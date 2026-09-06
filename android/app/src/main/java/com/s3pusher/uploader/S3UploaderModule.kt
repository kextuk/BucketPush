package com.s3pusher.uploader

import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import java.util.UUID

class S3UploaderModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), UploadEvents.Listener {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val db = UploadDb.get(reactContext)

    override fun getName() = "S3Uploader"

    override fun initialize() {
        super.initialize()
        UploadEvents.addListener(this)
    }

    override fun invalidate() {
        UploadEvents.removeListener(this)
        scope.cancel()
        super.invalidate()
    }

    // --- API ---------------------------------------------------------------

    @ReactMethod
    fun configure(cfg: ReadableMap, promise: Promise) {
        try {
            @Suppress("UNCHECKED_CAST")
            val config = S3Config.fromMap(cfg.toHashMap() as Map<String, Any?>)
            CredentialStore(reactContext).save(config)
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("configure_failed", e.message, e)
        }
    }

    @ReactMethod
    fun testConnection(promise: Promise) {
        val config = CredentialStore(reactContext).load()
        if (config == null) {
            promise.resolve(resultMap(false, "Aucune configuration enregistrée"))
            return
        }
        scope.launch {
            val res = try {
                S3Client(config).headBucket()
                resultMap(true, null)
            } catch (e: Exception) {
                resultMap(false, e.message ?: e.toString())
            }
            promise.resolve(res)
        }
    }

    /**
     * Ajoute des fichiers à la file. Avant chaque ajout :
     *  - dédup locale : si la clé est déjà dans la file (quel que soit le statut) → ignoré ;
     *  - dédup serveur : si `skipExisting` et un objet existe déjà à cette clé (HEAD) →
     *    marqué `skipped`, jamais ré-uploadé.
     * Résout avec `{ queued, skippedInQueue, skippedExisting }`.
     */
    @ReactMethod
    fun enqueue(items: ReadableArray, promise: Promise) {
        val config = CredentialStore(reactContext).load()
        // snapshot des entrées JS (l'objet ReadableArray n'est pas sûr hors du thread JS)
        data class Candidate(
            val id: String,
            val uri: String,
            val key: String,
            val name: String,
            val sizeHint: Long,
            val contentType: String?,
        )
        val candidates = ArrayList<Candidate>()
        try {
            val seenUris = HashSet<String>()
            for (i in 0 until items.size()) {
                val m = items.getMap(i) ?: continue
                val uriStr = m.getString("uri") ?: continue
                val key = m.getString("key") ?: continue
                if (!seenUris.add(uriStr)) continue // même fichier deux fois dans le lot
                candidates.add(
                    Candidate(
                        id = m.getString("id") ?: UUID.randomUUID().toString(),
                        uri = uriStr,
                        key = key,
                        name = m.getString("displayName") ?: key.substringAfterLast('/'),
                        sizeHint = if (m.hasKey("sizeBytes")) {
                            m.getDouble("sizeBytes").toLong()
                        } else {
                            -1L
                        },
                        contentType = m.getString("contentType"),
                    ),
                )
            }
        } catch (e: Exception) {
            promise.reject("enqueue_failed", e.message, e)
            return
        }

        scope.launch {
            try {
                val s3 = config?.let { S3Client(it) }
                val skipExisting = config?.skipExisting ?: false
                val now = System.currentTimeMillis()
                var queued = 0
                var skippedInQueue = 0
                var skippedExisting = 0

                for (c in candidates) {
                    if (db.itemByKey(c.key) != null) {
                        skippedInQueue++
                        continue
                    }
                    var size = c.sizeHint
                    if (size <= 0L) size = querySize(Uri.parse(c.uri))

                    var status = Status.QUEUED
                    var note: String? = null
                    if (skipExisting && s3 != null) {
                        val remoteSize = try {
                            s3.headObject(c.key)
                        } catch (_: Exception) {
                            null // erreur réseau → on n'ignore pas, on tente l'upload
                        }
                        if (remoteSize != null) {
                            status = Status.SKIPPED
                            note = "Déjà présent sur le serveur"
                            skippedExisting++
                        }
                    }
                    if (status == Status.QUEUED) queued++

                    takePersistablePermission(Uri.parse(c.uri))
                    db.insertItems(
                        listOf(
                            ItemRow(
                                id = c.id, uri = c.uri, key = c.key, displayName = c.name,
                                sizeBytes = size, uploadId = null, status = status, error = note,
                                uploadedBytes = if (status == Status.SKIPPED) size else 0L,
                                contentType = c.contentType, createdAt = now, updatedAt = now,
                            ),
                        ),
                    )
                    UploadEvents.itemStatus(c.id, status, note)
                }

                if (queued > 0) {
                    UploadController.resume()
                    UploadQueueWorker.enqueue(reactContext, config?.wifiOnly ?: false)
                }
                promise.resolve(
                    Arguments.createMap().apply {
                        putInt("queued", queued)
                        putInt("skippedInQueue", skippedInQueue)
                        putInt("skippedExisting", skippedExisting)
                    },
                )
            } catch (e: Exception) {
                promise.reject("enqueue_failed", e.message, e)
            }
        }
    }

    @ReactMethod
    fun listObjects(prefix: String, continuationToken: String?, promise: Promise) {
        val config = CredentialStore(reactContext).load()
        if (config == null) {
            promise.reject("no_config", "Aucune configuration enregistrée")
            return
        }
        scope.launch {
            try {
                val res = S3Client(config).listObjectsV2(prefix, continuationToken)
                val prefixes = Arguments.createArray().apply { res.prefixes.forEach { pushString(it) } }
                val objects = Arguments.createArray()
                for (o in res.objects) {
                    objects.pushMap(
                        Arguments.createMap().apply {
                            putString("key", o.key)
                            putDouble("size", o.size.toDouble())
                            o.lastModified?.let { putString("lastModified", it) }
                        },
                    )
                }
                promise.resolve(
                    Arguments.createMap().apply {
                        putArray("prefixes", prefixes)
                        putArray("objects", objects)
                        res.nextToken?.let { putString("nextToken", it) }
                    },
                )
            } catch (e: Exception) {
                promise.reject("list_failed", e.message, e)
            }
        }
    }

    @ReactMethod
    fun deleteObject(key: String, promise: Promise) {
        withS3(promise) { s3, _ ->
            s3.deleteObject(key)
            promise.resolve(null)
        }
    }

    @ReactMethod
    fun createFolder(prefix: String, name: String, promise: Promise) {
        withS3(promise) { s3, _ ->
            val clean = name.trim().trim('/').replace(Regex("[\\\\/]+"), "_")
            if (clean.isEmpty()) {
                promise.reject("bad_name", "Nom de dossier vide")
                return@withS3
            }
            s3.putEmptyObject("$prefix$clean/")
            promise.resolve(null)
        }
    }

    /**
     * Déplace/renomme un lot d'objets (copie côté serveur + suppression source).
     * `pairs` = `[{ src, dst }, …]`. Lot exécuté en parallèle borné (`config.moveConcurrency`),
     * chaque fichier > 128 Mo en copie multipart. Émet `S3Uploader:onMoveProgress` :
     * `{ filesDone, filesTotal, bytesCopied, bytesTotal, currentName }`.
     * Résout `{ moved, failed, errors: [String] }`.
     */
    @ReactMethod
    fun moveObjects(pairs: ReadableArray, promise: Promise) {
        val list = ArrayList<Pair<String, String>>()
        for (i in 0 until pairs.size()) {
            val m = pairs.getMap(i) ?: continue
            val src = m.getString("src") ?: continue
            val dst = m.getString("dst") ?: continue
            if (src != dst) list.add(src to dst)
        }
        withS3(promise) { s3, config ->
            val filesTotal = list.size
            // tailles connues d'avance → pourcentage réel
            val sizes = java.util.concurrent.ConcurrentHashMap<String, Long>()
            run {
                val sem = kotlinx.coroutines.sync.Semaphore(8)
                kotlinx.coroutines.coroutineScope {
                    list.forEach { (src, _) ->
                        launch {
                            sem.acquire()
                            try {
                                sizes[src] = try {
                                    s3.headObject(src) ?: 0L
                                } catch (_: Exception) {
                                    0L
                                }
                            } finally {
                                sem.release()
                            }
                        }
                    }
                }
            }
            val bytesTotal = sizes.values.sum().coerceAtLeast(1L)
            val filesDone = java.util.concurrent.atomic.AtomicInteger(0)
            val bytesDone = java.util.concurrent.atomic.AtomicLong(0)
            val partialByFile = java.util.Collections.synchronizedMap(HashMap<String, Long>())
            val errors = java.util.Collections.synchronizedList(ArrayList<String>())

            fun emit(name: String) {
                val partial = synchronized(partialByFile) { partialByFile.values.sum() }
                UploadEvents.moveProgress(
                    filesDone.get(), filesTotal,
                    bytesDone.get() + partial, bytesTotal, name,
                )
            }
            emit("")

            val sem = kotlinx.coroutines.sync.Semaphore(config.moveConcurrency.coerceIn(1, 16))
            kotlinx.coroutines.coroutineScope {
                list.forEach { (src, dst) ->
                    launch(kotlinx.coroutines.Dispatchers.IO) {
                        sem.acquire()
                        val name = src.substringAfterLast('/')
                        try {
                            s3.moveObject(src, dst) { _, _, bytesCopied, _ ->
                                partialByFile[src] = bytesCopied
                                emit(name)
                            }
                            synchronized(partialByFile) { partialByFile.remove(src) }
                            bytesDone.addAndGet(sizes[src] ?: 0L)
                            filesDone.incrementAndGet()
                            emit(name)
                        } catch (e: Exception) {
                            synchronized(partialByFile) { partialByFile.remove(src) }
                            errors.add("$name : ${e.message ?: e}")
                            filesDone.incrementAndGet()
                            emit(name)
                        } finally {
                            sem.release()
                        }
                    }
                }
            }
            promise.resolve(
                Arguments.createMap().apply {
                    putInt("moved", filesTotal - errors.size)
                    putInt("failed", errors.size)
                    putArray("errors", Arguments.createArray().apply {
                        errors.forEach { pushString(it) }
                    })
                },
            )
        }
    }

    /**
     * Taille totale et nombre d'objets sous un préfixe. Résout `{ totalBytes, objectCount }`.
     * `allVersions=true` : compte aussi les anciennes versions (≈ taille facturée B2).
     */
    @ReactMethod
    fun prefixStats(prefix: String, allVersions: Boolean, promise: Promise) {
        withS3(promise) { s3, _ ->
            val (bytes, count) = if (allVersions) {
                s3.versionTotals(prefix) { b, c -> UploadEvents.scanProgress(b, c) }
            } else {
                s3.prefixTotals(prefix) { b, c -> UploadEvents.scanProgress(b, c) }
            }
            promise.resolve(
                Arguments.createMap().apply {
                    putDouble("totalBytes", bytes.toDouble())
                    putDouble("objectCount", count.toDouble())
                },
            )
        }
    }

    @ReactMethod
    fun listObjectVersions(
        prefix: String,
        keyMarker: String?,
        versionIdMarker: String?,
        recursive: Boolean,
        promise: Promise,
    ) {
        withS3(promise) { s3, _ ->
            val res = s3.listObjectVersions(
                prefix, keyMarker, versionIdMarker,
                delimiter = if (recursive) "" else "/",
            )
            promise.resolve(
                Arguments.createMap().apply {
                    putArray("prefixes", Arguments.createArray().apply {
                        res.prefixes.forEach { pushString(it) }
                    })
                    putArray("versions", Arguments.createArray().apply {
                        res.versions.forEach { v ->
                            pushMap(Arguments.createMap().apply {
                                putString("key", v.key)
                                putString("versionId", v.versionId)
                                putDouble("size", v.size.toDouble())
                                v.lastModified?.let { putString("lastModified", it) }
                                putBoolean("isLatest", v.isLatest)
                                putBoolean("isDeleteMarker", v.isDeleteMarker)
                            })
                        }
                    })
                    res.nextKeyMarker?.let { putString("nextKeyMarker", it) }
                    res.nextVersionIdMarker?.let { putString("nextVersionIdMarker", it) }
                },
            )
        }
    }

    @ReactMethod
    fun deleteVersion(key: String, versionId: String, promise: Promise) {
        withS3(promise) { s3, _ ->
            s3.deleteVersion(key, versionId)
            promise.resolve(null)
        }
    }

    /** Supprime toutes les versions non-courantes sous un préfixe. Résout `{ deleted }`. */
    @ReactMethod
    fun purgeOldVersions(prefix: String, promise: Promise) {
        withS3(promise) { s3, _ ->
            val toDelete = ArrayList<Pair<String, String>>()
            var km: String? = null
            var vm: String? = null
            do {
                val res = s3.listObjectVersions(prefix, km, vm, delimiter = "")
                res.versions.forEach { if (!it.isLatest) toDelete.add(it.key to it.versionId) }
                km = res.nextKeyMarker
                vm = res.nextVersionIdMarker
            } while (km != null || vm != null)

            val deleted = java.util.concurrent.atomic.AtomicInteger(0)
            kotlinx.coroutines.coroutineScope {
                val sem = kotlinx.coroutines.sync.Semaphore(8)
                toDelete.forEach { (k, v) ->
                    launch(kotlinx.coroutines.Dispatchers.IO) {
                        sem.acquire()
                        try {
                            s3.deleteVersion(k, v)
                            deleted.incrementAndGet()
                        } catch (_: Exception) {
                        } finally {
                            sem.release()
                        }
                    }
                }
            }
            promise.resolve(Arguments.createMap().apply { putInt("deleted", deleted.get()) })
        }
    }

    /** Supprime tout ce qui est sous un préfixe. Résout `{ deleted }`. */
    @ReactMethod
    fun deletePrefix(prefix: String, promise: Promise) {
        withS3(promise) { s3, _ ->
            val keys = s3.listAllKeys(prefix)
            val deleted = java.util.concurrent.atomic.AtomicInteger(0)
            kotlinx.coroutines.coroutineScope {
                val sem = kotlinx.coroutines.sync.Semaphore(8)
                keys.forEach { k ->
                    launch {
                        sem.acquire()
                        try {
                            s3.deleteObject(k)
                            deleted.incrementAndGet()
                        } finally {
                            sem.release()
                        }
                    }
                }
            }
            promise.resolve(Arguments.createMap().apply { putInt("deleted", deleted.get()) })
        }
    }

    /**
     * Énumère récursivement un arbre SAF (`content://…/tree/…` renvoyé par pickDirectory).
     * Résout `{ files: [{ uri, name, relativePath, size, mimeType }] }`.
     */
    @ReactMethod
    fun listTree(treeUri: String, promise: Promise) {
        scope.launch {
            try {
                val root = Uri.parse(treeUri)
                runCatching {
                    reactContext.contentResolver.takePersistableUriPermission(
                        root, Intent.FLAG_GRANT_READ_URI_PERMISSION,
                    )
                }
                val rootDocId = android.provider.DocumentsContract.getTreeDocumentId(root)
                val files = Arguments.createArray()
                walkTree(root, rootDocId, "", files)
                promise.resolve(Arguments.createMap().apply { putArray("files", files) })
            } catch (e: Exception) {
                promise.reject("list_tree_failed", e.message, e)
            }
        }
    }

    private fun walkTree(
        treeUri: Uri,
        docId: String,
        relPath: String,
        out: com.facebook.react.bridge.WritableArray,
    ) {
        val childrenUri =
            android.provider.DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, docId)
        val cols = arrayOf(
            android.provider.DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            android.provider.DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            android.provider.DocumentsContract.Document.COLUMN_MIME_TYPE,
            android.provider.DocumentsContract.Document.COLUMN_SIZE,
        )
        reactContext.contentResolver.query(childrenUri, cols, null, null, null)?.use { c ->
            while (c.moveToNext()) {
                val id = c.getString(0) ?: continue
                val name = c.getString(1) ?: continue
                val mime = if (c.isNull(2)) null else c.getString(2)
                val size = if (c.isNull(3)) -1L else c.getLong(3)
                val childRel = if (relPath.isEmpty()) name else "$relPath/$name"
                if (mime == android.provider.DocumentsContract.Document.MIME_TYPE_DIR) {
                    walkTree(treeUri, id, childRel, out)
                } else {
                    val fileUri =
                        android.provider.DocumentsContract.buildDocumentUriUsingTree(treeUri, id)
                    out.pushMap(
                        Arguments.createMap().apply {
                            putString("uri", fileUri.toString())
                            putString("name", name)
                            putString("relativePath", childRel)
                            putDouble("size", size.toDouble())
                            mime?.let { putString("mimeType", it) }
                        },
                    )
                }
            }
        }
    }

    private fun withS3(promise: Promise, block: suspend (S3Client, S3Config) -> Unit) {
        val config = CredentialStore(reactContext).load()
        if (config == null) {
            promise.reject("no_config", "Aucune configuration enregistrée")
            return
        }
        scope.launch {
            try {
                block(S3Client(config), config)
            } catch (e: Exception) {
                promise.reject("s3_op_failed", e.message, e)
            }
        }
    }

    @ReactMethod
    fun pause(promise: Promise) {
        UploadController.pause()
        UploadQueueWorker.cancel(reactContext) // stoppe le service de premier plan
        UploadEvents.queueStatus("paused", 0)
        promise.resolve(null)
    }

    @ReactMethod
    fun resume(promise: Promise) {
        UploadController.resume()
        val wifiOnly = CredentialStore(reactContext).load()?.wifiOnly ?: false
        UploadQueueWorker.enqueue(reactContext, wifiOnly)
        UploadEvents.queueStatus("running", 0)
        promise.resolve(null)
    }

    @ReactMethod
    fun cancel(id: String, promise: Promise) {
        UploadController.cancel(id)
        scope.launch {
            val item = db.getItem(id)
            if (item != null && item.status != Status.COMPLETED) {
                if (item.status != Status.UPLOADING) {
                    // pas en cours de traitement : abort inline best-effort
                    try {
                        val config = CredentialStore(reactContext).load()
                        if (config != null && item.uploadId != null) {
                            S3Client(config).abortMultipartUpload(item.key, item.uploadId)
                        }
                    } catch (_: Exception) {
                    }
                    db.deletePartsFor(id)
                    db.setStatus(id, Status.CANCELED)
                    UploadController.clearCanceled(id)
                    UploadEvents.itemStatus(id, Status.CANCELED, null)
                }
            }
            promise.resolve(null)
        }
    }

    @ReactMethod
    fun retry(id: String, promise: Promise) {
        db.setStatus(id, Status.QUEUED, null)
        db.setUploadedBytes(id, db.uploadedPartBytes(id))
        UploadController.clearCanceled(id)
        UploadController.resume()
        UploadEvents.itemStatus(id, Status.QUEUED, null)
        val wifiOnly = CredentialStore(reactContext).load()?.wifiOnly ?: false
        UploadQueueWorker.enqueue(reactContext, wifiOnly)
        promise.resolve(null)
    }

    @ReactMethod
    fun clearCompleted(promise: Promise) {
        db.deleteByStatus(
            Status.COMPLETED, Status.CANCELED, Status.FAILED, Status.SKIPPED,
        )
        promise.resolve(null)
    }

    @ReactMethod
    fun getState(promise: Promise) {
        try {
            val items = Arguments.createArray()
            for (it in db.allItems()) {
                items.pushMap(
                    Arguments.createMap().apply {
                        putString("id", it.id)
                        putString("uri", it.uri)
                        putString("key", it.key)
                        putString("displayName", it.displayName)
                        putDouble("sizeBytes", it.sizeBytes.toDouble())
                        putDouble("uploadedBytes", it.uploadedBytes.toDouble())
                        putString("status", it.status)
                        it.error?.let { e -> putString("error", e) }
                    },
                )
            }
            val paused = UploadController.isPaused
            val hasActive = db.itemsToProcess().isNotEmpty()
            val status = when {
                paused -> "paused"
                hasActive -> "running"
                else -> "idle"
            }
            promise.resolve(
                Arguments.createMap().apply {
                    putString("status", status)
                    putArray("items", items)
                },
            )
        } catch (e: Exception) {
            promise.reject("get_state_failed", e.message, e)
        }
    }

    // requis par NativeEventEmitter (RN)
    @ReactMethod fun addListener(eventName: String) {}

    @ReactMethod fun removeListeners(count: Int) {}

    // --- UploadEvents.Listener -> JS -------------------------------------------

    override fun onItemStatus(id: String, status: String, error: String?) {
        emit("S3Uploader:onItemStatus", Arguments.createMap().apply {
            putString("id", id)
            putString("status", status)
            error?.let { putString("error", it) }
        })
    }

    override fun onProgress(
        id: String,
        uploadedBytes: Long,
        totalBytes: Long,
        partsCompleted: Int,
        partsTotal: Int,
    ) {
        emit("S3Uploader:onProgress", Arguments.createMap().apply {
            putString("id", id)
            putDouble("uploadedBytes", uploadedBytes.toDouble())
            putDouble("totalBytes", totalBytes.toDouble())
            putInt("partsCompleted", partsCompleted)
            putInt("partsTotal", partsTotal)
        })
    }

    override fun onQueueStatus(status: String, activeCount: Int) {
        emit("S3Uploader:onQueueStatus", Arguments.createMap().apply {
            putString("status", status)
            putInt("activeCount", activeCount)
        })
    }

    override fun onMoveProgress(
        filesDone: Int,
        filesTotal: Int,
        bytesCopied: Long,
        bytesTotal: Long,
        currentName: String,
    ) {
        emit("S3Uploader:onMoveProgress", Arguments.createMap().apply {
            putInt("filesDone", filesDone)
            putInt("filesTotal", filesTotal)
            putDouble("bytesCopied", bytesCopied.toDouble())
            putDouble("bytesTotal", bytesTotal.toDouble())
            putString("currentName", currentName)
        })
    }

    override fun onScanProgress(bytes: Long, count: Long) {
        emit("S3Uploader:onScanProgress", Arguments.createMap().apply {
            putDouble("bytes", bytes.toDouble())
            putDouble("count", count.toDouble())
        })
    }

    // --- Helpers ---------------------------------------------------------------

    private fun emit(event: String, params: WritableMap) {
        if (!reactContext.hasActiveReactInstance()) return
        runCatching {
            reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(event, params)
        }
    }

    private fun resultMap(ok: Boolean, error: String?): WritableMap =
        Arguments.createMap().apply {
            putBoolean("ok", ok)
            error?.let { putString("error", it) }
        }

    private fun takePersistablePermission(uri: Uri) {
        if (uri.scheme != "content") return
        runCatching {
            reactContext.contentResolver.takePersistableUriPermission(
                uri, Intent.FLAG_GRANT_READ_URI_PERMISSION,
            )
        }
    }

    private fun querySize(uri: Uri): Long {
        return runCatching {
            reactContext.contentResolver.query(uri, null, null, null, null)?.use { c ->
                val idx = c.getColumnIndex(OpenableColumns.SIZE)
                if (idx >= 0 && c.moveToFirst() && !c.isNull(idx)) c.getLong(idx) else -1L
            } ?: -1L
        }.getOrDefault(-1L)
    }
}
