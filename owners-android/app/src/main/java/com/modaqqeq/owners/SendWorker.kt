package com.modaqqeq.owners

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.util.concurrent.TimeUnit

// Sends one bank message / notification to Modaqqeq. No internet → it waits and is sent when it comes back.
class SendWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val url = inputData.getString("url") ?: return@withContext Result.failure()
        val text = inputData.getString("text") ?: return@withContext Result.failure()
        val src = inputData.getString("src") ?: ""
        try {
            val reply = Net.post(url, text)
            val j = runCatching { JSONObject(reply) }.getOrNull()
            when {
                j == null -> Store.addLog(applicationContext, src, text, "✗ رد غريب من مدقق")
                !j.optBoolean("ok") && busy(j.optString("error")) -> {
                    // حد جوجل اليومي خلص: الرسالة متضيعش، تتبعت تاني لما يتجدد
                    if (runAttemptCount == 0) Store.addLog(applicationContext, src, text, "⏳ سيرفر مدقق وصل لحد جوجل اليومي · هتتبعت لوحدها بعدين")
                    return@withContext if (runAttemptCount >= 40) Result.failure() else Result.retry()
                }
                !j.optBoolean("ok") -> Store.addLog(applicationContext, src, text, "✗ " + arabicError(j.optString("error")))
                j.optBoolean("dup") -> Store.addLog(applicationContext, src, text, "✓ وصل قبل كده")
                j.optBoolean("matched") -> Store.addLog(applicationContext, src, text, "✓ اتربط بنفس التحويل")
                j.optBoolean("skipped") -> Store.addLog(applicationContext, src, text, "• مش رسالة تحويل")
                else -> {
                    Store.addLog(applicationContext, src, text, "✓ وصل لمدقق")
                    j.optJSONObject("popup")?.let { p ->
                        Popup.show(applicationContext, p.optDouble("amount"), p.optString("from"), p.optString("wallet"), p.optBoolean("big"), p.optString("actUrl"))
                    }
                }
            }
            Result.success()
        } catch (e: Exception) {
            if (runAttemptCount >= 8) { Store.addLog(applicationContext, src, text, "✗ مقدرناش نبعته"); Result.failure() } else Result.retry()
        }
    }

    private fun busy(e: String) = Regex("urlfetch|too many|كثيرة جد|Service invoked", RegexOption.IGNORE_CASE).containsMatchIn(e)
    private fun arabicError(e: String) = when {
        e == "bad key" -> "الرابط غلط أو اتلغى"
        e.isBlank() -> "مدقق رفض الرسالة"
        else -> "مدقق رفض الرسالة ($e)"
    }

    companion object {
        fun enqueue(c: Context, url: String, text: String, src: String) {
            val req = OneTimeWorkRequestBuilder<SendWorker>()
                .setInputData(workDataOf("url" to url, "text" to text, "src" to src))
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(c).enqueue(req)
        }
    }
}
