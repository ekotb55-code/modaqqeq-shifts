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
import android.widget.ImageView
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
        val big = title.startsWith("⚠️")
        // ألوان فرحانة: أزرق ← بنفسجي ← وردي، والتحويل الكبير برتقالي ← أحمر
        val card = LinearLayout(c).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(c, 18), dp(c, 14), dp(c, 18), dp(c, 14))
            background = GradientDrawable(GradientDrawable.Orientation.TL_BR,
                if (big) intArrayOf(Color.parseColor("#FF8A00"), Color.parseColor("#FF4D6D"), Color.parseColor("#E0218A"))
                else intArrayOf(Color.parseColor("#1E6BFF"), Color.parseColor("#7B3FF2"), Color.parseColor("#E040A0"))).apply {
                cornerRadius = dp(c, 26).toFloat(); setStroke(dp(c, 2), Color.parseColor("#55FFFFFF"))
            }
            elevation = dp(c, 10).toFloat()
        }
        fun text(t: String, size: Float, color: String, bold: Boolean = false) = TextView(c).apply {
            this.text = t; textSize = size; setTextColor(Color.parseColor(color)); if (bold) setTypeface(typeface, Typeface.BOLD)
            textDirection = View.TEXT_DIRECTION_RTL; gravity = Gravity.START
        }
        // علامة مدقق + اسم التطبيق
        val head = LinearLayout(c).apply { orientation = LinearLayout.HORIZONTAL; layoutDirection = View.LAYOUT_DIRECTION_RTL; gravity = Gravity.CENTER_VERTICAL }
        head.addView(ImageView(c).apply {
            setImageResource(R.mipmap.ic_launcher)
            background = GradientDrawable().apply { cornerRadius = dp(c, 14).toFloat(); setColor(Color.WHITE) }
            setPadding(dp(c, 3), dp(c, 3), dp(c, 3), dp(c, 3))
            layoutParams = LinearLayout.LayoutParams(dp(c, 44), dp(c, 44)).apply { marginEnd = dp(c, 10) }
        })
        head.addView(LinearLayout(c).apply {
            orientation = LinearLayout.VERTICAL
            addView(text("مدقق", 17f, "#FFFFFF", true))
            addView(text("Owners · تحويل جديد", 12f, "#E8E4FF"))
        })
        card.addView(head)
        card.addView(text(title, 28f, "#FFFFFF", true).apply { setPadding(0, dp(c, 10), 0, 0) })
        if (line.isNotBlank()) card.addView(text(line, 15f, "#FFFFFF"))
        card.addView(text(hint, 12f, "#1E1B3A", true).apply {
            background = GradientDrawable().apply { cornerRadius = dp(c, 99).toFloat(); setColor(Color.parseColor(if (big) "#FFE08A" else "#D9F99D")) }
            setPadding(dp(c, 10), dp(c, 3), dp(c, 10), dp(c, 3))
            layoutParams = LinearLayout.LayoutParams(-2, -2).apply { topMargin = dp(c, 6) }
        })
        val row = LinearLayout(c).apply { orientation = LinearLayout.HORIZONTAL; layoutDirection = View.LAYOUT_DIRECTION_RTL; setPadding(0, dp(c, 12), 0, 0) }
        var removed = false
        val remove = { if (!removed) { removed = true; runCatching { wm.removeView(card) } } }
        fun btn(t: String, bg: String, fg: String, onClick: () -> Unit) = Button(c).apply {
            text = t; textSize = 16f; isAllCaps = false; setTextColor(Color.parseColor(fg)); setTypeface(typeface, Typeface.BOLD)
            background = GradientDrawable().apply { cornerRadius = dp(c, 99).toFloat(); setColor(Color.parseColor(bg)) }
            stateListAnimator = null
            setOnClickListener { onClick() }
            layoutParams = LinearLayout.LayoutParams(0, dp(c, 48), 1f).apply { marginStart = dp(c, 4); marginEnd = dp(c, 4) }
        }
        if (actUrl.isNotBlank()) row.addView(btn("شخصي", "#C6FF1A", "#1E1B3A") { remove(); Personal.mark(c, actUrl) })
        row.addView(btn("تمام", "#33FFFFFF", "#FFFFFF") { remove() })
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
