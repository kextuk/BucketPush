package com.s3pusher.uploader

/**
 * Découpage d'un fichier en parts pour l'upload multipart S3.
 *
 * Pur, sans dépendance Android → testable en JVM (voir PartPlanTest).
 */
object PartPlan {

    const val MIN_PART_SIZE = 5L * 1024 * 1024          // 5 MiB : minimum S3 (sauf dernière part)
    const val DEFAULT_PART_SIZE = 32L * 1024 * 1024     // 32 MiB par défaut
    const val MAX_PARTS = 10_000L                       // limite S3
    private const val TARGET_MAX_PARTS = 9_000L         // marge sous la limite
    private const val EIGHT_MIB = 8L * 1024 * 1024

    data class Part(val number: Int, val offset: Long, val size: Long)

    /**
     * Taille de part effective : au moins la valeur configurée (ou défaut), jamais sous 5 MiB,
     * agrandie si besoin pour rester sous ~9000 parts, arrondie au multiple de 8 MiB supérieur.
     */
    fun partSize(fileSize: Long, configured: Long?): Long {
        val base = (configured ?: DEFAULT_PART_SIZE).coerceAtLeast(MIN_PART_SIZE)
        val needed = ceilDiv(fileSize, TARGET_MAX_PARTS)
        // n'agrandir (et aligner sur 8 MiB) que si la limite de parts l'impose
        return if (needed <= base) base else ceilTo(needed, EIGHT_MIB)
    }

    fun plan(fileSize: Long, configured: Long?): List<Part> {
        if (fileSize <= 0L) return emptyList()
        val ps = partSize(fileSize, configured)
        val parts = ArrayList<Part>()
        var offset = 0L
        var number = 1
        while (offset < fileSize) {
            val size = minOf(ps, fileSize - offset)
            parts.add(Part(number, offset, size))
            offset += size
            number++
        }
        return parts
    }

    private fun ceilDiv(a: Long, b: Long): Long = if (b <= 0) 0 else (a + b - 1) / b
    private fun ceilTo(a: Long, unit: Long): Long = ceilDiv(a, unit) * unit
}
