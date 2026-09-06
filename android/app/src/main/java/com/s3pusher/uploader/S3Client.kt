package com.s3pusher.uploader

import android.util.Xml
import okhttp3.HttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.xmlpull.v1.XmlPullParser
import java.io.IOException
import java.io.StringReader
import java.util.Date
import java.util.concurrent.TimeUnit

/**
 * Opérations S3 multipart bas niveau : signature SigV4 + HTTP via OkHttp.
 * Aucune part n'est chargée en mémoire (voir [RangeRequestBody]).
 */
class S3Client(
    private val config: S3Config,
    private val http: OkHttpClient = defaultHttpClient(),
) {

    class S3Exception(val statusCode: Int, val s3Code: String?, message: String) :
        IOException(message) {
        val retryable: Boolean
            get() = statusCode == 0 || // erreur réseau
                statusCode in 500..599 ||
                statusCode == 429 ||
                s3Code == "SlowDown" ||
                s3Code == "RequestTimeout" ||
                s3Code == "InternalError"
    }

    data class UploadedPart(val partNumber: Int, val eTag: String)

    // --- Opérations ---------------------------------------------------------

    /** Test de connectivité / credentials : HEAD sur le bucket. */
    fun headBucket() {
        val url = config.bucketUrl()
        execute(build("HEAD", url, config.canonicalBucketPath(), emptyMap(),
            SigV4Signer.EMPTY_SHA256, null)).use { r ->
            if (!r.isSuccessful) throw parseError(r, "HEAD bucket a échoué")
        }
    }

    fun createMultipartUpload(key: String, contentType: String?): String {
        val query = mapOf("uploads" to "")
        val url = withQuery(config.objectUrl(key), query)
        val headers = if (contentType != null) mapOf("content-type" to contentType) else emptyMap()
        execute(build("POST", url, config.canonicalPath(key), query, SigV4Signer.EMPTY_SHA256,
            null, extraSignedHeaders = headers)).use { r ->
            val body = r.body?.string().orEmpty()
            if (!r.isSuccessful) throw parseError(r, body, "CreateMultipartUpload a échoué")
            return extractTag(body, "UploadId")
                ?: throw IOException("UploadId absent de la réponse CreateMultipartUpload")
        }
    }

    /** Upload d'une part. Renvoie l'ETag. */
    fun uploadPart(
        key: String,
        uploadId: String,
        partNumber: Int,
        body: RequestBody,
    ): String {
        val query = mapOf("partNumber" to partNumber.toString(), "uploadId" to uploadId)
        val url = withQuery(config.objectUrl(key), query)
        val req = build("PUT", url, config.canonicalPath(key), query,
            SigV4Signer.UNSIGNED_PAYLOAD, body)
        execute(req).use { r ->
            if (!r.isSuccessful) throw parseError(r, "UploadPart $partNumber a échoué")
            val etag = r.header("ETag") ?: r.header("Etag")
            ?: throw IOException("ETag absent de la réponse UploadPart $partNumber")
            return etag.trim()
        }
    }

    fun listParts(key: String, uploadId: String): List<UploadedPart> {
        val result = ArrayList<UploadedPart>()
        var marker: String? = null
        do {
            val query = buildMap {
                put("uploadId", uploadId)
                put("max-parts", "1000")
                if (marker != null) put("part-number-marker", marker!!)
            }
            val url = withQuery(config.objectUrl(key), query)
            execute(build("GET", url, config.canonicalPath(key), query,
                SigV4Signer.EMPTY_SHA256, null)).use { r ->
                val body = r.body?.string().orEmpty()
                // 404 / NoSuchUpload : laissé remonter → l'appelant recrée le multipart
                if (!r.isSuccessful) throw parseError(r, body, "ListParts a échoué")
                val (parts, truncated, next) = parseListParts(body)
                result.addAll(parts)
                marker = if (truncated) next else null
            }
        } while (marker != null)
        return result
    }

    fun completeMultipartUpload(key: String, uploadId: String, parts: List<UploadedPart>) {
        val xml = buildString {
            append("<CompleteMultipartUpload>")
            for (p in parts.sortedBy { it.partNumber }) {
                append("<Part><PartNumber>").append(p.partNumber).append("</PartNumber>")
                append("<ETag>").append(ensureQuoted(p.eTag)).append("</ETag></Part>")
            }
            append("</CompleteMultipartUpload>")
        }
        val bytes = xml.toByteArray(Charsets.UTF_8)
        val query = mapOf("uploadId" to uploadId)
        val url = withQuery(config.objectUrl(key), query)
        val reqBody = bytes.toRequestBody("application/xml".toMediaType())
        execute(build("POST", url, config.canonicalPath(key), query,
            SigV4Signer.sha256Hex(bytes), reqBody,
            extraSignedHeaders = mapOf("content-type" to "application/xml"))).use { r ->
            val body = r.body?.string().orEmpty()
            if (!r.isSuccessful) throw parseError(r, body, "CompleteMultipartUpload a échoué")
            // Quirk S3 : 200 OK possible avec un <Error> dans le corps
            if (body.contains("<Error")) {
                throw S3Exception(200, extractTag(body, "Code"),
                    "CompleteMultipartUpload : erreur dans le corps (200) : " +
                        (extractTag(body, "Message") ?: body.take(300)))
            }
        }
    }

    fun abortMultipartUpload(key: String, uploadId: String) {
        val query = mapOf("uploadId" to uploadId)
        val url = withQuery(config.objectUrl(key), query)
        execute(build("DELETE", url, config.canonicalPath(key), query,
            SigV4Signer.EMPTY_SHA256, null)).use { r ->
            if (!r.isSuccessful && r.code != 404) {
                throw parseError(r, "AbortMultipartUpload a échoué")
            }
        }
    }

    // --- Signature + envoi -----------------------------------------------------

    private fun build(
        method: String,
        url: HttpUrl,
        canonicalPath: String,
        query: Map<String, String>,
        payloadHash: String,
        body: RequestBody?,
        extraSignedHeaders: Map<String, String> = emptyMap(),
    ): Request {
        val amzDate = SigV4Signer.amzDate(Date())
        val headers = LinkedHashMap<String, String>()
        headers["host"] = config.hostHeader(virtualHosted = !config.forcePathStyle)
        headers["x-amz-content-sha256"] = payloadHash
        headers["x-amz-date"] = amzDate
        headers.putAll(extraSignedHeaders)

        val signed = SigV4Signer.sign(
            method = method,
            path = canonicalPath,
            query = query,
            headers = headers,
            payloadHash = payloadHash,
            accessKeyId = config.accessKeyId,
            secretAccessKey = config.secretAccessKey,
            region = config.region,
            amzDate = amzDate,
        )

        val rb = Request.Builder().url(url)
        for ((k, v) in headers) rb.header(k, v)
        rb.header("Authorization", signed.authorization)
        // OkHttp exige un corps non-null pour POST/PUT
        val effectiveBody = body
            ?: if (method == "POST" || method == "PUT") EMPTY_BODY else null
        rb.method(method, effectiveBody)
        return rb.build()
    }

    private fun execute(req: Request): Response =
        try {
            http.newCall(req).execute()
        } catch (e: IOException) {
            throw S3Exception(0, null, "Erreur réseau : ${e.message}").apply { initCause(e) }
        }

    private fun withQuery(base: HttpUrl, query: Map<String, String>): HttpUrl {
        val canonical = SigV4Signer.canonicalQueryString(query)
        return base.newBuilder()
            .encodedQuery(if (canonical.isEmpty()) null else canonical)
            .build()
    }

    private fun parseError(r: Response, fallbackMsg: String): S3Exception =
        parseError(r, r.body?.string().orEmpty(), fallbackMsg)

    private fun parseError(r: Response, body: String, fallbackMsg: String): S3Exception {
        val code = extractTag(body, "Code")
        val msg = extractTag(body, "Message")
        return S3Exception(r.code, code,
            "$fallbackMsg (HTTP ${r.code}${if (code != null) " $code" else ""}" +
                "${if (msg != null) " : $msg" else ""})")
    }

    // --- Parsing XML (android.util.Xml, pas de dépendance) --------------------

    private data class ListPartsResult(
        val parts: List<UploadedPart>,
        val truncated: Boolean,
        val nextMarker: String?,
    )

    private fun parseListParts(xml: String): ListPartsResult {
        val parts = ArrayList<UploadedPart>()
        var truncated = false
        var nextMarker: String? = null
        var curNumber: Int? = null
        var curETag: String? = null

        val parser = Xml.newPullParser()
        parser.setInput(StringReader(xml))
        var event = parser.eventType
        var currentTag: String? = null
        while (event != XmlPullParser.END_DOCUMENT) {
            when (event) {
                XmlPullParser.START_TAG -> {
                    currentTag = parser.name
                    if (currentTag == "Part") { curNumber = null; curETag = null }
                }
                XmlPullParser.TEXT -> {
                    val text = parser.text?.trim().orEmpty()
                    if (text.isNotEmpty()) when (currentTag) {
                        "PartNumber" -> curNumber = text.toIntOrNull()
                        "ETag" -> curETag = text
                        "IsTruncated" -> truncated = text.equals("true", ignoreCase = true)
                        "NextPartNumberMarker" -> nextMarker = text
                    }
                }
                XmlPullParser.END_TAG -> {
                    if (parser.name == "Part" && curNumber != null && curETag != null) {
                        parts.add(UploadedPart(curNumber!!, curETag!!))
                    }
                    currentTag = null
                }
            }
            event = parser.next()
        }
        return ListPartsResult(parts, truncated, nextMarker)
    }

    private fun extractTag(xml: String, tag: String): String? {
        val open = "<$tag>"
        val close = "</$tag>"
        val start = xml.indexOf(open)
        if (start < 0) return null
        val end = xml.indexOf(close, start + open.length)
        if (end < 0) return null
        return xml.substring(start + open.length, end).trim()
    }

    private fun ensureQuoted(etag: String): String {
        val e = etag.trim()
        return if (e.startsWith("\"") && e.endsWith("\"")) e else "\"$e\""
    }

    companion object {
        private val EMPTY_BODY: RequestBody = ByteArray(0).toRequestBody(null)

        fun defaultHttpClient(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(120, TimeUnit.SECONDS)
            .writeTimeout(0, TimeUnit.SECONDS)   // parts volumineuses sur réseau lent
            .callTimeout(0, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .build()
    }
}
