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
    private var swipe: androidx.swiperefreshlayout.widget.SwipeRefreshLayout? = null
    private val INK = "#15142A"; private val BLUE = "#1565D8"; private val BG = "#ECEFFF"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Popup.channel(this)
        window.statusBarColor = Color.parseColor(BG)
        root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; layoutDirection = View.LAYOUT_DIRECTION_RTL; setPadding(dp(16), dp(20), dp(16), dp(32)) }
        // اسحب لتحت علشان تحدّث
        swipe = androidx.swiperefreshlayout.widget.SwipeRefreshLayout(this).apply {
            setColorSchemeColors(Color.parseColor(BLUE), Color.parseColor("#C2549A"), Color.parseColor("#1B7F3B"))
            addView(ScrollView(this@MainActivity).apply { setBackgroundColor(Color.parseColor(BG)); addView(root) })
            setOnRefreshListener {
                when {
                    Account.mode(this@MainActivity) != "user" -> bg({ Account.sync(this@MainActivity) }) { render() }
                    page == "transfers" -> refreshTransfers(true)
                    page == "purchases" -> refreshPurchases(true)
                    page == "purchase" -> { purDetail = null; render() }
                    else -> refreshHome(true)
                }
            }
        }
        setContentView(swipe)
    }

    // القفل: كل مرة التطبيق يتفتح من الأول، أو بعد دقيقتين في الخلفية
    private var unlocked = false
    private var stoppedAt = 0L
    override fun onStop() { super.onStop(); stoppedAt = System.currentTimeMillis() }

    override fun onResume() {
        super.onResume()
        if (stoppedAt > 0 && System.currentTimeMillis() - stoppedAt > 2 * 60_000) { unlocked = false; bioAsked = false }
        render()
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
        bg({ Home.load(this).also { if ("purchases" in Home.cards(this)) runCatching { Purchases.load(this) } } }) { e -> loadingHome = false; homeErr = e; if (say && e == null) toast("اتحدّثت ✓"); render() }
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
        text = t; isAllCaps = false; textSize = 14.5f; stateListAnimator = null; minHeight = dp(50); setTypeface(typeface, Typeface.BOLD)
        setTextColor(Color.parseColor(if (primary) "#FFFFFF" else INK))
        background = GradientDrawable().apply { cornerRadius = dp(99).toFloat(); setColor(Color.parseColor(if (primary) BLUE else "#E9ECFB")) }
        setOnClickListener { onClick() }
    }

    // الصفحات: الرئيسية / التحويلات، و ☰ فيها كل الإعدادات
    private var page = "home"
    private fun go(p: String) {
        page = p; render(); (root.parent as? ScrollView)?.scrollTo(0, 0)
        root.alpha = 0.3f; root.animate().alpha(1f).setDuration(180).start()
    }
    @Deprecated("back")
    private val SUB = mapOf("menu" to "home", "purchase" to "purchases", "shift" to "shifts", "shifts" to "home", "expenses" to "home")
    private val SUB_TITLE = mapOf("menu" to ("الإعدادات" to "الأكونت والصلاحيات والمحافظ"), "purchase" to ("فاتورة مشتريات" to "كل اللي متسجّل عليها"),
        "shift" to ("الوردية" to "كل عملياتها"), "shifts" to ("الورديات" to "النهارده والمفتوحة"), "expenses" to ("المصروفات" to "كل مصروفات النهارده لايف"))
    override fun onBackPressed() { SUB[page]?.let { go(it) } ?: if (page != "home") go("home") else super.onBackPressed() }

    private fun allOk(): Boolean {
        val pm = getSystemService(PowerManager::class.java)
        return notifAccess() && has(Manifest.permission.RECEIVE_SMS) && Settings.canDrawOverlays(this) &&
            (Build.VERSION.SDK_INT < 33 || has(Manifest.permission.POST_NOTIFICATIONS)) && pm.isIgnoringBatteryOptimizations(packageName)
    }

    // نفس خط تطبيق الورديات (Alexandria) على كل الكلام
    private val fReg by lazy { runCatching { Typeface.createFromAsset(assets, "fonts/alexandria-regular.ttf") }.getOrDefault(Typeface.DEFAULT) }
    private val fBold by lazy { runCatching { Typeface.createFromAsset(assets, "fonts/alexandria-bold.ttf") }.getOrDefault(Typeface.DEFAULT_BOLD) }
    private fun applyFont(v: View) {
        if (v is TextView) { val b = v.typeface?.isBold == true; v.typeface = if (b) fBold else fReg }
        if (v is android.view.ViewGroup) for (i in 0 until v.childCount) applyFont(v.getChildAt(i))
    }
    private fun render() { renderInner(); applyFont(root) }

    private fun renderInner() {
        swipe?.isRefreshing = loadingHome || loadingTr || loadingPur
        root.removeAllViews()
        val mode0 = Account.mode(this)
        swipe?.isEnabled = mode0 != "user" || (unlocked && Lock.has(this))
        // مش داخل: صفحة دخول كاملة · داخل ومفيش رقم سري: يختار رقم · مقفول: شاشة الأرقام
        if (mode0.isEmpty() && page != "menu") { loginPage(); return }
        if (mode0 == "user" && !Lock.has(this)) { pinPage("set"); return }
        if (mode0 == "user" && !unlocked) { pinPage("unlock"); return }
        val mode = Account.mode(this)
        // الهيدر: العلامة والاسم، وأيقونة القايمة من غير زرار تقيل
        val top = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; layoutDirection = View.LAYOUT_DIRECTION_RTL; gravity = Gravity.CENTER_VERTICAL; setPadding(0, 0, 0, dp(2)) }
        top.addView(ImageView(this).apply {
            setImageResource(R.mipmap.ic_launcher); clipToOutline = true; background = round("#FFFFFF", 12)
            layoutParams = LinearLayout.LayoutParams(dp(34), dp(34)).apply { marginEnd = dp(10) }
        })
        val sub = SUB_TITLE[page]
        top.addView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; layoutParams = LinearLayout.LayoutParams(0, -2, 1f)
            addView(text(sub?.first ?: "مدقق", 19f, if (sub != null) INK else BLUE, true))
            // فلتر الفروع: كل اللي تحته بيبقى للفرع ده بس
            val shopsK = objs(j(Home.cached(this@MainActivity), "shops"))
            if (Account.mode(this@MainActivity) == "user" && page != "menu" && shopsK.size > 1) {
                val sel = Home.shop(this@MainActivity).takeIf { id -> shopsK.any { it.optString("id") == id } } ?: ""
                addView(dropChip(listOf("" to "📍 كل الفروع") + shopsK.map { it.optString("id") to "📍 " + it.optString("name") }, sel) { Home.setShop(this@MainActivity, it); showAllDone = false; render() }
                    .apply { textSize = 12f; setPadding(dp(12), dp(5), dp(12), dp(5)); (layoutParams as LinearLayout.LayoutParams).apply { topMargin = dp(3); gravity = Gravity.START } })
            } else addView(text(sub?.second ?: when (Account.mode(this@MainActivity)) {
                "user" -> "Owners · ${Account.name(this@MainActivity)}"; "shop" -> "Owners · موبايل المحل"; else -> "Owners" }, 11.5f, "#8A8AA0"))
        })
        if (Account.mode(this) == "user" && sub == null) top.addView(avatar(34) { go("menu") }.apply { (layoutParams as LinearLayout.LayoutParams).marginEnd = dp(4) })
        top.addView(iconBtn(if (sub != null) "→" else "☰") { go(SUB[page] ?: "menu") })
        root.addView(top)
        if (page == "menu") { menuPage(); return }

        // صلاحية مقفولة؟ تنبيه صغير يفتح ☰
        if (!allOk()) root.addView(card().apply {
            background = GradientDrawable().apply { cornerRadius = dp(20).toFloat(); setColor(Color.parseColor("#FFF4E0")) }
            addView(text("⚠️ فيه صلاحية مقفولة على الموبايل ده · التحويلات ممكن متوصلش. دوس هنا وفعّلها", 14f, "#8A5A00", true))
            setOnClickListener { go("menu") }
        })
        when (mode) {
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
        val tabs = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; layoutDirection = View.LAYOUT_DIRECTION_RTL; background = round("#FFFFFF", 99); setPadding(dp(5), dp(5), dp(5), dp(5))
            layoutParams = LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(12) } }
        if (SUB_TITLE[page] == null) listOf("home" to "🏠 الرئيسية", "transfers" to "📲 التحويلات", "purchases" to "🛒 المشتريات").forEach { (k, l) ->
            val on = page == k
            tabs.addView(TextView(this).apply {
                text = l; textSize = 13.5f; gravity = Gravity.CENTER; setTypeface(typeface, if (on) Typeface.BOLD else Typeface.NORMAL)
                setTextColor(Color.parseColor(if (on) "#FFFFFF" else "#6B6A80"))
                background = if (on) round(BLUE, 99) else null
                setPadding(0, dp(11), 0, dp(11)); setOnClickListener { if (!on) { showAllDone = false; go(k) } }
            }, LinearLayout.LayoutParams(0, -2, 1f))
        }
        if (SUB_TITLE[page] == null) root.addView(tabs)
        when (page) { "transfers" -> transfers(); "purchases" -> purchasesPage(); "purchase" -> purchaseDetail(); "shifts" -> shiftsPage(); "shift" -> shiftDetail(); "expenses" -> expensesPage(); else -> home() }
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
                acc.addView(LinearLayout(this).apply {
                    orientation = LinearLayout.HORIZONTAL; layoutDirection = View.LAYOUT_DIRECTION_RTL; gravity = Gravity.CENTER_VERTICAL; setPadding(0, 0, 0, dp(8))
                    addView(avatar(64) { pickPhoto() })
                    addView(TextView(this@MainActivity).apply { text = "🖼 غيّر الصورة"; textSize = 14f; setTypeface(typeface, Typeface.BOLD); setTextColor(Color.parseColor(BLUE)); setPadding(dp(14), dp(10), dp(14), dp(10)); setOnClickListener { pickPhoto() } })
                })
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
            if (Account.mode(this) == "user") acc.addView(button("🔒 غيّر الرقم السري", false) { Lock.clear(this); pinStage = ""; go("home") }.apply { layoutParams = LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(8) } })
            row.addView(button(if (Account.isShopPhone(this)) "فك الربط" else "خروج", false) {
                AlertDialog.Builder(this).setMessage(if (Account.isShopPhone(this)) "تفك ربط موبايل المحل؟ المحافظ هتبطل تتبعت من هنا." else "تخرج من الأكونت؟ المحافظ هتبطل تتبعت من الموبايل ده.")
                    .setPositiveButton("أيوه") { _, _ -> Account.signOut(this); unlocked = false; page = "home"; render() }.setNegativeButton("لأ", null).show()
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

        val at = data?.optLong("at") ?: 0
        hero(at, shops)
        if (data == null) return
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
                if (known.isEmpty()) "لسه مفيش وردية اتراجعت النهارده" else "من ${known.size} وردية اتراجعت", "#B6F000", "")
        }
        val todayShifts = shops.flatMap { s -> objs(j(s, "shifts")).map { it to s } }
        if ("expenses" in chosen) {
            val exps = todayShifts.flatMap { (sh, _) -> objs(j(sh, "expenses")) }
            val byKind = exps.groupBy { it.optString("kind") }.map { (k, l) -> k to l.sumOf { it.optDouble("amount") } }.sortedByDescending { it.second }.take(3)
            tiles += tile("🧾 مصروفات النهارده", money.format(exps.sumOf { it.optDouble("amount") }) + " ج",
                if (exps.isEmpty()) "لسه مفيش مصروفات النهارده" else "${exps.size} مصروف\n" + byKind.joinToString("\n") { "${it.first}: ${money.format(it.second)}" }, "#FF7A1A", "")
                .apply { setOnClickListener { go("expenses") } }
        }
        if ("diff" in chosen) {
            val led = shops.flatMap { objs(j(it, "ledger")) }
            val sh = led.filter { it.optString("kind") == "shortage" }.sumOf { it.optDouble("amount") }
            val ov = led.filter { it.optString("kind") == "overage" }.sumOf { it.optDouble("amount") }
            // أكبر عجز ظاهر علشان لو فيه رقم غلط (مبيعات اتكتبت غلط مثلًا) يبان على طول
            val top = led.filter { it.optString("kind") == "shortage" }.maxByOrNull { it.optDouble("amount") }
            val topTxt = top?.let { "\nأكبرهم: ${money.format(it.optDouble("amount"))} ج · ${it.optString("cashier")} ${it.optString("day").takeLast(5).split("-").reversed().joinToString("/")}" } ?: ""
            tiles += tile("⚖️ عجز الشهر ده", money.format(sh) + " ج", "زيادة ${money.format(ov)} ج · ${led.size} وردية$topTxt", "#FF7EB0", "")
        }
        if ("transfers" in chosen) {
            // كل اللي وصل محافظ صاحب المحل (حتى الشخصي) — من غير محافظ المحل اللي بتتسجل لوحدها ومن غير المرفوض
            val got = wall.filter { it.first.optString("dir") != "out" && it.first.optString("status") !in listOf("auto", "rejected") }.map { it.first }
            val sum = { l: List<JSONObject> -> money.format(l.sumOf { it.optDouble("amount") }) }
            val shopSide = got.filter { it.optString("status") in listOf("approved", "claimed") }
            val pers = got.filter { it.optString("status") == "personal" }
            val rest = got.filter { it.optString("status") !in listOf("approved", "claimed", "personal") }
            val by = got.groupBy { it.optString("w") }.map { (w, l) -> "${Home.walletName(w)}: ${sum(l)}" }
            tiles += tile("📲 وصل للمالك النهارده", sum(got) + " ج",
                if (got.isEmpty()) "لسه مفيش" else "تبع المحل ${sum(shopSide)} · شخصي ${sum(pers)}" + (if (rest.isNotEmpty()) " · لسه ${sum(rest)}" else "") + "\n" + by.joinToString("\n"), "#A07CFF", "")
                .apply { setOnClickListener { go("transfers") } }
        }
        if ("open" in chosen) {
            val o = shops.flatMap { s -> objs(j(s, "open")).map { it to s } }
            val closedN = todayShifts.count { it.first.optString("status") == "closed" }
            val waitN = todayShifts.count { it.first.optString("status") in listOf("submitted", "reviewing", "disputed", "reopened") }
            tiles += tile("🧾 الورديات", "${o.size} مفتوحة", (listOfNotNull(if (waitN > 0) "$waitN مستنية المحاسب" else null, if (closedN > 0) "$closedN اتقفلت" else null).joinToString(" · ").ifBlank { "النهارده" }) + "\n" +
                o.joinToString("\n") { (x, s) -> "${x.optString("cashier")} · من ${ago(x.optDouble("at"))}${tag(s)}" }, "#1565D8", "")
                .apply { setOnClickListener { go("shifts") } }
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
                "#1B7F3B", "")
        }
        if ("purchases" in chosen) {
            val pd = Purchases.cached(this)
            val today = Home.dayKey(System.currentTimeMillis())
            val ids = shops.map { it.optString("id") }.toSet()
            val pl = objs(j(pd, "list")).filter { Purchases.dayOf(it.optString("createdAt")) == today && (it.optString("shopId") in ids || it.optString("shopId").isEmpty()) }
            val wait = pl.count { Purchases.pending(it.optString("status")) }
            tiles += tile("🛒 مشتريات النهارده", if (pd == null) "—" else money.format(pl.sumOf { it.optDouble("total") }) + " ج",
                if (pd == null) "دوس ↻ علشان تتجاب" else if (pl.isEmpty()) "مفيش فواتير اترفعت النهارده" else "${pl.size} فاتورة" + if (wait > 0) " · $wait لسه مدخلتش السيستم" else " · كلها اتدخلت ✓",
                "#FFC400", "").apply { setOnClickListener { go("purchases") } }
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

    // ── شكل الصفحة: كروت بيضا ناعمة، وألوان كل محفظة ──
    private fun round(color: String, r: Int = 20) = GradientDrawable().apply { cornerRadius = dp(r).toFloat(); setColor(Color.parseColor(color)) }
    private fun pill(t: String, bg: String, fg: String, size: Float = 11.5f) = TextView(this).apply {
        text = t; textSize = size; setTextColor(Color.parseColor(fg)); setTypeface(typeface, Typeface.BOLD)
        background = round(bg, 99); setPadding(dp(9), dp(3), dp(9), dp(3))
        layoutParams = LinearLayout.LayoutParams(-2, -2).apply { marginEnd = dp(6); topMargin = dp(5) }
    }
    private fun walletLook(w: String): Triple<IntArray, String, String> = when {   // ألوان، اختصار، لون فاتح
        w == "insta2" -> Triple(intArrayOf(Color.parseColor("#2B1650"), Color.parseColor("#C2549A")), "IP", "#F0E6FF")
        w.startsWith("insta") -> Triple(intArrayOf(Color.parseColor("#4A1F7A"), Color.parseColor("#F0653A")), "IP", "#F3E8FF")
        w == "vf2" -> Triple(intArrayOf(Color.parseColor("#5C0010"), Color.parseColor("#F0567A")), "VF", "#FFE3EA")
        w.startsWith("vf") -> Triple(intArrayOf(Color.parseColor("#B30000"), Color.parseColor("#FF4D4D")), "VF", "#FFE5E5")
        w == "nbe" -> Triple(intArrayOf(Color.parseColor("#0B4F2E"), Color.parseColor("#8CC63F")), "NBE", "#E3F5E8")
        else -> Triple(intArrayOf(Color.parseColor("#1565D8"), Color.parseColor("#42A5F5")), "₤", "#E3F0FF")
    }
    // اختيارات صغيرة جنب بعض (بتتزحلق لو كتير)
    private fun chipRow(opts: List<Pair<String, String>>, sel: String, pick: (String) -> Unit) {
        val sc = android.widget.HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled = false; layoutDirection = View.LAYOUT_DIRECTION_RTL }
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; layoutDirection = View.LAYOUT_DIRECTION_RTL; setPadding(0, dp(8), 0, 0) }
        opts.forEach { (k, l) ->
            val on = k == sel
            row.addView(TextView(this).apply {
                text = l; textSize = 13.5f; gravity = Gravity.CENTER; setTypeface(typeface, if (on) Typeface.BOLD else Typeface.NORMAL)
                setTextColor(Color.parseColor(if (on) "#FFFFFF" else INK)); background = round(if (on) INK else "#FFFFFF", 99)
                setPadding(dp(16), dp(8), dp(16), dp(8)); setOnClickListener { pick(k) }
                layoutParams = LinearLayout.LayoutParams(-2, -2).apply { marginEnd = dp(6) }
            })
        }
        sc.addView(row); root.addView(sc)
    }
    private var showAllDone = false
    // أيقونة تطبيق المحفظة نفسه (InstaPay / الأهلي / فودافون كاش) من الموبايل — لو مش متسطب، الدايرة الملونة
    private val iconCache = HashMap<String, android.graphics.drawable.Drawable?>()
    private fun walletIcon(w: String): android.graphics.drawable.Drawable? = iconCache.getOrPut(w) {
        val want = if (w.startsWith("insta")) "insta" else if (w.startsWith("vf")) "vf" else w
        val pkg = Store.conns(this).firstOrNull { it.wallet.startsWith(want) && it.apps.isNotEmpty() }?.apps?.firstOrNull()
            ?: Defaults.apps(this, w).firstOrNull()?.first
        pkg?.let { runCatching { packageManager.getApplicationIcon(it) }.getOrNull() }
    }
    // أيقونة من غير خلفية (القايمة، التحديث…)
    private fun iconBtn(t: String, onClick: () -> Unit) = TextView(this).apply {
        text = t; textSize = 22f; gravity = Gravity.CENTER; setTextColor(Color.parseColor(INK))
        val tv = android.util.TypedValue(); context.theme.resolveAttribute(android.R.attr.selectableItemBackgroundBorderless, tv, true); setBackgroundResource(tv.resourceId)
        layoutParams = LinearLayout.LayoutParams(dp(44), dp(44)); setOnClickListener { onClick() }
    }
    // فلتر في سطر واحد: «النهارده ▾» ولما تدوس عليه تختار
    private fun dropChip(opts: List<Pair<String, String>>, sel: String, pick: (String) -> Unit) = TextView(this).apply {
        val cur = opts.firstOrNull { it.first == sel } ?: opts.first()
        val active = cur.first != opts.first().first
        text = cur.second + "  ▾"; textSize = 13f; setTypeface(typeface, Typeface.BOLD); gravity = Gravity.CENTER
        setTextColor(Color.parseColor(if (active) "#FFFFFF" else INK)); background = round(if (active) INK else "#FFFFFF", 99)
        setPadding(dp(14), dp(8), dp(14), dp(8))
        layoutParams = LinearLayout.LayoutParams(-2, -2).apply { marginEnd = dp(6) }
        setOnClickListener { v ->
            val m = android.widget.PopupMenu(this@MainActivity, v)
            opts.forEachIndexed { i, (_, l) -> m.menu.add(0, i, i, (if (opts[i].first == cur.first) "✓  " else "") + l) }
            m.setOnMenuItemClickListener { pick(opts[it.itemId].first); true }
            m.show()
        }
    }
    private fun filterRow(views: List<View>) {
        val sc = android.widget.HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled = false; layoutDirection = View.LAYOUT_DIRECTION_RTL }
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; layoutDirection = View.LAYOUT_DIRECTION_RTL; setPadding(0, dp(10), 0, 0) }
        views.forEach { row.addView(it) }
        sc.addView(row); root.addView(sc)
    }
    private fun title(t: String, sub: String, onRefresh: () -> Unit, loading: Boolean) {
        val head = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; layoutDirection = View.LAYOUT_DIRECTION_RTL; gravity = Gravity.CENTER_VERTICAL; setPadding(dp(2), dp(14), 0, 0) }
        head.addView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; layoutParams = LinearLayout.LayoutParams(0, -2, 1f)
            addView(text(t, 21f, INK, true)); if (sub.isNotBlank()) addView(text(sub, 11.5f, "#8A8AA0"))
        })
        head.addView(iconBtn(if (loading) "⏳" else "↻") { onRefresh() }.apply { setTextColor(Color.parseColor(BLUE)) })
        root.addView(head)
    }

    private fun transfers() {
        val data = Transfers.cached(this)
        val at = data?.optLong("at") ?: 0
        title("التحويلات", when {
            loadingTr -> "بيتحدّث…"
            at > 0 -> "آخر تحديث " + SimpleDateFormat("h:mm a", Locale.forLanguageTag("ar-EG-u-nu-latn")).format(Date(at)) + (trErr?.let { " · ⚠️ $it" } ?: "")
            else -> trErr ?: ""
        }, { refreshTransfers(true) }, loadingTr)
        val shopsAll = objs(j(data, "shops"))
        val raw = objs(j(data, "list"))
        val wallets = raw.map { it.optString("wallet") }.distinct()
        val selShop = Home.shop(this).takeIf { id -> shopsAll.any { it.optString("id") == id } } ?: ""
        // الفلاتر كلها في سطر واحد
        filterRow(listOfNotNull(
            dropChip(listOf("1" to "النهارده", "2" to "من امبارح", "7" to "آخر 7 أيام"), Transfers.days(this).toString()) { Transfers.setDays(this, it.toInt()); refreshTransfers(false) },
            if (wallets.size > 1) dropChip(listOf("" to "كل المحافظ") + wallets.map { it to Home.walletName(it) }, Transfers.wallet(this)) { Transfers.setWallet(this, it); render() } else null,
        ))

        undo?.let { (t, back) ->
            val bar = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; background = round(INK, 18); setPadding(dp(16), dp(8), dp(8), dp(8))
                layoutParams = LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(12) } }
            bar.addView(text("✓ $t", 14f, "#FFFFFF", true).apply { layoutParams = LinearLayout.LayoutParams(0, -2, 1f) })
            bar.addView(TextView(this).apply { text = "تراجع"; textSize = 14f; setTypeface(typeface, Typeface.BOLD); setTextColor(Color.parseColor("#C6FF1A")); setPadding(dp(14), dp(8), dp(14), dp(8))
                setOnClickListener { undo = null; act(back, "رجع زي ما كان", null) } })
            root.addView(bar)
        }
        if (data == null) { if (!loadingTr) refreshTransfers(false); return }

        val shopName = shopsAll.associate { it.optString("id") to it.optString("name") }
        val wf = Transfers.wallet(this)
        val filtered = raw.filter { (wf.isEmpty() || it.optString("wallet") == wf) && (selShop.isEmpty() || it.optString("shopId") == selShop) }
        val groups = filtered.groupBy { it.optString("group").ifBlank { it.optString("_id") } }.values.map { copies ->
            (copies.firstOrNull { it.optString("status") in listOf("claimed", "rejected", "approved") } ?: copies.first()) to copies
        }
        val now = System.currentTimeMillis().toDouble()
        fun tm(x: JSONObject, k: String) = x.optDouble(k, 0.0).takeIf { it > 0 } ?: x.optDouble("atMs", 0.0)
        fun win(x: JSONObject): Double { val m = x.optDouble("windowMin", 60.0); return if (m == 0.0) 36 * 3_600_000.0 else (if (m > 0) m else 60.0) * 60_000 }
        fun live(x: JSONObject) = x.optString("status") == "new" && tm(x, "releasedAtMs") > now - win(x)
        val newest = { k: String -> compareByDescending<Pair<JSONObject, List<JSONObject>>> { tm(it.first, k) } }
        val lLive = groups.filter { live(it.first) }.sortedWith(newest("releasedAtMs"))
        val lBig = groups.filter { it.first.optString("status") == "big" }.sortedWith(newest("atMs"))
        val lClaim = groups.filter { it.first.optString("status") == "claimed" }.sortedWith(newest("claimedAtMs"))
        val lDone = groups.filter { it.first.optString("status") in listOf("approved", "rejected", "personal", "expired") || (it.first.optString("status") == "new" && !live(it.first)) }.sortedWith(newest("atMs"))

        // ملخص الفترة: اللي وصل، تبع المحل، شخصي
        val got = groups.map { it.first }.filter { it.optString("status") != "rejected" }
        val sumOf = { l: List<JSONObject> -> l.sumOf { it.optDouble("amount") } }
        val shopSide = got.filter { it.optString("status") in listOf("approved", "claimed") }
        val pers = got.filter { it.optString("status") == "personal" }
        val stats = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; layoutDirection = View.LAYOUT_DIRECTION_RTL; setPadding(0, dp(12), 0, 0) }
        listOf(Triple("وصل", got, intArrayOf(Color.parseColor("#1565D8"), Color.parseColor("#5B8CFF"))),
            Triple("تبع المحل", shopSide, intArrayOf(Color.parseColor("#1B7F3B"), Color.parseColor("#4CC37A"))),
            Triple("شخصي", pers, intArrayOf(Color.parseColor("#5B2A9E"), Color.parseColor("#C2549A")))).forEachIndexed { i, (l, list, cols) ->
            stats.addView(LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL; setPadding(dp(12), dp(10), dp(12), dp(10))
                background = GradientDrawable(GradientDrawable.Orientation.TL_BR, cols).apply { cornerRadius = dp(20).toFloat() }
                addView(text(l, 12f, "#E8EAFF", true))
                addView(text(Transfers.money(sumOf(list)), 19f, "#FFFFFF", true))
                addView(text("${list.size} تحويل", 11f, "#E8EAFF"))
            }, LinearLayout.LayoutParams(0, -2, 1f).apply { if (i > 0) marginStart = dp(8) })
        }
        root.addView(stats)
        // 📅 كل يوم: وصل كام، منهم تبع المحل كام وشخصي كام
        if (Transfers.days(this) > 1) {
            val byDay = groups.map { it.first }.filter { it.optString("status") != "rejected" }.groupBy { it.optString("day") }.toSortedMap(compareByDescending { it })
            if (byDay.isNotEmpty()) root.addView(card().apply {
                addView(text("📅 كل يوم", 15f, INK, true))
                val dayF = SimpleDateFormat("EEEE d/M", Locale.forLanguageTag("ar-EG-u-nu-latn"))
                val today = Home.dayKey(System.currentTimeMillis()); val yest = Home.dayKey(System.currentTimeMillis() - 86_400_000)
                byDay.forEach { (d, l) ->
                    val label = when (d) { today -> "النهارده"; yest -> "امبارح"; else -> runCatching { dayF.format(SimpleDateFormat("yyyy-MM-dd", Locale.US).parse(d)!!) }.getOrDefault(d) }
                    val shopN = l.filter { it.optString("status") in listOf("approved", "claimed") }.sumOf { it.optDouble("amount") }
                    val persN = l.filter { it.optString("status") == "personal" }.sumOf { it.optDouble("amount") }
                    addView(LinearLayout(this@MainActivity).apply { orientation = LinearLayout.HORIZONTAL; layoutDirection = View.LAYOUT_DIRECTION_RTL; gravity = Gravity.CENTER_VERTICAL; setPadding(0, dp(9), 0, dp(9))
                        addView(LinearLayout(this@MainActivity).apply { orientation = LinearLayout.VERTICAL; layoutParams = LinearLayout.LayoutParams(0, -2, 1f)
                            addView(text(label, 14f, INK, true))
                            addView(text("تبع المحل ${Transfers.money(shopN)} · شخصي ${Transfers.money(persN)} · ${l.size} تحويل", 11.5f, "#8A8AA0")) })
                        addView(text(Transfers.money(l.sumOf { it.optDouble("amount") }) + " ج", 16f, BLUE, true)) })
                    addView(View(this@MainActivity).apply { setBackgroundColor(Color.parseColor("#EEF0F8")); layoutParams = LinearLayout.LayoutParams(-1, dp(1)) })
                }
            })
        }

        val tf = SimpleDateFormat("h:mm a", Locale.forLanguageTag("ar-EG-u-nu-latn"))
        fun twin(x: JSONObject) = groups.any { (y, _) -> y !== x && y.optString("wallet") == x.optString("wallet") && y.optDouble("amount") == x.optDouble("amount") &&
            y.optString("status") !in listOf("rejected", "personal") && Math.abs(y.optDouble("atMs") - x.optDouble("atMs")) < 45 * 60_000 }

        // سطر التحويل: دايرة بلون المحفظة، الاسم والوقت، المبلغ كبير، والحالة شارة ملونة
        fun row(x: JSONObject, copies: List<JSONObject>, btns: List<Triple<String, String, () -> Unit>>, fresh: Boolean = false) {
            val w = x.optString("wallet"); val (cols, abbr, soft) = walletLook(w)
            val box = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL; setPadding(dp(12), dp(10), dp(12), dp(10))
                background = GradientDrawable().apply { cornerRadius = dp(18).toFloat(); setColor(Color.WHITE); if (fresh) setStroke(dp(2), Color.parseColor("#C6FF1A")) }
                layoutParams = LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(6) }
            }
            // سطر ١: الدايرة · الاسم · المبلغ
            val line = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; layoutDirection = View.LAYOUT_DIRECTION_RTL; gravity = Gravity.CENTER_VERTICAL }
            val ic = walletIcon(w)
            line.addView(if (ic != null) ImageView(this).apply { setImageDrawable(ic); layoutParams = LinearLayout.LayoutParams(dp(38), dp(38)).apply { marginEnd = dp(10) } }
            else TextView(this).apply {
                text = abbr; textSize = if (abbr.length > 2) 9.5f else 11.5f; setTypeface(typeface, Typeface.BOLD); setTextColor(Color.WHITE); gravity = Gravity.CENTER
                background = GradientDrawable(GradientDrawable.Orientation.TL_BR, cols).apply { shape = GradientDrawable.OVAL }
                layoutParams = LinearLayout.LayoutParams(dp(36), dp(36)).apply { marginEnd = dp(10) }
            })
            val mid = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; layoutParams = LinearLayout.LayoutParams(0, -2, 1f) }
            mid.addView(text(x.optString("fromName").ifBlank { "عميل" }, 14.5f, INK, true).apply { maxLines = 1; ellipsize = android.text.TextUtils.TruncateAt.END })
            val shopTxt = if (shopsAll.size > 1) " · " + copies.mapNotNull { shopName[it.optString("shopId")] }.distinct().joinToString("، ") else ""
            mid.addView(text("${Home.walletName(w)} · ${tf.format(Date(x.optDouble("atMs").toLong()))}$shopTxt", 11.5f, "#8A8AA0").apply { maxLines = 1; ellipsize = android.text.TextUtils.TruncateAt.END })
            line.addView(mid)
            line.addView(text(Transfers.money(x.optDouble("amount")) + " ج", 16.5f, INK, true).apply { setPadding(dp(8), 0, 0, 0) })
            box.addView(line)
            // سطر ٢: الحالة والشارات، والزرار في نفس السطر
            val st = x.optString("status")
            val by = x.optString("decidedByName").let { if (it.contains("الإشعار")) "من الإشعار" else it }
            val tags = mutableListOf<View>()
            fun tag(t: String, bg: String, fg: String) { tags += pill(t, bg, fg, 10.5f).apply { setPadding(dp(8), dp(2), dp(8), dp(2)) } }
            when {
                live(x) -> tag("⏳ ظاهر للكاشير", "#FFF3D6", "#8A5A00")
                st == "big" -> tag("⚠️ مستني قرارك", "#FFE3E3", "#B3261E")
                st == "claimed" -> tag("✋ ${x.optString("claimedByName")} · فاتورة ${x.optString("claimInvoice").ifBlank { "—" }}", "#E3F0FF", "#1565D8")
                st == "approved" -> tag("✓ تبع المحل" + (x.optString("claimedByName").takeIf { it.isNotBlank() }?.let { " · $it" } ?: ""), "#E3F7E8", "#1B7F3B")
                st == "rejected" -> tag("✗ مرفوض", "#FDE7E7", "#B3261E")
                st == "personal" -> tag("👤 شخصي" + (by.takeIf { it.isNotBlank() }?.let { " · $it" } ?: ""), soft, "#5B2A9E")
                else -> tag("عدّى وقته", "#EEF0F4", "#6B6A80")
            }
            if (x.optString("src") == "note" && st !in listOf("personal", "rejected")) {
                if (x.optBoolean("bankOk")) tag("✓ البنك", "#E3F7E8", "#1B7F3B")
                else if (now - x.optDouble("atMs") > 30 * 60_000) tag("⚠️ من غير رسالة بنك", "#FFF3D6", "#8A5A00")
            }
            if (twin(x) && st !in listOf("rejected", "personal")) tag("⚠️ ممكن متكرر", "#FFE3E3", "#B3261E")
            val l2 = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; layoutDirection = View.LAYOUT_DIRECTION_RTL; gravity = Gravity.CENTER_VERTICAL; setPadding(dp(46), dp(4), 0, 0) }
            val tagBox = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; layoutDirection = View.LAYOUT_DIRECTION_RTL }
            tags.forEach { tagBox.addView(it) }
            l2.addView(android.widget.HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled = false; layoutDirection = View.LAYOUT_DIRECTION_RTL; addView(tagBox) }, LinearLayout.LayoutParams(0, -2, 1f))
            btns.forEach { (l, kind, f) ->
                val (bgc, fg) = when (kind) { "ok" -> "#1B7F3B" to "#FFFFFF"; "no" -> "#FDE7E7" to "#B3261E"; "lime" -> "#C6FF1A" to INK; else -> "#EEF0FB" to BLUE }
                l2.addView(TextView(this).apply { text = l; textSize = 12.5f; setTypeface(typeface, Typeface.BOLD); setTextColor(Color.parseColor(fg)); gravity = Gravity.CENTER
                    background = round(bgc, 99); setPadding(dp(12), dp(6), dp(12), dp(6)); setOnClickListener { f() }
                    layoutParams = LinearLayout.LayoutParams(-2, -2).apply { marginStart = dp(6); topMargin = dp(4) } })
            }
            box.addView(l2)
            box.alpha = 0f; box.translationY = dp(6).toFloat()
            box.animate().alpha(1f).translationY(0f).setDuration(200).start()
            root.addView(box)
        }
        fun header(t: String, n: Int, hint: String, color: String) {
            val h = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; layoutDirection = View.LAYOUT_DIRECTION_RTL; gravity = Gravity.CENTER_VERTICAL; setPadding(dp(4), dp(18), dp(4), 0) }
            h.addView(text(t, 16f, color, true))
            h.addView(pill("$n", color, "#FFFFFF", 11f).apply { (layoutParams as LinearLayout.LayoutParams).apply { marginStart = dp(8); topMargin = 0 } })
            if (hint.isNotBlank()) h.addView(text("  $hint", 11.5f, "#8A8AA0"))
            root.addView(h)
        }
        val personalBtn = { x: JSONObject, cp: List<JSONObject>, from: String -> Triple("👤 شخصي", "", { act({ Transfers.setAll(this, cp, "personal", "اتعلّم شخصي") }, "اتعلّم شخصي") { Transfers.setAll(this, cp, from, "رجع زي ما كان") } }) }

        if (lLive.isEmpty() && lBig.isEmpty() && lClaim.isEmpty()) root.addView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER; background = round("#FFFFFF", 22); setPadding(dp(16), dp(18), dp(16), dp(18))
            layoutParams = LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(14) }
            addView(text("✓  مفيش حاجة مستنياك دلوقتي", 15f, "#1B7F3B", true).apply { gravity = Gravity.CENTER })
        })
        if (lBig.isNotEmpty()) { header("⚠️ مستنية قرارك", lBig.size, "أكبر من الحد", "#B3261E")
            lBig.forEach { (x, cp) -> row(x, cp, listOfNotNull(Triple("للكاشير", "ok", { act({ Transfers.setAll(this, cp, "new", "اتبعت للكاشيرية", release = true) }, "اتبعت للكاشيرية") { Transfers.setAll(this, cp, "big", "رجع زي ما كان") } }),
                if (x.optBoolean("allowPersonal", true)) personalBtn(x, cp, "big") else null)) } }
        if (lClaim.isNotEmpty()) { header("✋ أكّدها الكاشير", lClaim.size, "طابقها بالفاتورة", "#1565D8")
            lClaim.forEach { (x, cp) -> row(x, cp, listOf(
                Triple("✓ تبع المحل", "ok", { act({ Transfers.setOne(this, x, "approved", "اتعلّم تبع المحل") }, "اتعلّم تبع المحل") { Transfers.setOne(this, x, "claimed", "رجع زي ما كان") } }),
                Triple("✗ مش بتاعه", "no", {
                    AlertDialog.Builder(this).setMessage("ترفض ${Transfers.money(x.optDouble("amount"))} ج اللي ${x.optString("claimedByName")} أكّده؟ المبلغ هيبقى على الكاشير.")
                        .setPositiveButton("أيوه ارفضه") { _, _ -> act({ Transfers.refuse(this, x, false) }, "اترفض · المبلغ بقى على الكاشير") { Transfers.refuse(this, x, true) } }
                        .setNegativeButton("لأ", null).show()
                }))) } }
        if (lLive.isNotEmpty()) { header("⏳ وصلت دلوقتي", lLive.size, "ظاهرة للكاشيرية", "#8A5A00")
            lLive.forEach { (x, cp) -> row(x, cp, if (x.optBoolean("allowPersonal", true)) listOf(personalBtn(x, cp, "new").copy(second = "lime")) else emptyList(), fresh = now - tm(x, "releasedAtMs") < 5 * 60_000) } }

        // اللي خلص: متقسم بالأيام، وأول 15 بس لحد ما تطلب الباقي
        if (lDone.isNotEmpty()) {
            header("اللي خلص", lDone.size, "", "#6B6A80")
            val dayF = SimpleDateFormat("EEEE d/M", Locale.forLanguageTag("ar-EG-u-nu-latn"))
            val today = Home.dayKey(System.currentTimeMillis()); val yest = Home.dayKey(System.currentTimeMillis() - 86_400_000)
            var lastDay = ""
            (if (showAllDone) lDone else lDone.take(15)).forEach { (x, cp) ->
                val d = x.optString("day")
                if (d != lastDay) { lastDay = d
                    root.addView(text(when (d) { today -> "النهارده"; yest -> "امبارح"; else -> dayF.format(Date(x.optDouble("atMs").toLong())) }, 12.5f, "#8A8AA0", true).apply { setPadding(dp(6), dp(12), dp(6), 0) }) }
                val st = x.optString("status")
                val b: Triple<String, String, () -> Unit>? = when (st) {
                    "approved" -> Triple("↩ رجّعه", "", { act({ Transfers.setOne(this, x, "claimed", "رجع لـ«أكّدها الكاشير»") }, "رجع لـ«أكّدها الكاشير»", null) })
                    "rejected" -> Triple("↩ رجّعه", "", { act({ Transfers.refuse(this, x, true) }, "رجع · المبلغ رجع في حساب الكاشير", null) })
                    "personal" -> Triple("للكاشير", "", { act({ Transfers.setAll(this, cp, "new", "اتبعت للكاشيرية", release = true) }, "اتبعت للكاشيرية") { Transfers.setAll(this, cp, "personal", "رجع زي ما كان") } })
                    else -> Triple("اظهره تاني", "", { act({ Transfers.setAll(this, cp, "new", "ظهر تاني للكاشيرية", release = true) }, "ظهر تاني للكاشيرية", null) })
                }
                row(x, cp, listOfNotNull(b))
            }
            if (!showAllDone && lDone.size > 15) root.addView(TextView(this).apply {
                text = "اعرض الباقي (${lDone.size - 15})"; textSize = 14f; setTypeface(typeface, Typeface.BOLD); setTextColor(Color.parseColor(BLUE)); gravity = Gravity.CENTER
                background = round("#FFFFFF", 99); setPadding(0, dp(12), 0, dp(12)); layoutParams = LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(12) }
                setOnClickListener { showAllDone = true; render() }
            })
        }
    }

    // ── 🛒 المشتريات ──
    private var loadingPur = false
    private var purErr: String? = null
    private var purId = ""
    private var purDetail: JSONObject? = null
    private var purDetailErr: String? = null
    private val purImgs = HashMap<String, android.graphics.Bitmap?>()
    private val purOpen = HashSet<String>()
    private val purBad = HashSet<String>()
    private var purLoading = false
    private fun refreshPurchases(say: Boolean) {
        if (loadingPur) return
        loadingPur = true; if (page == "purchases") render()
        bg({ Purchases.load(this) }) { e -> loadingPur = false; purErr = e; if (say && e == null) toast("اتحدّثت ✓"); render() }
    }
    private fun supColor(name: String): IntArray {
        val pal = listOf("#1565D8" to "#5B8CFF", "#00695C" to "#26A69A", "#E65100" to "#FFA040", "#6A1B9A" to "#BA68C8", "#AD1457" to "#F06292", "#2E7D32" to "#81C784", "#37474F" to "#78909C")
        val (a, b) = pal[(name.hashCode() and 0x7fffffff) % pal.size]
        return intArrayOf(Color.parseColor(a), Color.parseColor(b))
    }
    private fun timeOf(iso: String, withDay: Boolean = false): String {
        val ms = Purchases.ms(iso); if (ms == 0L) return ""
        return SimpleDateFormat(if (withDay) "EEEE d/M · h:mm a" else "h:mm a", Locale.forLanguageTag("ar-EG-u-nu-latn")).format(Date(ms))
    }

    private fun purchasesPage() {
        val data = Purchases.cached(this)
        val at = data?.optLong("at") ?: 0
        title("المشتريات", when {
            loadingPur -> "بيتحدّث…"
            at > 0 -> "آخر تحديث " + SimpleDateFormat("h:mm a", Locale.forLanguageTag("ar-EG-u-nu-latn")).format(Date(at)) + (purErr?.let { " · ⚠️ $it" } ?: "")
            else -> purErr ?: ""
        }, { refreshPurchases(true) }, loadingPur)
        if (data == null) { if (!loadingPur && purErr == null) refreshPurchases(false); return }

        val all = objs(j(data, "list"))
        val now = System.currentTimeMillis()
        val days = Purchases.days(this)
        val okDays = (0 until days).map { Home.dayKey(now - it * 86_400_000L) }.toSet()
        val inPeriod = all.filter { Purchases.dayOf(it.optString("createdAt")) in okDays }
        val shops = inPeriod.map { it.optString("shopId") to it.optString("shopName") }.distinct()
        val selShop = Home.shop(this).takeIf { id -> shops.any { it.first == id } } ?: ""
        val sups = inPeriod.filter { selShop.isEmpty() || it.optString("shopId") == selShop }.map { it.optString("supplier") }.filter { it.isNotBlank() }.distinct().sorted()
        val sup = Purchases.supplier(this).takeIf { it in sups } ?: ""
        val st = Purchases.status(this)
        filterRow(listOfNotNull(
            dropChip(listOf("1" to "النهارده", "2" to "من امبارح", "7" to "آخر 7 أيام", "30" to "آخر 30 يوم"), days.toString()) { val d = it.toInt(); Purchases.setDays(this, d); if (d > (data.optInt("days", 2) - 1)) refreshPurchases(false) else render() },
            if (sups.size > 1) dropChip(listOf("" to "كل الموردين") + sups.map { it to it }, sup) { Purchases.setSupplier(this, it); render() } else null,
            dropChip(listOf("" to "كل الحالات", "wait" to "لسه مدخلتش", "done" to "تم الإدخال", "rej" to "مرفوضة"), st) { Purchases.setStatus(this, it); render() },
        ))
        val un = data.optJSONArray("unmatched")
        if (un != null && un.length() > 0) root.addView(text("⚠️ ${(0 until un.length()).joinToString("، ") { un.getString(it) }} مش مربوط بالمشتريات لسه (مفيش فواتير بالاسم ده)", 12f, "#8A5A00").apply { setPadding(dp(4), dp(8), dp(4), 0) })

        val list = inPeriod.filter {
            (selShop.isEmpty() || it.optString("shopId") == selShop) && (sup.isEmpty() || it.optString("supplier") == sup) && when (st) {
                "wait" -> Purchases.pending(it.optString("status")); "done" -> it.optString("status").contains("تم"); "rej" -> it.optString("status").contains("مرفوض"); else -> true
            }
        }
        // ملخص
        val sumOf = { l: List<JSONObject> -> l.sumOf { it.optDouble("total") } }
        val done = list.filter { it.optString("status").contains("تم") }
        val wait = list.filter { Purchases.pending(it.optString("status")) }
        val stats = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; layoutDirection = View.LAYOUT_DIRECTION_RTL; setPadding(0, dp(12), 0, 0) }
        listOf(Triple("الإجمالي", list, intArrayOf(Color.parseColor("#00695C"), Color.parseColor("#26A69A"))),
            Triple("تم الإدخال", done, intArrayOf(Color.parseColor("#1B7F3B"), Color.parseColor("#4CC37A"))),
            Triple("لسه", wait, intArrayOf(Color.parseColor("#E65100"), Color.parseColor("#FFA040")))).forEachIndexed { i, (l, li, cols) ->
            stats.addView(LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL; setPadding(dp(12), dp(10), dp(12), dp(10))
                background = GradientDrawable(GradientDrawable.Orientation.TL_BR, cols).apply { cornerRadius = dp(20).toFloat() }
                addView(text(l, 12f, "#E8FFF8", true)); addView(text(Transfers.money(sumOf(li)), 19f, "#FFFFFF", true)); addView(text("${li.size} فاتورة", 11f, "#E8FFF8"))
            }, LinearLayout.LayoutParams(0, -2, 1f).apply { if (i > 0) marginStart = dp(8) })
        }
        root.addView(stats)
        if (list.isEmpty()) {
            root.addView(LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER; background = round("#FFFFFF", 22); setPadding(dp(16), dp(18), dp(16), dp(18))
                layoutParams = LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(14) }
                addView(text("مفيش فواتير في الفترة دي", 15f, "#6B6A80", true).apply { gravity = Gravity.CENTER }) })
            return
        }
        val dayF = SimpleDateFormat("EEEE d/M", Locale.forLanguageTag("ar-EG-u-nu-latn"))
        val today = Home.dayKey(now); val yest = Home.dayKey(now - 86_400_000)
        var lastDay = ""
        list.forEach { x ->
            val d = Purchases.dayOf(x.optString("createdAt"))
            if (days > 1 && d != lastDay) { lastDay = d
                root.addView(text(when (d) { today -> "النهارده"; yest -> "امبارح"; else -> dayF.format(Date(Purchases.ms(x.optString("createdAt")))) }, 12.5f, "#8A8AA0", true).apply { setPadding(dp(6), dp(12), dp(6), 0) }) }
            val box = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL; setPadding(dp(12), dp(10), dp(12), dp(10)); background = round("#FFFFFF", 18)
                layoutParams = LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(6) }
                setOnClickListener { purId = x.optString("id"); purDetail = null; purDetailErr = null; go("purchase") }
            }
            val line = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; layoutDirection = View.LAYOUT_DIRECTION_RTL; gravity = Gravity.CENTER_VERTICAL }
            val supName = x.optString("supplier").ifBlank { "مورد" }
            line.addView(TextView(this).apply {
                text = supName.trim().take(1); textSize = 15f; setTypeface(typeface, Typeface.BOLD); setTextColor(Color.WHITE); gravity = Gravity.CENTER
                background = GradientDrawable(GradientDrawable.Orientation.TL_BR, supColor(supName)).apply { shape = GradientDrawable.OVAL }
                layoutParams = LinearLayout.LayoutParams(dp(36), dp(36)).apply { marginEnd = dp(10) }
            })
            val mid = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; layoutParams = LinearLayout.LayoutParams(0, -2, 1f) }
            mid.addView(text(supName, 14.5f, INK, true).apply { maxLines = 1; ellipsize = android.text.TextUtils.TruncateAt.END })
            val meta = listOfNotNull(timeOf(x.optString("createdAt")), "${x.optInt("count")} صنف",
                x.optString("number").takeIf { it.isNotBlank() }?.let { "فاتورة $it" }, if (shops.size > 1) x.optString("shopName") else null).joinToString(" · ")
            mid.addView(text(meta, 11.5f, "#8A8AA0").apply { maxLines = 1; ellipsize = android.text.TextUtils.TruncateAt.END })
            line.addView(mid)
            line.addView(text(Transfers.money(x.optDouble("total")) + " ج", 16.5f, INK, true).apply { setPadding(dp(8), 0, 0, 0) })
            box.addView(line)
            val tags = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; layoutDirection = View.LAYOUT_DIRECTION_RTL }
            fun tag(t: String, bg: String, fg: String) = tags.addView(pill(t, bg, fg, 10.5f).apply { setPadding(dp(8), dp(2), dp(8), dp(2)) })
            val (sl, sb, sf) = Purchases.look(x.optString("status")); tag(sl, sb, sf)
            x.optString("systemNo").takeIf { it.isNotBlank() }?.let { tag("سيستم #$it", "#EEF0FB", "#1565D8") }
            if (x.optInt("priceUps") > 0) tag("⬆ ${x.optInt("priceUps")} سعر زاد", "#FFE3E3", "#B3261E")
            if (x.optInt("priceDowns") > 0) tag("⬇ ${x.optInt("priceDowns")} سعر قلّ", "#E3F7E8", "#1B7F3B")
            if (x.optInt("urgeCount") > 0) tag("🔔 استعجلوها ${x.optInt("urgeCount")}", "#FFF3D6", "#8A5A00")
            if (x.optInt("rejectCount") > 0 && !x.optString("status").contains("مرفوض")) tag("اترفضت قبل كده ${x.optInt("rejectCount")}", "#FDE7E7", "#B3261E")
            box.addView(android.widget.HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled = false; layoutDirection = View.LAYOUT_DIRECTION_RTL; setPadding(dp(46), dp(4), 0, 0); addView(tags) })
            box.alpha = 0f; box.animate().alpha(1f).setDuration(180).start()
            root.addView(box)
        }
    }

    // تقرير الفاتورة: كل اللي متسجّل عليها
    private fun purchaseDetail() {
        val d = purDetail
        if (d == null) {
            root.addView(text(purDetailErr ?: "بنجيب الفاتورة…", 14f, if (purDetailErr != null) "#B3261E" else "#8A8AA0").apply { setPadding(dp(4), dp(20), dp(4), 0) })
            if (purDetailErr == null && !purLoading) { purLoading = true; bg({ val (j, e) = Purchases.detail(this, purId); purDetail = j; purDetailErr = e; null }) { purLoading = false; if (page == "purchase") render() } }
            else root.addView(button("جرّب تاني", false) { purDetailErr = null; render() })
            return
        }
        val v = d.optJSONObject("invoice") ?: JSONObject()
        val lines = objs(d.optJSONArray("lines") ?: JSONArray())
        val supName = v.optString("supplier").ifBlank { "مورد" }
        // الكارت الأساسي
        root.addView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setPadding(dp(16), dp(14), dp(16), dp(14))
            background = GradientDrawable(GradientDrawable.Orientation.TL_BR, supColor(supName)).apply { cornerRadius = dp(24).toFloat() }
            layoutParams = LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(12) }
            addView(text(supName, 20f, "#FFFFFF", true))
            addView(text(Transfers.money(v.optDouble("total")) + " ج", 30f, "#FFFFFF", true))
            addView(text(listOfNotNull(v.optString("shopName"), "${v.optInt("count")} صنف", timeOf(v.optString("createdAt"), true)).joinToString(" · "), 12.5f, "#F0F4FF"))
            val (sl, _, _) = Purchases.look(v.optString("status"))
            addView(pill(sl, "#FFFFFF", INK, 12f).apply { (layoutParams as LinearLayout.LayoutParams).topMargin = dp(8) })
        })
        // البيانات: اللي مكتوب بس
        val info = card()
        fun kv(k: String, value: String?) {
            if (value.isNullOrBlank() || value == "null") return
            val r = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; layoutDirection = View.LAYOUT_DIRECTION_RTL; setPadding(0, dp(5), 0, dp(5)) }
            r.addView(text(k, 13f, "#8A8AA0").apply { layoutParams = LinearLayout.LayoutParams(dp(130), -2) })
            r.addView(text(value, 13.5f, INK, true).apply { layoutParams = LinearLayout.LayoutParams(0, -2, 1f) })
            info.addView(r)
        }
        fun who(n: String, t: String) = listOf(n, timeOf(t, true)).filter { it.isNotBlank() }.joinToString(" · ")
        kv("رقم فاتورة المورد", v.optString("number"))
        kv("رقمها على السيستم", v.optString("systemNo"))
        kv("رصيد المورد", v.optString("balance").let { b -> b.toDoubleOrNull()?.let { Transfers.money(it) + " ج" } ?: b })
        if (!v.isNull("typedTotal")) kv("الإجمالي المكتوب", Transfers.money(v.optDouble("typedTotal")) + " ج")
        kv("ملاحظة الإجمالي", v.optString("totalNote"))
        kv("رفعها", who(v.optString("user"), v.optString("createdAt")))
        kv("استلمها الدعم", who(v.optString("receivedBy"), v.optString("receivedAt")))
        kv("أدخلها", who(v.optString("doneBy"), v.optString("doneAt")))
        if (v.optInt("priceChanges") > 0 || v.optString("pricesBy").isNotBlank()) kv("أسعار البيع", "${v.optInt("priceChanges")} تعديل" + (v.optString("pricesBy").takeIf { it.isNotBlank() }?.let { " · $it" } ?: ""))
        kv("الجودة", who(v.optString("qaBy"), v.optString("qaAt")))
        if (v.optInt("qaRejects") > 0) kv("رجّعتها الجودة", "${v.optInt("qaRejects")} مرة")
        kv("ملاحظات الجودة", v.optString("qaNotes"))
        kv("راجعها الفرع", who(v.optString("reviewedBy"), v.optString("reviewedAt")))
        kv("ملاحظات المراجعة", v.optString("reviewNotes"))
        kv("سبب الرفض", v.optString("rejectReason"))
        kv("رفضها", who(v.optString("rejectedBy"), v.optString("rejectedAt")))
        if (v.optInt("rejectCount") > 0) kv("مرات الرفض", "${v.optInt("rejectCount")}")
        if (v.optInt("urgeCount") > 0) kv("الاستعجال", "${v.optInt("urgeCount")} مرة · آخرها ${timeOf(v.optString("urgedAt"), true)}")
        kv("ملاحظات", v.optString("notes"))
        if (info.childCount > 0) root.addView(info)

        // تقرير المدير
        v.optString("report").takeIf { it.isNotBlank() }?.let { rep ->
            root.addView(card().apply { addView(text("📋 تقرير الفاتورة", 15f, INK, true)); addView(text(rep, 13f, "#3A3950").apply { setPadding(0, dp(6), 0, 0); setTextIsSelectable(true) }) })
        }
        // الأسعار اللي اتغيّرت
        val changed = lines.filter { (!it.isNull("oldPrice") && it.optDouble("oldPrice") > 0 && Math.abs(it.optDouble("oldPrice") - it.optDouble("piecePrice")) > 0.009) || (!it.isNull("newSale") && !it.isNull("oldSale") && it.optDouble("newSale") != it.optDouble("oldSale")) }
        if (changed.isNotEmpty()) root.addView(card().apply {
            addView(text("💲 أسعار اتغيّرت (${changed.size})", 15f, INK, true))
            changed.forEach { l ->
                val up = !l.isNull("oldPrice") && l.optDouble("piecePrice") > l.optDouble("oldPrice")
                val parts = mutableListOf<String>()
                if (!l.isNull("oldPrice") && l.optDouble("oldPrice") > 0 && Math.abs(l.optDouble("oldPrice") - l.optDouble("piecePrice")) > 0.009) parts += "شراء ${Transfers.money(l.optDouble("oldPrice"))} ← ${Transfers.money(l.optDouble("piecePrice"))}"
                if (!l.isNull("newSale") && !l.isNull("oldSale") && l.optDouble("newSale") != l.optDouble("oldSale")) parts += "بيع ${Transfers.money(l.optDouble("oldSale"))} ← ${Transfers.money(l.optDouble("newSale"))}"
                addView(text((if (up) "⬆ " else "⬇ ") + l.optString("name"), 13.5f, if (up) "#B3261E" else "#1B7F3B", true).apply { setPadding(0, dp(8), 0, 0) })
                addView(text(parts.joinToString(" · ") + (l.optString("saleAction").takeIf { it.isNotBlank() }?.let { " · $it" } ?: ""), 12f, "#6B6A80"))
            }
        })
        // الأصناف
        if (lines.isNotEmpty()) root.addView(card().apply {
            addView(text("📦 الأصناف (${lines.size})", 15f, INK, true))
            lines.forEach { l ->
                val r = LinearLayout(this@MainActivity).apply { orientation = LinearLayout.HORIZONTAL; layoutDirection = View.LAYOUT_DIRECTION_RTL; setPadding(0, dp(8), 0, dp(8)) }
                val c = LinearLayout(this@MainActivity).apply { orientation = LinearLayout.VERTICAL; layoutParams = LinearLayout.LayoutParams(0, -2, 1f) }
                c.addView(text(l.optString("name") + if (l.optBoolean("isNew")) "  🆕" else "", 13.5f, INK, true))
                val q = Transfers.money(l.optDouble("qty")) + " " + l.optString("unit").ifBlank { "" } +
                    (if (l.optInt("pieces") > 0 && l.optString("unit").contains("كرت")) " (${l.optInt("pieces")} قطعة)" else "") + " × " + Transfers.money(l.optDouble("piecePrice"))
                c.addView(text(q + (l.optString("barcode").takeIf { it.isNotBlank() }?.let { " · $it" } ?: ""), 11.5f, "#8A8AA0"))
                r.addView(c)
                r.addView(text(Transfers.money(l.optDouble("total")), 14f, INK, true))
                addView(r)
                addView(View(this@MainActivity).apply { setBackgroundColor(Color.parseColor("#EEF0F8")); layoutParams = LinearLayout.LayoutParams(-1, dp(1)) })
            }
            addView(LinearLayout(this@MainActivity).apply { orientation = LinearLayout.HORIZONTAL; layoutDirection = View.LAYOUT_DIRECTION_RTL; setPadding(0, dp(10), 0, 0)
                addView(text("الإجمالي", 14f, INK, true).apply { layoutParams = LinearLayout.LayoutParams(0, -2, 1f) })
                addView(text(Transfers.money(lines.sumOf { it.optDouble("total") }) + " ج", 16f, INK, true)) })
        })
        // الصور: بتتجاب لما تدوس
        fun ids(k: String) = v.optJSONArray(k)?.let { a -> (0 until a.length()).map { a.getString(it) } } ?: emptyList()
        val groups = listOf("🧩 الصورة المدمجة" to listOfNotNull(v.optString("merged").takeIf { it.isNotBlank() }), "📷 صور الفرع" to ids("photos"), "🖥 سكرين السيستم" to ids("screens")).filter { it.second.isNotEmpty() }
        if (groups.isNotEmpty()) root.addView(card().apply {
            addView(text("🖼 الصور", 15f, INK, true))
            groups.forEach { (l, files) ->
                val open = l in purOpen
                addView(TextView(this@MainActivity).apply {
                    text = (if (open) "▾ " else "◂ ") + "$l (${files.size})"; textSize = 14f; setTypeface(typeface, Typeface.BOLD); setTextColor(Color.parseColor(BLUE)); setPadding(0, dp(10), 0, dp(4))
                    setOnClickListener { if (open) purOpen.remove(l) else purOpen.add(l); render() }
                })
                if (open) files.forEach { f ->
                    if (!purImgs.containsKey(f)) {
                        purImgs[f] = null
                        addView(text("بتتحمّل…", 12f, "#8A8AA0"))
                        bg({ val b = runCatching { Purchases.image(this@MainActivity, purId, f) }.getOrNull(); purImgs[f] = b; if (b == null) purBad.add(f); null }) { if (page == "purchase") render() }
                    } else if (f in purBad) addView(text("مقدرناش نجيب الصورة دي", 12f, "#B3261E"))
                    else purImgs[f]?.let { bmp ->
                        addView(ImageView(this@MainActivity).apply { setImageBitmap(bmp); adjustViewBounds = true; clipToOutline = true; background = round("#F2F3F8", 14)
                            layoutParams = LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(6) } })
                    } ?: addView(text("بتتحمّل…", 12f, "#8A8AA0"))
                }
            }
        })
        // السجلات
        listOf("سجل الاستعجال" to v.optString("urgeLog"), "سجل الجودة" to v.optString("qaLog")).filter { it.second.isNotBlank() }.forEach { (k, t) ->
            root.addView(card().apply { addView(text(k, 14f, INK, true)); addView(text(t, 12f, "#6B6A80").apply { setPadding(0, dp(4), 0, 0) }) })
        }
    }

    // ── صورة الأكونت (دايرة) ──
    private val PHOTO_REQ = 7711
    private fun avatar(size: Int, onClick: (() -> Unit)? = null): View {
        val b = Photo.get(this)
        val v: View = if (b != null) ImageView(this).apply {
            setImageBitmap(b); scaleType = ImageView.ScaleType.CENTER_CROP; clipToOutline = true
            background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(Color.WHITE) }
        } else TextView(this).apply {
            text = Account.name(this@MainActivity).trim().take(1).ifBlank { "👤" }; textSize = size / 2.6f; gravity = Gravity.CENTER; setTypeface(typeface, Typeface.BOLD)
            setTextColor(Color.parseColor(INK)); background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(Color.parseColor("#B6F000")) }
        }
        v.layoutParams = LinearLayout.LayoutParams(dp(size), dp(size))
        onClick?.let { f -> v.setOnClickListener { f() } }
        return v
    }
    private fun pickPhoto() {
        val pick = Intent(Intent.ACTION_GET_CONTENT).setType("image/*").addCategory(Intent.CATEGORY_OPENABLE)
        val cam = Intent(android.provider.MediaStore.ACTION_IMAGE_CAPTURE)
        runCatching { startActivityForResult(Intent.createChooser(pick, "صورتك").putExtra(Intent.EXTRA_INITIAL_INTENTS, arrayOf(cam)), PHOTO_REQ) }
            .onFailure { toast("مفيش تطبيق صور على الموبايل") }
    }

    // ── الكارت الأزرق الكبير: «صباح الفل يا …» (زي تطبيق الورديات) ──
    private fun hero(at: Long, shops: List<JSONObject>) {
        val h = java.util.Calendar.getInstance(java.util.TimeZone.getTimeZone("Africa/Cairo")).get(java.util.Calendar.HOUR_OF_DAY)
        val first = Account.name(this).trim().split(" ").firstOrNull().orEmpty()
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setPadding(dp(18), dp(18), dp(18), dp(16)); background = round(BLUE, 30)
            layoutParams = LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(12) }
        }
        val top = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; layoutDirection = View.LAYOUT_DIRECTION_RTL; gravity = Gravity.CENTER_VERTICAL }
        top.addView(avatar(58) { go("menu") }.apply { (layoutParams as LinearLayout.LayoutParams).marginEnd = dp(12)
            foreground = GradientDrawable().apply { shape = GradientDrawable.OVAL; setStroke(dp(3), Color.WHITE) } })
        top.addView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; layoutParams = LinearLayout.LayoutParams(0, -2, 1f)
            addView(text((if (h < 12) "صباح الفل" else "مساء الفل") + if (first.isNotBlank()) " يا $first" else "", 24f, "#FFFFFF", true))
            addView(text(SimpleDateFormat("EEEE d/M", Locale.forLanguageTag("ar-EG-u-nu-latn")).format(Date()) + when {
                loadingHome -> " · بيتحدّث…"
                at > 0 -> " · آخر تحديث " + SimpleDateFormat("h:mm a", Locale.forLanguageTag("ar-EG-u-nu-latn")).format(Date(at))
                else -> "" } + (homeErr?.let { " · ⚠️ $it" } ?: ""), 12f, "#D6E6FF"))
        })
        top.addView(iconBtn(if (loadingHome) "⏳" else "↻") { refreshHome(true) }.apply { setTextColor(Color.WHITE) })
        box.addView(top)
        // أهم رقمين
        val known = shops.flatMap { objs(j(it, "reviews")) }.filter { !it.isNull("sales") }
        val open = shops.sumOf { j(it, "open").length() }
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; layoutDirection = View.LAYOUT_DIRECTION_RTL; setPadding(0, dp(14), 0, 0) }
        listOf("مبيعات النهارده" to (if (known.isEmpty()) "—" else money.format(known.sumOf { it.optDouble("sales") }) + " ج"),
            "ورديات مفتوحة" to "$open").forEachIndexed { i, (l, v) ->
            row.addView(LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL; setPadding(dp(14), dp(10), dp(14), dp(10))
                background = GradientDrawable().apply { cornerRadius = dp(20).toFloat(); setColor(Color.parseColor("#2A7BEA")) }
                addView(text(l, 12f, "#D6E6FF")); addView(text(v, 21f, "#FFFFFF", true))
            }, LinearLayout.LayoutParams(0, -2, 1f).apply { if (i > 0) marginStart = dp(8) })
        }
        box.addView(row)
        root.addView(box)
    }

    // ── صفحة الدخول (كاملة) ──
    private var loginUser = ""
    private var loginPass = ""
    private var loginBusy = false
    private var loginErr = ""
    private fun field(hint: String, value: String, pass: Boolean, onChange: (String) -> Unit) = EditText(this).apply {
        setText(value); this.hint = hint; textSize = 16f; textDirection = View.TEXT_DIRECTION_LTR; setSingleLine()
        inputType = if (pass) InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD else InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS
        background = round("#FFFFFF", 18); setPadding(dp(18), dp(14), dp(18), dp(14))
        layoutParams = LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(10) }
        addTextChangedListener(object : android.text.TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun afterTextChanged(s: android.text.Editable?) { onChange(s?.toString() ?: "") }
        })
    }
    private fun loginPage() {
        root.addView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL; setPadding(0, dp(36), 0, 0)
            addView(ImageView(this@MainActivity).apply { setImageResource(R.mipmap.ic_launcher); clipToOutline = true; background = round("#FFFFFF", 28); layoutParams = LinearLayout.LayoutParams(dp(96), dp(96)) })
            addView(text("مدقق Owners", 28f, BLUE, true).apply { gravity = Gravity.CENTER; setPadding(0, dp(14), 0, 0) })
            addView(text("أهلًا بيك 👋 ادخل بنفس الإيميل والباسورد بتوع تطبيق الورديات", 14f, "#6B6A80").apply { gravity = Gravity.CENTER; setPadding(dp(12), dp(4), dp(12), dp(10)) })
        })
        val box = card().apply { setPadding(dp(16), dp(10), dp(16), dp(18)) }
        box.addView(field("الإيميل أو اسم المستخدم", loginUser, false) { loginUser = it })
        box.addView(field("الباسورد", loginPass, true) { loginPass = it })
        if (loginErr.isNotBlank()) box.addView(text("⚠️ $loginErr", 13f, "#B3261E", true).apply { setPadding(dp(4), dp(10), dp(4), 0) })
        box.addView(button(if (loginBusy) "بيدخل…" else "ادخل") {
            if (loginBusy) return@button
            if (loginUser.isBlank() || loginPass.isBlank()) { loginErr = "اكتب الإيميل والباسورد"; render(); return@button }
            loginBusy = true; loginErr = ""; render()
            bg({ Account.signIn(this, loginUser, loginPass) }) { e ->
                loginBusy = false
                if (e != null) { loginErr = e; render(); return@bg }
                loginPass = ""; unlocked = true; page = "home"; render(); refreshHome(false)
            }
        }.apply { textSize = 17f; layoutParams = LinearLayout.LayoutParams(-1, dp(58)).apply { topMargin = dp(16) } })
        root.addView(box)
        root.addView(TextView(this).apply {
            text = "📱 ده موبايل المحل؟ اربطه بالكود"; textSize = 14.5f; setTypeface(typeface, Typeface.BOLD); setTextColor(Color.parseColor(BLUE)); gravity = Gravity.CENTER
            setPadding(0, dp(18), 0, dp(8)); setOnClickListener { pairDialog() }
        })
        root.addView(TextView(this).apply {
            text = "⚙️ الصلاحيات والإعدادات"; textSize = 13f; setTextColor(Color.parseColor("#8A8AA0")); gravity = Gravity.CENTER
            setPadding(0, dp(4), 0, dp(8)); setOnClickListener { go("menu") }
        })
    }

    // ── شاشة الأرقام (زي دخول الكاشير) ──
    private var pinBuf = ""
    private var pinStage = ""      // set1 / set2 لما بيختار رقم
    private var pinFirst = ""
    private var pinMsg = ""
    private var bioAsked = false
    private fun bioReady(): Boolean {
        if (Build.VERSION.SDK_INT < 29) return false
        val bm = getSystemService(android.hardware.biometrics.BiometricManager::class.java) ?: return false
        return if (Build.VERSION.SDK_INT >= 30) bm.canAuthenticate(android.hardware.biometrics.BiometricManager.Authenticators.BIOMETRIC_WEAK) == android.hardware.biometrics.BiometricManager.BIOMETRIC_SUCCESS
        else @Suppress("DEPRECATION") (bm.canAuthenticate() == android.hardware.biometrics.BiometricManager.BIOMETRIC_SUCCESS)
    }
    private fun askBio() {
        if (Build.VERSION.SDK_INT < 29 || !bioReady()) return
        runCatching {
            val b = android.hardware.biometrics.BiometricPrompt.Builder(this).setTitle("افتح مدقق Owners").setSubtitle(Account.name(this))
                .setNegativeButton("الرقم السري", mainExecutor) { _, _ -> }
            if (Build.VERSION.SDK_INT >= 30) b.setAllowedAuthenticators(android.hardware.biometrics.BiometricManager.Authenticators.BIOMETRIC_WEAK)
            b.build().authenticate(android.os.CancellationSignal(), mainExecutor, object : android.hardware.biometrics.BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: android.hardware.biometrics.BiometricPrompt.AuthenticationResult?) { unlocked = true; pinBuf = ""; render() }
            })
        }
    }
    private fun pinPage(kind: String) {
        if (kind == "set" && pinStage.isEmpty()) pinStage = "set1"
        val setting = kind == "set"
        val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL; setPadding(0, dp(30), 0, 0) }
        col.addView(avatar(92))
        col.addView(text(Account.name(this).ifBlank { "مدقق Owners" }, 22f, INK, true).apply { gravity = Gravity.CENTER; setPadding(0, dp(12), 0, 0) })
        col.addView(text(when {
            pinMsg.isNotBlank() -> pinMsg
            setting && pinStage == "set1" -> "اختار رقم سري من ٤ أرقام تفتح بيه التطبيق"
            setting -> "اكتب الرقم تاني علشان نتأكد"
            else -> "اكتب الرقم السري"
        }, 14f, if (pinMsg.isNotBlank()) "#B3261E" else "#6B6A80").apply { gravity = Gravity.CENTER; setPadding(dp(12), dp(4), dp(12), dp(18)) })
        // النقط
        val dots = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; layoutDirection = View.LAYOUT_DIRECTION_LTR; gravity = Gravity.CENTER }
        repeat(4) { i ->
            dots.addView(View(this).apply {
                background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setStroke(dp(2), Color.parseColor(if (pinMsg.isNotBlank()) "#B3261E" else INK)); if (i < pinBuf.length) setColor(Color.parseColor(INK)) }
                layoutParams = LinearLayout.LayoutParams(dp(22), dp(22)).apply { marginStart = dp(8); marginEnd = dp(8) }
            })
        }
        col.addView(dots)
        if (pinMsg.isNotBlank()) dots.post { dots.animate().translationX(dp(10).toFloat()).setDuration(50).withEndAction { dots.animate().translationX(-dp(10).toFloat()).setDuration(80).withEndAction { dots.animate().translationX(0f).setDuration(60).start() }.start() }.start() }
        root.addView(col)
        val wait = if (setting) 0 else Lock.waitSec(this)
        if (wait > 0) root.addView(text("محاولات كتير غلط · استنى $wait ثانية", 13f, "#B3261E", true).apply { gravity = Gravity.CENTER; setPadding(0, dp(10), 0, 0) })
        // الأرقام
        val pad = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(18), dp(22), dp(18), 0) }
        val keys = listOf(listOf("1", "2", "3"), listOf("4", "5", "6"), listOf("7", "8", "9"), listOf(if (!setting && bioReady()) "bio" else "", "0", "del"))
        keys.forEach { r ->
            val line = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; layoutDirection = View.LAYOUT_DIRECTION_LTR }
            r.forEachIndexed { i, k ->
                line.addView(TextView(this).apply {
                    text = when (k) { "del" -> "⌫"; "bio" -> "☝"; else -> k }; textSize = if (k == "bio") 26f else 26f; gravity = Gravity.CENTER; setTypeface(typeface, Typeface.BOLD)
                    setTextColor(Color.parseColor(INK)); background = if (k.isEmpty() || k == "del") null else round(if (k == "bio") "#E2FAB0" else "#FFFFFF", 22)
                    isEnabled = k.isNotEmpty() && wait == 0
                    setOnClickListener {
                        when (k) {
                            "del" -> { pinBuf = pinBuf.dropLast(1); pinMsg = ""; render() }
                            "bio" -> askBio()
                            else -> { if (pinBuf.length < 4) { pinBuf += k; pinMsg = ""; render(); if (pinBuf.length == 4) Handler(Looper.getMainLooper()).postDelayed({ pinDone(setting) }, 120) } }
                        }
                    }
                }, LinearLayout.LayoutParams(0, dp(66), 1f).apply { if (i > 0) marginStart = dp(12) })
            }
            pad.addView(line, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(12) })
        }
        root.addView(pad)
        if (!setting) root.addView(TextView(this).apply {
            text = "نسيت الرقم؟ ادخل بالإيميل تاني"; textSize = 13.5f; setTypeface(typeface, Typeface.BOLD); setTextColor(Color.parseColor(BLUE)); gravity = Gravity.CENTER; setPadding(0, dp(22), 0, dp(8))
            setOnClickListener {
                AlertDialog.Builder(this@MainActivity).setMessage("هتخرج من الأكونت وتدخل تاني بالإيميل والباسورد، وتختار رقم جديد. المحافظ هترجع لوحدها.")
                    .setPositiveButton("تمام") { _, _ -> Account.signOut(this@MainActivity); unlocked = false; pinBuf = ""; render() }.setNegativeButton("لأ", null).show()
            }
        })
        if (!setting && !bioAsked && wait == 0 && bioReady()) { bioAsked = true; root.post { askBio() } }
    }
    private fun pinDone(setting: Boolean) {
        val p = pinBuf; pinBuf = ""
        if (setting) {
            if (pinStage == "set1") { pinFirst = p; pinStage = "set2"; pinMsg = ""; render(); return }
            if (p != pinFirst) { pinStage = "set1"; pinFirst = ""; pinMsg = "الرقمين مش زي بعض · اختار تاني"; render(); return }
            Lock.set(this, p); pinStage = ""; pinFirst = ""; pinMsg = ""; unlocked = true; toast("✓ الرقم السري اتحفظ"); render(); return
        }
        bg({ if (Lock.check(this, p)) null else "x" }) { e ->
            if (e == null) { unlocked = true; pinMsg = ""; render(); refreshHome(false) }
            else { pinMsg = if (Lock.waitSec(this) > 0) "محاولات كتير غلط" else "الرقم غلط"; render() }
        }
    }

    // كارت ملخص بألوان تطبيق الورديات (لون صريح + دايرة فيها الأيقونة)
    // ── 🧾 الورديات / الوردية / المصروفات ──
    private var shiftSel: JSONObject? = null
    private var shiftEntries: List<JSONObject>? = null
    private var shiftErr: String? = null
    private var shiftLoading = false
    private fun branchShops(): List<JSONObject> {
        val all = objs(j(Home.cached(this), "shops"))
        val sel = Home.shop(this).takeIf { id -> all.any { it.optString("id") == id } } ?: ""
        return if (sel.isEmpty()) all else all.filter { it.optString("id") == sel }
    }
    private fun fmtT(ms: Double, day: Boolean = false) = if (ms <= 0) "" else SimpleDateFormat(if (day) "EEEE d/M · h:mm a" else "h:mm a", Locale.forLanguageTag("ar-EG-u-nu-latn")).format(Date(ms.toLong()))
    private fun shiftLook(st: String): Triple<String, String, String> = when (st) {
        "open" -> Triple("🟢 مفتوحة", "#E3F7E8", "#1B7F3B")
        "submitted" -> Triple("📨 اتسلّمت · مستنية المحاسب", "#FFF3D6", "#8A5A00")
        "reviewing" -> Triple("🔎 المحاسب بيراجعها", "#E3F0FF", "#1565D8")
        "reopened" -> Triple("↩ اتفتحت تاني", "#F0E6FF", "#5B2A9E")
        "disputed" -> Triple("⚠️ الكاشير اعترض", "#FFE3E3", "#B3261E")
        "closed" -> Triple("✓ اتقفلت", "#EEF0F4", "#3A3950")
        else -> Triple(st, "#EEF0F4", "#6B6A80")
    }
    private fun emptyCard(t: String) = root.addView(LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER; background = round("#FFFFFF", 22); setPadding(dp(16), dp(18), dp(16), dp(18))
        layoutParams = LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(14) }
        addView(text(t, 15f, "#6B6A80", true).apply { gravity = Gravity.CENTER })
    })

    private fun shiftsPage() {
        val shops = branchShops()
        val list = shops.flatMap { s -> objs(j(s, "shifts")).map { it to s } }.sortedByDescending { it.first.optDouble("openedAt") }
        if (list.isEmpty()) { emptyCard(if (Home.cached(this) == null) "بنجيب الورديات…" else "مفيش ورديات النهارده"); return }
        val multi = shops.size > 1
        list.forEach { (x, s) ->
            val box = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(14), dp(12), dp(14), dp(12)); background = round("#FFFFFF", 22)
                layoutParams = LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(10) }
                setOnClickListener { shiftSel = JSONObject(x.toString()).put("_shop", s.optString("name")); shiftEntries = null; shiftErr = null; go("shift") } }
            val line = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; layoutDirection = View.LAYOUT_DIRECTION_RTL; gravity = Gravity.CENTER_VERTICAL }
            line.addView(TextView(this).apply { text = x.optString("cashier").trim().take(1).ifBlank { "؟" }; textSize = 16f; setTypeface(typeface, Typeface.BOLD); gravity = Gravity.CENTER; setTextColor(Color.parseColor(INK))
                background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(Color.parseColor("#B6F000")) }; layoutParams = LinearLayout.LayoutParams(dp(40), dp(40)).apply { marginEnd = dp(10) } })
            line.addView(LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; layoutParams = LinearLayout.LayoutParams(0, -2, 1f)
                addView(text(x.optString("cashier").ifBlank { "كاشير" }, 15.5f, INK, true))
                addView(text(listOfNotNull("من ${fmtT(x.optDouble("openedAt"))}", fmtT(x.optDouble("submittedAt")).takeIf { it.isNotBlank() }?.let { "سلّم $it" },
                    if (multi) s.optString("name") else null).joinToString(" · "), 11.5f, "#8A8AA0")) })
            val (sl, sb, sf) = shiftLook(x.optString("status"))
            line.addView(pill(sl, sb, sf, 10.5f))
            box.addView(line)
            // الأرقام
            val exp = objs(j(x, "expenses")).sumOf { it.optDouble("amount") }
            val nums = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; layoutDirection = View.LAYOUT_DIRECTION_RTL; setPadding(0, dp(10), 0, 0) }
            fun num(l: String, v: String, bg: String, fg: String) = nums.addView(LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(10), dp(8), dp(10), dp(8)); background = round(bg, 16)
                addView(text(l, 11f, fg)); addView(text(v, 15f, fg, true)) }, LinearLayout.LayoutParams(0, -2, 1f).apply { marginStart = dp(6) })
            num("المبيعات", if (x.isNull("sales")) "—" else money.format(x.optDouble("sales")), "#E2FAB0", "#2B3A00")
            num("المصروفات", money.format(exp), "#FFE8D6", "#7A3300")
            val dk = x.optString("diffKind"); val da = x.optDouble("diffAmount")
            num(if (dk == "overage") "زيادة" else "عجز", if (dk.isBlank() || da == 0.0) (if (x.optString("status") == "closed") "0" else "—") else money.format(da), if (dk == "overage") "#E3F7E8" else "#FFE3EA", if (dk == "overage") "#1B7F3B" else "#9A0036")
            box.addView(nums)
            root.addView(box)
        }
    }

    private fun shiftDetail() {
        val x = shiftSel ?: run { go("shifts"); return }
        val (sl, _, _) = shiftLook(x.optString("status"))
        root.addView(LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(16), dp(14), dp(16), dp(14)); background = round(BLUE, 28)
            layoutParams = LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(12) }
            addView(text(x.optString("cashier").ifBlank { "كاشير" }, 22f, "#FFFFFF", true))
            addView(text(listOfNotNull(x.optString("_shop"), x.optString("register").takeIf { it.isNotBlank() }).joinToString(" · "), 12.5f, "#D6E6FF"))
            addView(text("فتح ${fmtT(x.optDouble("openedAt"), true)}" + (fmtT(x.optDouble("submittedAt")).takeIf { it.isNotBlank() }?.let { "\nسلّم $it" } ?: "") +
                (fmtT(x.optDouble("closedAt")).takeIf { it.isNotBlank() }?.let { "\nاتقفلت $it" + (x.optString("closedBy").takeIf { b -> b.isNotBlank() }?.let { b -> " · $b" } ?: "") } ?: ""), 12.5f, "#FFFFFF").apply { setPadding(0, dp(6), 0, 0) })
            addView(pill(sl, "#FFFFFF", INK, 12f).apply { (layoutParams as LinearLayout.LayoutParams).topMargin = dp(8) })
        })
        val es = shiftEntries
        if (es == null) {
            root.addView(text(shiftErr ?: "بنجيب عمليات الوردية…", 14f, if (shiftErr != null) "#B3261E" else "#8A8AA0").apply { setPadding(dp(4), dp(16), dp(4), 0) })
            if (shiftErr == null && !shiftLoading) { shiftLoading = true; bg({ val (l, e) = Home.shiftEntries(this, x.optString("id")); shiftEntries = l; shiftErr = e; null }) { shiftLoading = false; if (page == "shift") render() } }
            return
        }
        // إجمالي كل نوع
        val groups = es.groupBy { it.optString("type") }
        val names = mapOf("expense" to "🧾 المصروفات", "income" to "💵 الإيرادات", "transfer" to "📲 تحويلات المحافظ", "topup" to "📶 شحن رصيد", "repPay" to "🤝 سداد مندوبين",
            "withdraw" to "👤 سحب لصاحب المحل", "move" to "↔️ نقل بين الدرجين", "liquidate" to "🔁 تسييل", "xfer_out" to "➡️ فلوس لكاشير تاني", "xfer_in" to "⬅️ استلام من كاشير")
        if (es.isEmpty()) { emptyCard("مفيش عمليات في الوردية دي"); return }
        groups.entries.sortedByDescending { e -> e.value.sumOf { it.optDouble("amount") } }.forEach { (t, l) ->
            root.addView(card().apply {
                addView(LinearLayout(this@MainActivity).apply { orientation = LinearLayout.HORIZONTAL; layoutDirection = View.LAYOUT_DIRECTION_RTL
                    addView(text("${names[t] ?: t} · ${l.size}", 15f, INK, true).apply { layoutParams = LinearLayout.LayoutParams(0, -2, 1f) })
                    addView(text(money.format(l.sumOf { it.optDouble("amount") }) + " ج", 15f, INK, true)) })
                l.forEach { e ->
                    addView(LinearLayout(this@MainActivity).apply { orientation = LinearLayout.HORIZONTAL; layoutDirection = View.LAYOUT_DIRECTION_RTL; setPadding(0, dp(8), 0, dp(8))
                        addView(LinearLayout(this@MainActivity).apply { orientation = LinearLayout.VERTICAL; layoutParams = LinearLayout.LayoutParams(0, -2, 1f)
                            addView(text(Home.entryTitle(e), 13.5f, INK))
                            addView(text(fmtT(e.optDouble("createdAt")), 11f, "#8A8AA0")) })
                        addView(text(money.format(e.optDouble("amount")), 14f, INK, true)) })
                    addView(View(this@MainActivity).apply { setBackgroundColor(Color.parseColor("#EEF0F8")); layoutParams = LinearLayout.LayoutParams(-1, dp(1)) })
                }
            })
        }
    }

    private fun expensesPage() {
        val shops = branchShops()
        val all = shops.flatMap { s -> objs(j(s, "shifts")).flatMap { sh -> objs(j(sh, "expenses")).map { JSONObject(it.toString()).put("_shop", s.optString("name")) } } }
            .sortedByDescending { it.optDouble("at") }
        if (all.isEmpty()) { emptyCard(if (Home.cached(this) == null) "بنجيب المصروفات…" else "مفيش مصروفات النهارده"); return }
        // الإجمالي والأنواع
        root.addView(LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(16), dp(14), dp(16), dp(14)); background = round("#FF7A1A", 28)
            layoutParams = LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(12) }
            addView(text("مصروفات النهارده", 13f, INK, true))
            addView(text(money.format(all.sumOf { it.optDouble("amount") }) + " ج", 30f, INK, true))
            addView(text("${all.size} مصروف", 12f, "#3A1A00"))
            val kinds = LinearLayout(this@MainActivity).apply { orientation = LinearLayout.HORIZONTAL; layoutDirection = View.LAYOUT_DIRECTION_RTL; setPadding(0, dp(6), 0, 0) }
            all.groupBy { it.optString("kind") }.map { it.key to it.value.sumOf { x -> x.optDouble("amount") } }.sortedByDescending { it.second }
                .forEach { (k, v) -> kinds.addView(pill("$k ${money.format(v)}", "#FFFFFF", INK, 11.5f)) }
            addView(android.widget.HorizontalScrollView(this@MainActivity).apply { isHorizontalScrollBarEnabled = false; layoutDirection = View.LAYOUT_DIRECTION_RTL; addView(kinds) })
        })
        val multi = shops.size > 1
        all.forEach { e ->
            root.addView(LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; layoutDirection = View.LAYOUT_DIRECTION_RTL; gravity = Gravity.CENTER_VERTICAL
                setPadding(dp(14), dp(10), dp(14), dp(10)); background = round("#FFFFFF", 18); layoutParams = LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(6) }
                addView(LinearLayout(this@MainActivity).apply { orientation = LinearLayout.VERTICAL; layoutParams = LinearLayout.LayoutParams(0, -2, 1f)
                    addView(text(e.optString("title"), 14f, INK, true))
                    addView(text(listOfNotNull(e.optString("cashier"), fmtT(e.optDouble("at")), if (multi) e.optString("_shop") else null).filter { it.isNotBlank() }.joinToString(" · "), 11.5f, "#8A8AA0")) })
                addView(text(money.format(e.optDouble("amount")) + " ج", 16f, INK, true)) })
        }
    }

    private fun tile(title: String, big: String, sub: String, c1: String, @Suppress("UNUSED_PARAMETER") c2: String) = LinearLayout(this).apply {
        val dark = run { val c = Color.parseColor(c1); (0.299 * Color.red(c) + 0.587 * Color.green(c) + 0.114 * Color.blue(c)) > 150 }
        val fg = if (dark) INK else "#FFFFFF"; val soft = if (dark) "#3A3950" else "#EEF2FF"
        orientation = LinearLayout.VERTICAL; layoutDirection = View.LAYOUT_DIRECTION_RTL; setPadding(dp(14), dp(14), dp(14), dp(14))
        background = round(c1, 28)
        val icon = title.substringBefore(" "); val name = title.substringAfter(" ")
        addView(TextView(this@MainActivity).apply { text = icon; textSize = 18f; gravity = Gravity.CENTER
            background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(if (dark) 0x40FFFFFF else 0x33FFFFFF) }
            layoutParams = LinearLayout.LayoutParams(dp(40), dp(40)) })
        addView(text(name, 13f, fg, true).apply { setPadding(0, dp(10), 0, 0) })
        addView(text(big, 23f, fg, true).apply { setPadding(0, dp(2), 0, dp(2)) })
        addView(text(sub, 11.5f, soft))
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
        if (requestCode == PHOTO_REQ) {
            if (resultCode != RESULT_OK || data == null) return
            val bmp: android.graphics.Bitmap? = runCatching {
                data.data?.let { u -> contentResolver.openInputStream(u)?.use { android.graphics.BitmapFactory.decodeStream(it) } }
                    ?: @Suppress("DEPRECATION") (data.extras?.get("data") as? android.graphics.Bitmap)
            }.getOrNull()
            if (bmp == null) { toast("مقدرناش نفتح الصورة"); return }
            toast("بيحفظ الصورة…")
            val d = Photo.square(bmp)
            bg({ Photo.upload(this, d) }) { e -> toast(e ?: "اتغيّرت الصورة ✓ · هتظهر في تطبيق الورديات كمان"); render() }
            return
        }
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
