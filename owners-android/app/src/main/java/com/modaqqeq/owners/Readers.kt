package com.modaqqeq.owners

import android.app.Notification
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

// Notifications of the chosen apps (InstaPay, الأهلي فون كاش…)
class NotifListener : NotificationListenerService() {
    override fun onNotificationPosted(sbn: StatusBarNotification) {
        val conns = Store.active(this).filter { sbn.packageName in it.apps }
        if (conns.isEmpty()) return
        val ex = sbn.notification.extras
        val big = ex.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString()
        val text = (big ?: ex.getCharSequence(Notification.EXTRA_TEXT)?.toString() ?: "").trim()
        if (text.isEmpty() || !Filter.money(text)) return
        if (Store.seenRecently(this, sbn.packageName + "|" + text)) return
        val appName = runCatching { packageManager.getApplicationLabel(packageManager.getApplicationInfo(sbn.packageName, 0)).toString() }.getOrDefault(sbn.packageName)
        conns.forEach { SendWorker.enqueue(this, it.url, text, "إشعار $appName") }
    }
}

// SMS from the chosen senders (ALEXBANK, NBE…)
class SmsReceiver : BroadcastReceiver() {
    override fun onReceive(c: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
        val msgs = Telephony.Sms.Intents.getMessagesFromIntent(intent) ?: return
        if (msgs.isEmpty()) return
        val from = msgs[0].displayOriginatingAddress ?: msgs[0].originatingAddress ?: ""
        val text = msgs.joinToString("") { it.displayMessageBody ?: "" }.trim()
        val conns = Store.active(c).filter { conn -> conn.senders.any { s -> s.isNotBlank() && from.contains(s.trim(), ignoreCase = true) } }
        if (conns.isEmpty() || !Filter.money(text)) return
        if (Store.seenRecently(c, "sms|$text")) return
        conns.forEach { SendWorker.enqueue(c, it.url, text, "رسالة $from") }
    }
}
