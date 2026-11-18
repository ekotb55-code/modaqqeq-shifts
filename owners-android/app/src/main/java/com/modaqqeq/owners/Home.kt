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
        "transfers" to "📲 وصل للمالك النهارده",
        "open" to "🧾 الورديات",
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
    internal fun query(token: String, coll: String, vararg filters: JSONObject): List<JSONObject> = queryIn(token, "", coll, *filters)
    // parent: "" للمجموعات الأساسية، أو "shifts/<id>" لعمليات وردية
    internal fun queryIn(token: String, parent: String, coll: String, vararg filters: JSONObject): List<JSONObject> {
        val where = if (filters.size == 1) filters[0] else JSONObject().put("compositeFilter", JSONObject().put("op", "AND").put("filters", JSONArray(filters.toList())))
        val body = JSONObject().put("structuredQuery", JSONObject().put("from", JSONArray().put(JSONObject().put("collectionId", coll))).put("where", where).put("limit", 500))
        val r = Net.authed(if (parent.isEmpty()) "$FS:runQuery" else "$FS/$parent:runQuery", token, body.toString())
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
            Photo.save(c, me.optString("photo").takeIf { it.startsWith("data:image") })
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
                // ورديات النهارده (أي حالة) + المفتوحة من أيام قبل كده، ومصروفات كل واحدة لايف
                val todays = query(token, "shifts", eq("shopId", id), eq("day", today))
                val shiftList = (todays + open.filter { o -> todays.none { it.optString("_id") == o.optString("_id") } })
                val revById = reviews.associateBy { it.optString("_id") }
                val ledById = ledger.associateBy { it.optString("_id") }
                val shiftsArr = JSONArray(shiftList.map { sh ->
                    val sid = sh.optString("_id")
                    val exp = runCatching { queryIn(token, "shifts/$sid", "entries", eq("type", "expense")) }.getOrDefault(emptyList()).filter { !it.optBoolean("deleted") }
                    val rv = revById[sid]; val lg = ledById[sid]
                    JSONObject().put("id", sid).put("cashier", sh.optString("cashierName")).put("status", sh.optString("status")).put("day", sh.optString("day"))
                        .put("openedAt", sh.optDouble("openedAt", 0.0)).put("submittedAt", sh.optDouble("submittedAt", 0.0)).put("closedAt", sh.optDouble("closedAt", 0.0))
                        .put("closedBy", sh.optString("closedBy")).put("register", sh.optString("registerName", sh.optString("register")))
                        .put("sales", rv?.optDouble("sales", Double.NaN)?.let { v -> if (v.isNaN()) JSONObject.NULL else v } ?: JSONObject.NULL)
                        .put("diffKind", lg?.optString("kind") ?: "").put("diffAmount", lg?.optDouble("amount", 0.0) ?: 0.0)
                        .put("expenses", JSONArray(exp.map { e -> JSONObject().put("amount", e.optDouble("amount", 0.0)).put("title", entryTitle(e)).put("kind", e.optString("kindLabel").ifBlank { "مصروف" })
                            .put("at", e.optDouble("createdAt", 0.0)).put("cashier", sh.optString("cashierName")).put("sid", sid) }))
                })
                val wIn = query(token, "walletIn", eq("shopId", id), eq("day", today))
                shopArr.put(JSONObject().put("id", id).put("name", s.optString("name")).put("shifts", shiftsArr)
                    .put("reviews", JSONArray(reviews.map { JSONObject().put("id", it.optString("_id")).put("sales", it.optDouble("sales", Double.NaN).let { v -> if (v.isNaN()) JSONObject.NULL else v }).put("cashier", it.optString("cashierName"))
                        .put("expenses", it.optJSONObject("totals")?.optDouble("expenses", 0.0) ?: 0.0).put("closed", !it.isNull("closedAt")).put("closedAt", it.optDouble("closedAt", 0.0))
                        .put("by", it.optString("accountantName")).put("startedAt", it.optDouble("startedAt", 0.0)).put("diff", it.optDouble("diff", Double.NaN).let { v -> if (v.isNaN()) JSONObject.NULL else v }) }))
                    .put("ledger", JSONArray(ledger.map { JSONObject().put("id", it.optString("_id")).put("kind", it.optString("kind")).put("amount", it.optDouble("amount", 0.0)).put("day", it.optString("day")).put("cashier", it.optString("cashierName"))
                        .put("acked", it.optBoolean("acknowledged")).put("ackRequired", it.optBoolean("ackRequired")).put("by", it.optString("by")).put("at", it.optDouble("createdAt", 0.0)) }))
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

    // نفس وصف العمليات اللي في شاشة الكاشير (src/cashier/Dash.jsx · entryTitle)
    fun entryTitle(e: JSONObject): String {
        fun j(vararg p: String?) = p.filter { !it.isNullOrBlank() }.joinToString(" · ")
        val money = { d: Double -> java.text.DecimalFormat("#,##0.##", java.text.DecimalFormatSymbols(Locale.US)).format(d) }
        return when (e.optString("type")) {
            "expense" -> j(e.optString("kindLabel").ifBlank { "مصروف" }, e.optString("sub"), if (e.optString("kind") == "supplier") (if (e.optString("invoice") == "invoice") "(فاتورة)" else "(توريد بدون فاتورة)") else "", e.optString("note"))
            "income" -> j("إيراد", e.optString("reason"), e.optString("note"))
            "transfer" -> j("تحويل ${walletName(e.optString("wallet"))}", e.optString("smsName"), e.optString("invoiceNo").takeIf { it.isNotBlank() }?.let { "فاتورة $it" }, if (e.optBoolean("smsRejected")) "❌ صاحب المحل رفضه" else if (e.optString("smsId").isNotBlank()) "✓ برسالة البنك" else "")
            "topup" -> j(if (e.optBoolean("credit")) "شحن آجل (دين للمندوب)" else "شحن رصيد", e.optString("machine"))
            "repPay" -> j("سداد لمندوب", e.optString("machine"))
            "move" -> if (e.optString("to", "side") == "side") "نقل من الدرج للجانبي" else "نقل من الجانبي للدرج"
            "withdraw" -> j("سحب لصاحب المحل", e.optString("note"))
            "liquidate" -> j("تسييل/تحويل ${e.optString("fromLabel")} ← ${e.optString("toLabel")}", e.optString("note"))
            "xfer_out" -> j("فلوس لـ ${e.optString("toName").ifBlank { "كاشير تاني" }}", e.optString("note"))
            "xfer_in" -> j("استلام من ${e.optString("fromName").ifBlank { "كاشير تاني" }}", if (e.has("sentAmount") && e.optBoolean("diffFromSent")) "(اتبعت ${money(e.optDouble("sentAmount"))})" else "")
            else -> e.optString("type")
        }
    }
    // الوردية كاملة: اللي استلمه، والتسليم، وإعدادات المحل (الخزن والمكن)، وكل العمليات
    fun shiftFull(c: Context, sid: String, shopId: String): Pair<JSONObject?, String?> {
        val token = try { Account.idToken(c) } catch (e: Exception) { return null to "مفيش نت" } ?: return null to "ادخل بأكونتك تاني"
        return try {
            val sh = get(token, "shifts/$sid") ?: return null to "مقدرناش نجيب الوردية"
            val shop = get(token, "shops/${shopId.ifBlank { sh.optString("shopId") }}") ?: JSONObject()
            val (es, e) = shiftEntries(c, sid)
            if (es == null) return null to e
            JSONObject().put("shift", sh).put("shop", shop).put("entries", JSONArray(es)) to null
        } catch (e: Exception) { null to "مفيش نت · جرّب تاني" }
    }

    // ── الفلوس في كل خزنة (نفس flows/computeShift في src/lib.js) ──
    data class Safe(val key: String, val label: String, val open: Double, var inn: Double = 0.0, var out: Double = 0.0, val lines: MutableList<Pair<String, Double>> = mutableListOf())
    fun safes(shift: JSONObject, entries: List<JSONObject>, shop: JSONObject): List<Safe> {
        val rcv = shift.optJSONObject("receive") ?: JSONObject()
        fun arr(o: JSONObject?, k: String) = o?.optJSONArray(k)?.let { a -> (0 until a.length()).mapNotNull { a.optJSONObject(it) } } ?: emptyList()
        val mKey = { m: JSONObject -> "m:${m.optString("machine")}|${m.optString("account")}" }
        val vaults = arr(shop, "vaults").filter { it.optBoolean("active", true) && it.optString("name").isNotBlank() }
        val modes = shop.optJSONObject("walletModes") ?: JSONObject()
        val shopWallets = shop.optJSONArray("wallets")?.let { a -> (0 until a.length()).map { a.getString(it) } } ?: listOf("insta", "vf")
        val list = LinkedHashMap<String, Safe>()
        fun addSafe(k: String, label: String, open: Double) { if (k !in list) list[k] = Safe(k, label, open) }
        addSafe("drawer", "درج الكاشير", rcv.optDouble("drawerTotal", 0.0))
        if (!shop.optBoolean("noSide")) addSafe("side", "الدرج الجانبي", rcv.optDouble("side", 0.0))
        vaults.forEach { v -> addSafe("vault:" + v.optString("id"), v.optString("name"), rcv.optJSONObject("vaults")?.optDouble(v.optString("id"), 0.0) ?: 0.0) }
        (arr(rcv, "machines") + arr(shop, "machines")).forEach { m -> addSafe(mKey(m), "${m.optString("machine")} · ${m.optString("account")}", arr(rcv, "machines").firstOrNull { mKey(it) == mKey(m) }?.optDouble("value", 0.0) ?: 0.0) }
        shopWallets.forEach { w -> addSafe(w, walletName(w), if (modes.optString(w) == "owner") 0.0 else rcv.optJSONObject("wallets")?.optDouble(w, 0.0) ?: 0.0) }
        fun move(k: String, label: String, a: Double) { val s = list[k] ?: return; s.lines += label to a; if (a >= 0) s.inn += a else s.out -= a }
        val firstAcc = { name: String -> arr(shop, "machines").firstOrNull { it.optString("machine") == name }?.let(mKey) ?: "m:$name|الرصيد" }
        entries.filter { !(it.optString("type") == "transfer" && it.optBoolean("smsRejected")) }.forEach { e ->
            val a = e.optDouble("amount", 0.0); val src = e.optString("src")
            val flows: List<Triple<String, String, Double>> = when (e.optString("type")) {
                "expense" -> listOf(Triple(src, "out:expense", a))
                "income" -> listOf(Triple("in:income", src, a))
                "transfer" -> listOf(Triple("in:customer", e.optString("wallet"), a))
                "topup" -> listOf(Triple(if (e.optBoolean("credit")) "in:rep" else src, e.optString("machineKey").ifBlank { firstAcc(e.optString("machine")) }, a))
                "repPay" -> listOf(Triple(src, "out:rep", a))
                "move" -> { val to = e.optString("to").ifBlank { "side" }; listOf(Triple(src.ifBlank { if (to == "side") "drawer" else "side" }, to, a)) }
                "withdraw" -> listOf(Triple(src, "out:owner", a))
                "liquidate" -> { val fee = e.optDouble("fee", 0.0); if (fee > 0) listOf(Triple(src, e.optString("to"), a - fee), Triple(src, "out:fees", fee)) else listOf(Triple(src, e.optString("to"), a)) }
                "xfer_out" -> listOf(Triple(src.ifBlank { "drawer" }, "out:reg", a))
                "xfer_in" -> listOf(Triple("in:reg", src.ifBlank { "drawer" }, a))
                else -> emptyList()
            }
            val t = entryTitle(e)
            flows.forEach { (from, to, x) -> move(from, t, -x); move(to, t, x) }
        }
        return list.values.toList()
    }

    // كل عمليات وردية (لشاشة تفاصيل الوردية)
    fun shiftEntries(c: Context, sid: String): Pair<List<JSONObject>?, String?> {
        val token = try { Account.idToken(c) } catch (e: Exception) { return null to "مفيش نت" } ?: return null to "ادخل بأكونتك تاني"
        return try {
            val body = JSONObject().put("structuredQuery", JSONObject().put("from", JSONArray().put(JSONObject().put("collectionId", "entries"))).put("limit", 1000))
            val r = Net.authed("$FS/shifts/$sid:runQuery", token, body.toString())
            if (r.first != 200) return null to "مقدرناش نجيب عمليات الوردية"
            val a = JSONArray(r.second)
            val list = (0 until a.length()).mapNotNull { a.getJSONObject(it).optJSONObject("document") }.map { d -> fields(d).put("_id", d.getString("name").substringAfterLast('/')) }
                .filter { !it.optBoolean("deleted") }.sortedBy { it.optDouble("createdAt", 0.0) }
            list to null
        } catch (e: Exception) { null to "مفيش نت · جرّب تاني" }
    }
}
