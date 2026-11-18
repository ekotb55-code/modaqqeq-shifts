package com.modaqqeq.owners

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

// «التحويلات»: same page as in the shifts app, for the owner's phone.
//  وصلت دلوقتي → «شخصي» · مستنية قرارك → «ابعته للكاشير» / «شخصي» · أكّدها الكاشير → «✓ تبع المحل» / «✗ مش بتاعه» · اللي خلص → «رجّعه»
object Transfers {
    private const val DOCS = "projects/modaqqeq-shifts/databases/(default)/documents"
    private fun prefs(c: Context) = c.getSharedPreferences("transfers", Context.MODE_PRIVATE)
    fun days(c: Context) = prefs(c).getInt("days", 1)
    fun setDays(c: Context, d: Int) = prefs(c).edit().putInt("days", d).apply()
    fun wallet(c: Context) = prefs(c).getString("wallet", "") ?: ""
    fun setWallet(c: Context, w: String) = prefs(c).edit().putString("wallet", w).apply()
    fun cached(c: Context): JSONObject? = prefs(c).getString("last", null)?.let { runCatching { JSONObject(it) }.getOrNull() }

    fun load(c: Context): String? {
        val token = try { Account.idToken(c) } catch (e: Exception) { return "مفيش نت" } ?: return "ادخل بأكونتك تاني"
        val uid = Account.uid(c) ?: return "ادخل بأكونتك تاني"
        return try {
            val me = Home.get(token, "users/$uid") ?: return "مقدرناش نقرا الأكونت"
            val ids = me.optJSONArray("shopIds")?.let { a -> (0 until a.length()).map { a.getString(it) } } ?: emptyList()
            val now = System.currentTimeMillis()
            val days = (0 until days(c)).map { Home.dayKey(now - it * 86_400_000L) }
            val inDays = JSONObject().put("fieldFilter", JSONObject().put("field", JSONObject().put("fieldPath", "day")).put("op", "IN")
                .put("value", JSONObject().put("arrayValue", JSONObject().put("values", JSONArray(days.map { JSONObject().put("stringValue", it) })))))
            val shops = JSONArray(); val list = JSONArray()
            ids.forEach { id ->
                val s = Home.get(token, "shops/$id") ?: return@forEach
                shops.put(JSONObject().put("id", id).put("name", s.optString("name")))
                Home.query(token, "walletIn", Home.eq("shopId", id), inDays).filter { it.optString("status") != "auto" && it.optString("dir") != "out" }.forEach { list.put(it) }
            }
            prefs(c).edit().putString("last", JSONObject().put("at", now).put("shops", shops).put("list", list).toString()).apply()
            null
        } catch (e: Exception) { "مقدرناش نجيب التحويلات · جرّب تاني" }
    }

    // ── كتابة: كل تغيير بيتسجل باسم صاحب الأكونت، زي تطبيق الورديات ──
    private fun v(x: Any?): JSONObject = when (x) {
        null -> JSONObject().put("nullValue", JSONObject.NULL)
        is Boolean -> JSONObject().put("booleanValue", x)
        is Int -> JSONObject().put("integerValue", x.toString())
        is Long -> JSONObject().put("integerValue", x.toString())
        is Double -> JSONObject().put("doubleValue", x)
        is List<*> -> JSONObject().put("arrayValue", JSONObject().put("values", JSONArray(x.map { v(it) })))
        else -> JSONObject().put("stringValue", x.toString())
    }
    private fun upd(path: String, f: Map<String, Any?>) = JSONObject()
        .put("update", JSONObject().put("name", "$DOCS/$path").put("fields", JSONObject().apply { f.forEach { (k, x) -> put(k, v(x)) } }))
        .put("updateMask", JSONObject().put("fieldPaths", JSONArray(f.keys.toList())))
        .put("currentDocument", JSONObject().put("exists", true))
    private fun create(path: String, f: Map<String, Any?>) = JSONObject()
        .put("update", JSONObject().put("name", "$DOCS/$path").put("fields", JSONObject().apply { f.forEach { (k, x) -> put(k, v(x)) } }))
        .put("currentDocument", JSONObject().put("exists", false))
    private fun commit(c: Context, writes: List<JSONObject>): String? {
        val token = try { Account.idToken(c) } catch (e: Exception) { return "مفيش نت · جرّب تاني" } ?: return "ادخل بأكونتك تاني"
        val r = try { Net.authed("https://firestore.googleapis.com/v1/$DOCS:commit", token, JSONObject().put("writes", JSONArray(writes)).toString()) }
            catch (e: Exception) { return "مفيش نت · جرّب تاني" }
        return when {
            r.first == 200 -> null
            r.first == 403 -> "مش مسموحلك تغيّر ده"
            else -> "مقدرناش نحفظ · جرّب تاني"
        }
    }
    private fun stamp(c: Context): Map<String, Any?> = mapOf("decidedBy" to (Account.uid(c) ?: ""), "decidedByName" to Account.name(c), "decidedAtMs" to System.currentTimeMillis())
    private fun activity(c: Context, action: String, text: String, shopId: String, shiftId: String? = null): JSONObject {
        val now = System.currentTimeMillis()
        return create("activity/" + UUID.randomUUID().toString().replace("-", "").take(20), mapOf(
            "uid" to (Account.uid(c) ?: ""), "name" to Account.name(c), "role" to Account.role(c), "shopIds" to listOf(shopId),
            "action" to action, "text" to text.take(300), "shopId" to shopId, "shiftId" to shiftId,
            "device" to "mobile", "deviceLabel" to "مدقق Owners", "deviceId" to "owners", "day" to Home.dayKey(now),
            "atLocal" to java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US).apply { timeZone = java.util.TimeZone.getTimeZone("UTC") }.format(java.util.Date(now)),
        )).also { w -> w.getJSONObject("update").getJSONObject("fields").put("at", JSONObject().put("timestampValue",
            java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", java.util.Locale.US).apply { timeZone = java.util.TimeZone.getTimeZone("UTC") }.format(java.util.Date(now)))) }
    }
    private fun label(x: JSONObject) = "تحويل ${money(x.optDouble("amount"))} ج من ${x.optString("fromName").ifBlank { "عميل" }}"
    fun money(d: Double) = java.text.DecimalFormat("#,##0.##", java.text.DecimalFormatSymbols(java.util.Locale.US)).format(d)

    // every copy (branch) of the transfer gets the same status
    fun setAll(c: Context, copies: List<JSONObject>, status: String, what: String, release: Boolean = false): String? {
        val f = mapOf("status" to status) + (if (release) mapOf("releasedAtMs" to System.currentTimeMillis()) else emptyMap()) + stamp(c)
        val x = copies.first()
        return commit(c, copies.map { upd("walletIn/" + it.getString("_id"), f) } + activity(c, "sms_decide", "$what · ${label(x)}", x.optString("shopId")))
    }
    fun setOne(c: Context, x: JSONObject, status: String, what: String): String? =
        commit(c, listOf(upd("walletIn/" + x.getString("_id"), mapOf("status" to status) + stamp(c)), activity(c, "sms_decide", "$what · ${label(x)}", x.optString("shopId"))))
    // «مش بتاعه»: المبلغ بيرجع على الكاشير (العملية في ورديته بتتعلّم مرفوضة)
    fun refuse(c: Context, x: JSONObject, back: Boolean): String? {
        val now = System.currentTimeMillis()
        val w = mutableListOf(upd("walletIn/" + x.getString("_id"), mapOf("status" to (if (back) "claimed" else "rejected")) + stamp(c)))
        val sh = x.optString("claimedShiftId"); val en = x.optString("claimedEntryId")
        if (sh.isNotBlank() && en.isNotBlank()) w += upd("shifts/$sh/entries/$en", mapOf("smsRejected" to !back, "smsRejectedBy" to Account.name(c), "smsRejectedAt" to now))
        w += activity(c, if (back) "sms_unrefuse" else "sms_refuse", if (back) "رجّع ${label(x)} اللي كان رفضه" else "رفض ${label(x)} اللي ${x.optString("claimedByName")} أكّده (فاتورة ${x.optString("claimInvoice").ifBlank { "—" }})", x.optString("shopId"), sh.ifBlank { null })
        if (!back) w += create("outbox/" + UUID.randomUUID().toString().replace("-", "").take(20), mapOf(
            "type" to "sms_refused", "shopId" to x.optString("shopId"), "shiftId" to sh.ifBlank { null }, "to" to "staff", "toUid" to null,
            "title" to "❌ ${Account.name(c)} رفض تحويل ${money(x.optDouble("amount"))} ج".take(120), "body" to "اللي ${x.optString("claimedByName")} أكّده · المبلغ ده بقى على الكاشير".take(240),
            "byUid" to (Account.uid(c) ?: ""), "atMs" to now))
        return commit(c, w)
    }
}
