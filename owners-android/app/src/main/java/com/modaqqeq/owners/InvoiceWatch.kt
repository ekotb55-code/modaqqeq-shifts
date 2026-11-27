package com.modaqqeq.owners

import android.content.Context
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
import java.util.concurrent.TimeUnit

// إشعار فواتير المشتريات: كل ربع ساعة التطبيق بيشوف فواتير فروعك (آخر يومين) من سيرفر مدقق،
// ولو فيه فاتورة جديدة أو أسعار اتغيرت فيها يطلع الشباك العايم (أو إشعار لو الشباك مقفول).
// أول مرة بيحفظ اللي موجود من غير ما ينبّه، علشان ميطلعش شباك لكل الفواتير القديمة.
object InvoiceWatch {
    private fun prefs(c: Context) = c.getSharedPreferences("invoiceWatch", Context.MODE_PRIVATE)

    fun newOn(c: Context) = prefs(c).getBoolean("new", true)
    fun setNew(c: Context, v: Boolean) { prefs(c).edit().putBoolean("new", v).apply(); schedule(c) }
    fun priceOn(c: Context) = prefs(c).getBoolean("price", true)
    fun setPrice(c: Context, v: Boolean) { prefs(c).edit().putBoolean("price", v).apply(); schedule(c) }
    fun offShops(c: Context): Set<String> = prefs(c).getStringSet("off", null) ?: emptySet()
    fun setShop(c: Context, id: String, on: Boolean) {
        val s = offShops(c).toMutableSet(); if (on) s.remove(id) else s.add(id)
        prefs(c).edit().putStringSet("off", s).apply()
    }
    fun lastCheck(c: Context) = prefs(c).getLong("at", 0)

    fun schedule(c: Context) {
        val wm = WorkManager.getInstance(c)
        if (Account.mode(c) != "user" || (!newOn(c) && !priceOn(c) && !Loads.notifyOn(c))) { wm.cancelUniqueWork("invoices"); return }
        val req = PeriodicWorkRequestBuilder<InvoiceWorker>(15, TimeUnit.MINUTES)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build()
        wm.enqueueUniquePeriodicWork("invoices", ExistingPeriodicWorkPolicy.KEEP, req)
    }
    fun cancel(c: Context) { WorkManager.getInstance(c).cancelUniqueWork("invoices"); prefs(c).edit().clear().apply() }

    private fun state(inv: JSONObject) = "${inv.optInt("priceUps")}/${inv.optInt("priceDowns")}"

    // بيرجّع null لو تمام، أو سبب المشكلة
    fun check(c: Context): String? {
        if (Account.mode(c) != "user" || (!newOn(c) && !priceOn(c))) return null
        val (j, e) = Purchases.list(c, 2)
        if (j == null) return e
        val p = prefs(c)
        val seen = runCatching { JSONObject(p.getString("seen", null) ?: "") }.getOrNull()
        val first = seen == null
        val now = JSONObject()
        val off = offShops(c)
        val fresh = ArrayList<JSONObject>()   // فواتير جديدة
        val priced = ArrayList<JSONObject>()  // أسعارها اتغيرت بعد ما شفناها
        val arr = j.optJSONArray("list")
        for (i in 0 until (arr?.length() ?: 0)) {
            val inv = arr!!.getJSONObject(i)
            val id = inv.optString("id"); if (id.isBlank()) continue
            val st = state(inv)
            now.put(id, st)
            val shop = inv.optString("shopId")
            if (first || shop.isBlank() || shop in off) continue
            val old = seen!!.optString(id, "")
            val hasPrices = inv.optInt("priceUps") + inv.optInt("priceDowns") > 0
            when {
                old.isEmpty() && newOn(c) -> fresh += inv
                old.isEmpty() && priceOn(c) && hasPrices -> priced += inv
                old.isNotEmpty() && old != st && priceOn(c) && hasPrices -> priced += inv
            }
        }
        // الفواتير اللي عدّت اليومين بتخرج من القايمة، فبنحتفظ باللي لسه فيها بس
        p.edit().putString("seen", now.toString()).putLong("at", System.currentTimeMillis()).apply()
        if (first) return null

        val all = (fresh + priced).distinctBy { it.optString("id") }
        when {
            all.isEmpty() -> {}
            all.size == 1 -> one(c, all[0], all[0] in fresh)
            else -> {
                val ups = all.sumOf { it.optInt("priceUps") }; val downs = all.sumOf { it.optInt("priceDowns") }
                val title = if (fresh.isNotEmpty()) "🧾 ${all.size} فواتير مشتريات" else "🏷️ أسعار اتغيرت في ${all.size} فواتير"
                val line = all.map { it.optString("supplier").ifBlank { "مورد" } + " · " + it.optString("shopName") }.distinct().take(3).joinToString("، ")
                Popup.invoice(c, title, line, priceHint(ups, downs), "", ups > 0)
            }
        }
        return null
    }

    private fun priceHint(ups: Int, downs: Int) = listOfNotNull(
        if (ups > 0) "⬆ $ups صنف سعره زاد" else null,
        if (downs > 0) "⬇ $downs صنف سعره قلّ" else null,
    ).joinToString(" · ").ifBlank { "راجع الأسعار" }

    private fun one(c: Context, inv: JSONObject, isNew: Boolean) {
        val id = inv.optString("id")
        val ups = inv.optInt("priceUps"); val downs = inv.optInt("priceDowns")
        val total = inv.optDouble("total", 0.0)
        val title = (if (isNew) "🧾 " else "🏷️ ") + (if (total > 0) Transfers.money(total) + " ج" else "فاتورة مشتريات")
        val line = listOf(inv.optString("supplier"), inv.optString("shopName"),
            if (inv.optInt("count") > 0) "${inv.optInt("count")} صنف" else "").filter { it.isNotBlank() }.joinToString(" · ")
        // أكبر تغيير في السعر (من تفاصيل الفاتورة)
        var top = ""
        if (ups + downs > 0) runCatching {
            val (d, _) = Purchases.detail(c, id)
            val lines = d?.optJSONArray("lines")
            var best = 0.0
            for (i in 0 until (lines?.length() ?: 0)) {
                val l = lines!!.getJSONObject(i)
                if (l.isNull("oldPrice")) continue
                val o = l.optDouble("oldPrice"); val n = l.optDouble("piecePrice")
                if (o <= 0 || Math.abs(n - o) <= 0.009) continue
                val pct = Math.abs(n - o) / o
                if (pct > best) { best = pct; top = "${l.optString("name").take(28)}: ${Transfers.money(o)} ← ${Transfers.money(n)}" }
            }
        }
        val hint = (if (isNew) (if (ups + downs > 0) "" else "فاتورة جديدة · راجع الأسعار") else "") +
            (if (ups + downs > 0) priceHint(ups, downs) else "")
        Popup.invoice(c, title, listOf(line, top).filter { it.isNotBlank() }.joinToString("\n"), hint, id, ups > 0)
    }
}

class InvoiceWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        runCatching { InvoiceWatch.check(applicationContext) }
        runCatching { Loads.watch(applicationContext) }   // طلبات التحميل والتفريغ اللي اتعتمدت
        Result.success()
    }
}
