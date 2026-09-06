# BucketPush — S3 Browser & heavy transfer

Application Android (React Native, sans Expo) : **navigateur de bucket S3‑compatible** +
transfert de **très gros fichiers** (> 10 Go, lots de centaines de Go) **sans crash** et
**en arrière-plan**.

- ID application : `app.bucketpush.android` · package de code : `com.s3pusher` (inchangé)

## Principe

Le contenu des fichiers ne transite **jamais** par le tas JavaScript (c'est ce qui fait
crasher les solutions type S3Drive sur une longue liste de gros fichiers). Tout l'I/O
lourd est fait dans un **module natif Kotlin** :

- Upload **S3 multipart** (`CreateMultipartUpload` → `UploadPart` ×N → `CompleteMultipartUpload`).
- Chaque part est **streamée depuis le disque** (`RangeRequestBody` : `content://` +
  `openFileDescriptor` + `FileChannel.position`), buffer 64 KiB → **mémoire constante**
  quelle que soit la taille / le nombre de fichiers.
- **Signature SigV4 faite main** (OkHttp, `x-amz-content-sha256: UNSIGNED-PAYLOAD` pour les
  parts → aucune relecture pour signer).
- **WorkManager + Foreground Service (`dataSync`)** : l'upload continue écran verrouillé /
  app fermée / process tué.
- **Reprise stricte** : parts persistées en SQLite + `ListParts` au redémarrage ; sur
  `NoSuchUpload` le multipart est recréé.
- **Retry** exponentiel + jitter par part ; concurrence de parts et de fichiers bornées.

La couche JS = UI (2 écrans), sélection de fichiers (`@react-native-documents/picker`,
mode `open` + `requestLongTermAccess` → pas de copie, permission persistée), pilotage.

## Prérequis

- Node 20+ (le projet déclare `>= 22.11`).
- JDK 17, Android SDK, un appareil/emulateur Android (minSdk 24).

## Lancer en dev

```bash
npm install
npx react-native run-android        # build debug + install + Metro
```

Au premier lancement : ouvrir **Config**, renseigner endpoint / region / bucket / clés,
« Tester la connexion », puis **Ajouter des fichiers**.

## Build release (APK)

```bash
cd android
./gradlew assembleRelease           # android/app/build/outputs/apk/release/
```

> La signature release utilise la `debug.keystore` du template. Générer une vraie clé
> pour une vraie distribution (voir la doc RN "Signed APK").

## Tests

```bash
# JS (pur, sans device)
npm test

# Signature SigV4 — implémentation de référence contre les vecteurs officiels AWS
node scripts/sigv4-reference.js

# Kotlin (JVM, sans device)
cd android && ./gradlew testDebugUnitTest
```

`scripts/sigv4-reference.js` est la **spec exécutable** de la signature ; `SigV4Signer.kt`
en est le portage ligne à ligne. Tests Kotlin : `SigV4SignerTest` (vecteurs AWS),
`PartPlanTest` (découpage, limite 10 000 parts, tailles adaptatives).

## Vérification d'intégration (manuelle, avec un bucket de test)

1. Uploader un fichier > 6 Go ; couper le réseau en cours → l'upload doit reprendre seul.
2. Pendant l'upload, tuer l'app depuis les récents → à la réouverture, `getState()`
   réhydrate et le worker reprend les parts manquantes.
3. À la fin : `aws s3api head-object --endpoint-url … --bucket … --key …` (ou `mc stat`) →
   taille identique, objet multipart complété.
4. Tester un lot de plusieurs fichiers volumineux à la suite (RAM stable, pas d'OOM).

## Architecture des fichiers

```
src/
  native/S3Uploader.ts     Pont typé vers le module natif + événements
  profiles.ts              Logique pure des profils de connexion (test unitaire)
  config.ts                Trousseau : profils S3 + profil actif + credentials par profil
  keys.ts                  Génération des clés S3 (préfixe, horodatage, anti-collision)
  format.ts                Octets / débit (EWMA) / ETA
  useUploader.ts           Hook : état de la file, abonnement aux événements natifs
  screens/QueueScreen.tsx  File d'attente + ajout de fichiers
  screens/ProfilesScreen.tsx  Gestion des profils (créer / basculer / dupliquer / supprimer)
  screens/SettingsScreen.tsx  Édition d'un profil S3
  screens/BrowserScreen.tsx   Navigateur de bucket (lecture + suppression)

android/app/src/main/java/com/s3pusher/uploader/
  S3UploaderModule.kt      @ReactMethod : configure / enqueue / pause / resume / cancel / …
  S3UploaderPackage.kt     Enregistré dans MainApplication.kt
  SigV4Signer.kt           AWS Signature V4 (service s3)
  RangeRequestBody.kt      Corps OkHttp streamant une plage d'octets d'un content:// URI
  S3Client.kt              create / uploadPart / listParts / complete / abort / headBucket
  MultipartUploader.kt     Orchestration par fichier (concurrence, retry, reprise)
  UploadQueueWorker.kt     CoroutineWorker + Foreground Service (dataSync)
  UploadControl.kt         État partagé (pause / annulations) + bus d'événements
  CredentialStore.kt       Config chiffrée (EncryptedSharedPreferences)
  UploadDb.kt              SQLite : upload_item, upload_part
  PartPlan.kt              Découpage adaptatif en parts
```

## Limites connues (v1)

- **Providers SAF non-seekable** (rares, ex. certains fournisseurs cloud) : le seek par
  offset échoue → l'item passe en erreur avec un message explicite.
- **Cap Foreground Service `dataSync` 6 h/jour (Android 15)** : une session de plusieurs
  centaines de Go peut être suspendue par l'OS ; elle reprend à la réouverture de l'app.
- Endpoint avec un **chemin de base** (`https://host/v1`) non géré (chemin canonique).
- **Horloge de l'appareil** : si elle dérive, S3 renvoie `RequestTimeTooSkewed`.
- iOS : non implémenté (phase 2, module Swift `NSURLSession` background, même API JS).

## Si le build casse

- `androidx.security:security-crypto:1.1.0-alpha06` est la dépendance la plus fragile.
  `CredentialStore` retombe à l'exécution sur des `SharedPreferences` privées si le
  chiffrement échoue, mais la dépendance doit résoudre au build. En cas de souci, la
  retirer et remplacer le corps de `CredentialStore` par un `getSharedPreferences(...,
  MODE_PRIVATE)` (l'app a déjà `allowBackup=false`).
- Module natif introuvable côté JS : `npx react-native run-android` reconstruit bien le
  natif (pas seulement Metro).
