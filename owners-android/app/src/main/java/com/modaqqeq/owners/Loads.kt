package com.modaqqeq.owners

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import org.json.JSONObject

// «التحميل والتفريغ»: طلبات مناديب التوزيع لمحلات صاحب الأكونت (الشيت اللي المندوب كتبه + صورة فاتورة السيستم)،
// من سيرفر التحميل والتفريغ نفسه بدخول الأكونت (السيرفر بيتأكد إنه أونر ويجيب محلاته بس) — قراية بس.
object Loads {
    private const val API = "https://script.google.com/macros/s/AKfycbzAiM8070GNCmLGOMYDeCHdf-cCMMFFJ3GIjpzznb5znOyWwAHlYZF1eRpqpju9-RoY/exec"
    private fun prefs(c: Context) = c.getSharedPreferences("loads", Context.MODE_PRIVATE)
    fun days(c: Context) = prefs(c).getInt("days", 1)
    fun setDays(c: Context, d: Int) = prefs(c).edit().putInt("days", d).apply()
    fun cached(c: Context): JSONObject? = prefs(c).getString("last", null)?.let { runCatching { JSONObject(it) }.getOrNull() }
    // الكارت في الرئيسية بيظهر بس لو الأكونت ليه مناديب (أول ما يظهر أي طلب)
    fun ever(c: Context) = prefs(c).getBoolean("ever", false)
    fun notifyOn(c: Context) = prefs(c).getBoolean("notify", true)
    fun setNotify(c: Context, v: Boolean) { prefs(c).edit().putBoolean("notify", v).apply(); InvoiceWatch.schedule(c) }

    private fun call(c: Context, action: String, data: JSONObject): Pair<JSONObject?, String?> {
        val t = try { Account.idToken(c) } catch (e: Exception) { return null to "مفيش نت" } ?: return null to "ادخل بأكونتك تاني"
        val body = JSONObject().put("auth", JSONObject().put("kind", "fb").put("idToken", t)).put("action", action).put("data", data)
        val j = try { JSONObject(Net.post(API, body.toString())) } catch (e: Exception) { return null to "مفيش نت · جرّب تاني" }
        return if (j.optBoolean("ok")) j to null else null to j.optString("err").ifBlank { "مقدرناش نجيب التحميل والتفريغ · جرّب تاني" }
    }
    fun list(c: Context, days: Int): Pair<JSONObject?, String?> = call(c, "owner", JSONObject().put("days", days))

    fun load(c: Context): String? {
        val d = days(c)
        val (j, e) = list(c, d)
        if (j == null) return e
        val p = prefs(c).edit().putString("last", j.put("at", System.currentTimeMillis()).put("days", d).toString())
        if ((j.optJSONArray("list")?.length() ?: 0) > 0) p.putBoolean("ever", true)
        p.apply()
        return null
    }

    // صورة السيستم بتتحفظ على الموبايل علشان متتجابش كل مرة
    fun image(c: Context, id: String): Bitmap? {
        val f = java.io.File(c.cacheDir, "lu_$id")
        if (!f.exists()) {
            val (j, _) = call(c, "img", JSONObject().put("id", id))
            val data = j?.optString("img")?.takeIf { it.isNotBlank() } ?: return null
            f.writeBytes(Base64.decode(data.substringAfter("base64,"), Base64.DEFAULT))
        }
        val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(f.path, o)
        var s = 1; while (o.outWidth / s > 1400) s *= 2
        return BitmapFactory.decodeFile(f.path, BitmapFactory.Options().apply { inSampleSize = s })
    }

    fun typeName(x: JSONObject) = if (x.optString("type") == "load") "تحميل" else "تفريغ"
    // الحالة ولونها
    fun look(st: String): Triple<String, String, String> = when (st) {
        "done" -> Triple("✓ اتعتمد", "#E3F7E8", "#1B7F3B")
        "qa" -> Triple("🔎 مستني الجودة", "#F0E6FF", "#5B2A9E")
        "received" -> Triple("⌨️ الدعم بيرفعه", "#E3F0FF", "#1565D8")
        else -> Triple("🆕 اتبعت للدعم", "#FFF3D6", "#8A5A00")
    }

    // إشعار لما طلب يتعتمد (بيشيّك مع فواتير المشتريات كل ربع ساعة)
    fun watch(c: Context) {
        if (Account.mode(c) != "user" || !notifyOn(c)) return
        val (j, _) = list(c, 1)
        val arr = j?.optJSONArray("list") ?: return
        val p = prefs(c)
        val seen = runCatching { JSONObject(p.getString("seen", null) ?: "") }.getOrNull()
        val now = JSONObject()
        val done = ArrayList<JSONObject>()
        for (i in 0 until arr.length()) {
            val x = arr.getJSONObject(i)
            val id = x.optString("id"); if (id.isBlank()) continue
            now.put(id, x.optString("status"))
            if (seen != null && x.optString("status") == "done" && seen.optString(id) != "done") done += x
        }
        val ed = p.edit().putString("seen", now.toString())
        if (arr.length() > 0) ed.putBoolean("ever", true)
        ed.apply()
        if (seen == null || done.isEmpty()) return
        if (done.size == 1) {
            val x = done[0]
            notify(c, "🚚 ${typeName(x)} ${x.optString("driver")} اتعتمد ✅",
                listOf(x.optString("truck"), x.optString("shop"), "${x.optJSONArray("lines")?.length() ?: 0} صنف").filter { it.isNotBlank() }.joinToString(" · ") +
                    "\nالشيت وصورة السيستم جنب بعض في التطبيق", x.optString("id"))
        } else notify(c, "🚚 ${done.size} طلبات تحميل وتفريغ اتعتمدت ✅", done.map { typeName(it) + " " + it.optString("driver") }.distinct().take(4).joinToString("، "), "")
    }

    private const val CH = "loads"
    private fun notify(c: Context, title: String, body: String, id: String) {
        val nm = c.getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CH) == null) nm.createNotificationChannel(NotificationChannel(CH, "التحميل والتفريغ", NotificationManager.IMPORTANCE_HIGH))
        val n = (System.currentTimeMillis() % 100000).toInt()
        val open = Intent(c, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra("openLoad", id.ifBlank { "*" })
        val pi = PendingIntent.getActivity(c, n, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val b = NotificationCompat.Builder(c, CH).setSmallIcon(R.drawable.ic_stat).setContentTitle(title).setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body)).setPriority(NotificationCompat.PRIORITY_HIGH).setAutoCancel(true).setContentIntent(pi)
        runCatching { NotificationManagerCompat.from(c).notify(n, b.build()) }
    }
}
