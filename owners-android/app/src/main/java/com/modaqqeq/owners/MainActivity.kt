package com.modaqqeq.owners

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.ClipboardManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Looper
import android.os.Handler
import android.os.PowerManager
import android.provider.Settings
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.UUID

// One screen: what's allowed on this phone, which wallets are linked, and what was sent lately.
class MainActivity : Activity() {
    private lateinit var root: LinearLayout
    private val INK = "#15142A"; private val BLUE = "#1565D8"; private val BG = "#ECEFFF"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Popup.channel(this)
        window.statusBarColor = Color.parseColor(BG)
        root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; layoutDirection = View.LAYOUT_DIRECTION_RTL; setPadding(dp(16), dp(20), dp(16), dp(32)) }
        setContentView(ScrollView(this).apply { setBackgroundColor(Color.parseColor(BG)); addView(root) })
    }

    override fun onResume() { super.onResume(); render() }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()
    private fun text(t: String, size: Float = 15f, color: String = INK, bold: Boolean = false) = TextView(this).apply {
        text = t; textSize = size; setTextColor(Color.parseColor(color)); if (bold) setTypeface(typeface, Typeface.BOLD)
        textDirection = View.TEXT_DIRECTION_RTL; gravity = Gravity.START; setLineSpacing(0f, 1.15f)
    }
    private fun card() = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL; setPadding(dp(16), dp(14), dp(16), dp(14))
        background = GradientDrawable().apply { cornerRadius = dp(24).toFloat(); setColor(Color.WHITE) }
        layoutParams = LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(12) }
    }
    private fun button(t: String, primary: Boolean = true, onClick: () -> Unit) = Button(this).apply {
        text = t; isAllCaps = false; textSize = 14f
        setTextColor(Color.parseColor(if (primary) "#FFFFFF" else INK))
        background = GradientDrawable().apply { cornerRadius = dp(99).toFloat(); setColor(Color.parseColor(if (primary) BLUE else "#E9ECFB")) }
        setOnClickListener { onClick() }
    }

    private fun render() {
        root.removeAllViews()
        root.addView(text("مدقق Owners", 26f, BLUE, true))
        root.addView(text("بيقرا رسايل البنك وإشعارات التحويلات على التليفون ده ويبعتها لمدقق، ويطلّعلك شباك فيه التحويل وزرار «شخصي».", 14f, "#6B6A80"))

        // ١) الصلاحيات
        val perms = card()
        perms.addView(text("١) الصلاحيات على التليفون ده", 17f, bold = true))
        permRow(perms, "قراءة إشعارات التطبيقات (انستاباي، الأهلي فون كاش…)", notifAccess()) { startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)) }
        permRow(perms, "قراءة رسايل البنك (SMS)", has(Manifest.permission.RECEIVE_SMS)) { requestPermissions(arrayOf(Manifest.permission.RECEIVE_SMS), 1) }
        permRow(perms, "الشباك العايم فوق التطبيقات", Settings.canDrawOverlays(this)) {
            startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")))
        }
        if (Build.VERSION.SDK_INT >= 33) permRow(perms, "الإشعارات", has(Manifest.permission.POST_NOTIFICATIONS)) { requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 2) }
        val pm = getSystemService(PowerManager::class.java)
        permRow(perms, "يفضل شغال في الخلفية (من غير توفير البطارية)", pm.isIgnoringBatteryOptimizations(packageName)) {
            startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName")))
        }
        perms.addView(text("لو التليفون قالك «إعداد مقيّد»: افتح «معلومات التطبيق» ← النقط التلاتة فوق ← «السماح بالإعدادات المقيّدة»، وارجع فعّل تاني.", 12f, "#8A5A00").apply { setPadding(0, dp(8), 0, dp(4)) })
        perms.addView(button("جرّب الشباك العايم", false) {
            Popup.show(this, 1.0, "تجربة", "انستاباي", false, "")
            Handler(Looper.getMainLooper()).postDelayed({ render() }, 800)
        })
        perms.addView(button("افتح معلومات التطبيق", false) { startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName"))) })
        root.addView(perms)

        // ٢) المحافظ المربوطة
        val links = card()
        links.addView(text("٢) المحافظ المربوطة", 17f, bold = true))
        val conns = Store.conns(this)
        if (conns.isEmpty()) links.addView(text("لسه مفيش. انسخ «رابط رسايل البنك» من مدقق (الإعداد ← المحل ← رسايل البنك) ودوس «اربط محفظة».", 13f, "#6B6A80"))
        conns.forEach { cn ->
            val box = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(0, dp(10), 0, dp(6)) }
            box.addView(text(cn.name.ifBlank { "محفظة" }, 16f, bold = true))
            val from = (cn.appNames.map { "إشعارات $it" } + cn.senders.filter { it.isNotBlank() }.map { "رسايل $it" }).joinToString("، ")
            box.addView(text(if (from.isBlank()) "⚠️ مش متحدد بيقرا منين" else "بيقرا: $from", 13f, "#6B6A80"))
            val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; setPadding(0, dp(6), 0, 0) }
            row.addView(button("عدّل", false) { editConn(cn) })
            row.addView(button("امسح", false) {
                AlertDialog.Builder(this).setMessage("تمسح ربط «${cn.name}» من التليفون ده؟").setPositiveButton("امسح") { _, _ ->
                    Store.saveConns(this, Store.conns(this).filter { it.id != cn.id }); render()
                }.setNegativeButton("لأ", null).show()
            }.apply { (layoutParams as? LinearLayout.LayoutParams)?.marginStart = dp(8) })
            box.addView(row)
            links.addView(box)
        }
        links.addView(button("+ اربط محفظة") { editConn(null) }.apply { layoutParams = LinearLayout.LayoutParams(-1, dp(52)).apply { topMargin = dp(10) } })
        root.addView(links)

        // ٣) آخر حاجات اتبعتت
        val log = card()
        log.addView(text("٣) آخر حاجات اتبعتت لمدقق", 17f, bold = true))
        val arr = Store.log(this)
        if (arr.length() == 0) log.addView(text("لسه مفيش", 13f, "#6B6A80"))
        val tf = SimpleDateFormat("d/M h:mm a", Locale("ar", "EG"))
        for (i in 0 until arr.length()) {
            val o = arr.getJSONObject(i)
            log.addView(text("${o.optString("res")}  ·  ${tf.format(Date(o.optLong("at")))}  ·  ${o.optString("src")}", 13f, bold = true).apply { setPadding(0, dp(8), 0, 0) })
            log.addView(text(o.optString("text"), 12f, "#6B6A80"))
        }
        root.addView(log)
        root.addView(text("نسخة ${packageManager.getPackageInfo(packageName, 0).versionName}", 11f, "#A9A8BC").apply { setPadding(0, dp(12), 0, 0) })
    }

    private fun permRow(parent: LinearLayout, label: String, ok: Boolean, fix: () -> Unit) {
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setPadding(0, dp(8), 0, 0) }
        row.addView(text((if (ok) "✅ " else "⬜ ") + label, 14f).apply { layoutParams = LinearLayout.LayoutParams(0, -2, 1f) })
        if (!ok) row.addView(button("فعّل") { fix() })
        parent.addView(row)
    }

    private fun has(p: String) = checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED
    private fun notifAccess(): Boolean {
        val flat = Settings.Secure.getString(contentResolver, "enabled_notification_listeners") ?: return false
        return flat.split(":").any { ComponentName.unflattenFromString(it)?.packageName == packageName }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) { render() }

    // ربط محفظة: الرابط + الاسم + التطبيقات اللي نقرا إشعاراتها + أسماء مرسلين الرسايل
    private fun editConn(old: Conn?) {
        val box = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; layoutDirection = View.LAYOUT_DIRECTION_RTL; setPadding(dp(20), dp(8), dp(20), 0) }
        val clip = (getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).primaryClip?.getItemAt(0)?.text?.toString()?.trim() ?: ""
        box.addView(text("رابط رسايل البنك من مدقق", 13f, "#6B6A80"))
        val url = EditText(this).apply { setText(old?.url ?: if (clip.startsWith("https://script.google.com/")) clip else ""); hint = "https://script.google.com/…"; inputType = InputType.TYPE_TEXT_VARIATION_URI; textDirection = View.TEXT_DIRECTION_LTR }
        box.addView(url)
        box.addView(text("اسم المحفظة (علشان تعرفها)", 13f, "#6B6A80"))
        val name = EditText(this).apply { setText(old?.name ?: ""); hint = "مثلًا: انستاباي شخصي" }
        box.addView(name)
        box.addView(text("أسماء مرسلين رسايل البنك (مفصولة بفاصلة)", 13f, "#6B6A80"))
        val senders = EditText(this).apply { setText(old?.senders?.joinToString(", ") ?: ""); hint = "مثلًا: ALEXBANK, NBE"; textDirection = View.TEXT_DIRECTION_LTR }
        box.addView(senders)
        box.addView(text("إشعارات التطبيقات اللي نقراها", 13f, "#6B6A80").apply { setPadding(0, dp(8), 0, 0) })
        val apps = launchableApps()
        val chosen = (old?.apps ?: emptyList()).toMutableSet()
        apps.forEach { (pkg, label) ->
            box.addView(CheckBox(this).apply {
                text = label; isChecked = pkg in chosen; layoutDirection = View.LAYOUT_DIRECTION_RTL
                setOnCheckedChangeListener { _, on -> if (on) chosen.add(pkg) else chosen.remove(pkg) }
            })
        }
        AlertDialog.Builder(this).setTitle(if (old == null) "اربط محفظة" else "عدّل الربط")
            .setView(ScrollView(this).apply { addView(box) })
            .setPositiveButton("احفظ") { _, _ ->
                val u = url.text.toString().trim()
                if (!u.startsWith("https://script.google.com/") || !u.contains("k=")) { Toast.makeText(this, "الرابط مش مظبوط · انسخه تاني من مدقق", Toast.LENGTH_LONG).show(); return@setPositiveButton }
                val names = apps.filter { it.first in chosen }.map { it.second }
                val c = Conn(old?.id ?: UUID.randomUUID().toString(), name.text.toString().trim(), u, chosen.toList(), names,
                    senders.text.toString().split(",", "،").map { it.trim() }.filter { it.isNotEmpty() })
                Store.saveConns(this, Store.conns(this).filter { it.id != c.id } + c)
                render()
            }.setNegativeButton("إلغاء", null).show()
    }

    // التطبيقات اللي على التليفون، والمحافظ والبنوك الأول
    private fun launchableApps(): List<Pair<String, String>> {
        val i = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val list = packageManager.queryIntentActivities(i, 0).map { it.activityInfo.packageName to it.loadLabel(packageManager).toString() }
            .distinctBy { it.first }.filter { it.first != packageName }
        val likely = Regex("insta|انستا|إنستا|cash|كاش|bank|بنك|nbe|الأهلي|اهلي|wallet|محفظ|vodafone|فودافون|misr|مصر|cib|alex", RegexOption.IGNORE_CASE)
        return list.sortedWith(compareBy({ !likely.containsMatchIn(it.second + " " + it.first) }, { it.second }))
    }
}
