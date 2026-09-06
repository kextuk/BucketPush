package com.s3pusher.uploader

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.work.CoroutineWorker
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.ForegroundInfo
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Semaphore

/**
 * File d'attente d'upload, exécutée en service de premier plan (dataSync) pour survivre
 * à l'arrière-plan / écran verrouillé. Un seul worker à la fois (`ExistingWorkPolicy.KEEP`).
 */
class UploadQueueWorker(appContext: Context, params: WorkerParameters) :
    CoroutineWorker(appContext, params) {

    private val db = UploadDb.get(applicationContext)
    private var lastNotifyAt = 0L

    override suspend fun getForegroundInfo(): ForegroundInfo = buildForegroundInfo()

    override suspend fun doWork(): Result {
        val config = CredentialStore(applicationContext).load() ?: run {
            UploadEvents.queueStatus("idle", 0)
            return Result.success()
        }
        ensureChannel()
        runCatching { setForeground(buildForegroundInfo()) }

        if (UploadController.isPaused) {
            UploadEvents.queueStatus("paused", 0)
            return Result.success()
        }
        UploadEvents.queueStatus("running", 0)

        val control = object : MultipartUploader.Control {
            override fun isPaused() = UploadController.isPaused || isStopped
            override fun isCanceled(itemId: String) = UploadController.isCanceled(itemId)
        }
        val progress = object : MultipartUploader.ProgressSink {
            override fun onProgress(
                itemId: String,
                uploadedBytes: Long,
                totalBytes: Long,
                partsCompleted: Int,
                partsTotal: Int,
            ) {
                UploadEvents.progress(itemId, uploadedBytes, totalBytes, partsCompleted, partsTotal)
                maybeUpdateNotification()
            }
        }

        val filesSem = Semaphore(config.maxConcurrentFiles.coerceIn(1, 4))
        var stoppedEarly = false

        try {
            while (true) {
                if (UploadController.isPaused || isStopped) { stoppedEarly = true; break }
                val batch = db.itemsToProcess()
                if (batch.isEmpty()) break

                val before = batch.map { it.id }.toSet()
                coroutineScope {
                    for (item in batch) {
                        if (UploadController.isPaused || isStopped) break
                        filesSem.acquire()
                        launch(Dispatchers.IO) {
                            try {
                                processItem(item, config, control, progress)
                            } finally {
                                filesSem.release()
                            }
                        }
                    }
                }
                maybeUpdateNotification(force = true)

                // garde-fou anti-boucle : si rien n'a bougé et qu'on n'est pas en pause, on sort
                val after = db.itemsToProcess().map { it.id }.toSet()
                if (after == before && !UploadController.isPaused && !isStopped) break
            }
        } catch (ce: CancellationException) {
            // worker stoppé par le système → les items restent en base pour la reprise
            return Result.retry()
        }

        return when {
            isStopped -> Result.retry() // contrainte perdue (réseau…) → WM replanifie
            stoppedEarly && UploadController.isPaused -> {
                UploadEvents.queueStatus("paused", 0)
                Result.success()
            }
            else -> {
                UploadEvents.queueStatus("idle", 0)
                Result.success()
            }
        }
    }

    private suspend fun processItem(
        item: ItemRow,
        config: S3Config,
        control: MultipartUploader.Control,
        progress: MultipartUploader.ProgressSink,
    ) {
        // relire l'état frais (il a pu être annulé entre-temps)
        val fresh = db.getItem(item.id) ?: return
        if (fresh.status in setOf(Status.COMPLETED, Status.CANCELED, Status.FAILED)) return

        if (UploadController.isCanceled(item.id)) {
            db.setStatus(item.id, Status.CANCELED)
            UploadEvents.itemStatus(item.id, Status.CANCELED, null)
            UploadController.clearCanceled(item.id)
            return
        }

        db.setStatus(item.id, Status.UPLOADING)
        UploadEvents.itemStatus(item.id, Status.UPLOADING, null)

        val result = try {
            MultipartUploader(applicationContext, config, db).upload(fresh, control, progress)
        } catch (ce: CancellationException) {
            throw ce
        } catch (e: Exception) {
            MultipartUploader.Result(MultipartUploader.Outcome.FAILED, e.message ?: e.toString())
        }

        when (result.outcome) {
            MultipartUploader.Outcome.COMPLETED -> {
                db.setStatus(item.id, Status.COMPLETED)
                UploadEvents.itemStatus(item.id, Status.COMPLETED, null)
            }
            MultipartUploader.Outcome.CANCELED -> {
                db.setStatus(item.id, Status.CANCELED)
                UploadController.clearCanceled(item.id)
                UploadEvents.itemStatus(item.id, Status.CANCELED, null)
            }
            MultipartUploader.Outcome.FAILED -> {
                db.setStatus(item.id, Status.FAILED, result.error)
                UploadEvents.itemStatus(item.id, Status.FAILED, result.error)
            }
            MultipartUploader.Outcome.PAUSED -> {
                // reste en UPLOADING : repris au prochain lancement du worker
                UploadEvents.itemStatus(item.id, Status.UPLOADING, null)
            }
        }
    }

    // --- Notification -------------------------------------------------------

    private fun maybeUpdateNotification(force: Boolean = false) {
        val now = System.currentTimeMillis()
        if (!force && now - lastNotifyAt < 1000L) return
        lastNotifyAt = now
        runCatching {
            val nm = applicationContext.getSystemService(NotificationManager::class.java)
            nm?.notify(NOTIF_ID, buildNotification())
        }
    }

    private fun buildForegroundInfo(): ForegroundInfo {
        val notif = buildNotification()
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ForegroundInfo(NOTIF_ID, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            ForegroundInfo(NOTIF_ID, notif)
        }
    }

    private fun buildNotification(): android.app.Notification {
        val items = db.allItems()
        val active = items.filter {
            it.status == Status.UPLOADING || it.status == Status.QUEUED
        }
        val totalBytes = items.sumOf { it.sizeBytes }.coerceAtLeast(1)
        val uploadedBytes = items.sumOf {
            if (it.status == Status.COMPLETED) it.sizeBytes else it.uploadedBytes
        }
        val pct = (uploadedBytes * 100 / totalBytes).toInt().coerceIn(0, 100)
        val done = items.count { it.status == Status.COMPLETED }
        val title = if (active.isEmpty()) "Uploads terminés" else "Upload en cours"
        val text = "$done/${items.size} fichiers · $pct %"

        return NotificationCompat.Builder(applicationContext, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(text)
            .setSmallIcon(android.R.drawable.stat_sys_upload)
            .setOngoing(active.isNotEmpty())
            .setOnlyAlertOnce(true)
            .setProgress(100, pct, false)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build()
    }

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = applicationContext.getSystemService(NotificationManager::class.java) ?: return
        if (nm.getNotificationChannel(CHANNEL_ID) == null) {
            nm.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_ID,
                    "Uploads S3",
                    NotificationManager.IMPORTANCE_LOW,
                ).apply { description = "Progression des uploads vers S3" },
            )
        }
    }

    companion object {
        const val WORK_NAME = "s3-upload-queue"
        private const val CHANNEL_ID = "s3_uploads"
        private const val NOTIF_ID = 4210

        fun enqueue(context: Context, wifiOnly: Boolean) {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(if (wifiOnly) NetworkType.UNMETERED else NetworkType.CONNECTED)
                .build()
            val request = OneTimeWorkRequestBuilder<UploadQueueWorker>()
                .setConstraints(constraints)
                .addTag(WORK_NAME)
                .build()
            WorkManager.getInstance(context)
                .enqueueUniqueWork(WORK_NAME, ExistingWorkPolicy.KEEP, request)
        }

        fun cancel(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME)
        }
    }
}
