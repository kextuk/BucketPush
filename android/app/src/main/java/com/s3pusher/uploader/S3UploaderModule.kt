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

    @ReactMethod
    fun enqueue(items: ReadableArray, promise: Promise) {
        try {
            val now = System.currentTimeMillis()
            val rows = ArrayList<ItemRow>()
            for (i in 0 until items.size()) {
                val m = items.getMap(i) ?: continue
                val uriStr = m.getString("uri") ?: continue
                val key = m.getString("key") ?: continue
                val name = m.getString("displayName") ?: key.substringAfterLast('/')
                var size = if (m.hasKey("sizeBytes")) m.getDouble("sizeBytes").toLong() else -1L
                if (size <= 0L) size = querySize(Uri.parse(uriStr))
                val contentType = m.getString("contentType")
                takePersistablePermission(Uri.parse(uriStr))
                rows.add(
                    ItemRow(
                        id = m.getString("id") ?: UUID.randomUUID().toString(),
                        uri = uriStr,
                        key = key,
                        displayName = name,
                        sizeBytes = size,
                        uploadId = null,
                        status = Status.QUEUED,
                        error = null,
                        uploadedBytes = 0L,
                        contentType = contentType,
                        createdAt = now,
                        updatedAt = now,
                    ),
                )
            }
            db.insertItems(rows)
            rows.forEach { UploadEvents.itemStatus(it.id, Status.QUEUED, null) }
            UploadController.resume()
            val wifiOnly = CredentialStore(reactContext).load()?.wifiOnly ?: false
            UploadQueueWorker.enqueue(reactContext, wifiOnly)
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("enqueue_failed", e.message, e)
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
        db.deleteByStatus(Status.COMPLETED, Status.CANCELED, Status.FAILED)
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
