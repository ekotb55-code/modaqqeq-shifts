package com.modaqqeq.owners

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

// One "connection" = one Modaqqeq bank-messages link (one wallet) and where its messages come from:
// apps whose notifications are read (InstaPay, الأهلي فون كاش…) and SMS senders (ALEXBANK, NBE…).
data class Conn(
    val id: String,
    val name: String,
    val url: String,
    val apps: List<String>,      // package names
    val appNames: List<String>,  // shown in the list
    val senders: List<String>,   // SMS sender names, matched case-insensitively
    val managed: Boolean = false, // came by itself from Modaqqeq (account / shop phone)
    val wallet: String = "",
    val shopName: String = "",
    val on: Boolean = true,       // «على الموبايل ده»
    val edited: Boolean = false,  // apps/senders changed by hand → keep them on the next sync
)

object Store {
    private const val P = "owners"
    private fun prefs(c: Context) = c.getSharedPreferences(P, Context.MODE_PRIVATE)

    fun conns(c: Context): List<Conn> {
        val arr = JSONArray(prefs(c).getString("conns", "[]"))
        return (0 until arr.length()).map { i ->
            val o = arr.getJSONObject(i)
            Conn(
                o.getString("id"), o.optString("name"), o.getString("url"),
                o.optJSONArray("apps").strings(), o.optJSONArray("appNames").strings(), o.optJSONArray("senders").strings(),
                o.optBoolean("managed"), o.optString("wallet"), o.optString("shopName"), o.optBoolean("on", true), o.optBoolean("edited"),
            )
        }
    }

    fun saveConns(c: Context, list: List<Conn>) {
        val arr = JSONArray()
        list.forEach { x ->
            arr.put(JSONObject().apply {
                put("id", x.id); put("name", x.name); put("url", x.url)
                put("apps", JSONArray(x.apps)); put("appNames", JSONArray(x.appNames)); put("senders", JSONArray(x.senders))
                put("managed", x.managed); put("wallet", x.wallet); put("shopName", x.shopName); put("on", x.on); put("edited", x.edited)
            })
        }
        prefs(c).edit().putString("conns", arr.toString()).apply()
    }

    // «الموبايل ده مش بيقرا محافظ»: موبايل أونر أو مدير مش عليه انستا ولا محافظ → مفيش قراية ولا صلاحيات ولا تنبيهات
    fun readOff(c: Context) = prefs(c).getBoolean("readOff", false)
    fun setReadOff(c: Context, v: Boolean) = prefs(c).edit().putBoolean("readOff", v).apply()

    fun active(c: Context) = if (readOff(c)) emptyList() else conns(c).filter { it.on }

    // The wallets Modaqqeq gave this phone: add new ones, update moved ones, drop removed ones.
    // Hand-made links to the same wallet are replaced; «على الموبايل ده» and hand edits are kept.
    fun applyManaged(c: Context, keys: List<JSONObject>) {
        synchronized(this) {
            val old = conns(c)
            val byId = old.associateBy { it.id }
            val nbeToo = keys.any { it.optString("wallet") == "nbe" }
            val ids = keys.map { it.optString("k") }
            val manual = old.filter { m -> !m.managed && ids.none { id -> m.url.contains("k=$id") } }
            val managed = keys.map { k ->
                val id = k.optString("k"); val w = k.optString("wallet"); val prev = byId[id]
                val apps = Defaults.apps(c, w)
                val base = Conn(id, k.optString("label"), k.optString("url"), apps.map { it.first }, apps.map { it.second }, Defaults.senders(w, nbeToo),
                    managed = true, wallet = w, shopName = k.optString("shopName"), on = prev?.on ?: true)
                if (prev != null && prev.edited) base.copy(apps = prev.apps, appNames = prev.appNames, senders = prev.senders, edited = true) else base
            }
            saveConns(c, manual + managed)
        }
    }

    // What was sent lately (shown on the main screen)
    fun log(c: Context): JSONArray = JSONArray(prefs(c).getString("log", "[]"))
    fun addLog(c: Context, source: String, text: String, result: String) {
        synchronized(this) {
            val old = log(c)
            val arr = JSONArray()
            arr.put(JSONObject().apply { put("at", System.currentTimeMillis()); put("src", source); put("text", text.take(140)); put("res", result) })
            for (i in 0 until minOf(old.length(), 29)) arr.put(old.get(i))
            prefs(c).edit().putString("log", arr.toString()).apply()
        }
    }

    // The same notification is often posted again (updated): send it once a minute at most.
    fun seenRecently(c: Context, key: String): Boolean {
        synchronized(this) {
            val p = prefs(c)
            val o = JSONObject(p.getString("seen", "{}"))
            val now = System.currentTimeMillis()
            val last = o.optLong(key, 0)
            val keep = JSONObject()
            o.keys().forEach { k -> if (now - o.optLong(k) < 10 * 60_000) keep.put(k, o.optLong(k)) }
            keep.put(key, now)
            p.edit().putString("seen", keep.toString()).apply()
            return now - last < 60_000
        }
    }

    private fun JSONArray?.strings(): List<String> = if (this == null) emptyList() else (0 until length()).map { getString(it) }
}

// Only messages about money coming in or going out — never OTPs or ads.
object Filter {
    private val words = Regex("استلم|استقبل|إستلام|استلام|تحويل|حوّل|حول|أضيف|اضيف|إضافة|اضافة|خصم|سحب|ايداع|إيداع|received|transfer|credited|debited", RegexOption.IGNORE_CASE)
    private val otp = Regex("كود|رمز التحقق|OTP|كلمة المرور|password|code", RegexOption.IGNORE_CASE)
    fun money(text: String): Boolean = Regex("\\d").containsMatchIn(text) && words.containsMatchIn(text) && !otp.containsMatchIn(text)
}
