package com.modaqqeq.owners

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

// قفل التطبيق: رقم سري من ٤ أرقام (متخزن متشفّر على الموبايل بس) + البصمة.
object Lock {
    private fun prefs(c: Context) = c.getSharedPreferences("lock", Context.MODE_PRIVATE)
    const val LEN = 6
    // الأرقام القديمة كانت ٤ · اللي عنده رقم قديم يدخل بيه مرة ويختار رقم من ٦
    fun len(c: Context) = prefs(c).getInt("len", 4)
    fun has(c: Context) = prefs(c).getString("hash", null) != null
    private fun hash(pin: String, salt: ByteArray): String {
        val k = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(PBEKeySpec(pin.toCharArray(), salt, 30_000, 256))
        return Base64.encodeToString(k.encoded, Base64.NO_WRAP)
    }
    fun set(c: Context, pin: String) {
        val salt = ByteArray(16).also { SecureRandom().nextBytes(it) }
        prefs(c).edit().putString("salt", Base64.encodeToString(salt, Base64.NO_WRAP)).putString("hash", hash(pin, salt)).putInt("len", pin.length).putInt("fails", 0).putLong("until", 0).apply()
    }
    fun check(c: Context, pin: String): Boolean {
        val p = prefs(c)
        val salt = Base64.decode(p.getString("salt", "") ?: "", Base64.NO_WRAP)
        val ok = MessageDigest.isEqual(hash(pin, salt).toByteArray(), (p.getString("hash", "") ?: "").toByteArray())
        if (ok) p.edit().putInt("fails", 0).apply()
        else { val f = p.getInt("fails", 0) + 1; p.edit().putInt("fails", f).putLong("until", if (f % 5 == 0) System.currentTimeMillis() + 30_000 else 0).apply() }
        return ok
    }
    // بعد ٥ محاولات غلط: استنى ٣٠ ثانية
    fun waitSec(c: Context) = ((prefs(c).getLong("until", 0) - System.currentTimeMillis()) / 1000).toInt().coerceAtLeast(0)
    fun clear(c: Context) { val b = bioOn(c); prefs(c).edit().clear().putBoolean("bioOff", !b).apply() }
    fun bioOn(c: Context) = !prefs(c).getBoolean("bioOff", false)
    fun setBio(c: Context, on: Boolean) = prefs(c).edit().putBoolean("bioOff", !on).apply()
}

// صورة الأكونت: نفس صورة تطبيق الورديات (users/{uid}.photo · JPEG مربع 320)
object Photo {
    private fun prefs(c: Context) = c.getSharedPreferences("home", Context.MODE_PRIVATE)
    private var mem: Pair<String, Bitmap?>? = null
    fun save(c: Context, data: String?) = prefs(c).edit().putString("photo", data ?: "").apply()
    fun get(c: Context): Bitmap? {
        val d = prefs(c).getString("photo", "") ?: ""
        if (d.isBlank()) return null
        mem?.let { if (it.first == d) return it.second }
        val b = runCatching { val bytes = Base64.decode(d.substringAfter("base64,"), Base64.DEFAULT); BitmapFactory.decodeByteArray(bytes, 0, bytes.size) }.getOrNull()
        mem = d to b
        return b
    }
    // مربع من نص الصورة، 320، JPEG 82 (نفس اللي بيعمله تطبيق الورديات)
    fun square(src: Bitmap): String {
        val side = minOf(src.width, src.height)
        val crop = Bitmap.createBitmap(src, (src.width - side) / 2, (src.height - side) / 2, side, side)
        val out = Bitmap.createScaledBitmap(crop, 320, 320, true)
        val bos = java.io.ByteArrayOutputStream()
        out.compress(Bitmap.CompressFormat.JPEG, 82, bos)
        return "data:image/jpeg;base64," + Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP)
    }
    fun upload(c: Context, data: String): String? {
        val token = try { Account.idToken(c) } catch (e: Exception) { return "مفيش نت" } ?: return "ادخل بأكونتك تاني"
        val uid = Account.uid(c) ?: return "ادخل بأكونتك تاني"
        val w = JSONObject()
            .put("update", JSONObject().put("name", "projects/modaqqeq-shifts/databases/(default)/documents/users/$uid")
                .put("fields", JSONObject().put("photo", JSONObject().put("stringValue", data))))
            .put("updateMask", JSONObject().put("fieldPaths", JSONArray().put("photo")))
            .put("currentDocument", JSONObject().put("exists", true))
        val r = try { Net.authed("https://firestore.googleapis.com/v1/projects/modaqqeq-shifts/databases/(default)/documents:commit", token, JSONObject().put("writes", JSONArray().put(w)).toString()) }
            catch (e: Exception) { return "مفيش نت · جرّب تاني" }
        if (r.first != 200) return "مقدرناش نحفظ الصورة"
        save(c, data)
        return null
    }
}
