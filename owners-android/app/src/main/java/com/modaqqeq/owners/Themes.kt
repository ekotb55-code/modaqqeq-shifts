package com.modaqqeq.owners

import android.content.Context
import android.graphics.Color

// نفس ثيمات تطبيق الورديات (users/{uid}.theme) + ذهبي وداكن
data class Th(
    val id: String, val name: String,
    val bg: String, val card: String, val ink: String, val muted: String, val faint: String,
    val line: String, val chip: String, val soft: String, val main: String, val mainSoft: String,
    val hero: List<String>, val lime: String, val violet: String, val orange: String, val yellow: String, val pink: String, val green: String,
    val dark: Boolean = false,
) {
    // الألوان دي بتاعة الثيم نفسه، فمش بتتغيّر في الداكن
    val own: Set<String> by lazy { setOf(bg, card, ink, muted, faint, line, chip, soft, main, mainSoft, lime, violet, orange, yellow, pink, green) + hero }
}

object Themes {
    // كلام غامق ثابت فوق الألوان الفاتحة (الليموني، البرتقاني…) — مبيتغيّرش في الداكن
    const val ON_LIGHT = "#16152B"; const val ON_LIGHT2 = "#3B3A51"
    private fun light(id: String, name: String, bg: String, main: String, mainSoft: String, chip: String, line: String, hero: List<String>,
                      lime: String, violet: String, orange: String, yellow: String, pink: String, ink: String = "#15142A", muted: String = "#6B6A80") =
        Th(id, name, bg, "#FFFFFF", ink, muted, "#A9A8BC", line, chip, "#F6F7FC", main, mainSoft, hero, lime, violet, orange, yellow, pink, "#1B7F3B")

    val ALL = listOf(
        light("mdq", "أزرق مدقق", "#ECEFFF", "#1565D8", "#D6E6FF", "#E9ECFB", "#EEF0F8", listOf("#0F4FB0", "#1565D8", "#3D8BF0"), "#B6F000", "#A07CFF", "#FF7A1A", "#FFC400", "#FF7EB0"),
        light("mint", "نعناعي", "#E6F6F2", "#0E9384", "#C8F1E8", "#DDF3EE", "#D3ECE6", listOf("#0B7A6E", "#0E9384", "#2BB7A3"), "#FFD23F", "#7FD8C9", "#FF8A5B", "#FFD23F", "#FF9FB2"),
        light("sunset", "غروب", "#FFF0E8", "#E4572E", "#FFD9C7", "#FFE6DA", "#F8DCCD", listOf("#E4572E", "#F27C38", "#FFB347"), "#FFC857", "#9B5DE5", "#FF8C42", "#FFC857", "#FF7AA2"),
        light("night", "ليلي", "#ECE8FF", "#4C2FB0", "#DCD3FF", "#E4DEFF", "#DAD3F7", listOf("#2A1A6E", "#4C2FB0", "#7A4BE0"), "#00E0B0", "#FF6FB5", "#FFB547", "#FFD54F", "#FF6FB5"),
        light("girly", "بناتي وردي", "#FFF0F7", "#E0569B", "#FFD6EA", "#FFE3F0", "#F9D7E7", listOf("#E0569B", "#F08BC3", "#C9A7FF"), "#FFB3D9", "#C9A7FF", "#FFA6C9", "#FFD6A5", "#FF8FC7", "#3D1530", "#8A5F78"),
        light("ocean", "محيط", "#E7F5FB", "#0077B6", "#CDEBF7", "#DCEFF8", "#CFE7F2", listOf("#023E8A", "#0077B6", "#00B4D8"), "#FFD166", "#48CAE4", "#EF476F", "#FFD166", "#F78CA2"),
        light("olive", "زيتوني", "#F1F4E8", "#4F772D", "#DCE8C8", "#E6EDD8", "#DCE4CC", listOf("#31572C", "#4F772D", "#90A955"), "#F4A259", "#90A955", "#BC4B51", "#F4D35E", "#E07A5F"),
        light("coffee", "قهوة", "#F6EFE8", "#6F4E37", "#EBDCCF", "#EFE4DA", "#E6D8CB", listOf("#4B3326", "#6F4E37", "#A47148"), "#F2C14E", "#C08552", "#D9734E", "#F2C14E", "#E39B8B"),
        light("peach", "بناتي خوخي", "#FFF4EF", "#FF7F6E", "#FFE0D9", "#FFEAE3", "#FADCD3", listOf("#FF7F6E", "#FF9E8A", "#FFC2B4"), "#9EE6CF", "#FFB4A2", "#FFA987", "#FFE29A", "#FF9AA2", "#4A2420", "#8C625B"),
        light("lavender", "بناتي لافندر", "#F6F0FF", "#9B6BD6", "#E8DBFB", "#EFE6FD", "#E5D9F7", listOf("#8E5CD1", "#B28AE6", "#FFC8DD"), "#BDE0FE", "#CDB4DB", "#FFAFCC", "#FFE5A3", "#FFC8DD", "#33204D", "#7D6896"),
        light("gold", "ذهبي", "#FBF6E9", "#A87B12", "#F3E4BE", "#F5ECD2", "#EEE2C2", listOf("#6E4E05", "#A87B12", "#D9AE3F"), "#F2C94C", "#C9A25A", "#D9822B", "#F2C94C", "#E8A0A0", "#2E2410", "#7D6E4E"),
        Th("dark", "داكن", "#0F0F1A", "#1B1B2C", "#EDEDF7", "#A3A3BD", "#6E6E88", "#2A2A40", "#26263A", "#22223A", "#5B8CFF", "#26305A",
            listOf("#1B1B3A", "#2C2C66", "#4C3FB0"), "#B6F000", "#A07CFF", "#FF7A1A", "#FFC400", "#FF7EB0", "#4CC37A", dark = true),
    )
    fun of(id: String?) = ALL.firstOrNull { it.id == id } ?: ALL[0]
    private fun p(c: Context) = c.getSharedPreferences("theme", Context.MODE_PRIVATE)
    fun id(c: Context) = p(c).getString("id", "mdq") ?: "mdq"
    fun cur(c: Context) = of(id(c))
    fun set(c: Context, id: String) = p(c).edit().putString("id", id).apply()

    // يحفظ الثيم على الأكونت كله (نفس الحقل اللي تطبيق الورديات بيقراه)
    fun upload(c: Context, id: String): String? {
        val token = runCatching { Account.idToken(c) }.getOrNull() ?: return "مفيش نت"
        val uid = Account.uid(c) ?: return "ادخل الأول"
        val body = org.json.JSONObject().put("writes", org.json.JSONArray().put(org.json.JSONObject()
            .put("update", org.json.JSONObject().put("name", "projects/modaqqeq-shifts/databases/(default)/documents/users/$uid")
                .put("fields", org.json.JSONObject().put("theme", org.json.JSONObject().put("stringValue", id))))
            .put("updateMask", org.json.JSONObject().put("fieldPaths", org.json.JSONArray().put("theme")))))
        val r = Net.authed("https://firestore.googleapis.com/v1/projects/modaqqeq-shifts/databases/(default)/documents:commit", token, body.toString())
        return if (r.first in 200..299) null else "الشكل اتغيّر هنا بس · مقدرناش نحفظه على الأكونت"
    }

    // في الداكن: الخلفيات الفاتحة بتغمق، والكلام الغامق بيفتح — علشان الألوان الثابتة (أحمر/أخضر…) تفضل باينة
    fun adapt(t: Th, h: String): Int {
        val c = Color.parseColor(h)
        if (!t.dark || h.length == 9 || h.equals("#FFFFFF", true) || h in t.own || h == ON_LIGHT || h == ON_LIGHT2) return c
        val lum = (0.299 * Color.red(c) + 0.587 * Color.green(c) + 0.114 * Color.blue(c)) / 255
        return when {
            lum > 0.78 -> mix(Color.parseColor(t.card), c, 0.22)
            lum < 0.42 -> mix(c, Color.WHITE, 0.5)
            else -> c
        }
    }
    private fun mix(a: Int, b: Int, f: Double): Int {
        fun ch(x: Int, y: Int) = (x + (y - x) * f).toInt().coerceIn(0, 255)
        return Color.argb(Color.alpha(b), ch(Color.red(a), Color.red(b)), ch(Color.green(a), Color.green(b)), ch(Color.blue(a), Color.blue(b)))
    }
}
