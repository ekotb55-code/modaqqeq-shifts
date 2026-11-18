package com.modaqqeq.owners

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.hardware.display.DisplayManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.Display
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import org.json.JSONObject
import java.text.DecimalFormat

// The floating window (like Truecaller): amount, who sent it, «شخصي» and «تمام».
// No "show over other apps" permission → a notification with the same buttons.
object Popup {
    private val main = Handler(Looper.getMainLooper())
    private const val CH = "transfers"
    private val fmt = DecimalFormat("#,##0.##")

    fun show(c: Context, amount: Double, from: String, wallet: String, big: Boolean, actUrl: String) {
        val title = (if (big) "⚠️ تحويل كبير " else "💰 وصل ") + fmt.format(amount) + " ج"
        val line = listOf(if (from.isNotBlank()) "من $from" else "", wallet).filter { it.isNotBlank() }.joinToString(" · ")
        val hint = if (big) "أكبر من الحد · مش ظاهر للكاشير" else "ظاهر للكاشيرية دلوقتي"
        val app = c.applicationContext
        if (!Settings.canDrawOverlays(app)) {
            Store.addLog(app, "الشباك العايم", title, "✗ مظهرش: إذن «الشباك العايم فوق التطبيقات» مقفول · طلع إشعار بداله")
            notify(app, title, "$line · $hint", actUrl); return
        }
        main.post {
            try { overlay(app, title, line, hint, actUrl) }
            catch (e: Throwable) {
                // ميضيعش التحويل من غير ما صاحب المحل يعرف: إشعار بداله + السبب في السجل
                Store.addLog(app, "الشباك العايم", title, "✗ مظهرش (" + (e.javaClass.simpleName + " " + (e.message ?: "")).trim().take(120) + ") · طلع إشعار بداله")
                notify(app, title, "$line · $hint", actUrl)
            }
        }
    }

    private fun dp(c: Context, v: Int) = (v * c.resources.displayMetrics.density).toInt()

    private fun overlay(app: Context, title: String, line: String, hint: String, actUrl: String) {
        // أندرويد 11+: الشباك لازم يتعمل من "سياق شباك" مش من التطبيق نفسه، وإلا ممكن ميظهرش
        val c: Context = if (Build.VERSION.SDK_INT >= 30) {
            val screen = app.getSystemService(DisplayManager::class.java).getDisplay(Display.DEFAULT_DISPLAY)
            app.createDisplayContext(screen).createWindowContext(WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY, null)
        } else app
        val wm = c.getSystemService(WindowManager::class.java)
        val card = LinearLayout(c).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(c, 18), dp(c, 14), dp(c, 18), dp(c, 12))
            background = GradientDrawable().apply { cornerRadius = dp(c, 24).toFloat(); setColor(Color.parseColor("#15142A")) }
            elevation = dp(c, 8).toFloat()
        }
        fun text(t: String, size: Float, color: String, bold: Boolean = false) = TextView(c).apply {
            this.text = t; textSize = size; setTextColor(Color.parseColor(color)); if (bold) setTypeface(typeface, Typeface.BOLD)
            textDirection = View.TEXT_DIRECTION_RTL; gravity = Gravity.START
        }
        card.addView(text("مدقق Owners", 12f, "#9FB4FF", true))
        card.addView(text(title, 22f, "#FFFFFF", true))
        if (line.isNotBlank()) card.addView(text(line, 15f, "#E6E6F0"))
        card.addView(text(hint, 12f, "#A9A8BC"))
        val row = LinearLayout(c).apply { orientation = LinearLayout.HORIZONTAL; layoutDirection = View.LAYOUT_DIRECTION_RTL; setPadding(0, dp(c, 10), 0, 0) }
        var removed = false
        val remove = { if (!removed) { removed = true; runCatching { wm.removeView(card) } } }
        fun btn(t: String, bg: String, fg: String, onClick: () -> Unit) = Button(c).apply {
            text = t; textSize = 15f; isAllCaps = false; setTextColor(Color.parseColor(fg))
            background = GradientDrawable().apply { cornerRadius = dp(c, 99).toFloat(); setColor(Color.parseColor(bg)) }
            setOnClickListener { onClick() }
            layoutParams = LinearLayout.LayoutParams(0, dp(c, 46), 1f).apply { marginStart = dp(c, 4); marginEnd = dp(c, 4) }
        }
        if (actUrl.isNotBlank()) row.addView(btn("شخصي", "#B6F000", "#15142A") { remove(); Personal.mark(c, actUrl) })
        row.addView(btn("تمام", "#2E2D45", "#FFFFFF") { remove() })
        card.addView(row)
        val lp = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT,
        ).apply { gravity = Gravity.TOP; x = 0; y = dp(c, 36); horizontalMargin = 0.03f }
        wm.addView(card, lp)
        main.postDelayed({ remove() }, 3 * 60_000L) // ميفضلش على الشاشة للأبد
    }

    fun channel(c: Context) {
        val nm = c.getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CH) == null) nm.createNotificationChannel(NotificationChannel(CH, "التحويلات", NotificationManager.IMPORTANCE_HIGH))
    }

    fun notify(c: Context, title: String, body: String, actUrl: String) {
        channel(c)
        val id = (System.currentTimeMillis() % 100000).toInt()
        val b = NotificationCompat.Builder(c, CH).setSmallIcon(R.drawable.ic_stat).setContentTitle(title).setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body)).setPriority(NotificationCompat.PRIORITY_HIGH).setAutoCancel(true)
        if (actUrl.isNotBlank()) {
            val pi = PendingIntent.getBroadcast(c, id, Intent(c, ActionReceiver::class.java).putExtra("url", actUrl).putExtra("id", id),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            b.addAction(0, "شخصي", pi)
        }
        runCatching { NotificationManagerCompat.from(c).notify(id, b.build()) }
    }
}

// «شخصي»: the transfer disappears from the cashiers (same link as the button in Modaqqeq's own notification).
object Personal {
    fun mark(c: Context, url: String) {
        Thread {
            val msg = try {
                val j = JSONObject(Net.get(url))
                when {
                    j.optBoolean("ok") -> if (j.optBoolean("already")) "كان متعلّم شخصي قبل كده" else "اتعلّم شخصي ✓ · اختفى من عند الكاشيرية"
                    j.optBoolean("claimed") -> "الكاشير ${j.optString("by")} أكّده خلاص · لو مش بتاع المحل ارفضه من «التحويلات»"
                    else -> "مقدرناش نعلّمه شخصي · جرّب من تطبيق الورديات"
                }
            } catch (e: Exception) { "مفيش نت · علّمه شخصي من «التحويلات» في تطبيق الورديات" }
            Popup.notify(c, "مدقق Owners", msg, "")
        }.start()
    }
}

class ActionReceiver : BroadcastReceiver() {
    override fun onReceive(c: Context, i: Intent) {
        NotificationManagerCompat.from(c).cancel(i.getIntExtra("id", 0))
        i.getStringExtra("url")?.let { Personal.mark(c, it) }
    }
}
