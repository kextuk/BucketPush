package com.s3pusher.uploader

import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/**
 * Configuration S3. Les secrets (accessKeyId / secretAccessKey) sont conservés par
 * [CredentialStore] ; le reste est passé à chaque `enqueue`/worker.
 */
data class S3Config(
    val endpoint: String,
    val region: String,
    val bucket: String,
    val accessKeyId: String,
    val secretAccessKey: String,
    val forcePathStyle: Boolean = true,
    val partSizeBytes: Long? = null,
    val maxConcurrentParts: Int = 2,
    val maxConcurrentFiles: Int = 1,
    val wifiOnly: Boolean = false,
    val skipExisting: Boolean = true,
    val moveConcurrency: Int = 4,
) {
    val endpointUrl: HttpUrl =
        requireNotNull(endpoint.trim().trimEnd('/').toHttpUrlOrNull()) {
            "endpoint invalide : $endpoint"
        }

    /**
     * URL de base d'un objet. Les segments sont pré-encodés avec le MÊME encodeur que
     * la signature (SigV4Signer.uriEncode) pour que le chemin envoyé corresponde
     * exactement au canonical URI signé — OkHttp encode différemment ('+', '$', ':'…).
     */
    fun objectUrl(key: String): HttpUrl {
        val b = endpointUrl.newBuilder()
        if (forcePathStyle) {
            b.addEncodedPathSegment(SigV4Signer.uriEncode(bucket, encodeSlash = true))
        } else {
            b.host("$bucket.${endpointUrl.host}")
        }
        for (seg in key.split('/')) {
            b.addEncodedPathSegment(SigV4Signer.uriEncode(seg, encodeSlash = true))
        }
        return b.build()
    }

    /** URL du bucket (pour les opérations bucket-level : HEAD bucket). */
    fun bucketUrl(): HttpUrl {
        val b = endpointUrl.newBuilder()
        if (forcePathStyle) {
            b.addEncodedPathSegment(SigV4Signer.uriEncode(bucket, encodeSlash = true))
        } else {
            b.host("$bucket.${endpointUrl.host}")
        }
        return b.build()
    }

    /** Chemin canonique (pour SigV4), style path ou virtual-hosted. */
    fun canonicalPath(key: String): String =
        if (forcePathStyle) "/$bucket/$key" else "/$key"

    fun canonicalBucketPath(): String = if (forcePathStyle) "/$bucket" else "/"

    fun hostHeader(virtualHosted: Boolean = !forcePathStyle): String {
        val host = if (virtualHosted) "$bucket.${endpointUrl.host}" else endpointUrl.host
        val port = endpointUrl.port
        val isDefault =
            (endpointUrl.scheme == "https" && port == 443) ||
                (endpointUrl.scheme == "http" && port == 80)
        return if (isDefault) host else "$host:$port"
    }

    companion object {
        fun fromMap(m: Map<String, Any?>): S3Config = S3Config(
            endpoint = m["endpoint"] as String,
            region = m["region"] as String,
            bucket = m["bucket"] as String,
            accessKeyId = m["accessKeyId"] as String,
            secretAccessKey = m["secretAccessKey"] as String,
            forcePathStyle = (m["forcePathStyle"] as? Boolean) ?: true,
            partSizeBytes = (m["partSizeBytes"] as? Number)?.toLong(),
            maxConcurrentParts = (m["maxConcurrentParts"] as? Number)?.toInt() ?: 2,
            maxConcurrentFiles = (m["maxConcurrentFiles"] as? Number)?.toInt() ?: 1,
            wifiOnly = (m["wifiOnly"] as? Boolean) ?: false,
            skipExisting = (m["skipExisting"] as? Boolean) ?: true,
            moveConcurrency = (m["moveConcurrency"] as? Number)?.toInt() ?: 4,
        )
    }
}
