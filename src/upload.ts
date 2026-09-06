import { pick, pickDirectory, types } from '@react-native-documents/picker';
import { S3Uploader, type EnqueueResult, type UploadItemInput } from './native/S3Uploader';
import { dedupeKeys, normalizePrefix, sanitizeSegment } from './keys';

/** Assemble une clé S3 : `<prefixe>/<reste>` (prefixe éventuellement vide). */
export function joinKey(prefix: string, rest: string): string {
  const p = normalizePrefix(prefix);
  return p ? `${p}/${rest}` : rest;
}

function mkId(i: number): string {
  return `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Fichiers choisis par l'utilisateur, uploadés sous `destPrefix` (dossier courant du navigateur). */
export async function addFilesTo(destPrefix: string): Promise<EnqueueResult | null> {
  const picked = await pick({
    allowMultiSelection: true,
    mode: 'open',
    requestLongTermAccess: true,
    type: [types.allFiles],
  });
  if (!picked.length) return null;

  const rawKeys = picked.map(f =>
    joinKey(destPrefix, sanitizeSegment(f.name ?? 'fichier') || 'fichier'),
  );
  const keys = dedupeKeys(rawKeys);
  const payload: UploadItemInput[] = picked.map((f, i) => ({
    id: mkId(i),
    uri: f.uri,
    key: keys[i],
    displayName: f.name ?? keys[i].split('/').pop() ?? 'fichier',
    sizeBytes: typeof f.size === 'number' ? f.size : -1,
    contentType: f.type ?? undefined,
  }));
  return S3Uploader.enqueue(payload);
}

/** Dossier Android choisi via pickDirectory, énuméré récursivement puis uploadé sous `destPrefix`. */
export async function addFolderTo(destPrefix: string): Promise<EnqueueResult | null> {
  const dir = await pickDirectory({ requestLongTermAccess: true });
  const { files } = await S3Uploader.listTree(dir.uri);
  if (!files.length) return { queued: 0, skippedInQueue: 0, skippedExisting: 0 };

  const rootName =
    sanitizeSegment(
      decodeURIComponent(dir.uri)
        .split(/[/:]/)
        .filter(Boolean)
        .pop() ?? 'dossier',
    ) || 'dossier';

  const rawKeys = files.map(f => {
    const rel = f.relativePath
      .split('/')
      .map(sanitizeSegment)
      .filter(Boolean)
      .join('/');
    return joinKey(destPrefix, `${rootName}/${rel}`);
  });
  const keys = dedupeKeys(rawKeys);
  const payload: UploadItemInput[] = files.map((f, i) => ({
    id: mkId(i),
    uri: f.uri,
    key: keys[i],
    displayName: f.name,
    sizeBytes: typeof f.size === 'number' ? f.size : -1,
    contentType: f.mimeType,
  }));
  return S3Uploader.enqueue(payload);
}

export function summarizeEnqueue(res: EnqueueResult): string | null {
  const skipped = res.skippedExisting + res.skippedInQueue;
  if (!skipped) return res.queued ? `${res.queued} fichier(s) ajouté(s).` : null;
  const bits: string[] = [];
  if (res.skippedExisting) bits.push(`${res.skippedExisting} déjà en ligne`);
  if (res.skippedInQueue) bits.push(`${res.skippedInQueue} déjà dans la file`);
  return (
    `${res.queued} ajouté(s), ${skipped} ignoré(s) (${bits.join(', ')}).`
  );
}
