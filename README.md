# BucketPush — S3 browser & heavy-file transfers

Android app (React Native, no Expo): an **S3-compatible bucket browser** plus
**very large file transfers** (> 10 GB, batches of hundreds of GB) that run
**without crashing** and **in the background**.

- Application ID: `app.bucketpush.android` · code package: `com.s3pusher` (kept as-is)
- 🇫🇷 [README en français](README_FR.md)
- 📖 [User guide](https://kextuk.github.io/BucketPush/guide.html) · 🔒 [Privacy policy](https://kextuk.github.io/BucketPush/privacy.html)

> **Fully vibe-coded.** This project was written almost entirely by prompting an
> AI assistant, iteratively, with the author reviewing and running the builds.
> It works and it ships to the Play Store, but treat the code accordingly.

## Why

File bytes **never** pass through the JavaScript heap — that is what makes
S3Drive-style apps OOM on a long list of large files. All the heavy I/O lives in
a **native Kotlin module**:

- **S3 multipart upload** (`CreateMultipartUpload` → `UploadPart` ×N → `CompleteMultipartUpload`).
- Each part is **streamed from disk** (`RangeRequestBody`: `content://` +
  `openFileDescriptor` + `FileChannel.position`), 64 KiB buffer → **constant memory**
  regardless of file size or count.
- **Hand-rolled SigV4** (OkHttp, `x-amz-content-sha256: UNSIGNED-PAYLOAD` for parts →
  no re-read to sign).
- **WorkManager + Foreground Service (`dataSync`)** — the upload keeps going with the
  screen locked, the app closed, or the process killed.
- **Strict resume** — parts persisted in SQLite + `ListParts` on restart; on
  `NoSuchUpload` the multipart is recreated. An interrupted transfer picks up
  part by part, never from the start of the file.
- **Retry** with exponential backoff + jitter per part; bounded part and file concurrency.

The JS layer is UI, file picking (`@react-native-documents/picker`, `open` mode +
`requestLongTermAccess` → no local copy, permission persisted), and queue control.

## Requirements

- Node 20+ (the project declares `>= 22.11`).
- JDK 17, Android SDK, an Android device/emulator (minSdk 24).

## Run (dev)

```bash
npm install
npx react-native run-android        # debug build + install + Metro
```

On first launch: open **Settings**, fill in endpoint / region / bucket / keys,
"Test connection", then **Add files**.

## Release build

```bash
tools/build-apk.sh [abi]          # standalone APK -> app/build/outputs/apk/release/app-release.apk
tools/build-aab.sh               # Play bundle    -> app/build/outputs/bundle/release/app-release.aab
tools/install-adb.sh [--build] [abi] [-s serial]   # push the release APK to a USB device + launch
```

`abi` (e.g. `arm64-v8a`) limits architectures → shorter build for testing.

> Signing: if `~/.gradle/gradle.properties` defines `BUCKETPUSH_STORE_FILE` /
> `_KEY_ALIAS` / `_STORE_PASSWORD` / `_KEY_PASSWORD`, the upload key is used;
> otherwise Gradle falls back to the debug key (rejected by the Play Store).

## Tests

```bash
npm test                              # JS unit tests (no device)
node scripts/sigv4-reference.js       # SigV4 reference impl vs official AWS vectors
cd android && ./gradlew testDebugUnitTest   # Kotlin JVM tests (no device)
```

`scripts/sigv4-reference.js` is the **executable spec** of the signature;
`SigV4Signer.kt` is a line-by-line port. Kotlin tests: `SigV4SignerTest` (AWS
vectors), `PartPlanTest` (part planning, 10 000-part cap, adaptive sizes).

## Project layout

```
src/
  native/S3Uploader.ts     Typed bridge to the native module + events
  profiles.ts / prefs.ts   Pure logic: connection profiles + inherited transfer settings (unit-tested)
  config.ts                Keychain: profiles + active profile + per-profile credentials
  keys.ts / format.ts      Key generation · bytes / speed (EWMA) / ETA
  i18n.ts                  FR/EN dictionaries + t() + live language switch
  useUploader.ts           Hook: queue state, native event subscription
  screens/                 Browser (home), Queue, Profiles, per-profile Settings, global Settings, Versions
  components/               Sheets, AboutModal, ProvidersModal, settings controls

android/app/src/main/java/com/s3pusher/uploader/
  S3UploaderModule.kt      @ReactMethod surface: configure / enqueue / pause / resume / cancel / …
  SigV4Signer.kt           AWS Signature V4 (service s3)
  RangeRequestBody.kt      OkHttp body streaming a byte range from a content:// URI
  S3Client.kt              create / uploadPart / listParts / complete / abort / list / versions / purge / …
  MultipartUploader.kt     Per-file orchestration (concurrency, retry, resume)
  UploadQueueWorker.kt     CoroutineWorker + Foreground Service (dataSync)
  UploadControl.kt         Shared state (pause / cancellations) + event bus
  CredentialStore.kt       Encrypted config (EncryptedSharedPreferences)
  UploadDb.kt              SQLite: upload_item, upload_part
  PartPlan.kt              Adaptive part sizing
```

A separate experimental **Tauri desktop port** lives on the `tauri-desktop`
branch under `tauri-app/` (reuses the pure TS core, S3 engine rewritten in
Rust). Rough, not feature-complete.

## Known limits (v1)

- **Non-seekable SAF providers** (rare): the offset seek fails → the item errors out
  with an explicit message.
- **Foreground Service `dataSync` 6 h/day cap (Android 15)**: a multi-hundred-GB session
  can be suspended by the OS; it resumes when the app is reopened.
- Endpoints with a **base path** (`https://host/v1`) are not handled (canonical path).
- **Device clock**: if it drifts, S3 returns `RequestTimeTooSkewed`.
- iOS: not implemented (phase 2, Swift `NSURLSession` background module, same JS API).

## License

Source-available — see [`LICENSE`](LICENSE). In short: free to use, modify and
redistribute (including inside a company), but **you may not sell it** — no
selling the software or a derivative, and no turning it into a paid product or
service, without written permission. This is **not** an OSI open-source license.
