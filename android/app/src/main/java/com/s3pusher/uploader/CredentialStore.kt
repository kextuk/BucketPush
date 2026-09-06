package com.s3pusher.uploader

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import org.json.JSONObject

/**
 * Stockage chiffré de la configuration S3 (secrets inclus).
 *
 * Écrit par `configure()` côté JS ; relu par [UploadQueueWorker] pour permettre la reprise
 * en arrière-plan après la mort du process, sans JS attaché.
 *
 * En cas d'échec d'init du chiffrement (rare, appareils exotiques) on retombe sur des
 * SharedPreferences privées classiques (stockage app-private, `allowBackup=false`).
 */
class CredentialStore(context: Context) {

    private val prefs: SharedPreferences = runCatching {
        val key = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context,
            "s3pusher_secure",
            key,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }.getOrElse {
        context.getSharedPreferences("s3pusher_fallback", Context.MODE_PRIVATE)
    }

    fun save(config: S3Config) {
        val json = JSONObject().apply {
            put("endpoint", config.endpoint)
            put("region", config.region)
            put("bucket", config.bucket)
            put("accessKeyId", config.accessKeyId)
            put("secretAccessKey", config.secretAccessKey)
            put("forcePathStyle", config.forcePathStyle)
            config.partSizeBytes?.let { put("partSizeBytes", it) }
            put("maxConcurrentParts", config.maxConcurrentParts)
            put("maxConcurrentFiles", config.maxConcurrentFiles)
            put("wifiOnly", config.wifiOnly)
        }
        prefs.edit().putString(KEY_CONFIG, json.toString()).apply()
    }

    fun load(): S3Config? {
        val raw = prefs.getString(KEY_CONFIG, null) ?: return null
        return runCatching {
            val j = JSONObject(raw)
            S3Config(
                endpoint = j.getString("endpoint"),
                region = j.getString("region"),
                bucket = j.getString("bucket"),
                accessKeyId = j.getString("accessKeyId"),
                secretAccessKey = j.getString("secretAccessKey"),
                forcePathStyle = j.optBoolean("forcePathStyle", true),
                partSizeBytes = if (j.has("partSizeBytes")) j.getLong("partSizeBytes") else null,
                maxConcurrentParts = j.optInt("maxConcurrentParts", 2),
                maxConcurrentFiles = j.optInt("maxConcurrentFiles", 1),
                wifiOnly = j.optBoolean("wifiOnly", false),
            )
        }.getOrNull()
    }

    fun clear() = prefs.edit().remove(KEY_CONFIG).apply()

    private companion object {
        const val KEY_CONFIG = "config_v1"
    }
}
