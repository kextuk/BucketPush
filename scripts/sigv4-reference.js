/**
 * Implémentation de référence AWS Signature V4 (service "s3").
 *
 * Sert de spec exécutable : la version Kotlin (SigV4Signer.kt) est un portage
 * ligne à ligne de ces fonctions. Validé contre les vecteurs officiels AWS
 * ("Examples of a signed request" de la doc S3) — voir le bloc `runTests()` en bas.
 *
 * Usage : node scripts/sigv4-reference.js
 */

'use strict';
/* eslint-env node */

const crypto = require('crypto');

const ALGORITHM = 'AWS4-HMAC-SHA256';
const SERVICE = 's3';
const AWS4_REQUEST = 'aws4_request';

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

function hmac(key, data) {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}

/**
 * Encodage RFC 3986. Non réservés : A-Z a-z 0-9 - _ . ~
 * `encodeSlash=false` conserve les '/' (canonical URI d'un chemin).
 */
function uriEncode(str, encodeSlash) {
  let out = '';
  for (const ch of str) {
    // itération par point de code (le portage Kotlin fait de même)
    if (
      (ch >= 'A' && ch <= 'Z') ||
      (ch >= 'a' && ch <= 'z') ||
      (ch >= '0' && ch <= '9') ||
      ch === '-' ||
      ch === '_' ||
      ch === '.' ||
      ch === '~'
    ) {
      out += ch;
    } else if (ch === '/' && !encodeSlash) {
      out += '/';
    } else {
      const bytes = Buffer.from(ch, 'utf8');
      for (const b of bytes) {
        out += '%' + b.toString(16).toUpperCase().padStart(2, '0');
      }
    }
  }
  return out;
}

/** canonical URI S3 : chaque segment encodé une fois, '/' conservés, pas de normalisation. */
function canonicalUri(path) {
  if (!path || path === '') return '/';
  return path
    .split('/')
    .map(seg => uriEncode(seg, true))
    .join('/');
}

/** query : clés triées, `k=v` encodés (slash inclus), jointes par '&'. */
function canonicalQueryString(params) {
  const keys = Object.keys(params).sort();
  return keys
    .map(k => uriEncode(k, true) + '=' + uriEncode(String(params[k]), true))
    .join('&');
}

/**
 * @param {object} p
 * @param {string} p.method
 * @param {string} p.path            chemin brut, ex "/mon-bucket/dossier/fichier.bin"
 * @param {object} p.query           map clé->valeur (peut être {})
 * @param {object} p.headers         headers à signer (host + x-amz-* au minimum)
 * @param {string} p.payloadHash     hex(sha256(body)) | "UNSIGNED-PAYLOAD"
 * @param {string} p.accessKeyId
 * @param {string} p.secretAccessKey
 * @param {string} p.region
 * @param {string} p.amzDate         format YYYYMMDD'T'HHMMSS'Z'
 * @returns {{authorization:string, signedHeaders:string, signature:string, canonicalRequest:string, stringToSign:string}}
 */
function sign(p) {
  const dateStamp = p.amzDate.slice(0, 8);
  const credentialScope = `${dateStamp}/${p.region}/${SERVICE}/${AWS4_REQUEST}`;

  // headers canoniques : nom en minuscule, valeur trim, triés par nom
  const lowered = {};
  for (const name of Object.keys(p.headers)) {
    lowered[name.toLowerCase()] = String(p.headers[name]).trim().replace(/\s+/g, ' ');
  }
  const headerNames = Object.keys(lowered).sort();
  const canonicalHeaders = headerNames.map(n => `${n}:${lowered[n]}\n`).join('');
  const signedHeaders = headerNames.join(';');

  const canonicalRequest = [
    p.method,
    canonicalUri(p.path),
    canonicalQueryString(p.query || {}),
    canonicalHeaders,
    signedHeaders,
    p.payloadHash,
  ].join('\n');

  const stringToSign = [
    ALGORITHM,
    p.amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const kDate = hmac('AWS4' + p.secretAccessKey, dateStamp);
  const kRegion = hmac(kDate, p.region);
  const kService = hmac(kRegion, SERVICE);
  const kSigning = hmac(kService, AWS4_REQUEST);
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  const authorization =
    `${ALGORITHM} Credential=${p.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return { authorization, signedHeaders, signature, canonicalRequest, stringToSign };
}

module.exports = { sign, uriEncode, canonicalUri, canonicalQueryString, sha256Hex };

// ---------------------------------------------------------------------------
// Vecteurs officiels AWS — doc "Authenticating Requests: Using the Authorization
// Header (AWS Signature Version 4)" / exemples S3.
// ---------------------------------------------------------------------------
function runTests() {
  const AK = 'AKIAIOSFODNN7EXAMPLE';
  const SK = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
  const REGION = 'us-east-1';
  const EMPTY_SHA = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

  let pass = 0;
  let fail = 0;
  const check = (name, got, want) => {
    if (got === want) {
      pass++;
      console.log(`  ok   ${name}`);
    } else {
      fail++;
      console.log(`  FAIL ${name}\n       attendu : ${want}\n       obtenu  : ${got}`);
    }
  };

  // Vecteur 1 : GET Object avec Range (doc AWS "Example: GET Object")
  const v1 = sign({
    method: 'GET',
    path: '/test.txt',
    query: {},
    headers: {
      host: 'examplebucket.s3.amazonaws.com',
      range: 'bytes=0-9',
      'x-amz-content-sha256': EMPTY_SHA,
      'x-amz-date': '20130524T000000Z',
    },
    payloadHash: EMPTY_SHA,
    accessKeyId: AK,
    secretAccessKey: SK,
    region: REGION,
    amzDate: '20130524T000000Z',
  });
  check(
    'GET Object (Range) — signature',
    v1.signature,
    'f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
  );

  // Vecteur 2 : PUT Object (doc AWS "Example: PUT Object")
  const body = 'Welcome to Amazon S3.';
  const v2 = sign({
    method: 'PUT',
    path: '/test%24file.text'.replace(/%24/g, '$'), // clé "test$file.text"
    query: {},
    headers: {
      host: 'examplebucket.s3.amazonaws.com',
      date: 'Fri, 24 May 2013 00:00:00 GMT',
      'x-amz-content-sha256': sha256Hex(body),
      'x-amz-date': '20130524T000000Z',
      'x-amz-storage-class': 'REDUCED_REDUNDANCY',
    },
    payloadHash: sha256Hex(body),
    accessKeyId: AK,
    secretAccessKey: SK,
    region: REGION,
    amzDate: '20130524T000000Z',
  });
  check(
    'PUT Object — signature',
    v2.signature,
    '98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd',
  );

  // Vecteur 3 : encodage URI
  check('uriEncode espace', uriEncode('a b', true), 'a%20b');
  check('uriEncode slash gardé', uriEncode('a/b', false), 'a/b');
  check('uriEncode slash encodé', uriEncode('a/b', true), 'a%2Fb');
  check('uriEncode tilde', uriEncode('a~b', true), 'a~b');
  check(
    'canonicalQueryString tri',
    canonicalQueryString({ uploadId: 'abc/def', partNumber: 2 }),
    'partNumber=2&uploadId=abc%2Fdef',
  );

  console.log(`\n${pass} ok, ${fail} fail`);
  process.exit(fail === 0 ? 0 : 1);
}

if (require.main === module) runTests();
