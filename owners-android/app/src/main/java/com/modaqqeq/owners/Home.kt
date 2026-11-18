package com.modaqqeq.owners

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

// The owner's home: alerts + the summary cards he chose, read straight from Modaqqeq with his own sign-in
// (no Google Apps Script, so it never touches the daily limit).
object Home {
    internal const val FS = "https://firestore.googleapis.com/v1/projects/modaqqeq-shifts/databases/(default)/documents"
    private fun prefs(c: Context) = c.getSharedPreferences("home", Context.MODE_PRIVATE)

    // ── what the owner chose ──
    val CARDS = listOf(
        "sales" to "💰 مبيعات النهارده",
        "expenses" to "🧾 مصروفات النهارده",
        "diff" to "⚖️ العجز والزيادة الشهر ده",
        "transfers" to "📲 التحويلات النهارده",
        "open" to "🟢 الورديات المفتوحة دلوقتي",
        "balances" to "🏦 رصيد المحافظ",
        "purchases" to "🛒 مشتريات النهارده",
    )
    fun cards(c: Context): Set<String> = prefs(c).getStringSet("cards", null) ?: CARDS.map { it.first }.toSet()
    fun setCards(c: Context, v: Set<String>) = prefs(c).edit().putStringSet("cards", v).apply()
    fun shortageMin(c: Context) = prefs(c).getInt("shortMin", 50)
    fun longHours(c: Context) = prefs(c).getInt("longH", 12)
    fun setLimits(c: Context, shortMin: Int, longH: Int) = prefs(c).edit().putInt("shortMin", shortMin).putInt("longH", longH).apply()
    fun shop(c: Context) = prefs(c).getString("shop", "") ?: ""            // "" = كل المحلات
    fun setShop(c: Context, id: String) = prefs(c).edit().putString("shop", id).apply()

    // last result, shown right away while the new one loads
    fun cached(c: Context): JSONObject? = prefs(c).getString("last", null)?.let { runCatching { JSONObject(it) }.getOrNull() }

    // ── Firestore REST ──
    private fun value(v: JSONObject?): Any? {
        if (v == null) return null
        return when {
            v.has("stringValue") -> v.getString("stringValue")
            v.has("integerValue") -> v.getString("integerValue").toDoubleOrNull() ?: 0.0
            v.has("doubleValue") -> v.getDouble("doubleValue")
            v.has("booleanValue") -> v.getBoolean("booleanValue")
            v.has("timestampValue") -> parseTime(v.getString("timestampValue"))
            v.has("mapValue") -> fields(v.getJSONObject("mapValue"))
            v.has("arrayValue") -> JSONArray().apply { v.getJSONObject("arrayValue").optJSONArray("values")?.let { a -> for (i in 0 until a.length()) put(value(a.getJSONObject(i))) } }
            else -> null
        }
    }
    private fun fields(doc: JSONObject): JSONObject {
        val out = JSONObject(); val f = doc.optJSONObject("fields") ?: return out
        f.keys().forEach { k -> out.put(k, value(f.getJSONObject(k)) ?: JSONObject.NULL) }
        return out
    }
    private fun parseTime(s: String): Double = runCatching {
        val f = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }
        f.parse(s.take(19))!!.time.toDouble()
    }.getOrDefault(0.0)

    internal fun get(token: String, path: String): JSONObject? {
        val r = Net.authed("$FS/$path", token, null)
        return if (r.first == 200) fields(JSONObject(r.second)) else null
    }
    internal fun eq(field: String, v: String) = JSONObject().put("fieldFilter", JSONObject().put("field", JSONObject().put("fieldPath", field)).put("op", "EQUAL").put("value", JSONObject().put("stringValue", v)))
    internal fun query(token: String, coll: String, vararg filters: JSONObject): List<JSONObject> {
        val where = if (filters.size == 1) filters[0] else JSONObject().put("compositeFilter", JSONObject().put("op", "AND").put("filters", JSONArray(filters.toList())))
        val body = JSONObject().put("structuredQuery", JSONObject().put("from", JSONArray().put(JSONObject().put("collectionId", coll))).put("where", where).put("limit", 500))
        val r = Net.authed("$FS:runQuery", token, body.toString())
        if (r.first != 200) throw Exception("read $coll ${r.first}")
        val a = JSONArray(r.second)
        return (0 until a.length()).mapNotNull { a.getJSONObject(it).optJSONObject("document") }.map { d -> fields(d).put("_id", d.getString("name").substringAfterLast('/')) }
    }

    private val cairo = TimeZone.getTimeZone("Africa/Cairo")
    internal fun dayKey(ms: Long) = SimpleDateFormat("yyyy-MM-dd", Locale.US).apply { timeZone = cairo }.format(Date(ms))
    private val WALLET = mapOf("insta" to "انستاباي", "insta2" to "انستاباي شخصي", "vf" to "فودافون كاش", "vf2" to "فودافون كاش شخصي", "nbe" to "الأهلي فون كاش")

    // Everything the home needs, for the shops this account may see. Returns an error text or null.
    fun load(c: Context): String? {
        val token = try { Account.idToken(c) } catch (e: Exception) { return "مفيش نت" } ?: return "ادخل بأكونتك تاني"
        val uid = Account.uid(c) ?: return "ادخل بأكونتك تاني"
        try {
            val me = get(token, "users/$uid") ?: return "مقدرناش نقرا الأكونت"
            val role = me.optString("role")
            val ids = me.optJSONArray("shopIds")?.let { a -> (0 until a.length()).map { a.getString(it) } } ?: emptyList()
            val shops = (if (ids.isEmpty() && role in listOf("admin", "support")) emptyList() else ids)
                .mapNotNull { id -> get(token, "shops/$id")?.put("_id", id) }
                .filter { !it.optBoolean("disabled") }
            val now = System.currentTimeMillis()
            val today = dayKey(now); val yesterday = dayKey(now - 86_400_000); val month = today.take(7)
            val out = JSONObject().put("at", now).put("today", today)
            val shopArr = JSONArray()
            shops.forEach { s ->
                val id = s.getString("_id")
                val reviews = query(token, "reviews", eq("shopId", id), eq("day", today))
                val ledger = query(token, "ledger", eq("shopId", id), eq("month", month))
                val open = query(token, "shifts", eq("shopId", id), eq("status", "open"))
                val wIn = query(token, "walletIn", eq("shopId", id), eq("day", today))
                shopArr.put(JSONObject().put("id", id).put("name", s.optString("name"))
                    .put("reviews", JSONArray(reviews.map { JSONObject().put("sales", it.optDouble("sales", Double.NaN).let { v -> if (v.isNaN()) JSONObject.NULL else v }).put("cashier", it.optString("cashierName")).put("expenses", it.optJSONObject("totals")?.optDouble("expenses", 0.0) ?: 0.0).put("closed", !it.isNull("closedAt")) }))
                    .put("ledger", JSONArray(ledger.map { JSONObject().put("kind", it.optString("kind")).put("amount", it.optDouble("amount", 0.0)).put("day", it.optString("day")).put("cashier", it.optString("cashierName")) }))
                    .put("open", JSONArray(open.map { JSONObject().put("cashier", it.optString("cashierName")).put("at", it.optDouble("openedAt", 0.0).takeIf { v -> v > 0 } ?: runCatching { parseTime(it.optString("openedAtLocal")) }.getOrDefault(0.0)) }))
                    .put("wallet", JSONArray(wIn.map { JSONObject().put("w", it.optString("wallet")).put("dir", it.optString("dir")).put("amount", it.optDouble("amount", 0.0)).put("status", it.optString("status"))
                        .put("bankOk", it.optBoolean("bankOk", true)).put("from", it.optString("fromName")).put("bal", it.optDouble("balance", Double.NaN).let { v -> if (v.isNaN()) JSONObject.NULL else v }).put("atMs", it.optDouble("atMs", 0.0)).put("group", it.optString("group")) })))
            }
            out.put("shops", shopArr).put("yesterday", yesterday)
            prefs(c).edit().putString("last", out.toString()).apply()
            return null
        } catch (e: Exception) { return "مقدرناش نجيب الأرقام · جرّب تاني" }
    }

    fun walletName(k: String) = WALLET[k] ?: k
}
