package com.s3pusher.uploader

import android.util.Xml
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Semaphore
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
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong
import kotlin.random.Random

/**
 * Opérations S3 multipart bas niveau : signature SigV4 + HTTP via OkHttp.
 * Aucune part n'est chargée en mémoire (voir [RangeRequestBody]).
 */
class S3Client(
    private val config: S3Config,
    private val http: OkHttpClient = defaultHttpClient(),
) {

    class S3Exception(
        val statusCode: Int,
        val s3Code: String?,
        message: String,
        val retryAfterSeconds: Long? = null,
    ) : IOException(message) {
        val retryable: Boolean
            get() = statusCode == 0 || // erreur réseau
                statusCode in 500..599 ||
                statusCode == 429 ||
                s3Code == "SlowDown" ||
                s3Code == "RequestTimeout" ||
                s3Code == "InternalError"
    }

    data class UploadedPart(val partNumber: Int, val eTag: String)

    data class S3Object(val key: String, val size: Long, val lastModified: String?)

    data class ListResult(
        val prefixes: List<String>,
        val objects: List<S3Object>,
        val nextToken: String?,
    )

    data class ObjectVersion(
        val key: String,
        val versionId: String,
        val size: Long,
        val lastModified: String?,
        val isLatest: Boolean,
        val isDeleteMarker: Boolean,
    )

    data class VersionsResult(
        val prefixes: List<String>,
        val versions: List<ObjectVersion>,
        val nextKeyMarker: String?,
        val nextVersionIdMarker: String?,
    )

    // --- Opérations ---------------------------------------------------------

    /** Test de connectivité / credentials : HEAD sur le bucket. */
    fun headBucket() {
        val url = config.bucketUrl()
        execute(build("HEAD", url, config.canonicalBucketPath(), emptyMap(),
            SigV4Signer.EMPTY_SHA256, null)).use { r ->
            if (!r.isSuccessful) throw parseError(r, "HEAD bucket a échoué")
        }
    }

    /**
     * @return la taille de l'objet s'il existe, `null` s'il n'existe pas (404 / 403 /
     *   NoSuchKey). Lève sur les autres erreurs (réseau…) → l'appelant décide.
     */
    fun headObject(key: String): Long? {
        val url = config.objectUrl(key)
        execute(build("HEAD", url, config.canonicalPath(key), emptyMap(),
            SigV4Signer.EMPTY_SHA256, null)).use { r ->
            if (r.code == 404 || r.code == 403) return null
            if (!r.isSuccessful) throw parseError(r, "HEAD object a échoué")
            return r.header("Content-Length")?.toLongOrNull() ?: -1L
        }
    }

    fun listObjectsV2(prefix: String, continuationToken: String?, maxKeys: Int = 500): ListResult {
        val query = buildMap {
            put("list-type", "2")
            put("delimiter", "/")
            put("max-keys", maxKeys.toString())
            if (prefix.isNotEmpty()) put("prefix", prefix)
            if (continuationToken != null) put("continuation-token", continuationToken)
        }
        val url = withQuery(config.bucketUrl(), query)
        execute(build("GET", url, config.canonicalBucketPath(), query,
            SigV4Signer.EMPTY_SHA256, null)).use { r ->
            val body = r.body?.string().orEmpty()
            if (!r.isSuccessful) throw parseError(r, body, "ListObjectsV2 a échoué")
            return parseListObjects(body)
        }
    }

    fun deleteObject(key: String) {
        val url = config.objectUrl(key)
        execute(build("DELETE", url, config.canonicalPath(key), emptyMap(),
            SigV4Signer.EMPTY_SHA256, null)).use { r ->
            if (!r.isSuccessful && r.code != 404) throw parseError(r, "DeleteObject a échoué")
        }
    }

    /** Liste les versions (S3 `?versions`, supporté par B2). `delimiter=""` = récursif. */
    fun listObjectVersions(
        prefix: String,
        keyMarker: String?,
        versionIdMarker: String?,
        delimiter: String = "/",
    ): VersionsResult {
        val query = buildMap {
            put("versions", "")
            if (delimiter.isNotEmpty()) put("delimiter", delimiter)
            put("max-keys", "1000")
            if (prefix.isNotEmpty()) put("prefix", prefix)
            if (keyMarker != null) put("key-marker", keyMarker)
            if (versionIdMarker != null) put("version-id-marker", versionIdMarker)
        }
        val url = withQuery(config.bucketUrl(), query)
        execute(build("GET", url, config.canonicalBucketPath(), query,
            SigV4Signer.EMPTY_SHA256, null)).use { r ->
            val body = r.body?.string().orEmpty()
            if (!r.isSuccessful) throw parseError(r, body, "ListObjectVersions a échoué")
            return parseVersions(body)
        }
    }

    fun deleteVersion(key: String, versionId: String) {
        val query = mapOf("versionId" to versionId)
        val url = withQuery(config.objectUrl(key), query)
        execute(build("DELETE", url, config.canonicalPath(key), query,
            SigV4Signer.EMPTY_SHA256, null)).use { r ->
            if (!r.isSuccessful && r.code != 404) throw parseError(r, "DeleteVersion a échoué")
        }
    }

    /** Objet vide (marqueur de « dossier » : clé se terminant par '/'). */
    fun putEmptyObject(key: String) {
        val url = config.objectUrl(key)
        execute(build("PUT", url, config.canonicalPath(key), emptyMap(),
            SigV4Signer.EMPTY_SHA256, EMPTY_BODY)).use { r ->
            if (!r.isSuccessful) throw parseError(r, "PutObject a échoué")
        }
    }

    /** Totaux (octets, nb d'objets) sous un préfixe, paginé, sans delimiter. */
    fun prefixTotals(prefix: String): Pair<Long, Long> {
        var bytes = 0L
        var count = 0L
        var token: String? = null
        do {
            val query = buildMap {
                put("list-type", "2")
                put("max-keys", "1000")
                if (prefix.isNotEmpty()) put("prefix", prefix)
                if (token != null) put("continuation-token", token!!)
            }
            val url = withQuery(config.bucketUrl(), query)
            execute(build("GET", url, config.canonicalBucketPath(), query,
                SigV4Signer.EMPTY_SHA256, null)).use { r ->
                val body = r.body?.string().orEmpty()
                if (!r.isSuccessful) throw parseError(r, body, "ListObjectsV2 a échoué")
                val res = parseListObjects(body)
                res.objects.forEach { bytes += it.size; count++ }
                token = res.nextToken
            }
        } while (token != null)
        return bytes to count
    }

    /** Toutes les clés sous un préfixe (sans delimiter), paginé. */
    fun listAllKeys(prefix: String): List<String> {
        val keys = ArrayList<String>()
        var token: String? = null
        do {
            val query = buildMap {
                put("list-type", "2")
                put("max-keys", "1000")
                if (prefix.isNotEmpty()) put("prefix", prefix)
                if (token != null) put("continuation-token", token!!)
            }
            val url = withQuery(config.bucketUrl(), query)
            execute(build("GET", url, config.canonicalBucketPath(), query,
                SigV4Signer.EMPTY_SHA256, null)).use { r ->
                val body = r.body?.string().orEmpty()
                if (!r.isSuccessful) throw parseError(r, body, "ListObjectsV2 a échoué")
                val res = parseListObjects(body)
                res.objects.forEach { keys.add(it.key) }
                token = res.nextToken
            }
        } while (token != null)
        return keys
    }

    /**
     * Déplace/renomme un objet : copie **côté serveur** (aucune donnée ne transite par le
     * client) puis suppression de la source.
     *
     * Sous [SINGLE_COPY_THRESHOLD] : un seul CopyObject.
     * Au-dessus : copie multipart, parties [COPY_PART_SIZE] lancées en parallèle (borné par
     * `config.moveConcurrency`), retry + backoff honorant `Retry-After` (throttling B2).
     *
     * @param onPart progression : (partiesFaites, partiesTotal, octetsCopiés, octetsTotal)
     */
    suspend fun moveObject(
        srcKey: String,
        dstKey: String,
        onPart: ((Int, Int, Long, Long) -> Unit)? = null,
    ) {
        if (srcKey == dstKey) return
        val size = headObject(srcKey) ?: throw IOException("Objet source introuvable : $srcKey")
        if (size <= SINGLE_COPY_THRESHOLD) {
            // idempotent : si une réponse est perdue mais que la copie a réussi, on
            // ne recommence pas (sinon B2 crée une 2ᵉ version de la même clé)
            withRetryDedup(dstKey, size, "CopyObject") { copyObject(srcKey, dstKey) }
            onPart?.invoke(1, 1, size, size)
        } else {
            multipartCopy(srcKey, dstKey, size, onPart)
        }
        withRetry("DeleteObject") { deleteObject(srcKey) }
    }

    private fun objectExistsWithSize(key: String, expected: Long): Boolean =
        try {
            headObject(key)?.let { it == expected } ?: false
        } catch (_: Exception) {
            false
        }

    /**
     * Comme [withRetry] mais, avant chaque nouvelle tentative, vérifie si l'objet destination
     * existe déjà avec la bonne taille → l'opération avait réussi malgré la réponse perdue.
     */
    private suspend fun withRetryDedup(
        dstKey: String,
        expectedSize: Long,
        label: String,
        maxAttempts: Int = 6,
        block: () -> Unit,
    ) {
        var attempt = 0
        var delayMs = 1000L
        while (true) {
            try {
                block()
                return
            } catch (ce: CancellationException) {
                throw ce
            } catch (e: Exception) {
                if (objectExistsWithSize(dstKey, expectedSize)) return
                attempt++
                val retryable = e !is S3Exception || e.retryable
                if (!retryable || attempt >= maxAttempts) throw e
                val wait = if (e is S3Exception) {
                    maxOf(delayMs, (e.retryAfterSeconds ?: 0L) * 1000L)
                } else {
                    delayMs
                }
                delay(wait + Random.nextLong(0, 500))
                delayMs = (delayMs * 2).coerceAtMost(20_000L)
            }
        }
    }

    private fun copySource(srcKey: String): String {
        val path = "/${config.bucket}/$srcKey"
        return path.split("/").joinToString("/") { SigV4Signer.uriEncode(it, encodeSlash = true) }
    }

    private fun copyObject(srcKey: String, dstKey: String) {
        val url = config.objectUrl(dstKey)
        execute(build("PUT", url, config.canonicalPath(dstKey), emptyMap(),
            SigV4Signer.EMPTY_SHA256, EMPTY_BODY,
            extraSignedHeaders = mapOf("x-amz-copy-source" to copySource(srcKey)))).use { r ->
            val body = r.body?.string().orEmpty()
            if (!r.isSuccessful) throw parseError(r, body, "CopyObject a échoué")
            if (body.contains("<Error")) {
                throw S3Exception(200, extractTag(body, "Code"),
                    "CopyObject : erreur dans le corps (200) : " +
                        (extractTag(body, "Message") ?: body.take(200)))
            }
        }
    }

    private suspend fun multipartCopy(
        srcKey: String,
        dstKey: String,
        size: Long,
        onPart: ((Int, Int, Long, Long) -> Unit)?,
    ) {
        val uploadId = withRetry("CreateMultipartUpload") { createMultipartUpload(dstKey, null) }
        try {
            val ranges = ArrayList<Triple<Int, Long, Long>>()
            var offset = 0L
            var n = 1
            while (offset < size) {
                val end = minOf(offset + COPY_PART_SIZE, size) - 1
                ranges.add(Triple(n, offset, end))
                offset = end + 1
                n++
            }
            val total = ranges.size
            val etags = arrayOfNulls<String>(total)
            val done = AtomicInteger(0)
            val bytes = AtomicLong(0)
            val sem = Semaphore(config.moveConcurrency.coerceIn(1, 16))
            coroutineScope {
                for ((num, start, end) in ranges) {
                    launch(Dispatchers.IO) {
                        sem.acquire()
                        try {
                            etags[num - 1] = withRetry("UploadPartCopy $num") {
                                uploadPartCopy(dstKey, uploadId, num, srcKey, start, end)
                            }
                            val d = done.incrementAndGet()
                            val b = bytes.addAndGet(end - start + 1)
                            onPart?.invoke(d, total, b, size)
                        } finally {
                            sem.release()
                        }
                    }
                }
            }
            val parts = etags.mapIndexed { i, e ->
                UploadedPart(i + 1, e ?: throw IOException("Partie ${i + 1} manquante"))
            }
            // idempotent : un Complete rejoué (réponse perdue) échouerait en NoSuchUpload
            withRetryDedup(dstKey, size, "CompleteMultipartUpload") {
                completeMultipartUpload(dstKey, uploadId, parts)
            }
        } catch (e: Exception) {
            runCatching { abortMultipartUpload(dstKey, uploadId) }
            throw e
        }
    }

    /** Retry avec backoff exponentiel + jitter ; honore `Retry-After` (throttling B2). */
    private suspend fun <T> withRetry(label: String, maxAttempts: Int = 6, block: () -> T): T {
        var attempt = 0
        var delayMs = 1000L
        while (true) {
            try {
                return block()
            } catch (ce: CancellationException) {
                throw ce
            } catch (e: S3Exception) {
                attempt++
                if (!e.retryable || attempt >= maxAttempts) throw e
                val wait = maxOf(delayMs, (e.retryAfterSeconds ?: 0L) * 1000L)
                delay(wait + Random.nextLong(0, 500))
            } catch (e: IOException) {
                attempt++
                if (attempt >= maxAttempts) throw e
                delay(delayMs + Random.nextLong(0, 500))
            }
            delayMs = (delayMs * 2).coerceAtMost(20_000L)
        }
    }

    private fun uploadPartCopy(
        dstKey: String,
        uploadId: String,
        partNumber: Int,
        srcKey: String,
        rangeStart: Long,
        rangeEnd: Long,
    ): String {
        val query = mapOf("partNumber" to partNumber.toString(), "uploadId" to uploadId)
        val url = withQuery(config.objectUrl(dstKey), query)
        execute(build("PUT", url, config.canonicalPath(dstKey), query,
            SigV4Signer.EMPTY_SHA256, EMPTY_BODY,
            extraSignedHeaders = mapOf(
                "x-amz-copy-source" to copySource(srcKey),
                "x-amz-copy-source-range" to "bytes=$rangeStart-$rangeEnd",
            ))).use { r ->
            val body = r.body?.string().orEmpty()
            if (!r.isSuccessful) throw parseError(r, body, "UploadPartCopy $partNumber a échoué")
            return extractTag(body, "ETag")
                ?: throw IOException("ETag absent (UploadPartCopy $partNumber)")
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
        val retryAfter = r.header("Retry-After")?.trim()?.toLongOrNull()
        return S3Exception(r.code, code,
            "$fallbackMsg (HTTP ${r.code}${if (code != null) " $code" else ""}" +
                "${if (msg != null) " : $msg" else ""})", retryAfter)
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

    private fun parseListObjects(xml: String): ListResult {
        val prefixes = ArrayList<String>()
        val objects = ArrayList<S3Object>()
        var nextToken: String? = null
        var truncated = false

        var inContents = false
        var inCommonPrefixes = false
        var curKey: String? = null
        var curSize = 0L
        var curModified: String? = null
        var curPrefix: String? = null

        val parser = Xml.newPullParser()
        parser.setInput(StringReader(xml))
        var event = parser.eventType
        var tag: String? = null
        while (event != XmlPullParser.END_DOCUMENT) {
            when (event) {
                XmlPullParser.START_TAG -> {
                    tag = parser.name
                    when (tag) {
                        "Contents" -> { inContents = true; curKey = null; curSize = 0L; curModified = null }
                        "CommonPrefixes" -> { inCommonPrefixes = true; curPrefix = null }
                    }
                }
                XmlPullParser.TEXT -> {
                    val text = parser.text?.trim().orEmpty()
                    if (text.isNotEmpty()) when (tag) {
                        "Key" -> if (inContents) curKey = text
                        "Size" -> if (inContents) curSize = text.toLongOrNull() ?: 0L
                        "LastModified" -> if (inContents) curModified = text
                        "Prefix" -> if (inCommonPrefixes) curPrefix = text
                        "IsTruncated" -> truncated = text.equals("true", ignoreCase = true)
                        "NextContinuationToken" -> nextToken = text
                    }
                }
                XmlPullParser.END_TAG -> {
                    when (parser.name) {
                        "Contents" -> {
                            curKey?.let { objects.add(S3Object(it, curSize, curModified)) }
                            inContents = false
                        }
                        "CommonPrefixes" -> {
                            curPrefix?.let { prefixes.add(it) }
                            inCommonPrefixes = false
                        }
                    }
                    tag = null
                }
            }
            event = parser.next()
        }
        return ListResult(prefixes, objects, if (truncated) nextToken else null)
    }

    private fun parseVersions(xml: String): VersionsResult {
        val prefixes = ArrayList<String>()
        val out = ArrayList<ObjectVersion>()
        var truncated = false
        var nextKey: String? = null
        var nextVer: String? = null

        var inItem = false
        var isDelMarker = false
        var inCommon = false
        var key: String? = null
        var vid: String? = null
        var size = 0L
        var mod: String? = null
        var latest = false
        var curPrefix: String? = null

        val p = Xml.newPullParser()
        p.setInput(StringReader(xml))
        var ev = p.eventType
        var tag: String? = null
        while (ev != XmlPullParser.END_DOCUMENT) {
            when (ev) {
                XmlPullParser.START_TAG -> {
                    tag = p.name
                    when (tag) {
                        "Version", "DeleteMarker" -> {
                            inItem = true; isDelMarker = tag == "DeleteMarker"
                            key = null; vid = null; size = 0L; mod = null; latest = false
                        }
                        "CommonPrefixes" -> { inCommon = true; curPrefix = null }
                    }
                }
                XmlPullParser.TEXT -> {
                    val t = p.text?.trim().orEmpty()
                    if (t.isNotEmpty()) when (tag) {
                        "Key" -> if (inItem) key = t
                        "VersionId" -> if (inItem) vid = t
                        "Size" -> if (inItem) size = t.toLongOrNull() ?: 0L
                        "LastModified" -> if (inItem) mod = t
                        "IsLatest" -> if (inItem) latest = t.equals("true", ignoreCase = true)
                        "Prefix" -> if (inCommon) curPrefix = t
                        "IsTruncated" -> truncated = t.equals("true", ignoreCase = true)
                        "NextKeyMarker" -> nextKey = t
                        "NextVersionIdMarker" -> nextVer = t
                    }
                }
                XmlPullParser.END_TAG -> {
                    when (p.name) {
                        "Version", "DeleteMarker" -> {
                            val k = key
                            val v = vid
                            if (k != null && v != null) {
                                out.add(ObjectVersion(k, v, size, mod, latest, isDelMarker))
                            }
                            inItem = false
                        }
                        "CommonPrefixes" -> { curPrefix?.let { prefixes.add(it) }; inCommon = false }
                    }
                    tag = null
                }
            }
            ev = p.next()
        }
        return VersionsResult(
            prefixes,
            out,
            if (truncated) nextKey else null,
            if (truncated) nextVer else null,
        )
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
        /** Sous ce seuil : un seul CopyObject. Au-dessus : copie multipart. */
        private const val SINGLE_COPY_THRESHOLD = 128L * 1024 * 1024

        /** Taille d'une partie de copie multipart (donne la granularité de progression). */
        private const val COPY_PART_SIZE = 128L * 1024 * 1024

        private val EMPTY_BODY: RequestBody = ByteArray(0).toRequestBody(null)

        fun defaultHttpClient(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(600, TimeUnit.SECONDS)  // les copies serveur (B2) sont synchrones et longues
            .writeTimeout(0, TimeUnit.SECONDS)
            .callTimeout(0, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .build()
    }
}
