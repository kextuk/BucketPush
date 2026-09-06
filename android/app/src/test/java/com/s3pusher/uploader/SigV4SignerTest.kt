package com.s3pusher.uploader

import org.junit.Assert.assertEquals
import org.junit.Test
import java.util.Date

/**
 * Vecteurs officiels AWS (doc "Authenticating Requests: Using the Authorization Header
 * (AWS Signature Version 4)", exemples S3). Miroir de scripts/sigv4-reference.js.
 */
class SigV4SignerTest {

    private val ak = "AKIAIOSFODNN7EXAMPLE"
    private val sk = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
    private val region = "us-east-1"

    @Test
    fun getObjectWithRange() {
        val signed = SigV4Signer.sign(
            method = "GET",
            path = "/test.txt",
            query = emptyMap(),
            headers = mapOf(
                "host" to "examplebucket.s3.amazonaws.com",
                "range" to "bytes=0-9",
                "x-amz-content-sha256" to SigV4Signer.EMPTY_SHA256,
                "x-amz-date" to "20130524T000000Z",
            ),
            payloadHash = SigV4Signer.EMPTY_SHA256,
            accessKeyId = ak,
            secretAccessKey = sk,
            region = region,
            amzDate = "20130524T000000Z",
        )
        assertEquals(
            "f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
            signed.signature,
        )
    }

    @Test
    fun putObject() {
        val body = "Welcome to Amazon S3."
        val signed = SigV4Signer.sign(
            method = "PUT",
            path = "/test\$file.text",
            query = emptyMap(),
            headers = mapOf(
                "host" to "examplebucket.s3.amazonaws.com",
                "date" to "Fri, 24 May 2013 00:00:00 GMT",
                "x-amz-content-sha256" to SigV4Signer.sha256Hex(body),
                "x-amz-date" to "20130524T000000Z",
                "x-amz-storage-class" to "REDUCED_REDUNDANCY",
            ),
            payloadHash = SigV4Signer.sha256Hex(body),
            accessKeyId = ak,
            secretAccessKey = sk,
            region = region,
            amzDate = "20130524T000000Z",
        )
        assertEquals(
            "98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd",
            signed.signature,
        )
    }

    @Test
    fun uriEncoding() {
        assertEquals("a%20b", SigV4Signer.uriEncode("a b", encodeSlash = true))
        assertEquals("a/b", SigV4Signer.uriEncode("a/b", encodeSlash = false))
        assertEquals("a%2Fb", SigV4Signer.uriEncode("a/b", encodeSlash = true))
        assertEquals("a~b", SigV4Signer.uriEncode("a~b", encodeSlash = true))
        assertEquals("caf%C3%A9", SigV4Signer.uriEncode("café", encodeSlash = true))
    }

    @Test
    fun canonicalQueryIsSorted() {
        assertEquals(
            "partNumber=2&uploadId=abc%2Fdef",
            SigV4Signer.canonicalQueryString(mapOf("uploadId" to "abc/def", "partNumber" to "2")),
        )
    }

    @Test
    fun amzDateFormat() {
        assertEquals("20130524T000000Z", SigV4Signer.amzDate(Date(1369353600000L)))
    }
}
