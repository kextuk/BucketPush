import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import {
  S3Uploader,
  type QueueStatus,
  type UploadItemState,
} from './native/S3Uploader';
import { SpeedMeter } from './format';

export type UiItem = UploadItemState & {
  totalBytes: number;
  partsCompleted: number;
  partsTotal: number;
  speedBps: number;
  etaSeconds: number;
};

function toUi(s: UploadItemState): UiItem {
  return {
    ...s,
    totalBytes: s.sizeBytes,
    partsCompleted: 0,
    partsTotal: 0,
    speedBps: 0,
    etaSeconds: 0,
  };
}

export function useUploader() {
  const [items, setItems] = useState<Record<string, UiItem>>({});
  const [queueStatus, setQueueStatus] = useState<QueueStatus>('idle');
  const meters = useRef<Record<string, SpeedMeter>>({});

  const hydrate = useCallback(async () => {
    const state = await S3Uploader.getState();
    setQueueStatus(state.status);
    setItems(prev => {
      const next: Record<string, UiItem> = {};
      for (const s of state.items) {
        next[s.id] = { ...toUi(s), ...(prev[s.id] ? pickLive(prev[s.id]) : {}) };
      }
      return next;
    });
  }, []);

  useEffect(() => {
    hydrate();

    const subProgress = S3Uploader.onProgress(e => {
      const meter = (meters.current[e.id] ??= new SpeedMeter());
      const speedBps = meter.sample(e.uploadedBytes);
      const remaining = Math.max(0, e.totalBytes - e.uploadedBytes);
      const etaSeconds = speedBps > 0 ? remaining / speedBps : 0;
      setItems(prev => {
        const cur = prev[e.id];
        if (!cur) return prev;
        return {
          ...prev,
          [e.id]: {
            ...cur,
            uploadedBytes: e.uploadedBytes,
            totalBytes: e.totalBytes,
            partsCompleted: e.partsCompleted,
            partsTotal: e.partsTotal,
            speedBps,
            etaSeconds,
            status: cur.status === 'queued' ? 'uploading' : cur.status,
          },
        };
      });
    });

    const subItem = S3Uploader.onItemStatus(e => {
      if (e.status === 'completed' || e.status === 'failed' || e.status === 'canceled') {
        meters.current[e.id]?.reset();
      }
      setItems(prev => {
        const cur = prev[e.id];
        if (!cur) {
          // item apparu (enqueue) : on rehydrate pour récupérer ses métadonnées
          hydrate();
          return prev;
        }
        return {
          ...prev,
          [e.id]: {
            ...cur,
            status: e.status,
            error: e.error,
            ...(e.status === 'completed' ? { uploadedBytes: cur.totalBytes } : {}),
          },
        };
      });
    });

    const subQueue = S3Uploader.onQueueStatus(e => setQueueStatus(e.status));

    const appStateSub = AppState.addEventListener('change', s => {
      if (s === 'active') hydrate();
    });

    return () => {
      subProgress.remove();
      subItem.remove();
      subQueue.remove();
      appStateSub.remove();
    };
  }, [hydrate]);

  const list = Object.values(items).sort((a, b) => a.displayName.localeCompare(b.displayName));

  const active = list.filter(i => i.status === 'uploading' || i.status === 'queued');
  const relevant = list.filter(i => i.status !== 'skipped' && i.status !== 'canceled');
  const totalBytes = relevant.reduce((s, i) => s + (i.totalBytes || i.sizeBytes), 0);
  const uploadedBytes = relevant.reduce((s, i) => s + i.uploadedBytes, 0);
  const summary = {
    activeCount: active.length,
    totalCount: relevant.length,
    doneCount: relevant.filter(i => i.status === 'completed').length,
    failedCount: list.filter(i => i.status === 'failed').length,
    pct: totalBytes > 0 ? Math.round((uploadedBytes / totalBytes) * 100) : 0,
    speedBps: active.reduce((s, i) => s + i.speedBps, 0),
  };

  return {
    items: list,
    queueStatus,
    summary,
    hydrate,
    pause: () => S3Uploader.pause(),
    resume: () => S3Uploader.resume(),
    cancel: (id: string) => S3Uploader.cancel(id),
    cancelAll: async () => {
      await S3Uploader.cancelAll();
      hydrate();
    },
    retry: (id: string) => S3Uploader.retry(id),
    clearCompleted: async () => {
      await S3Uploader.clearCompleted();
      hydrate();
    },
  };
}

function pickLive(i: UiItem) {
  return {
    speedBps: i.speedBps,
    etaSeconds: i.etaSeconds,
    partsCompleted: i.partsCompleted,
    partsTotal: i.partsTotal,
  };
}
