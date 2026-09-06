import { NativeEventEmitter, NativeModules } from 'react-native';

const LINKING_ERROR =
  "Le module natif 'S3Uploader' est introuvable. Reconstruis l'app (npx react-native run-android) " +
  'après avoir ajouté le module Kotlin.';

const S3UploaderNative = NativeModules.S3Uploader
  ? NativeModules.S3Uploader
  : new Proxy(
      {},
      {
        get() {
          throw new Error(LINKING_ERROR);
        },
      },
    );

const emitter = new NativeEventEmitter(S3UploaderNative);

export type S3Config = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  partSizeBytes?: number;
  maxConcurrentParts?: number;
  maxConcurrentFiles?: number;
  wifiOnly?: boolean;
  skipExisting?: boolean;
  moveConcurrency?: number;
};

export type EnqueueResult = {
  queued: number;
  skippedInQueue: number;
  skippedExisting: number;
};

export type S3ListEntry = { key: string; size: number; lastModified?: string };
export type S3ListResult = {
  prefixes: string[];
  objects: S3ListEntry[];
  nextToken?: string;
};

export type TreeFile = {
  uri: string;
  name: string;
  relativePath: string;
  size: number;
  mimeType?: string;
};

export type ObjectVersion = {
  key: string;
  versionId: string;
  size: number;
  lastModified?: string;
  isLatest: boolean;
  isDeleteMarker: boolean;
};

export type VersionsResult = {
  prefixes: string[];
  versions: ObjectVersion[];
  nextKeyMarker?: string;
  nextVersionIdMarker?: string;
};

export type UploadItemInput = {
  id: string;
  uri: string;
  key: string;
  displayName: string;
  sizeBytes: number;
  contentType?: string;
};

export type ItemStatus =
  | 'queued'
  | 'uploading'
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'paused'
  | 'skipped';

export type QueueStatus = 'idle' | 'running' | 'paused';

export type UploadItemState = {
  id: string;
  uri: string;
  key: string;
  displayName: string;
  sizeBytes: number;
  uploadedBytes: number;
  status: ItemStatus;
  error?: string;
};

export type ProgressEvent = {
  id: string;
  uploadedBytes: number;
  totalBytes: number;
  partsCompleted: number;
  partsTotal: number;
};

export type ItemStatusEvent = { id: string; status: ItemStatus; error?: string };
export type QueueStatusEvent = { status: QueueStatus; activeCount: number };

export type MovePair = { src: string; dst: string };
export type MoveResult = { moved: number; failed: number; errors: string[] };
export type MoveProgressEvent = {
  filesDone: number;
  filesTotal: number;
  bytesCopied: number;
  bytesTotal: number;
  currentName: string;
};

export const S3Uploader = {
  configure(config: S3Config): Promise<void> {
    return S3UploaderNative.configure(config);
  },
  testConnection(): Promise<{ ok: boolean; error?: string }> {
    return S3UploaderNative.testConnection();
  },
  enqueue(items: UploadItemInput[]): Promise<EnqueueResult> {
    return S3UploaderNative.enqueue(items);
  },
  listObjects(prefix: string, continuationToken?: string): Promise<S3ListResult> {
    return S3UploaderNative.listObjects(prefix, continuationToken ?? null);
  },
  deleteObject(key: string): Promise<void> {
    return S3UploaderNative.deleteObject(key);
  },
  deletePrefix(prefix: string): Promise<{ deleted: number }> {
    return S3UploaderNative.deletePrefix(prefix);
  },
  /** Liste les versions B2 (S3 `?versions`). */
  listObjectVersions(
    prefix: string,
    keyMarker?: string,
    versionIdMarker?: string,
  ): Promise<VersionsResult> {
    return S3UploaderNative.listObjectVersions(
      prefix,
      keyMarker ?? null,
      versionIdMarker ?? null,
    );
  },
  deleteVersion(key: string, versionId: string): Promise<void> {
    return S3UploaderNative.deleteVersion(key, versionId);
  },
  /** Supprime toutes les versions non-courantes sous un préfixe. */
  purgeOldVersions(prefix: string): Promise<{ deleted: number }> {
    return S3UploaderNative.purgeOldVersions(prefix);
  },
  createFolder(prefix: string, name: string): Promise<void> {
    return S3UploaderNative.createFolder(prefix, name);
  },
  /**
   * Déplace/renomme un lot d'objets, entièrement côté serveur (copie + suppression).
   * Parallèle borné + copie multipart pour les gros fichiers ; émet `onMoveProgress`.
   */
  moveObjects(pairs: MovePair[]): Promise<MoveResult> {
    return S3UploaderNative.moveObjects(pairs);
  },
  /** Raccourci pour un seul objet (renommage). */
  moveObject(srcKey: string, dstKey: string): Promise<MoveResult> {
    return S3UploaderNative.moveObjects([{ src: srcKey, dst: dstKey }]);
  },
  /** Énumère récursivement un dossier Android choisi via pickDirectory. */
  listTree(treeUri: string): Promise<{ files: TreeFile[] }> {
    return S3UploaderNative.listTree(treeUri);
  },
  pause(): Promise<void> {
    return S3UploaderNative.pause();
  },
  resume(): Promise<void> {
    return S3UploaderNative.resume();
  },
  cancel(id: string): Promise<void> {
    return S3UploaderNative.cancel(id);
  },
  retry(id: string): Promise<void> {
    return S3UploaderNative.retry(id);
  },
  clearCompleted(): Promise<void> {
    return S3UploaderNative.clearCompleted();
  },
  getState(): Promise<{ status: QueueStatus; items: UploadItemState[] }> {
    return S3UploaderNative.getState();
  },

  onProgress(cb: (e: ProgressEvent) => void) {
    return emitter.addListener('S3Uploader:onProgress', cb as (...a: unknown[]) => void);
  },
  onItemStatus(cb: (e: ItemStatusEvent) => void) {
    return emitter.addListener('S3Uploader:onItemStatus', cb as (...a: unknown[]) => void);
  },
  onQueueStatus(cb: (e: QueueStatusEvent) => void) {
    return emitter.addListener('S3Uploader:onQueueStatus', cb as (...a: unknown[]) => void);
  },
  onMoveProgress(cb: (e: MoveProgressEvent) => void) {
    return emitter.addListener('S3Uploader:onMoveProgress', cb as (...a: unknown[]) => void);
  },
};
