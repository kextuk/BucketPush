package com.s3pusher.uploader

import android.content.ContentResolver
import android.net.Uri
import okhttp3.MediaType
import okhttp3.RequestBody
import okio.BufferedSink
import java.io.FileInputStream
import java.io.IOException

/**
 * Corps de requête OkHttp qui streame **une plage d'octets** d'un fichier `content://`
 * sans jamais la charger en mémoire.
 *
 * Mémoire de travail = un buffer de [BUFFER_SIZE]. Le descripteur est (r)ouvert à chaque
 * appel de [writeTo] (une fois par tentative de part) et repositionné via `channel.position`.
 *
 * @param onBytesWritten callback de progression (octets cumulés écrits sur cet appel).
 */
class RangeRequestBody(
    private val resolver: ContentResolver,
    private val uri: Uri,
    private val offset: Long,
    private val length: Long,
    private val onBytesWritten: ((Long) -> Unit)? = null,
) : RequestBody() {

    override fun contentType(): MediaType? = null

    override fun contentLength(): Long = length

    override fun isOneShot(): Boolean = false // OkHttp peut rappeler writeTo lors d'un retry

    override fun writeTo(sink: BufferedSink) {
        val pfd = resolver.openFileDescriptor(uri, "r")
            ?: throw IOException("openFileDescriptor a renvoyé null pour $uri")
        pfd.use {
            FileInputStream(it.fileDescriptor).use { fis ->
                try {
                    fis.channel.position(offset)
                } catch (e: Exception) {
                    throw IOException(
                        "Fichier non repositionnable (provider SAF non-seekable) : $uri", e,
                    )
                }
                val buf = ByteArray(BUFFER_SIZE)
                var remaining = length
                var written = 0L
                while (remaining > 0L) {
                    val toRead = minOf(buf.size.toLong(), remaining).toInt()
                    val read = fis.read(buf, 0, toRead)
                    if (read == -1) {
                        throw IOException(
                            "Fin de fichier prématurée : manque ${remaining} octets sur $uri",
                        )
                    }
                    sink.write(buf, 0, read)
                    remaining -= read
                    written += read
                    onBytesWritten?.invoke(written)
                }
            }
        }
    }

    private companion object {
        const val BUFFER_SIZE = 64 * 1024
    }
}
