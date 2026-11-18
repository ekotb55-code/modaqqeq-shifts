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
import com.google.zxing.integration.android.IntentIntegrator
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

    override fun onResume() {
        super.onResume(); render()
        // المحافظ بتتحدّث لوحدها كل ما التطبيق يتفتح (لو عدّى عشر دقايق)
        if (Account.mode(this).isNotEmpty() && System.currentTimeMillis() - Account.lastSync(this) > 10 * 60_000) bg({ Account.sync(this) }) { render() }
    }

    private fun bg(work: () -> String?, done: (String?) -> Unit) {
        Thread { val r = runCatching { work() }.getOrElse { "حصلت مشكلة · جرّب تاني" }; runOnUiThread { done(r) } }.start()
    }
    private fun toast(t: String) = Toast.makeText(this, t, Toast.LENGTH_LONG).show()

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

        // الموبايل ده بتاع مين؟
        val acc = card()
        when (Account.mode(this)) {
            "user" -> {
                acc.addView(text("👤 داخل بأكونت ${Account.name(this).ifBlank { Account.email(this) }}", 17f, bold = true))
                acc.addView(text("المحافظ اللي «مع ${Account.name(this).ifBlank { "الأكونت ده" }}» في الإعدادات بتيجي هنا لوحدها.", 13f, "#6B6A80"))
            }
            "shop" -> {
                acc.addView(text("📱 موبايل محل ${Account.shopName(this)}", 17f, bold = true))
                acc.addView(text("بيقرا محافظ المحل اللي «مع موبايل المحل» ويبعتها ساكت، من غير شباك ولا أرقام.", 13f, "#6B6A80"))
            }
            else -> {
                acc.addView(text("الموبايل ده بتاع مين؟", 17f, bold = true))
                acc.addView(text("ادخل بأكونتك (صاحب المحل أو المدير) والمحافظ هتتظبط لوحدها. ولو ده موبايل المحل اربطه بالكود اللي في الإعدادات.", 13f, "#6B6A80"))
                acc.addView(button("👤 ادخل بأكونتك") { login() }.apply { layoutParams = LinearLayout.LayoutParams(-1, dp(52)).apply { topMargin = dp(10) } })
                acc.addView(button("📱 ده موبايل المحل", false) { pairDialog() }.apply { layoutParams = LinearLayout.LayoutParams(-1, dp(52)).apply { topMargin = dp(8) } })
            }
        }
        if (Account.mode(this).isNotEmpty()) {
            val last = Account.lastSync(this)
            if (last > 0) acc.addView(text("آخر تحديث للمحافظ: " + SimpleDateFormat("d/M h:mm a", Locale("ar", "EG")).format(Date(last)), 12f, "#A9A8BC"))
            val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; setPadding(0, dp(8), 0, 0) }
            row.addView(button("🔄 حدّث المحافظ", false) { bg({ Account.sync(this) }) { e -> toast(e ?: "اتحدّثت ✓"); render() } })
            row.addView(button(if (Account.isShopPhone(this)) "فك الربط" else "خروج", false) {
                AlertDialog.Builder(this).setMessage(if (Account.isShopPhone(this)) "تفك ربط موبايل المحل؟ المحافظ هتبطل تتبعت من هنا." else "تخرج من الأكونت؟ المحافظ هتبطل تتبعت من الموبايل ده.")
                    .setPositiveButton("أيوه") { _, _ -> Account.signOut(this); render() }.setNegativeButton("لأ", null).show()
            }.apply { layoutParams = LinearLayout.LayoutParams(-2, -2).apply { marginStart = dp(8) } })
            acc.addView(row)
        }
        root.addView(acc)

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
        if (conns.isEmpty()) links.addView(text(if (Account.mode(this).isEmpty()) "ادخل بأكونتك أو اربط موبايل المحل فوق، والمحافظ هتيجي لوحدها." else "مفيش محافظ «مع ${if (Account.isShopPhone(this)) "موبايل المحل" else "الأكونت ده"}» في الإعدادات لسه.", 13f, "#6B6A80"))
        // محفظتين من نفس النوع شغالين هنا = نفس الإشعار هيروح للاتنين
        val on = conns.filter { it.on }
        listOf("insta" to "انستاباي", "vf" to "فودافون كاش").forEach { (k, l) ->
            if (on.count { it.wallet.startsWith(k) } > 1) links.addView(text("⚠️ فيه أكتر من محفظة $l شغالين على الموبايل ده · نفس الإشعار هيتبعت للاتنين. اقفل اللي مش على الموبايل ده.", 12f, "#B3261E").apply { setPadding(0, dp(6), 0, 0) })
        }
        conns.forEach { cn ->
            val box = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(0, dp(10), 0, dp(6)); alpha = if (cn.on) 1f else 0.55f }
            box.addView(text(cn.name.ifBlank { "محفظة" } + (if (cn.shopName.isNotBlank()) " · ${cn.shopName}" else ""), 16f, bold = true))
            val from = (cn.appNames.map { "إشعارات $it" } + cn.senders.filter { it.isNotBlank() }.take(4).map { "رسايل $it" }).joinToString("، ") + if (cn.senders.size > 4) " و${cn.senders.size - 4} بنوك تانية" else ""
            box.addView(text(if (from.isBlank()) "⚠️ مش متحدد بيقرا منين" else "بيقرا: $from", 13f, "#6B6A80"))
            if (cn.managed && cn.appNames.isEmpty()) box.addView(text("⚠️ ملقيناش تطبيق المحفظة على الموبايل ده · لو متسطب دوس «عدّل» واختاره", 12f, "#8A5A00"))
            val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setPadding(0, dp(6), 0, 0) }
            if (cn.managed) row.addView(CheckBox(this).apply {
                text = "على الموبايل ده"; isChecked = cn.on; layoutDirection = View.LAYOUT_DIRECTION_RTL
                setOnCheckedChangeListener { _, v -> Store.saveConns(this@MainActivity, Store.conns(this@MainActivity).map { if (it.id == cn.id) it.copy(on = v) else it }); render() }
            })
            row.addView(button("عدّل", false) { editConn(cn) }.apply { layoutParams = LinearLayout.LayoutParams(-2, -2).apply { marginStart = dp(8) } })
            if (!cn.managed) row.addView(button("امسح", false) {
                AlertDialog.Builder(this).setMessage("تمسح ربط «${cn.name}» من التليفون ده؟").setPositiveButton("امسح") { _, _ ->
                    Store.saveConns(this, Store.conns(this).filter { it.id != cn.id }); render()
                }.setNegativeButton("لأ", null).show()
            }.apply { layoutParams = LinearLayout.LayoutParams(-2, -2).apply { marginStart = dp(8) } })
            box.addView(row)
            links.addView(box)
        }
        links.addView(button("+ اربط محفظة برابط (للمتقدمين)", false) { editConn(null) }.apply { layoutParams = LinearLayout.LayoutParams(-1, dp(48)).apply { topMargin = dp(10) } })
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
        val managed = old?.managed == true
        val url = EditText(this).apply { setText(old?.url ?: if (clip.startsWith("https://script.google.com/")) clip else ""); hint = "https://script.google.com/…"; inputType = InputType.TYPE_TEXT_VARIATION_URI; textDirection = View.TEXT_DIRECTION_LTR }
        val name = EditText(this).apply { setText(old?.name ?: ""); hint = "مثلًا: انستاباي شخصي" }
        if (!managed) {
            box.addView(text("رابط رسايل البنك من مدقق", 13f, "#6B6A80"))
            box.addView(url)
            box.addView(text("اسم المحفظة (علشان تعرفها)", 13f, "#6B6A80"))
            box.addView(name)
        }
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
        AlertDialog.Builder(this).setTitle(if (old == null) "اربط محفظة" else if (managed) "${old.name} · بيقرا منين" else "عدّل الربط")
            .setView(ScrollView(this).apply { addView(box) })
            .setPositiveButton("احفظ") { _, _ ->
                val u = url.text.toString().trim()
                if (!managed && !u.startsWith("https://script.google.com/") || !u.contains("k=")) { Toast.makeText(this, "الرابط مش مظبوط · انسخه تاني من مدقق", Toast.LENGTH_LONG).show(); return@setPositiveButton }
                val names = apps.filter { it.first in chosen }.map { it.second }
                val sl = senders.text.toString().split(",", "،").map { it.trim() }.filter { it.isNotEmpty() }
                val c = if (managed) old!!.copy(apps = chosen.toList(), appNames = names, senders = sl, edited = true)
                    else Conn(old?.id ?: UUID.randomUUID().toString(), name.text.toString().trim(), u, chosen.toList(), names, sl)
                Store.saveConns(this, Store.conns(this).filter { it.id != c.id } + c)
                render()
            }.setNegativeButton("إلغاء", null).show()
    }

    // الدخول بنفس أكونت تطبيق الورديات
    private fun login() {
        val box = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; layoutDirection = View.LAYOUT_DIRECTION_RTL; setPadding(dp(20), dp(8), dp(20), 0) }
        box.addView(text("نفس الإيميل والباسورد بتوع تطبيق الورديات", 13f, "#6B6A80"))
        val user = EditText(this).apply { hint = "الإيميل أو اسم المستخدم"; inputType = InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS; textDirection = View.TEXT_DIRECTION_LTR }
        val pass = EditText(this).apply { hint = "الباسورد"; inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD; textDirection = View.TEXT_DIRECTION_LTR }
        box.addView(user); box.addView(pass)
        AlertDialog.Builder(this).setTitle("👤 ادخل بأكونتك").setView(box)
            .setPositiveButton("ادخل") { _, _ ->
                val u = user.text.toString(); val p = pass.text.toString()
                if (u.isBlank() || p.isBlank()) { toast("اكتب الإيميل والباسورد"); return@setPositiveButton }
                toast("بيدخل…")
                bg({ Account.signIn(this, u, p) }) { e -> toast(e ?: "أهلًا ${Account.name(this)} ✓ المحافظ اتظبطت"); render() }
            }.setNegativeButton("إلغاء", null).show()
    }

    // موبايل المحل: كود من ٦ أرقام أو QR من الإعدادات ← رسايل البنك ← «اربط موبايل المحل»
    private fun pairDialog() {
        val box = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; layoutDirection = View.LAYOUT_DIRECTION_RTL; setPadding(dp(20), dp(8), dp(20), 0) }
        box.addView(text("من تطبيق الورديات: الإعدادات ← المحل ← رسايل البنك ← «📱 اربط موبايل المحل» ← «اعمل كود».", 13f, "#6B6A80"))
        val code = EditText(this).apply { hint = "الكود (٦ أرقام)"; inputType = InputType.TYPE_CLASS_NUMBER; textDirection = View.TEXT_DIRECTION_LTR; textSize = 22f }
        box.addView(code)
        val d = AlertDialog.Builder(this).setTitle("📱 اربط موبايل المحل").setView(box)
            .setPositiveButton("اربط") { _, _ -> doPair(code.text.toString()) }
            .setNeutralButton("📷 صوّر الكود") { _, _ -> scan() }
            .setNegativeButton("إلغاء", null).create()
        d.show()
    }
    private fun doPair(raw: String) {
        val c = Account.normUsername(raw).filter { it.isDigit() }
        if (c.length != 6) { toast("الكود ٦ أرقام"); return }
        toast("بيربط…")
        bg({ Account.pair(this, c) }) { e -> toast(e ?: "اتربط ✓ موبايل محل ${Account.shopName(this)}"); render() }
    }
    private fun scan() {
        IntentIntegrator(this).apply {
            setDesiredBarcodeFormats(IntentIntegrator.QR_CODE)
            setPrompt("صوّر كود الربط اللي على شاشة الإعدادات")
            setBeepEnabled(false); setOrientationLocked(false)
        }.initiateScan()
    }
    @Deprecated("Activity result")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        val r = IntentIntegrator.parseActivityResult(requestCode, resultCode, data)
        if (r == null) { super.onActivityResult(requestCode, resultCode, data); return }
        val t = r.contents ?: return
        if (t.startsWith("MDQPAIR:")) doPair(t.removePrefix("MDQPAIR:")) else toast("ده مش كود ربط مدقق")
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
