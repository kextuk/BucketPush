/**
 * Logique pure des profils de connexion S3 (aucune dépendance native).
 * L'I/O (trousseau) est dans config.ts. Testé dans __tests__/profiles.test.ts.
 */

export type ProfileMeta = {
  id: string;
  name: string;
  endpoint: string;
  region: string;
  bucket: string;
  forcePathStyle: boolean;
  keyPrefix: string;
  timestampKeys: boolean;
  wifiOnly: boolean;
  skipExisting: boolean;
  partSizeMiB?: number;
  maxConcurrentParts?: number;
  maxConcurrentFiles?: number;
  moveConcurrency?: number;
};

export type ProfileStore = {
  activeId: string | null;
  profiles: ProfileMeta[];
};

export const PROFILE_DEFAULTS: Omit<ProfileMeta, 'id' | 'name'> = {
  endpoint: '',
  region: '',
  bucket: '',
  forcePathStyle: true,
  keyPrefix: '',
  timestampKeys: false,
  wifiOnly: false,
  skipExisting: true,
  partSizeMiB: undefined,
  maxConcurrentParts: 2,
  maxConcurrentFiles: 1,
  moveConcurrency: 4,
};

const META_KEYS: (keyof ProfileMeta)[] = [
  'endpoint',
  'region',
  'bucket',
  'forcePathStyle',
  'keyPrefix',
  'timestampKeys',
  'wifiOnly',
  'skipExisting',
  'partSizeMiB',
  'maxConcurrentParts',
  'maxConcurrentFiles',
  'moveConcurrency',
];

export function makeId(): string {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function blankProfile(name: string): ProfileMeta {
  return { id: makeId(), name, ...PROFILE_DEFAULTS };
}

/** Ne garde que les champs de config connus d'un objet quelconque (import legacy). */
export function pickMeta(src: Partial<ProfileMeta> | null | undefined): Partial<ProfileMeta> {
  const out: Partial<ProfileMeta> = {};
  if (!src) return out;
  for (const k of META_KEYS) {
    if (src[k] !== undefined) (out as Record<string, unknown>)[k] = src[k];
  }
  return out;
}

/** Nom unique dans la liste : "base", puis "base 2", "base 3"… */
export function uniqueName(existing: string[], base: string): string {
  const set = new Set(existing);
  if (!set.has(base)) return base;
  let i = 2;
  while (set.has(`${base} ${i}`)) i++;
  return `${base} ${i}`;
}

/** Crée ou remplace un profil ; le premier profil devient actif. */
export function upsert(store: ProfileStore, profile: ProfileMeta): ProfileStore {
  const idx = store.profiles.findIndex(p => p.id === profile.id);
  const profiles =
    idx >= 0
      ? store.profiles.map(p => (p.id === profile.id ? profile : p))
      : [...store.profiles, profile];
  return { activeId: store.activeId ?? profile.id, profiles };
}

/** Actif après suppression de `removingId` (le premier restant, sinon null). */
export function nextActiveId(store: ProfileStore, removingId: string): string | null {
  if (store.activeId !== removingId) return store.activeId;
  const remaining = store.profiles.filter(p => p.id !== removingId);
  return remaining.length ? remaining[0].id : null;
}

export function removeProfile(store: ProfileStore, id: string): ProfileStore {
  return {
    activeId: nextActiveId(store, id),
    profiles: store.profiles.filter(p => p.id !== id),
  };
}

export function duplicateMeta(src: ProfileMeta, existingNames: string[]): ProfileMeta {
  return {
    ...src,
    id: makeId(),
    name: uniqueName(existingNames, `${src.name} (copie)`),
  };
}

export function validateProfile(p: ProfileMeta): string[] {
  const errors: string[] = [];
  if (!p.name.trim()) errors.push('Nom de profil requis.');
  if (!/^https?:\/\/.+/.test(p.endpoint.trim())) {
    errors.push('Endpoint invalide (doit commencer par http:// ou https://).');
  }
  if (!p.region.trim()) errors.push('Region requise.');
  if (!p.bucket.trim()) errors.push('Bucket requis.');
  else if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(p.bucket.trim())) {
    errors.push('Nom de bucket invalide.');
  }
  if (p.partSizeMiB != null && p.partSizeMiB < 5) {
    errors.push('Taille de part minimale : 5 MiB.');
  }
  return errors;
}
