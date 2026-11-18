package com.modaqqeq.owners

import android.content.Context
import android.content.Intent
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

// The phone either belongs to a person (owner / manager signs in with his Modaqqeq account)
// or sits in the shop (linked once with a code from Setup, no password, no numbers shown).
// Either way the wallets come by themselves from Modaqqeq: nothing to copy or paste.
object Account {
    const val SERVER = "https://script.google.com/macros/s/AKfycbwOUayDsXPiUJPCXfE6JQWzMfKdWXbaDHNbvKv7qhrEkzcGSLHervdq5NzDZirfFg/exec"
    private const val KEY = "AIzaSyCRCvSveuol7K9eQdDVTPEFundBVD8HtWs" // Firebase web key (public)
    private fun prefs(c: Context) = c.getSharedPreferences("account", Context.MODE_PRIVATE)

    fun mode(c: Context) = prefs(c).getString("mode", "") ?: ""          // "" | "user" | "shop"
    fun name(c: Context) = prefs(c).getString("name", "") ?: ""
    fun email(c: Context) = prefs(c).getString("email", "") ?: ""
    fun shopName(c: Context) = prefs(c).getString("shopName", "") ?: ""
    fun lastSync(c: Context) = prefs(c).getLong("syncAt", 0)
    fun isShopPhone(c: Context) = mode(c) == "shop"

    // ── sign in (same login as the shifts app: email + password, or username + PIN) ──
    fun signIn(c: Context, login: String, secret: String): String? {
        val isEmail = login.contains("@")
        val email = if (isEmail) login.trim() else cashierEmail(login)
        val pass = if (isEmail) secret else "mdq-${secret.trim()}-shift"
        val r = try {
            Net.call("https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=$KEY",
                JSONObject().put("email", email).put("password", pass).put("returnSecureToken", true).toString(), "application/json")
        } catch (e: Exception) { return "مفيش نت · جرّب تاني" }
        val j = runCatching { JSONObject(r.second) }.getOrNull() ?: return "حصلت مشكلة · جرّب تاني"
        if (r.first >= 400) {
            val m = j.optJSONObject("error")?.optString("message") ?: ""
            return when {
                m.contains("TOO_MANY") -> "محاولات كتير · استنى شوية وجرّب تاني"
                m.contains("DISABLED") -> "الأكونت ده متوقف"
                else -> "الإيميل أو الباسورد غلط"
            }
        }
        prefs(c).edit().putString("mode", "user").putString("email", email).putString("refresh", j.optString("refreshToken"))
            .putString("idToken", j.optString("idToken")).putLong("idExp", System.currentTimeMillis() + 50 * 60_000).apply()
        val err = sync(c)
        if (err != null) signOut(c)
        return err
    }

    private fun idToken(c: Context): String? {
        val p = prefs(c)
        if (System.currentTimeMillis() < p.getLong("idExp", 0)) p.getString("idToken", null)?.let { return it }
        val refresh = p.getString("refresh", null) ?: return null
        val r = Net.call("https://securetoken.googleapis.com/v1/token?key=$KEY",
            "grant_type=refresh_token&refresh_token=" + URLEncoder.encode(refresh, "UTF-8"), "application/x-www-form-urlencoded")
        if (r.first >= 400) return null
        val j = JSONObject(r.second)
        p.edit().putString("idToken", j.optString("id_token")).putString("refresh", j.optString("refresh_token", refresh))
            .putLong("idExp", System.currentTimeMillis() + 50 * 60_000).apply()
        return j.optString("id_token")
    }

    // ── shop phone: the 6-digit code (or its QR) from Setup → «اربط موبايل المحل» ──
    fun pair(c: Context, code: String): String? {
        val j = try { JSONObject(Net.post(SERVER, JSONObject().put("action", "pair").put("code", code.trim()).toString())) }
        catch (e: Exception) { return "مفيش نت · جرّب تاني" }
        if (!j.optBoolean("ok")) return if (j.optString("error") == "expired") "الكود خلص · اعمل كود جديد من الإعدادات" else "الكود غلط أو اتستخدم قبل كده · اعمل كود جديد"
        prefs(c).edit().putString("mode", "shop").putString("shopId", j.optString("shopId")).putString("shopName", j.optString("shopName"))
            .putString("token", j.optString("token")).apply()
        val err = sync(c)
        if (err != null) signOut(c)
        return err
    }

    // ── bring the wallets from Modaqqeq ──
    fun sync(c: Context): String? {
        val p = prefs(c)
        val body = when (mode(c)) {
            "user" -> {
                val t = try { idToken(c) } catch (e: Exception) { return "مفيش نت · هنحدّث لما النت يرجع" } ?: return "ادخل بأكونتك تاني"
                JSONObject().put("action", "mykeys").put("idToken", t)
            }
            "shop" -> JSONObject().put("action", "shopkeys").put("shopId", p.getString("shopId", "")).put("token", p.getString("token", ""))
            else -> return null
        }
        val j = try { JSONObject(Net.post(SERVER, body.toString())) } catch (e: Exception) { return "مفيش نت · هنحدّث لما النت يرجع" }
        if (!j.optBoolean("ok")) {
            return when (j.optString("error")) {
                "role" -> "الأكونت ده مش أونر ولا مدير فرع · التطبيق ده لصاحب المحل والمدير بس"
                "unpaired" -> { signOut(c); "موبايل المحل اتفك ربطه من الإعدادات · اربطه تاني بكود جديد" }
                "login" -> "ادخل بأكونتك تاني"
                else -> "مقدرناش نجيب المحافظ · جرّب تاني"
            }
        }
        val e = p.edit().putLong("syncAt", System.currentTimeMillis())
        if (mode(c) == "user") e.putString("name", j.optString("name"))
        if (mode(c) == "shop" && j.optString("shopName").isNotBlank()) e.putString("shopName", j.optString("shopName"))
        e.apply()
        val arr = j.optJSONArray("keys")
        Store.applyManaged(c, (0 until (arr?.length() ?: 0)).map { arr!!.getJSONObject(it) })
        schedule(c)
        return null
    }

    fun signOut(c: Context) {
        prefs(c).edit().clear().apply()
        Store.saveConns(c, Store.conns(c).filter { !it.managed })
        WorkManager.getInstance(c).cancelUniqueWork("sync")
    }

    // every 6 hours: a wallet added or moved in Setup shows up by itself
    fun schedule(c: Context) {
        val req = PeriodicWorkRequestBuilder<SyncWorker>(6, TimeUnit.HOURS)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build()
        WorkManager.getInstance(c).enqueueUniquePeriodicWork("sync", ExistingPeriodicWorkPolicy.KEEP, req)
    }

    // نفس تحويل اسم المستخدم لإيميل اللي في تطبيق الورديات (src/lib.js: normUsername / cashierEmail)
    fun normUsername(u: String): String {
        var n = u.trim().lowercase()
        n = n.map { ch -> val i = "٠١٢٣٤٥٦٧٨٩".indexOf(ch); if (i >= 0) ('0' + i) else ch }.joinToString("")
        n = n.replace(Regex("[ً-ٰٟـ]"), "")
            .replace(Regex("[أإآٱ]"), "ا").replace("ى", "ي").replace("ة", "ه").replace("ؤ", "و").replace("ئ", "ي")
            .replace(Regex("\\s+"), "")
        return n
    }
    fun cashierEmail(u: String): String {
        val n = normUsername(u)
        if (Regex("^[a-z0-9._-]+$").matches(n)) return "$n@cashier.modaqqeq.app"
        return "ar-" + n.toByteArray(Charsets.UTF_8).joinToString("") { "%02x".format(it) } + "@cashier.modaqqeq.app"
    }
}

class SyncWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        if (Account.mode(applicationContext).isEmpty()) return@withContext Result.success()
        Account.sync(applicationContext)
        Result.success()
    }
}

// Where each kind of wallet's messages come from, so nobody has to choose apps or senders.
object Defaults {
    private val BANKS = listOf("ALEXBANK", "AlexBank", "CIB", "BanqueMisr", "Banque Misr", "QNB", "AAIB", "NBE", "HSBC", "ADIB", "EGBANK", "SAIB", "FAB", "BDC", "MIDBANK", "InstaPay")
    fun senders(wallet: String, nbeToo: Boolean): List<String> = when {
        wallet.startsWith("insta") -> BANKS.filter { !(nbeToo && it == "NBE") } // رسالة NBE تروح لمحفظة الأهلي فون كاش بس
        wallet == "nbe" -> listOf("NBE")
        wallet.startsWith("vf") -> listOf("VF-Cash", "VFCash", "VF Cash", "Vodafone")
        else -> emptyList()
    }
    private fun appRe(wallet: String) = Regex(when {
        wallet.startsWith("insta") -> "insta ?pay|انستا ?باي|إنستا ?باي"
        wallet == "nbe" -> "phone ?cash|فون ?كاش|الأهلي|الاهلي|\\bnbe\\b"
        wallet.startsWith("vf") -> "vodafone ?cash|فودافون ?كاش|ana vodafone|انا فودافون|أنا فودافون"
        else -> "^$"
    }, RegexOption.IGNORE_CASE)
    fun apps(c: Context, wallet: String): List<Pair<String, String>> {
        val pm = c.packageManager
        val i = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val re = appRe(wallet)
        return pm.queryIntentActivities(i, 0).map { it.activityInfo.packageName to it.loadLabel(pm).toString() }
            .distinctBy { it.first }.filter { it.first != c.packageName && re.containsMatchIn(it.second + " " + it.first) }
    }
}
