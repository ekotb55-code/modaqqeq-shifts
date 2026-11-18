package com.modaqqeq.owners

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

// 👥 الأكونتات: الأونر أو المدير بيعمل أكونت مدير جديد لفروع من فروعه، ويوقّفه أو يرجّعه.
// الأكونت الجديد بيشتغل في تطبيق الورديات وفي مدقق Owners بنفس الإيميل والباسورد.
object Users {
    private const val KEY = "AIzaSyCRCvSveuol7K9eQdDVTPEFundBVD8HtWs"
    private const val DOCS = "projects/modaqqeq-shifts/databases/(default)/documents"
    private fun prefs(c: Context) = c.getSharedPreferences("users", Context.MODE_PRIVATE)
    fun cached(c: Context): JSONArray = prefs(c).getString("list", null)?.let { runCatching { JSONArray(it) }.getOrNull() } ?: JSONArray()

    private fun str(v: String) = JSONObject().put("stringValue", v)
    private fun arr(l: List<String>) = JSONObject().put("arrayValue", JSONObject().put("values", JSONArray(l.map { str(it) })))

    // المديرين اللي أنا عملتهم (أو عملهم حد تحتي)
    fun load(c: Context): String? {
        val token = runCatching { Account.idToken(c) }.getOrNull() ?: return "مفيش نت"
        val uid = Account.uid(c) ?: return "ادخل بأكونتك تاني"
        val body = JSONObject().put("structuredQuery", JSONObject().put("from", JSONArray().put(JSONObject().put("collectionId", "users")))
            .put("where", JSONObject().put("fieldFilter", JSONObject().put("field", JSONObject().put("fieldPath", "chain")).put("op", "ARRAY_CONTAINS").put("value", str(uid))))
            .put("limit", 200))
        val r = runCatching { Net.authed("${Home.FS}:runQuery", token, body.toString()) }.getOrElse { return "مفيش نت · جرّب تاني" }
        if (r.first != 200) return "مقدرناش نجيب الأكونتات"
        val a = JSONArray(r.second)
        val out = JSONArray()
        for (i in 0 until a.length()) {
            val d = a.getJSONObject(i).optJSONObject("document") ?: continue
            val f = d.optJSONObject("fields") ?: JSONObject()
            fun s(k: String) = f.optJSONObject(k)?.optString("stringValue") ?: ""
            val shops = f.optJSONObject("shopIds")?.optJSONObject("arrayValue")?.optJSONArray("values")?.let { v -> (0 until v.length()).map { v.getJSONObject(it).optString("stringValue") } } ?: emptyList()
            out.put(JSONObject().put("id", d.getString("name").substringAfterLast('/')).put("name", s("name")).put("email", s("email"))
                .put("by", s("createdByName")).put("mine", s("createdBy") == uid).put("shopIds", JSONArray(shops))
                .put("disabled", f.optJSONObject("disabled")?.optBoolean("booleanValue") ?: false))
        }
        prefs(c).edit().putString("list", out.toString()).apply()
        return null
    }

    // أكونت مدير جديد: نعمله في تسجيل الدخول، وبعدين ملفه في مدقق بفروعه. لو الملف فشل، نمسح الأكونت تاني.
    fun create(c: Context, name: String, email: String, pass: String, shopIds: List<String>): String? {
        if (name.isBlank()) return "اكتب الاسم"
        if (!Regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$").matches(email.trim())) return "الإيميل مش مظبوط"
        if (pass.length < 6) return "الباسورد ٦ حروف أو أرقام على الأقل"
        if (shopIds.isEmpty()) return "اختار فرع واحد على الأقل"
        val token = runCatching { Account.idToken(c) }.getOrNull() ?: return "مفيش نت"
        val uid = Account.uid(c) ?: return "ادخل بأكونتك تاني"
        val me = runCatching { Home.get(token, "users/$uid") }.getOrNull() ?: return "مقدرناش نقرا أكونتك"
        if (me.optString("role") !in listOf("owner", "manager")) return "الأونر والمدير بس هما اللي يعملوا أكونتات"
        val myShops = me.optJSONArray("shopIds")?.let { a -> (0 until a.length()).map { a.getString(it) } } ?: emptyList()
        if (!myShops.containsAll(shopIds)) return "فيه فرع مش بتاعك"
        val chain = (me.optJSONArray("chain")?.let { a -> (0 until a.length()).map { a.getString(it) } } ?: emptyList()) + uid

        val su = runCatching {
            Net.call("https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=$KEY",
                JSONObject().put("email", email.trim()).put("password", pass).put("returnSecureToken", true).toString(), "application/json")
        }.getOrElse { return "مفيش نت · جرّب تاني" }
        val sj = runCatching { JSONObject(su.second) }.getOrNull() ?: return "حصلت مشكلة · جرّب تاني"
        if (su.first >= 400) {
            val m = sj.optJSONObject("error")?.optString("message") ?: ""
            return when {
                m.contains("EMAIL_EXISTS") -> "الإيميل ده عليه أكونت قبل كده"
                m.contains("WEAK_PASSWORD") -> "الباسورد ضعيف · ٦ حروف أو أرقام على الأقل"
                m.contains("INVALID_EMAIL") -> "الإيميل مش مظبوط"
                m.contains("TOO_MANY") -> "محاولات كتير · استنى شوية"
                else -> "مقدرناش نعمل الأكونت"
            }
        }
        val newUid = sj.optString("localId"); val newTok = sj.optString("idToken")
        // الاسم يبان في تسجيل الدخول كمان
        runCatching { Net.call("https://identitytoolkit.googleapis.com/v1/accounts:update?key=$KEY", JSONObject().put("idToken", newTok).put("displayName", name.trim()).toString(), "application/json") }

        val fields = JSONObject().put("role", str("manager")).put("name", str(name.trim())).put("email", str(email.trim().lowercase()))
            .put("shopIds", arr(shopIds)).put("color", str(listOf("#1565D8", "#A07CFF", "#FF7A1A", "#1B7F3B", "#C2549A", "#0E9384").random()))
            .put("createdAt", JSONObject().put("integerValue", System.currentTimeMillis().toString()))
            .put("createdBy", str(uid)).put("createdByName", str(Account.name(c))).put("chain", arr(chain))
        val w = JSONObject().put("update", JSONObject().put("name", "$DOCS/users/$newUid").put("fields", fields))
            .put("currentDocument", JSONObject().put("exists", false))
        val r = runCatching { Net.authed("${Home.FS}:commit", token, JSONObject().put("writes", JSONArray().put(w)).toString()) }.getOrNull()
        if (r == null || r.first != 200) {
            runCatching { Net.call("https://identitytoolkit.googleapis.com/v1/accounts:delete?key=$KEY", JSONObject().put("idToken", newTok).toString(), "application/json") }
            return "مقدرناش نحفظ الأكونت في مدقق · مفيش حاجة اتعملت"
        }
        load(c)
        return null
    }

    fun setDisabled(c: Context, id: String, off: Boolean): String? {
        val token = runCatching { Account.idToken(c) }.getOrNull() ?: return "مفيش نت"
        val uid = Account.uid(c) ?: return "ادخل بأكونتك تاني"
        val w = JSONObject().put("update", JSONObject().put("name", "$DOCS/users/$id").put("fields", JSONObject()
                .put("disabled", JSONObject().put("booleanValue", off))
                .put("disabledAt", JSONObject().put("integerValue", System.currentTimeMillis().toString()))
                .put("disabledBy", str(uid))))
            .put("updateMask", JSONObject().put("fieldPaths", JSONArray().put("disabled").put("disabledAt").put("disabledBy")))
            .put("currentDocument", JSONObject().put("exists", true))
        val r = runCatching { Net.authed("${Home.FS}:commit", token, JSONObject().put("writes", JSONArray().put(w)).toString()) }.getOrNull()
        if (r == null || r.first != 200) return "مقدرناش نغيّر · جرّب تاني"
        load(c)
        return null
    }
}
