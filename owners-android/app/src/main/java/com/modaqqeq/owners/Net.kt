package com.modaqqeq.owners

import java.net.HttpURLConnection
import java.net.URL

// Google Apps Script answers a POST with a redirect to the real reply (googleusercontent.com): follow it by hand.
object Net {
    fun post(url: String, body: String): String = request(url, "POST", body, "text/plain; charset=utf-8").let { if (it.first >= 400) throw Exception("HTTP ${it.first}") else it.second }
    fun get(url: String): String = request(url, "GET", null, null).let { if (it.first >= 400) throw Exception("HTTP ${it.first}") else it.second }
    // Google sign-in APIs: the error comes back as JSON with a 400, so give back the code and the text both
    fun call(url: String, body: String, type: String): Pair<Int, String> = request(url, "POST", body, type)

    private fun request(start: String, method0: String, body: String?, type: String?): Pair<Int, String> {
        var url = start
        var method = method0
        repeat(6) {
            val c = URL(url).openConnection() as HttpURLConnection
            c.instanceFollowRedirects = false
            c.connectTimeout = 20_000
            c.readTimeout = 40_000
            c.requestMethod = method
            if (method == "POST" && body != null) {
                c.doOutput = true
                c.setRequestProperty("Content-Type", type ?: "text/plain; charset=utf-8")
                c.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            }
            val code = c.responseCode
            if (code in 300..399) {
                url = c.getHeaderField("Location") ?: throw Exception("redirect")
                method = "GET"
                c.disconnect()
                return@repeat
            }
            val text = (if (code >= 400) c.errorStream else c.inputStream)?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
            c.disconnect()
            return code to text
        }
        throw Exception("too many redirects")
    }
}
