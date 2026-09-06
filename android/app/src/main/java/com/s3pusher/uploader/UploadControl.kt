package com.s3pusher.uploader

import java.util.Collections
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicBoolean

/**
 * État de contrôle partagé entre le module JS et le worker (in-process singletons).
 * Le worker peut aussi tourner sans JS ; la vérité persistante reste la DB.
 */
object UploadController {
    private val pausedFlag = AtomicBoolean(false)
    private val canceled = Collections.synchronizedSet(HashSet<String>())

    val isPaused: Boolean get() = pausedFlag.get()

    fun pause() = pausedFlag.set(true)
    fun resume() = pausedFlag.set(false)

    fun cancel(id: String) { canceled.add(id) }
    fun isCanceled(id: String): Boolean = canceled.contains(id)
    fun clearCanceled(id: String) { canceled.remove(id) }
}

/** Bus d'événements minimal ; le module s'y abonne quand JS est attaché. */
object UploadEvents {

    interface Listener {
        fun onItemStatus(id: String, status: String, error: String?)
        fun onProgress(
            id: String,
            uploadedBytes: Long,
            totalBytes: Long,
            partsCompleted: Int,
            partsTotal: Int,
        )
        fun onQueueStatus(status: String, activeCount: Int)
    }

    private val listeners = CopyOnWriteArrayList<Listener>()

    fun addListener(l: Listener) { listeners.addIfAbsent(l) }
    fun removeListener(l: Listener) { listeners.remove(l) }

    fun itemStatus(id: String, status: String, error: String?) =
        listeners.forEach { runCatching { it.onItemStatus(id, status, error) } }

    fun progress(id: String, up: Long, total: Long, done: Int, totalParts: Int) =
        listeners.forEach { runCatching { it.onProgress(id, up, total, done, totalParts) } }

    fun queueStatus(status: String, activeCount: Int) =
        listeners.forEach { runCatching { it.onQueueStatus(status, activeCount) } }
}
