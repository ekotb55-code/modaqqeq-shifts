package com.modaqqeq.owners

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

// «المشتريات»: فواتير المشتريات من لوحة الدعم (شيت «فواتير المشتريات»)، عن طريق سيرفر مدقق، لمحلات صاحب الأكونت بس.
object Purchases {
    private fun prefs(c: Context) = c.getSharedPreferences("purchases", Context.MODE_PRIVATE)
    fun days(c: Context) = prefs(c).getInt("days", 1)
    fun setDays(c: Context, d: Int) = prefs(c).edit().putInt("days", d).apply()
    fun supplier(c: Context) = prefs(c).getString("sup", "") ?: ""
    fun setSupplier(c: Context, s: String) = prefs(c).edit().putString("sup", s).apply()
    fun status(c: Context) = prefs(c).getString("st", "") ?: ""
    fun setStatus(c: Context, s: String) = prefs(c).edit().putString("st", s).apply()
    fun cached(c: Context): JSONObject? = prefs(c).getString("last", null)?.let { runCatching { JSONObject(it) }.getOrNull() }

    private fun err(e: String) = when (e) {
        "login" -> "ادخل بأكونتك تاني"
        "role" -> "الأكونت ده مش أونر ولا مدير"
        "nosheet" -> "شيت المشتريات لسه مش متشارك مع سيرفر مدقق"
        "notfound" -> "الفاتورة مش موجودة أو مش بتاعة محلاتك"
        else -> "مقدرناش نجيب المشتريات · جرّب تاني"
    }
    private fun call(c: Context, body: JSONObject): Pair<JSONObject?, String?> {
        val t = try { Account.idToken(c) } catch (e: Exception) { return null to "مفيش نت" } ?: return null to "ادخل بأكونتك تاني"
        val j = try { JSONObject(Net.post(Account.SERVER, body.put("idToken", t).toString())) } catch (e: Exception) { return null to "مفيش نت · جرّب تاني" }
        return if (j.optBoolean("ok")) j to null else null to err(j.optString("error"))
    }

    // يوم زيادة علشان «النهارده» يبقى من نص الليل بتوقيت مصر مش آخر 24 ساعة
    fun load(c: Context): String? {
        val (j, e) = call(c, JSONObject().put("action", "purchases").put("days", days(c).coerceAtLeast(1) + 1))
        if (j == null) return e
        prefs(c).edit().putString("last", j.put("at", System.currentTimeMillis()).toString()).apply()
        return null
    }
    fun detail(c: Context, id: String): Pair<JSONObject?, String?> = call(c, JSONObject().put("action", "purchase").put("id", id))

    // الصور بتتحفظ على الموبايل علشان متتجابش كل مرة
    fun image(c: Context, id: String, file: String): Bitmap? {
        val f = java.io.File(c.cacheDir, "pur_$file")
        if (!f.exists()) {
            val (j, _) = call(c, JSONObject().put("action", "pimage").put("id", id).put("file", file))
            val data = j?.optString("data") ?: return null
            f.writeBytes(Base64.decode(data.substringAfter("base64,"), Base64.DEFAULT))
        }
        val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(f.path, o)
        var s = 1; while (o.outWidth / s > 1400) s *= 2
        return BitmapFactory.decodeFile(f.path, BitmapFactory.Options().apply { inSampleSize = s })
    }

    fun ms(iso: String): Long = runCatching {
        SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }.parse(iso.take(19))!!.time
    }.getOrDefault(0L)
    fun dayOf(iso: String) = if (iso.isBlank()) "" else Home.dayKey(ms(iso))

    // الحالة ولونها
    fun look(st: String): Triple<String, String, String> = when {
        st.contains("تم") -> Triple("✓ تم الإدخال", "#E3F7E8", "#1B7F3B")
        st.contains("مرفوض") -> Triple("✗ مرفوضة", "#FDE7E7", "#B3261E")
        st.contains("الجودة") -> Triple("🔎 مستنية الجودة", "#F0E6FF", "#5B2A9E")
        st.contains("يتم") || st.contains("بيتدخل") || st.contains("بتدخل") -> Triple("⌨️ يتم الإدخال", "#E3F0FF", "#1565D8")
        st.contains("جديد") -> Triple("🆕 جديدة · لسه محدش مسكها", "#FFF3D6", "#8A5A00")
        else -> Triple(st.ifBlank { "—" }, "#EEF0F4", "#6B6A80")
    }
    fun pending(st: String) = !st.contains("تم") && !st.contains("مرفوض")
}
