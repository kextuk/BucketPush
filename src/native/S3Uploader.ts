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
};
