package com.s3pusher.uploader

import android.content.Context
import android.net.Uri
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Semaphore
import kotlin.math.min
import kotlin.random.Random

/**
 * Orchestration de l'upload multipart d'un fichier :
 * création/reprise du multipart, upload des parts manquantes (concurrence bornée,
 * retry/backoff), persistance incrémentale, complétion.
 */
class MultipartUploader(
    private val context: Context,
    private val config: S3Config,
    private val db: UploadDb,
    private val s3: S3Client = S3Client(config),
) {

    enum class Outcome { COMPLETED, PAUSED, CANCELED, FAILED }

    data class Result(val outcome: Outcome, val error: String? = null)

    interface Control {
        /** L'utilisateur / le système demande une pause : finir proprement, garder l'état. */
        fun isPaused(): Boolean
        /** L'item a été annulé : abort + purge. */
        fun isCanceled(itemId: String): Boolean
    }

    interface ProgressSink {
        fun onProgress(
            itemId: String,
            uploadedBytes: Long,
            totalBytes: Long,
            partsCompleted: Int,
            partsTotal: Int,
        )
    }

    suspend fun upload(item: ItemRow, control: Control, progress: ProgressSink): Result {
        val uri = Uri.parse(item.uri)
        if (control.isCanceled(item.id)) return abortAndPurge(item)

        // 1) uploadId : réutiliser ou créer
        var uploadId = item.uploadId ?: retry("CreateMultipartUpload") {
            s3.createMultipartUpload(item.key, item.contentType)
        }.also { db.setUploadId(item.id, it) }

        // 2) parts déjà faites : fusion distant (ListParts) + local (DB)
        val remote: List<S3Client.UploadedPart> = try {
            retry("ListParts") { s3.listParts(item.key, uploadId) }
        } catch (e: S3Client.S3Exception) {
            if (e.statusCode != 404) throw e
            db.deletePartsFor(item.id)
            uploadId = retry("CreateMultipartUpload") {
                s3.createMultipartUpload(item.key, item.contentType)
            }.also { db.setUploadId(item.id, it) }
            emptyList()
        }
        val uid: String = uploadId

        val plan = PartPlan.plan(item.sizeBytes, config.partSizeBytes)
        if (plan.isEmpty()) {
            return Result(Outcome.FAILED, "Taille de fichier invalide (${item.sizeBytes})")
        }
        val sizeByNumber = plan.associate { it.number to it.size }

        // parts connues = union(DB, distant), persistées en DB
        val dbParts = db.partsFor(item.id).associate { it.partNumber to it.eTag }.toMutableMap()
        for (rp in remote) {
            if (rp.partNumber !in dbParts) {
                val size = sizeByNumber[rp.partNumber] ?: continue
                db.addPart(item.id, rp.partNumber, rp.eTag, size)
                dbParts[rp.partNumber] = rp.eTag
            }
        }

        val totalBytes = item.sizeBytes
        val partsTotal = plan.size
        val doneCount = java.util.concurrent.atomic.AtomicInteger(dbParts.size)
        val inFlight = HashMap<Int, Long>()
        val lock = Any()
        val lastEmitAt = java.util.concurrent.atomic.AtomicLong(0L)

        fun emit() {
            val completedBytes = db.uploadedPartBytes(item.id)
            val inFlightBytes = synchronized(lock) { inFlight.values.sum() }
            val uploaded = min(totalBytes, completedBytes + inFlightBytes)
            db.setUploadedBytes(item.id, uploaded)
            progress.onProgress(item.id, uploaded, totalBytes, doneCount.get(), partsTotal)
        }
        fun emitThrottled() {
            val now = System.currentTimeMillis()
            val prev = lastEmitAt.get()
            if (now - prev >= 500L && lastEmitAt.compareAndSet(prev, now)) emit()
        }
        emit()

        val todo = plan.filter { it.number !in dbParts }
        if (todo.isEmpty()) return complete(item, uid)

        val sem = Semaphore(config.maxConcurrentParts.coerceIn(1, 8))
        val stopReason = java.util.concurrent.atomic.AtomicReference<Outcome?>(null)
        val failure = java.util.concurrent.atomic.AtomicReference<String?>(null)

        coroutineScope {
            for (part in todo) {
                if (stopReason.get() != null || failure.get() != null) break
                if (control.isPaused()) { stopReason.set(Outcome.PAUSED); break }
                if (control.isCanceled(item.id)) { stopReason.set(Outcome.CANCELED); break }

                sem.acquire()
                launch(Dispatchers.IO) {
                    try {
                        if (control.isPaused()) { stopReason.set(Outcome.PAUSED); return@launch }
                        if (control.isCanceled(item.id)) {
                            stopReason.set(Outcome.CANCELED); return@launch
                        }
                        val etag = retry("UploadPart ${part.number}") {
                            val body = RangeRequestBody(
                                context.contentResolver, uri, part.offset, part.size,
                            ) { written ->
                                synchronized(lock) { inFlight[part.number] = written }
                                emitThrottled()
                            }
                            s3.uploadPart(item.key, uid, part.number, body)
                        }
                        synchronized(lock) {
                            db.addPart(item.id, part.number, etag, part.size)
                            inFlight.remove(part.number)
                        }
                        doneCount.incrementAndGet()
                        emit()
                    } catch (ce: CancellationException) {
                        throw ce
                    } catch (e: Exception) {
                        synchronized(lock) { inFlight.remove(part.number) }
                        failure.compareAndSet(null, e.message ?: e.toString())
                    } finally {
                        sem.release()
                    }
                }
            }
        }

        return when {
            stopReason.get() == Outcome.CANCELED || control.isCanceled(item.id) ->
                abortAndPurge(item)
            failure.get() != null -> Result(Outcome.FAILED, failure.get())
            stopReason.get() == Outcome.PAUSED || control.isPaused() -> Result(Outcome.PAUSED)
            else -> {
                val have = db.partsFor(item.id).map { it.partNumber }.toHashSet()
                when {
                    plan.all { it.number in have } -> complete(item, uid)
                    control.isPaused() -> Result(Outcome.PAUSED)
                    else -> Result(
                        Outcome.FAILED,
                        "Parts incomplètes sans erreur explicite (état incohérent)",
                    )
                }
            }
        }
    }

    private suspend fun complete(item: ItemRow, uploadId: String): Result {
        val parts = db.partsFor(item.id)
        retry("CompleteMultipartUpload") {
            s3.completeMultipartUpload(item.key, uploadId, parts)
        }
        db.setUploadedBytes(item.id, item.sizeBytes)
        db.deletePartsFor(item.id)
        return Result(Outcome.COMPLETED)
    }

    private fun abortAndPurge(item: ItemRow): Result {
        try {
            item.uploadId?.let { s3.abortMultipartUpload(item.key, it) }
        } catch (_: Exception) { /* best effort */ }
        db.deletePartsFor(item.id)
        return Result(Outcome.CANCELED)
    }

    /** Retry exponentiel + jitter sur erreurs réseau / S3 retryables. */
    private suspend fun <T> retry(
        label: String,
        maxAttempts: Int = 5,
        block: suspend () -> T,
    ): T {
        var attempt = 0
        var delayMs = 1000L
        while (true) {
            try {
                return block()
            } catch (ce: CancellationException) {
                throw ce
            } catch (e: S3Client.S3Exception) {
                attempt++
                if (!e.retryable || attempt >= maxAttempts) throw e
            } catch (e: Exception) {
                attempt++
                if (attempt >= maxAttempts) throw e
            }
            delay(delayMs + Random.nextLong(0, 500))
            delayMs = (delayMs * 2).coerceAtMost(16_000L)
        }
    }
}
