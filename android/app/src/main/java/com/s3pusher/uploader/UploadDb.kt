package com.s3pusher.uploader

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

/** Statuts d'un item d'upload. */
object Status {
    const val QUEUED = "queued"
    const val UPLOADING = "uploading"
    const val COMPLETED = "completed"
    const val FAILED = "failed"
    const val CANCELED = "canceled"
    const val PAUSED = "paused"
}

data class ItemRow(
    val id: String,
    val uri: String,
    val key: String,
    val displayName: String,
    val sizeBytes: Long,
    val uploadId: String?,
    val status: String,
    val error: String?,
    val uploadedBytes: Long,
    val contentType: String?,
    val createdAt: Long,
    val updatedAt: Long,
)

/**
 * Persistance de la file d'upload et des parts déjà envoyées.
 * SQLite brut (pas de Room / KSP). Singleton, WAL activé pour l'accès concurrent
 * worker + module.
 */
class UploadDb private constructor(context: Context) :
    SQLiteOpenHelper(context.applicationContext, "s3pusher.db", null, 1) {

    override fun onConfigure(db: SQLiteDatabase) {
        db.enableWriteAheadLogging()
        db.setForeignKeyConstraintsEnabled(true)
    }

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE upload_item (
              id TEXT PRIMARY KEY NOT NULL,
              uri TEXT NOT NULL,
              s3key TEXT NOT NULL,
              display_name TEXT NOT NULL,
              size_bytes INTEGER NOT NULL,
              upload_id TEXT,
              status TEXT NOT NULL,
              error TEXT,
              uploaded_bytes INTEGER NOT NULL DEFAULT 0,
              content_type TEXT,
              created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL
            )
            """.trimIndent(),
        )
        db.execSQL(
            """
            CREATE TABLE upload_part (
              item_id TEXT NOT NULL,
              part_number INTEGER NOT NULL,
              etag TEXT NOT NULL,
              size_bytes INTEGER NOT NULL,
              uploaded_at INTEGER NOT NULL,
              PRIMARY KEY (item_id, part_number),
              FOREIGN KEY (item_id) REFERENCES upload_item(id) ON DELETE CASCADE
            )
            """.trimIndent(),
        )
        db.execSQL("CREATE INDEX idx_item_status ON upload_item(status)")
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        // v1 seulement pour l'instant.
    }

    // --- Items ---------------------------------------------------------------

    fun insertItems(items: List<ItemRow>) {
        val db = writableDatabase
        db.beginTransaction()
        try {
            for (it in items) {
                val cv = ContentValues().apply {
                    put("id", it.id)
                    put("uri", it.uri)
                    put("s3key", it.key)
                    put("display_name", it.displayName)
                    put("size_bytes", it.sizeBytes)
                    put("upload_id", it.uploadId)
                    put("status", it.status)
                    put("error", it.error)
                    put("uploaded_bytes", it.uploadedBytes)
                    put("content_type", it.contentType)
                    put("created_at", it.createdAt)
                    put("updated_at", it.updatedAt)
                }
                db.insertWithOnConflict("upload_item", null, cv, SQLiteDatabase.CONFLICT_IGNORE)
            }
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    fun allItems(): List<ItemRow> = query("SELECT * FROM upload_item ORDER BY created_at ASC")

    fun itemsToProcess(): List<ItemRow> = query(
        "SELECT * FROM upload_item WHERE status IN (?, ?) ORDER BY created_at ASC",
        arrayOf(Status.QUEUED, Status.UPLOADING),
    )

    fun getItem(id: String): ItemRow? =
        query("SELECT * FROM upload_item WHERE id = ?", arrayOf(id)).firstOrNull()

    fun setStatus(id: String, status: String, error: String? = null) {
        writableDatabase.execSQL(
            "UPDATE upload_item SET status = ?, error = ?, updated_at = ? WHERE id = ?",
            arrayOf<Any?>(status, error, System.currentTimeMillis(), id),
        )
    }

    fun setUploadId(id: String, uploadId: String) {
        writableDatabase.execSQL(
            "UPDATE upload_item SET upload_id = ?, updated_at = ? WHERE id = ?",
            arrayOf(uploadId, System.currentTimeMillis(), id),
        )
    }

    fun setUploadedBytes(id: String, bytes: Long) {
        writableDatabase.execSQL(
            "UPDATE upload_item SET uploaded_bytes = ?, updated_at = ? WHERE id = ?",
            arrayOf(bytes, System.currentTimeMillis(), id),
        )
    }

    fun deleteItem(id: String) {
        writableDatabase.execSQL("DELETE FROM upload_item WHERE id = ?", arrayOf(id))
    }

    fun deleteByStatus(vararg statuses: String) {
        val marks = statuses.joinToString(",") { "?" }
        writableDatabase.execSQL(
            "DELETE FROM upload_item WHERE status IN ($marks)", arrayOf(*statuses),
        )
    }

    /** Repasse les items actifs en QUEUED (ex. au démarrage d'un worker). */
    fun requeue(vararg fromStatuses: String) {
        val marks = fromStatuses.joinToString(",") { "?" }
        writableDatabase.execSQL(
            "UPDATE upload_item SET status = ?, updated_at = ? WHERE status IN ($marks)",
            arrayOf(Status.QUEUED, System.currentTimeMillis(), *fromStatuses),
        )
    }

    // --- Parts -------------------------------------------------------------

    fun addPart(itemId: String, partNumber: Int, etag: String, size: Long) {
        val cv = ContentValues().apply {
            put("item_id", itemId)
            put("part_number", partNumber)
            put("etag", etag)
            put("size_bytes", size)
            put("uploaded_at", System.currentTimeMillis())
        }
        writableDatabase.insertWithOnConflict(
            "upload_part", null, cv, SQLiteDatabase.CONFLICT_REPLACE,
        )
    }

    fun partsFor(itemId: String): List<S3Client.UploadedPart> {
        val out = ArrayList<S3Client.UploadedPart>()
        readableDatabase.rawQuery(
            "SELECT part_number, etag FROM upload_part WHERE item_id = ? ORDER BY part_number",
            arrayOf(itemId),
        ).use { c ->
            while (c.moveToNext()) out.add(S3Client.UploadedPart(c.getInt(0), c.getString(1)))
        }
        return out
    }

    fun uploadedPartBytes(itemId: String): Long {
        readableDatabase.rawQuery(
            "SELECT COALESCE(SUM(size_bytes), 0) FROM upload_part WHERE item_id = ?",
            arrayOf(itemId),
        ).use { c -> return if (c.moveToFirst()) c.getLong(0) else 0L }
    }

    fun deletePartsFor(itemId: String) {
        writableDatabase.execSQL("DELETE FROM upload_part WHERE item_id = ?", arrayOf(itemId))
    }

    // --- Helpers ---------------------------------------------------------------

    private fun query(sql: String, args: Array<String>? = null): List<ItemRow> {
        val list = ArrayList<ItemRow>()
        readableDatabase.rawQuery(sql, args).use { c ->
            val iId = c.getColumnIndexOrThrow("id")
            val iUri = c.getColumnIndexOrThrow("uri")
            val iKey = c.getColumnIndexOrThrow("s3key")
            val iName = c.getColumnIndexOrThrow("display_name")
            val iSize = c.getColumnIndexOrThrow("size_bytes")
            val iUp = c.getColumnIndexOrThrow("upload_id")
            val iStatus = c.getColumnIndexOrThrow("status")
            val iErr = c.getColumnIndexOrThrow("error")
            val iUpBytes = c.getColumnIndexOrThrow("uploaded_bytes")
            val iCt = c.getColumnIndexOrThrow("content_type")
            val iCreated = c.getColumnIndexOrThrow("created_at")
            val iUpdated = c.getColumnIndexOrThrow("updated_at")
            while (c.moveToNext()) {
                list.add(
                    ItemRow(
                        id = c.getString(iId),
                        uri = c.getString(iUri),
                        key = c.getString(iKey),
                        displayName = c.getString(iName),
                        sizeBytes = c.getLong(iSize),
                        uploadId = if (c.isNull(iUp)) null else c.getString(iUp),
                        status = c.getString(iStatus),
                        error = if (c.isNull(iErr)) null else c.getString(iErr),
                        uploadedBytes = c.getLong(iUpBytes),
                        contentType = if (c.isNull(iCt)) null else c.getString(iCt),
                        createdAt = c.getLong(iCreated),
                        updatedAt = c.getLong(iUpdated),
                    ),
                )
            }
        }
        return list
    }

    companion object {
        @Volatile
        private var instance: UploadDb? = null

        fun get(context: Context): UploadDb =
            instance ?: synchronized(this) {
                instance ?: UploadDb(context).also { instance = it }
            }
    }
}
