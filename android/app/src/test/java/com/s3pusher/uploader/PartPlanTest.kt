package com.s3pusher.uploader

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PartPlanTest {

    private val MIB = 1024L * 1024L
    private val GIB = 1024L * MIB

    @Test
    fun smallFileIsOnePart() {
        val plan = PartPlan.plan(3 * MIB, null)
        assertEquals(1, plan.size)
        assertEquals(0L, plan[0].offset)
        assertEquals(3 * MIB, plan[0].size)
    }

    @Test
    fun exactMultipleOfPartSize() {
        val ps = PartPlan.partSize(64 * MIB, 32 * MIB)
        assertEquals(32 * MIB, ps)
        val plan = PartPlan.plan(64 * MIB, 32 * MIB)
        assertEquals(2, plan.size)
        assertEquals(32 * MIB, plan[0].size)
        assertEquals(32 * MIB, plan[1].size)
        assertEquals(32 * MIB, plan[1].offset)
    }

    @Test
    fun lastPartIsRemainder() {
        val plan = PartPlan.plan(70 * MIB, 32 * MIB)
        assertEquals(3, plan.size)
        assertEquals(6 * MIB, plan.last().size)
        assertEquals(plan.sumOf { it.size }, 70 * MIB)
    }

    @Test
    fun configuredBelowMinIsClamped() {
        assertEquals(PartPlan.MIN_PART_SIZE, PartPlan.partSize(100 * MIB, 1 * MIB))
    }

    @Test
    fun hugeFileStaysUnderPartLimit() {
        for (sizeGib in listOf(100L, 400L, 500L, 1024L)) {
            val fileSize = sizeGib * GIB
            val plan = PartPlan.plan(fileSize, null)
            assertTrue(
                "taille $sizeGib GiB -> ${plan.size} parts",
                plan.size <= PartPlan.MAX_PARTS,
            )
            assertEquals(fileSize, plan.sumOf { it.size })
            // parts contiguës
            var expected = 0L
            for (p in plan) {
                assertEquals(expected, p.offset)
                expected += p.size
            }
        }
    }

    @Test
    fun partNumbersStartAtOneAndIncrement() {
        val plan = PartPlan.plan(200 * MIB, 32 * MIB)
        plan.forEachIndexed { i, p -> assertEquals(i + 1, p.number) }
    }

    @Test
    fun partSizeRoundedTo8Mib() {
        val ps = PartPlan.partSize(500 * GIB, null)
        assertEquals(0L, ps % (8 * MIB))
    }
}
