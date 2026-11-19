package com.modaqqeq.owners

import android.content.Context
import org.json.JSONObject

// «الموقف المالي»: لقطة كل يوم من صفحة «الموقف المالى» في برنامج البيع بتاع كل فرع.
// السيرفر بيسحبها الساعة 4 الفجر (أو لما الأونر يدوس «هات دلوقتي»)، والتطبيق بيعرض السجل بس.
object FinPos {
    private fun prefs(c: Context) = c.getSharedPreferences("finpos", Context.MODE_PRIVATE)
    fun cached(c: Context): JSONObject? = prefs(c).getString("last", null)?.let { runCatching { JSONObject(it) }.getOrNull() }

    // الأونر والإدارة والدعم بس (مش المدير)
    fun allowed(c: Context): Boolean {
        val r = Account.role(c).ifBlank { c.getSharedPreferences("home", Context.MODE_PRIVATE).getString("role", "") ?: "" }
        return r in listOf("owner", "admin", "support")
    }

    // الأرقام بالترتيب اللي في صفحة البرنامج
    val FIELDS = listOf(
        "treasury" to "إجمالي أرصدة الخزن",
        "customers" to "إجمالي أرصدة العملاء",
        "inventory" to "إجمالي المخزون بسعر الشراء",
        "suppliers" to "إجمالي أرصدة الموردين",
        "totalFor" to "الإجمالي (له)",
        "totalAgainst" to "الإجمالي (عليه)",
    )

    fun err(e: String) = when (e) {
        "login" -> "ادخل بأكونتك تاني"
        "role" -> "الموقف المالي للأونر بس"
        "nosheet" -> "شيت «دليل الموظفين» مش متشارك مع سيرفر مدقق"
        "nobranch" -> "الفرع ده مش لاقيينه في «ربط برامج البيع» · اكتب اسمه هناك في إعداد المحل (اسم الفرع في التطبيق المجمع)"
        "poslogin" -> "برنامج البيع رفض اليوزر أو الباسورد اللي في الشيت"
        "noform", "parse" -> "برنامج البيع فتح بشكل مختلف · ابعت لدعم مدقق"
        "time" -> "الوقت خلص قبل الفرع ده · هيتسحب المرة الجاية"
        "net" -> "برنامج البيع مكانش بيرد"
        else -> "مقدرناش نجيب الموقف المالي · جرّب تاني"
    }
    private fun call(c: Context, body: JSONObject): Pair<JSONObject?, String?> {
        val t = try { Account.idToken(c) } catch (e: Exception) { return null to "مفيش نت" } ?: return null to "ادخل بأكونتك تاني"
        val j = try { JSONObject(Net.post(Account.SERVER, body.put("idToken", t).toString())) } catch (e: Exception) { return null to "مفيش نت · جرّب تاني" }
        return if (j.optBoolean("ok")) j to null else null to err(j.optString("error"))
    }

    fun load(c: Context): String? {
        val (j, e) = call(c, JSONObject().put("action", "finpos").put("days", 120))
        if (j == null) return e
        prefs(c).edit().putString("last", j.put("at", System.currentTimeMillis()).toString()).apply()
        return null
    }
    // «هات دلوقتي» لفرع واحد: null لو تمام، أو سبب الفشل
    fun now(c: Context, shopId: String): String? = call(c, JSONObject().put("action", "finposnow").put("shopId", shopId)).second
}
