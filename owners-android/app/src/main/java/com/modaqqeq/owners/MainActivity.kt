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
import android.widget.ImageView
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import com.google.zxing.integration.android.IntentIntegrator
import org.json.JSONArray
import org.json.JSONObject
import java.text.DecimalFormat
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
        // أرقام الصفحة الرئيسية: لو آخر تحديث أقدم من دقيقتين
        if (Account.mode(this) == "user" && System.currentTimeMillis() - (Home.cached(this)?.optLong("at") ?: 0) > 2 * 60_000) refreshHome(false)
        if (Account.mode(this) == "user" && page == "transfers" && System.currentTimeMillis() - (Transfers.cached(this)?.optLong("at") ?: 0) > 60_000) refreshTransfers(false)
    }

    private var loadingHome = false
    private var homeErr: String? = null
    private fun refreshHome(say: Boolean) {
        if (loadingHome) return
        loadingHome = true; render()
        bg({ Home.load(this) }) { e -> loadingHome = false; homeErr = e; if (say && e == null) toast("اتحدّثت ✓"); render() }
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

    // الصفحات: الرئيسية / التحويلات، و ☰ فيها كل الإعدادات
    private var page = "home"
    private fun go(p: String) { page = p; render(); (root.parent as? ScrollView)?.scrollTo(0, 0) }
    @Deprecated("back")
    override fun onBackPressed() { if (page != "home") go("home") else super.onBackPressed() }

    private fun allOk(): Boolean {
        val pm = getSystemService(PowerManager::class.java)
        return notifAccess() && has(Manifest.permission.RECEIVE_SMS) && Settings.canDrawOverlays(this) &&
            (Build.VERSION.SDK_INT < 33 || has(Manifest.permission.POST_NOTIFICATIONS)) && pm.isIgnoringBatteryOptimizations(packageName)
    }

    private fun render() {
        root.removeAllViews()
        val mode = Account.mode(this)
        val top = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; layoutDirection = View.LAYOUT_DIRECTION_RTL; gravity = Gravity.CENTER_VERTICAL }
        top.addView(ImageView(this).apply { setImageResource(R.mipmap.ic_launcher); layoutParams = LinearLayout.LayoutParams(dp(40), dp(40)).apply { marginEnd = dp(10) } })
        top.addView(text(if (page == "menu") "الإعدادات" else "مدقق Owners", 24f, BLUE, true).apply { layoutParams = LinearLayout.LayoutParams(0, -2, 1f) })
        top.addView(button(if (page == "menu") "رجوع ←" else "☰", false) { go(if (page == "menu") "home" else "menu") }.apply { textSize = if (page == "menu") 14f else 22f; layoutParams = LinearLayout.LayoutParams(-2, dp(48)) })
        root.addView(top)
        if (page == "menu") { menuPage(); return }

        // صلاحية مقفولة؟ تنبيه صغير يفتح ☰
        if (!allOk()) root.addView(card().apply {
            background = GradientDrawable().apply { cornerRadius = dp(20).toFloat(); setColor(Color.parseColor("#FFF4E0")) }
            addView(text("⚠️ فيه صلاحية مقفولة على الموبايل ده · التحويلات ممكن متوصلش. دوس هنا وفعّلها", 14f, "#8A5A00", true))
            setOnClickListener { go("menu") }
        })
        when (mode) {
            "" -> { accountCard(); return }
            "shop" -> {
                root.addView(card().apply {
                    addView(text("📱 موبايل محل ${Account.shopName(this@MainActivity)}", 18f, bold = true))
                    addView(text("شغال · بيقرا محافظ المحل ويبعتها لمدقق ساكت، من غير شباك ولا أرقام.", 13f, "#6B6A80"))
                    addView(text("${Store.active(this@MainActivity).size} محفظة شغالة على الموبايل ده", 13f, "#2E7D32", true).apply { setPadding(0, dp(6), 0, 0) })
                })
                return
            }
        }
        // الصفحتين
        val tabs = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; layoutDirection = View.LAYOUT_DIRECTION_RTL; setPadding(0, dp(12), 0, 0) }
        listOf("home" to "🏠 الرئيسية", "transfers" to "📲 التحويلات").forEachIndexed { i, (k, l) ->
            tabs.addView(button(l, page == k) { if (k == "transfers" && Transfers.cached(this) == null) refreshTransfers(false); go(k) }.apply { layoutParams = LinearLayout.LayoutParams(0, dp(48), 1f).apply { if (i == 1) marginStart = dp(8) } })
        }
        root.addView(tabs)
        if (page == "transfers") transfers() else home()
    }

    // ☰: الأكونت، الصلاحيات، المحافظ، السجل، وإعدادات الصفحة الرئيسية
    private fun menuPage() {
        accountCard()
        if (Account.mode(this) == "user") root.addView(button("⚙️ إعدادات الصفحة الرئيسية (الكروت والتنبيهات)", false) { homeSettings() }.apply { layoutParams = LinearLayout.LayoutParams(-1, dp(52)).apply { topMargin = dp(12) } })
        val perms = card()
        perms.addView(text("✅ الصلاحيات على التليفون ده", 17f, bold = true))
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
        perms.addView(text("لو التليفون قالك «إعداد مقيّد»: افتح «معلومات التطبيق» ← النقط التلاتة فوق ← «السماح بالإعدادات المقيّدة»، وارجع فعّل تاني.", 12f, "#8A5A00").apply { setPadding(0, dp(8), 0, dp(4)) })
        perms.addView(button("🧪 جرّب الشباك العايم", false) {
            Popup.show(this, 1.0, "تجربة", "انستاباي", false, "")
            Handler(Looper.getMainLooper()).postDelayed({ render() }, 800)
        })
        perms.addView(button("افتح معلومات التطبيق", false) { startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName"))) }.apply { layoutParams = LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(6) } })
        root.addView(perms)
        // 💳 المحافظ المربوطة
        val links = card()
        links.addView(text("💳 المحافظ المربوطة", 17f, bold = true))
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
        log.addView(text("🧾 آخر حاجات اتبعتت لمدقق", 17f, bold = true))
        val arr = Store.log(this)
        if (arr.length() == 0) log.addView(text("لسه مفيش", 13f, "#6B6A80"))
        val tf = SimpleDateFormat("d/M h:mm a", Locale.forLanguageTag("ar-EG-u-nu-latn"))
        for (i in 0 until arr.length()) {
            val o = arr.getJSONObject(i)
            log.addView(text("${o.optString("res")}  ·  ${tf.format(Date(o.optLong("at")))}  ·  ${o.optString("src")}", 13f, bold = true).apply { setPadding(0, dp(8), 0, 0) })
            log.addView(text(o.optString("text"), 12f, "#6B6A80"))
        }
        root.addView(log)
        root.addView(text("نسخة ${packageManager.getPackageInfo(packageName, 0).versionName}", 11f, "#A9A8BC").apply { setPadding(0, dp(12), 0, 0) })
    }

    private fun accountCard() {
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
            if (last > 0) acc.addView(text("آخر تحديث للمحافظ: " + SimpleDateFormat("d/M h:mm a", Locale.forLanguageTag("ar-EG-u-nu-latn")).format(Date(last)), 12f, "#A9A8BC"))
            val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; setPadding(0, dp(8), 0, 0) }
            row.addView(button("🔄 حدّث المحافظ", false) { bg({ Account.sync(this) }) { e -> toast(e ?: "اتحدّثت ✓"); render() } })
            row.addView(button(if (Account.isShopPhone(this)) "فك الربط" else "خروج", false) {
                AlertDialog.Builder(this).setMessage(if (Account.isShopPhone(this)) "تفك ربط موبايل المحل؟ المحافظ هتبطل تتبعت من هنا." else "تخرج من الأكونت؟ المحافظ هتبطل تتبعت من الموبايل ده.")
                    .setPositiveButton("أيوه") { _, _ -> Account.signOut(this); render() }.setNegativeButton("لأ", null).show()
            }.apply { layoutParams = LinearLayout.LayoutParams(-2, -2).apply { marginStart = dp(8) } })
            acc.addView(row)
        }
        root.addView(acc)

    }


    private var showPerms = false
    private val money = DecimalFormat("#,##0.##", java.text.DecimalFormatSymbols(Locale.US))
    private fun j(o: JSONObject?, k: String) = o?.optJSONArray(k) ?: JSONArray()
    private fun objs(a: JSONArray) = (0 until a.length()).map { a.getJSONObject(it) }
    private fun ago(ms: Double): String {
        val m = ((System.currentTimeMillis() - ms) / 60_000).toInt().coerceAtLeast(0)
        return if (m < 60) "$m د" else "${m / 60} س ${m % 60} د"
    }
    private fun openShifts() = runCatching { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://ekotb55-code.github.io/modaqqeq-shifts/#wallet"))) }

    // ── الصفحة الرئيسية: التنبيهات + الملخصات ──
    private fun home() {
        val data = Home.cached(this)
        val all = objs(j(data, "shops"))
        val sel = Home.shop(this).takeIf { id -> all.any { it.optString("id") == id } } ?: ""
        val shops = if (sel.isEmpty()) all else all.filter { it.optString("id") == sel }
        val multi = sel.isEmpty() && all.size > 1
        val tag = { s: JSONObject -> if (multi) " · ${s.optString("name")}" else "" }

        val head = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setPadding(0, dp(14), 0, 0) }
        head.addView(text("🏠 النهارده", 20f, INK, true).apply { layoutParams = LinearLayout.LayoutParams(0, -2, 1f) })
        head.addView(button(if (loadingHome) "⏳" else "🔄", false) { refreshHome(true) }.apply { layoutParams = LinearLayout.LayoutParams(dp(56), dp(44)) })
        head.addView(button("⚙️", false) { homeSettings() }.apply { layoutParams = LinearLayout.LayoutParams(dp(56), dp(44)).apply { marginStart = dp(6) } })
        root.addView(head)
        val at = data?.optLong("at") ?: 0
        root.addView(text(when {
            loadingHome && at == 0L -> "بنجيب الأرقام…"
            at > 0 -> "آخر تحديث: " + SimpleDateFormat("h:mm a", Locale.forLanguageTag("ar-EG-u-nu-latn")).format(Date(at)) + (homeErr?.let { " · ⚠️ $it" } ?: "")
            else -> homeErr ?: ""
        }, 12f, "#8A8AA0"))
        if (data == null) return

        // المحلات
        if (all.size > 1) {
            val sc = android.widget.HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled = false; layoutDirection = View.LAYOUT_DIRECTION_RTL }
            val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; layoutDirection = View.LAYOUT_DIRECTION_RTL; setPadding(0, dp(8), 0, 0) }
            (listOf("" to "كل المحلات") + all.map { it.optString("id") to it.optString("name") }).forEach { (id, n) ->
                row.addView(button(n, id == sel) { Home.setShop(this, id); render() }.apply { layoutParams = LinearLayout.LayoutParams(-2, dp(40)).apply { marginEnd = dp(6) } })
            }
            sc.addView(row); root.addView(sc)
        }
        if (all.isEmpty()) { root.addView(text("مفيش محلات على الأكونت ده", 13f, "#6B6A80")); return }

        // نفس التحويل ممكن يكون له نسخة في كل فرع على نفس الحساب: نعدّه مرة واحدة
        val seen = HashSet<String>()
        val wall = shops.flatMap { s -> objs(j(s, "wallet")).map { it to s } }.filter { (x, _) -> val g = x.optString("group"); g.isEmpty() || seen.add(g) }

        // 🔔 التنبيهات
        val alerts = mutableListOf<String>()
        val min = Home.shortageMin(this); val hrs = Home.longHours(this)
        val today = data.optString("today"); val yest = data.optString("yesterday")
        wall.filter { it.first.optString("status") == "big" }.forEach { (x, s) -> alerts += "⚠️ تحويل كبير ${money.format(x.optDouble("amount"))} ج${x.optString("from").let { if (it.isNotBlank()) " من $it" else "" }} مستني قرارك${tag(s)}" }
        wall.filter { it.first.optString("status") == "claimed" && !it.first.optBoolean("bankOk", true) }.forEach { (x, s) -> alerts += "❓ الكاشير أكّد تحويل ${money.format(x.optDouble("amount"))} ج ومفيش رسالة بنك${tag(s)}" }
        shops.forEach { s ->
            objs(j(s, "ledger")).filter { it.optString("kind") == "shortage" && it.optDouble("amount") >= min && it.optString("day") in listOf(today, yest) }
                .forEach { alerts += "🔴 عجز ${money.format(it.optDouble("amount"))} ج في وردية ${it.optString("cashier")}${if (it.optString("day") == yest) " (امبارح)" else ""}${tag(s)}" }
            objs(j(s, "open")).filter { it.optDouble("at") > 0 && System.currentTimeMillis() - it.optDouble("at") > hrs * 3_600_000.0 }
                .forEach { alerts += "⏰ وردية ${it.optString("cashier")} مفتوحة من ${ago(it.optDouble("at"))}${tag(s)}" }
        }
        if (alerts.isNotEmpty()) {
            val box = card().apply { background = GradientDrawable().apply { cornerRadius = dp(24).toFloat(); setColor(Color.parseColor("#FFF1F0")); setStroke(dp(2), Color.parseColor("#FFC9C4")) } }
            box.addView(text("🔔 تنبيهات (${alerts.size})", 16f, "#B3261E", true))
            alerts.forEach { a -> box.addView(text(a, 14f, INK).apply { setPadding(0, dp(8), 0, 0) }) }
            box.addView(text("دوس هنا تفتح تطبيق الورديات", 11f, "#A9A8BC").apply { setPadding(0, dp(6), 0, 0) })
            box.setOnClickListener { openShifts() }
            root.addView(box)
        }

        // 📊 الملخصات
        val chosen = Home.cards(this)
        val tiles = mutableListOf<View>()
        val rev = shops.flatMap { objs(j(it, "reviews")) }
        if ("sales" in chosen) {
            val known = rev.filter { !it.isNull("sales") }
            tiles += tile("💰 مبيعات النهارده", if (known.isEmpty()) "—" else money.format(known.sumOf { it.optDouble("sales") }) + " ج",
                if (known.isEmpty()) "لسه مفيش وردية اتراجعت النهارده" else "من ${known.size} وردية اتراجعت", "#2E7D32", "#66BB6A")
        }
        if ("expenses" in chosen) {
            val closed = rev.filter { it.optBoolean("closed") }
            tiles += tile("🧾 مصروفات النهارده", money.format(closed.sumOf { it.optDouble("expenses") }) + " ج",
                if (closed.isEmpty()) "من الورديات اللي اتقفلت · لسه مفيش" else "من ${closed.size} وردية اتقفلت", "#E65100", "#FF9800")
        }
        if ("diff" in chosen) {
            val led = shops.flatMap { objs(j(it, "ledger")) }
            val sh = led.filter { it.optString("kind") == "shortage" }.sumOf { it.optDouble("amount") }
            val ov = led.filter { it.optString("kind") == "overage" }.sumOf { it.optDouble("amount") }
            // أكبر عجز ظاهر علشان لو فيه رقم غلط (مبيعات اتكتبت غلط مثلًا) يبان على طول
            val top = led.filter { it.optString("kind") == "shortage" }.maxByOrNull { it.optDouble("amount") }
            val topTxt = top?.let { "\nأكبرهم: ${money.format(it.optDouble("amount"))} ج · ${it.optString("cashier")} ${it.optString("day").takeLast(5).split("-").reversed().joinToString("/")}" } ?: ""
            tiles += tile("⚖️ عجز الشهر ده", money.format(sh) + " ج", "زيادة ${money.format(ov)} ج · ${led.size} وردية$topTxt", "#C62828", "#EF5350")
        }
        if ("transfers" in chosen) {
            val got = wall.filter { it.first.optString("dir") != "out" && it.first.optString("status") !in listOf("personal", "rejected") }
            val by = got.groupBy { it.first.optString("w") }.map { (w, l) -> "${Home.walletName(w)}: ${money.format(l.sumOf { it.first.optDouble("amount") })} ج (${l.size})" }
            tiles += tile("📲 تحويلات النهارده", money.format(got.sumOf { it.first.optDouble("amount") }) + " ج", if (by.isEmpty()) "لسه مفيش" else by.joinToString("\n"), "#5B2A9E", "#9C6ADE")
        }
        if ("open" in chosen) {
            val o = shops.flatMap { s -> objs(j(s, "open")).map { it to s } }
            tiles += tile("🟢 ورديات مفتوحة", "${o.size}", if (o.isEmpty()) "مفيش ورديات مفتوحة" else o.joinToString("\n") { (x, s) -> "${x.optString("cashier")} · من ${ago(x.optDouble("at"))}${tag(s)}" }, "#1565D8", "#42A5F5")
        }
        if ("balances" in chosen) {
            val last = HashMap<String, JSONObject>()
            shops.forEach { s -> objs(j(s, "wallet")).filter { !it.isNull("bal") }.forEach { x ->
                val k = x.optString("w") + (if (multi) "|" + s.optString("name") else "")
                if ((last[k]?.optDouble("atMs") ?: -1.0) < x.optDouble("atMs")) last[k] = JSONObject(x.toString()).put("_shop", s.optString("name"))
            } }
            val tf = SimpleDateFormat("h:mm a", Locale.forLanguageTag("ar-EG-u-nu-latn"))
            tiles += tile("🏦 رصيد المحافظ", if (last.isEmpty()) "—" else "${last.size} محفظة",
                if (last.isEmpty()) "مفيش رسايل فيها رصيد النهارده" else last.values.joinToString("\n") { "${Home.walletName(it.optString("w"))}${if (multi) " · " + it.optString("_shop") else ""}: ${money.format(it.optDouble("bal"))} ج · ${tf.format(Date(it.optDouble("atMs").toLong()))}" },
                "#0B4F2E", "#43A047")
        }
        tiles.chunked(2).forEach { pair ->
            val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; layoutDirection = View.LAYOUT_DIRECTION_RTL; setPadding(0, dp(10), 0, 0) }
            pair.forEachIndexed { i, v -> row.addView(v, LinearLayout.LayoutParams(0, -1, 1f).apply { if (i == 1) marginStart = dp(10) }) }
            if (pair.size == 1) row.addView(View(this), LinearLayout.LayoutParams(0, 1, 1f).apply { marginStart = dp(10) })
            root.addView(row)
        }
        if (tiles.isEmpty()) root.addView(text("مفيش ملخصات مختارة · دوس ⚙️ واختار", 13f, "#6B6A80"))
    }

    // ── 📲 التحويلات ──
    private var loadingTr = false
    private var trErr: String? = null
    private var undo: Pair<String, () -> String?>? = null   // آخر قرار، علشان «تراجع»
    private fun refreshTransfers(say: Boolean) {
        if (loadingTr) return
        loadingTr = true; if (page == "transfers") render()
        bg({ Transfers.load(this) }) { e -> loadingTr = false; trErr = e; if (say && e == null) toast("اتحدّثت ✓"); render() }
    }
    // يعمل القرار، يحدّث القايمة، ويطلّع «تراجع» لمدة 8 ثواني
    private fun act(work: () -> String?, done: String, back: (() -> String?)?) {
        toast("بيحفظ…")
        bg(work) { e ->
            if (e != null) { toast(e); return@bg }
            undo = if (back != null) done to back else null
            val mine = undo
            Handler(Looper.getMainLooper()).postDelayed({ if (undo === mine) { undo = null; render() } }, 8000)
            refreshTransfers(false)
        }
    }

    private fun transfers() {
        val data = Transfers.cached(this)
        val head = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setPadding(0, dp(14), 0, 0) }
        head.addView(text("📲 التحويلات", 20f, INK, true).apply { layoutParams = LinearLayout.LayoutParams(0, -2, 1f) })
        head.addView(button(if (loadingTr) "⏳" else "🔄", false) { refreshTransfers(true) }.apply { layoutParams = LinearLayout.LayoutParams(dp(56), dp(44)) })
        root.addView(head)
        val at = data?.optLong("at") ?: 0
        root.addView(text(when {
            loadingTr && at == 0L -> "بنجيب التحويلات…"
            at > 0 -> "آخر تحديث: " + SimpleDateFormat("h:mm a", Locale.forLanguageTag("ar-EG-u-nu-latn")).format(Date(at)) + (trErr?.let { " · ⚠️ $it" } ?: "")
            else -> trErr ?: ""
        }, 12f, "#8A8AA0"))

        // الفلاتر: الأيام والمحفظة والمحل
        fun chips(opts: List<Pair<String, String>>, sel: String, pick: (String) -> Unit) {
            val sc = android.widget.HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled = false; layoutDirection = View.LAYOUT_DIRECTION_RTL }
            val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; layoutDirection = View.LAYOUT_DIRECTION_RTL; setPadding(0, dp(8), 0, 0) }
            opts.forEach { (k, l) -> row.addView(button(l, k == sel) { pick(k) }.apply { textSize = 13f; layoutParams = LinearLayout.LayoutParams(-2, dp(40)).apply { marginEnd = dp(6) } }) }
            sc.addView(row); root.addView(sc)
        }
        chips(listOf("1" to "النهارده", "2" to "من امبارح", "7" to "آخر 7 أيام"), Transfers.days(this).toString()) { Transfers.setDays(this, it.toInt()); refreshTransfers(false) }
        val shopsAll = objs(j(data, "shops"))
        val raw = objs(j(data, "list"))
        val wallets = raw.map { it.optString("wallet") }.distinct()
        if (wallets.size > 1) chips(listOf("" to "كل المحافظ") + wallets.map { it to Home.walletName(it) }, Transfers.wallet(this)) { Transfers.setWallet(this, it); render() }
        val selShop = Home.shop(this).takeIf { id -> shopsAll.any { it.optString("id") == id } } ?: ""
        if (shopsAll.size > 1) chips(listOf("" to "كل المحلات") + shopsAll.map { it.optString("id") to it.optString("name") }, selShop) { Home.setShop(this, it); render() }

        undo?.let { (t, back) ->
            val bar = card().apply { background = GradientDrawable().apply { cornerRadius = dp(20).toFloat(); setColor(Color.parseColor(INK)) } }
            val r = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
            r.addView(text("✓ $t", 14f, "#FFFFFF", true).apply { layoutParams = LinearLayout.LayoutParams(0, -2, 1f) })
            r.addView(button("تراجع", false) { undo = null; act(back, "رجع زي ما كان", null) })
            bar.addView(r); root.addView(bar)
        }
        if (data == null) return

        val shopName = shopsAll.associate { it.optString("id") to it.optString("name") }
        val wf = Transfers.wallet(this)
        val filtered = raw.filter { (wf.isEmpty() || it.optString("wallet") == wf) && (selShop.isEmpty() || it.optString("shopId") == selShop) }
        // نفس التحويل ممكن يكون في كذا فرع: نعرضه مرة واحدة
        val groups = filtered.groupBy { it.optString("group").ifBlank { it.optString("_id") } }.values.map { copies ->
            val main = copies.firstOrNull { it.optString("status") in listOf("claimed", "rejected", "approved") } ?: copies.first()
            main to copies
        }
        val now = System.currentTimeMillis().toDouble()
        fun t(x: JSONObject, k: String) = x.optDouble(k, 0.0).takeIf { it > 0 } ?: x.optDouble("atMs", 0.0)
        fun win(x: JSONObject): Double { val m = x.optDouble("windowMin", 60.0); return if (m == 0.0) 36 * 3_600_000.0 else (if (m > 0) m else 60.0) * 60_000 }
        fun live(x: JSONObject) = x.optString("status") == "new" && t(x, "releasedAtMs") > now - win(x)
        val newest = { k: String -> compareByDescending<Pair<JSONObject, List<JSONObject>>> { t(it.first, k) } }
        val lLive = groups.filter { live(it.first) }.sortedWith(newest("releasedAtMs"))
        val lBig = groups.filter { it.first.optString("status") == "big" }.sortedWith(newest("atMs"))
        val lClaim = groups.filter { it.first.optString("status") == "claimed" }.sortedWith(newest("claimedAtMs"))
        val lDone = groups.filter { it.first.optString("status") in listOf("approved", "rejected", "personal", "expired") || (it.first.optString("status") == "new" && !live(it.first)) }.sortedWith(newest("decidedAtMs"))

        val tf = SimpleDateFormat("EEE h:mm a", Locale.forLanguageTag("ar-EG-u-nu-latn"))
        fun whenTxt(ms: Double) = if (ms > 0) tf.format(Date(ms.toLong())) else ""
        fun twin(x: JSONObject) = groups.any { (y, _) -> y !== x && y.optString("wallet") == x.optString("wallet") && y.optDouble("amount") == x.optDouble("amount") &&
            y.optString("status") !in listOf("rejected", "personal") && Math.abs(y.optDouble("atMs") - x.optDouble("atMs")) < 45 * 60_000 }
        fun bank(x: JSONObject): String {
            var b = if (twin(x) && x.optString("status") !in listOf("rejected", "personal")) " · ⚠️ ممكن يكون متكرر · راجع الاسم" else ""
            if (x.optString("src") == "note") b += if (x.optBoolean("bankOk")) " · ✓ رسالة البنك" else if (now - x.optDouble("atMs") > 30 * 60_000) " · ⚠️ من غير رسالة بنك" else " · مستني رسالة البنك"
            return b
        }
        fun branches(copies: List<JSONObject>) = if (shopsAll.size > 1) " · " + copies.mapNotNull { shopName[it.optString("shopId")] }.distinct().joinToString("، ") else ""

        fun row(parent: LinearLayout, x: JSONObject, sub: String, btns: List<Triple<String, String, () -> Unit>>) {
            val r = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(0, dp(10), 0, dp(10)) }
            val line = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; layoutDirection = View.LAYOUT_DIRECTION_RTL; gravity = Gravity.CENTER_VERTICAL }
            val w = x.optString("wallet")
            line.addView(View(this).apply {
                background = GradientDrawable().apply { cornerRadius = dp(10).toFloat(); setColor(Color.parseColor(when { w.startsWith("vf") -> "#E60000"; w == "nbe" -> "#1F8A4C"; else -> "#7B2FBE" })) }
                layoutParams = LinearLayout.LayoutParams(dp(8), dp(38)).apply { marginEnd = dp(10) }
            })
            val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; layoutParams = LinearLayout.LayoutParams(0, -2, 1f) }
            col.addView(text("${Transfers.money(x.optDouble("amount"))} ج · ${x.optString("fromName").ifBlank { "عميل" }}", 16f, INK, true))
            col.addView(text("${Home.walletName(w)} · $sub", 12f, "#6B6A80"))
            line.addView(col); r.addView(line)
            if (btns.isNotEmpty()) {
                val br = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; layoutDirection = View.LAYOUT_DIRECTION_RTL; setPadding(dp(18), dp(6), 0, 0) }
                btns.forEach { (l, kind, f) ->
                    br.addView(Button(this).apply {
                        text = l; isAllCaps = false; textSize = 13f
                        val (bgc, fg) = when (kind) { "ok" -> "#2E7D32" to "#FFFFFF"; "no" -> "#FDE7E7" to "#B3261E"; else -> "#E9ECFB" to INK }
                        setTextColor(Color.parseColor(fg)); background = GradientDrawable().apply { cornerRadius = dp(99).toFloat(); setColor(Color.parseColor(bgc)) }
                        setOnClickListener { f() }
                        layoutParams = LinearLayout.LayoutParams(-2, dp(40)).apply { marginEnd = dp(8) }
                    })
                }
                r.addView(br)
            }
            parent.addView(r)
            parent.addView(View(this).apply { setBackgroundColor(Color.parseColor("#EEF0F8")); layoutParams = LinearLayout.LayoutParams(-1, dp(1)) })
        }
        fun sec(title: String, hint: String, list: List<Pair<JSONObject, List<JSONObject>>>, body: (LinearLayout) -> Unit) {
            if (list.isEmpty()) return
            val c = card()
            c.addView(text("$title · ${list.size}", 17f, INK, true))
            if (hint.isNotBlank()) c.addView(text(hint, 12f, "#8A8AA0"))
            body(c); root.addView(c)
        }
        if (lLive.isEmpty() && lBig.isEmpty() && lClaim.isEmpty()) root.addView(card().apply { addView(text("مفيش تحويلات مستنية حاجة دلوقتي ✓", 15f, "#6B6A80")) })

        sec("⏳ وصلت دلوقتي", "ظاهرة للكاشيرية", lLive) { c ->
            lLive.forEach { (x, cp) -> row(c, x, whenTxt(t(x, "releasedAtMs")) + branches(cp) + (x.optString("fromPhone").takeIf { it.isNotBlank() }?.let { " · $it" } ?: "") + bank(x),
                if (x.optBoolean("allowPersonal", true)) listOf(Triple("شخصي", "", { act({ Transfers.setAll(this, cp, "personal", "اتعلّم شخصي") }, "اتعلّم شخصي") { Transfers.setAll(this, cp, x.optString("status"), "رجع زي ما كان") } })) else emptyList()) }
        }
        sec("⚠️ مستنية قرارك", "أكبر من الحد · مش ظاهرة للكاشير", lBig) { c ->
            lBig.forEach { (x, cp) -> row(c, x, whenTxt(x.optDouble("atMs")) + branches(cp) + bank(x), listOfNotNull(
                Triple("ابعته للكاشير", "ok", { act({ Transfers.setAll(this, cp, "new", "اتبعت للكاشيرية", release = true) }, "اتبعت للكاشيرية") { Transfers.setAll(this, cp, "big", "رجع زي ما كان") } }),
                if (x.optBoolean("allowPersonal", true)) Triple("شخصي", "", { act({ Transfers.setAll(this, cp, "personal", "اتعلّم شخصي") }, "اتعلّم شخصي") { Transfers.setAll(this, cp, "big", "رجع زي ما كان") } }) else null)) }
        }
        sec("✋ أكّدها الكاشير", "طابقها بالفاتورة على البرنامج", lClaim) { c ->
            lClaim.forEach { (x, cp) -> row(c, x, "${x.optString("claimedByName")} · فاتورة ${x.optString("claimInvoice").ifBlank { "—" }} · ${whenTxt(t(x, "claimedAtMs"))}${branches(cp)}${bank(x)}", listOf(
                Triple("✓ تبع المحل", "ok", { act({ Transfers.setOne(this, x, "approved", "اتعلّم تبع المحل") }, "اتعلّم تبع المحل") { Transfers.setOne(this, x, "claimed", "رجع زي ما كان") } }),
                Triple("✗ مش بتاعه", "no", {
                    AlertDialog.Builder(this).setMessage("ترفض ${Transfers.money(x.optDouble("amount"))} ج اللي ${x.optString("claimedByName")} أكّده؟ المبلغ هيبقى على الكاشير.")
                        .setPositiveButton("أيوه ارفضه") { _, _ -> act({ Transfers.refuse(this, x, false) }, "اترفض · المبلغ بقى على الكاشير") { Transfers.refuse(this, x, true) } }
                        .setNegativeButton("لأ", null).show()
                }))) }
        }
        sec("اللي خلص", "تبع المحل / مرفوض / شخصي / عدّى وقته", lDone) { c ->
            lDone.forEach { (x, cp) ->
                val st = x.optString("status"); val by = x.optString("decidedByName").takeIf { it.isNotBlank() }?.let { " · $it" } ?: ""
                val txt = when (st) {
                    "approved" -> "✓ تبع المحل$by · أكّده ${x.optString("claimedByName")}"
                    "rejected" -> "❌ اترفض$by · كان أكّده ${x.optString("claimedByName")}"
                    "personal" -> "شخصي$by"
                    else -> "عدّى وقته ومحدش أكّده"
                }
                val b: Triple<String, String, () -> Unit>? = when (st) {
                    "approved" -> Triple("رجّعه", "", { act({ Transfers.setOne(this, x, "claimed", "رجع لـ«أكّدها الكاشير»") }, "رجع لـ«أكّدها الكاشير»", null) })
                    "rejected" -> Triple("رجّعه", "", { act({ Transfers.refuse(this, x, true) }, "رجع زي ما كان · المبلغ رجع في حساب الكاشير", null) })
                    "personal" -> Triple("ابعته للكاشير", "", { act({ Transfers.setAll(this, cp, "new", "اتبعت للكاشيرية", release = true) }, "اتبعت للكاشيرية") { Transfers.setAll(this, cp, "personal", "رجع زي ما كان") } })
                    else -> Triple("اظهره تاني", "", { act({ Transfers.setAll(this, cp, "new", "ظهر تاني للكاشيرية", release = true) }, "ظهر تاني للكاشيرية", null) })
                }
                row(c, x, "$txt · ${whenTxt(t(x, "decidedAtMs"))}${branches(cp)}", listOfNotNull(b))
            }
        }
    }

    private fun tile(title: String, big: String, sub: String, c1: String, c2: String) = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL; layoutDirection = View.LAYOUT_DIRECTION_RTL; setPadding(dp(14), dp(12), dp(14), dp(12))
        background = GradientDrawable(GradientDrawable.Orientation.TL_BR, intArrayOf(Color.parseColor(c1), Color.parseColor(c2))).apply { cornerRadius = dp(22).toFloat() }
        addView(text(title, 13f, "#FFFFFF", true))
        addView(text(big, 24f, "#FFFFFF", true).apply { setPadding(0, dp(4), 0, dp(2)) })
        addView(text(sub, 11.5f, "#F2F2FF"))
    }

    private fun homeSettings() {
        val box = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; layoutDirection = View.LAYOUT_DIRECTION_RTL; setPadding(dp(20), dp(8), dp(20), 0) }
        box.addView(text("الملخصات اللي تظهر", 14f, bold = true))
        val chosen = Home.cards(this).toMutableSet()
        Home.CARDS.forEach { (k, l) -> box.addView(CheckBox(this).apply { text = l; isChecked = k in chosen; layoutDirection = View.LAYOUT_DIRECTION_RTL; setOnCheckedChangeListener { _, v -> if (v) chosen.add(k) else chosen.remove(k) } }) }
        box.addView(text("التنبيهات", 14f, bold = true).apply { setPadding(0, dp(12), 0, 0) })
        box.addView(text("نبّهني لو العجز في وردية أكبر من (جنيه)", 13f, "#6B6A80"))
        val sm = EditText(this).apply { setText(Home.shortageMin(this@MainActivity).toString()); inputType = InputType.TYPE_CLASS_NUMBER; textDirection = View.TEXT_DIRECTION_LTR }
        box.addView(sm)
        box.addView(text("نبّهني لو وردية فضلت مفتوحة أكتر من (ساعة)", 13f, "#6B6A80"))
        val lh = EditText(this).apply { setText(Home.longHours(this@MainActivity).toString()); inputType = InputType.TYPE_CLASS_NUMBER; textDirection = View.TEXT_DIRECTION_LTR }
        box.addView(lh)
        AlertDialog.Builder(this).setTitle("⚙️ الصفحة الرئيسية").setView(ScrollView(this).apply { addView(box) })
            .setPositiveButton("احفظ") { _, _ ->
                Home.setCards(this, chosen)
                Home.setLimits(this, sm.text.toString().toIntOrNull()?.coerceAtLeast(0) ?: 50, lh.text.toString().toIntOrNull()?.coerceIn(1, 72) ?: 12)
                render()
            }.setNegativeButton("إلغاء", null).show()
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
                bg({ Account.signIn(this, u, p) }) { e -> toast(e ?: "أهلًا ${Account.name(this)} ✓ المحافظ اتظبطت"); render(); if (e == null) refreshHome(false) }
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
