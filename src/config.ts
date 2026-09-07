import * as Keychain from 'react-native-keychain';
import type { S3Config } from './native/S3Uploader';
import { SEED_CREDENTIALS } from './seed';
import {
  STORE_VERSION,
  blankProfile,
  deriveRegion,
  duplicateMeta,
  migrateStore,
  pickMeta,
  removeProfile,
  upsert,
  validateProfile,
  type ProfileMeta,
  type ProfileStore,
} from './profiles';
import {
  DEFAULT_PREFS,
  clampPrefs,
  resolvePrefs,
  type PrefOverrides,
  type TransferPrefs,
} from './prefs';

export type { ProfileMeta, ProfileStore } from './profiles';
export { PROFILE_DEFAULTS, deriveRegion, validateProfile } from './profiles';
export {
  DEFAULT_PREFS,
  PREF_RANGES,
  PREF_KEYS,
  clampPrefs,
  resolvePrefs,
  validatePrefs,
} from './prefs';
export type { TransferPrefs, PrefOverrides } from './prefs';

/** Un profil enrichi de l'info « des clés sont stockées ». */
export type Profile = ProfileMeta & { hasCredentials: boolean };

// Compat : les écrans existants manipulent un « AppConfig » = profil actif.
export type AppConfig = Profile;

const STORE_SERVICE = 's3pusher.profiles';
const PREFS_SERVICE = 's3pusher.prefs';
const credService = (id: string) => `s3pusher.cred.${id}`;

// Ancien schéma mono-profil (migration).
const LEGACY_SETTINGS = 's3pusher.settings';
const LEGACY_CREDS = 's3pusher.credentials';

// --- Réglages de transfert globaux ------------------------------------------

export async function readPrefs(): Promise<TransferPrefs> {
  try {
    const s = await Keychain.getGenericPassword({ service: PREFS_SERVICE });
    if (s && s.password) {
      return clampPrefs({ ...DEFAULT_PREFS, ...JSON.parse(s.password) });
    }
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_PREFS };
}

export async function savePrefs(prefs: Partial<TransferPrefs>): Promise<TransferPrefs> {
  const clamped = clampPrefs({ ...DEFAULT_PREFS, ...prefs });
  await Keychain.setGenericPassword('prefs', JSON.stringify(clamped), {
    service: PREFS_SERVICE,
  });
  return clamped;
}

/** Prefs effectives d'un profil (global + surcharges du profil). */
export async function effectivePrefs(overrides: PrefOverrides): Promise<TransferPrefs> {
  return resolvePrefs(await readPrefs(), overrides);
}

// --- I/O trousseau -------------------------------------------------------------

async function readStoreRaw(): Promise<ProfileStore | null> {
  try {
    const s = await Keychain.getGenericPassword({ service: STORE_SERVICE });
    if (s && s.password) return JSON.parse(s.password) as ProfileStore;
  } catch {
    /* ignore */
  }
  return null;
}

async function writeStore(store: ProfileStore): Promise<void> {
  await Keychain.setGenericPassword(
    'profiles',
    JSON.stringify({ ...store, version: STORE_VERSION }),
    { service: STORE_SERVICE },
  );
}

async function migrateLegacy(): Promise<ProfileStore | null> {
  let legacy: Partial<ProfileMeta> | null = null;
  try {
    const s = await Keychain.getGenericPassword({ service: LEGACY_SETTINGS });
    if (s && s.password) legacy = JSON.parse(s.password);
  } catch {
    /* ignore */
  }
  if (!legacy) return null;

  const p: ProfileMeta = { ...blankProfile('Profil 1'), ...pickMeta(legacy) };
  p.name = 'Profil 1';
  const store: ProfileStore = { activeId: p.id, profiles: [p], version: STORE_VERSION };

  try {
    const c = await Keychain.getGenericPassword({ service: LEGACY_CREDS });
    if (c && c.password) {
      await Keychain.setGenericPassword(c.username, c.password, {
        service: credService(p.id),
      });
    }
  } catch {
    /* ignore */
  }
  await writeStore(store);
  try {
    await Keychain.resetGenericPassword({ service: LEGACY_SETTINGS });
    await Keychain.resetGenericPassword({ service: LEGACY_CREDS });
  } catch {
    /* ignore */
  }
  return store;
}

// --- Profil de démo (builds de test) ---------------------------------------
// TODO: retirer avant la production publique. Bucket B2 jetable (capacités
// read/write sans delete + règle de cycle de vie 1 j). Les identifiants ne
// sont PAS dans le dépôt public : voir src/seed.ts.
const SEED = {
  name: 'Bucket de test (BucketPush)',
  endpoint: 'https://s3.eu-central-003.backblazeb2.com',
  bucket: 'bucket-test-bucketpush',
};

/** Injecte le profil de démo au tout premier lancement (store vierge, jamais seedé). */
async function seedTestProfile(): Promise<ProfileStore> {
  const meta: ProfileMeta = {
    ...blankProfile(SEED.name),
    endpoint: SEED.endpoint,
    bucket: SEED.bucket,
    forcePathStyle: true,
  };
  const next: ProfileStore = {
    activeId: meta.id,
    profiles: [meta],
    version: STORE_VERSION,
    seeded: true,
  };
  await writeStore(next);
  // Clés absentes du dépôt public : le profil est créé « prêt » et l'utilisateur
  // colle ses identifiants. Un build de test peut les fournir via src/seed.ts.
  if (SEED_CREDENTIALS.accessKeyId && SEED_CREDENTIALS.secretAccessKey) {
    await writeCredentials(meta.id, {
      accessKeyId: SEED_CREDENTIALS.accessKeyId,
      secretAccessKey: SEED_CREDENTIALS.secretAccessKey,
    });
  }
  return next;
}

async function getStore(): Promise<ProfileStore> {
  const raw = (await readStoreRaw()) ?? (await migrateLegacy());
  let store: ProfileStore;
  if (!raw) {
    store = { activeId: null, profiles: [], version: STORE_VERSION };
  } else if (raw.version === STORE_VERSION) {
    store = raw;
  } else {
    store = migrateStore(raw); // v1 (réglages à plat) → connexion + overrides
    await writeStore(store);
  }
  if (!store.seeded && store.profiles.length === 0) {
    store = await seedTestProfile();
  }
  return store;
}

// --- Credentials -------------------------------------------------------------

export async function readCredentials(
  profileId: string,
): Promise<{ accessKeyId: string; secretAccessKey: string } | null> {
  try {
    const c = await Keychain.getGenericPassword({ service: credService(profileId) });
    if (!c || !c.password) return null;
    return { accessKeyId: c.username, secretAccessKey: c.password };
  } catch {
    return null;
  }
}

async function writeCredentials(
  profileId: string,
  creds: { accessKeyId: string; secretAccessKey: string },
): Promise<void> {
  await Keychain.setGenericPassword(creds.accessKeyId, creds.secretAccessKey, {
    service: credService(profileId),
  });
}

export async function clearCredentials(profileId: string): Promise<void> {
  try {
    await Keychain.resetGenericPassword({ service: credService(profileId) });
  } catch {
    /* ignore */
  }
}

// --- API profils -----------------------------------------------------------

async function enrich(m: ProfileMeta): Promise<Profile> {
  return { ...m, hasCredentials: !!(await readCredentials(m.id)) };
}

export async function listProfiles(): Promise<{
  activeId: string | null;
  profiles: Profile[];
}> {
  const store = await getStore();
  const profiles = await Promise.all(store.profiles.map(enrich));
  return { activeId: store.activeId, profiles };
}

export async function getProfile(id: string): Promise<Profile | null> {
  const store = await getStore();
  const m = store.profiles.find(p => p.id === id);
  return m ? enrich(m) : null;
}

export async function getActiveProfile(): Promise<Profile | null> {
  const store = await getStore();
  if (!store.activeId) return null;
  const m = store.profiles.find(p => p.id === store.activeId);
  return m ? enrich(m) : null;
}

/** Crée un profil vide et le renvoie (actif si c'est le premier). */
export async function createProfile(name: string): Promise<Profile> {
  const store = await getStore();
  const meta = { ...blankProfile(name) };
  await writeStore(upsert(store, meta));
  return enrich(meta);
}

export async function saveProfile(
  meta: ProfileMeta,
  creds?: { accessKeyId: string; secretAccessKey: string },
): Promise<void> {
  const store = await getStore();
  await writeStore(upsert(store, meta));
  if (creds && creds.accessKeyId && creds.secretAccessKey) {
    await writeCredentials(meta.id, creds);
  }
}

export async function deleteProfile(id: string): Promise<void> {
  const store = await getStore();
  await writeStore(removeProfile(store, id));
  try {
    await Keychain.resetGenericPassword({ service: credService(id) });
  } catch {
    /* ignore */
  }
}

export async function setActiveProfile(id: string): Promise<void> {
  const store = await getStore();
  if (!store.profiles.some(p => p.id === id)) return;
  await writeStore({ ...store, activeId: id });
}

export async function duplicateProfile(id: string): Promise<Profile | null> {
  const store = await getStore();
  const src = store.profiles.find(p => p.id === id);
  if (!src) return null;
  const copy = duplicateMeta(src, store.profiles.map(p => p.name));
  await writeStore(upsert(store, copy));
  const c = await readCredentials(id);
  if (c) await writeCredentials(copy.id, c);
  return enrich(copy);
}

// --- Compat pour les écrans (profil actif) --------------------------------

export async function loadConfig(): Promise<Profile> {
  return (
    (await getActiveProfile()) ?? {
      ...blankProfile(''),
      hasCredentials: false,
    }
  );
}

export const DEFAULT_CONFIG: Profile = {
  ...blankProfile(''),
  name: '',
  hasCredentials: false,
};

/** Config native (secrets + réglages effectifs) à passer à `S3Uploader.configure`. */
export async function toNativeConfig(cfg: Profile): Promise<S3Config | null> {
  const creds = await readCredentials(cfg.id);
  if (!creds) return null;
  const prefs = await effectivePrefs(cfg.overrides ?? {});
  return {
    endpoint: cfg.endpoint.trim(),
    region: deriveRegion(cfg.endpoint, cfg.region),
    bucket: cfg.bucket.trim(),
    accessKeyId: creds.accessKeyId,
    secretAccessKey: creds.secretAccessKey,
    forcePathStyle: cfg.forcePathStyle,
    partSizeBytes: prefs.partSizeMiB
      ? Math.round(prefs.partSizeMiB * 1024 * 1024)
      : undefined,
    maxConcurrentParts: prefs.maxConcurrentParts,
    maxConcurrentFiles: prefs.maxConcurrentFiles,
    wifiOnly: prefs.wifiOnly,
    skipExisting: prefs.skipExisting,
    moveConcurrency: prefs.moveConcurrency,
  };
}

/** Compat : ancienne fonction de validation. */
export function validateConfig(cfg: ProfileMeta): string[] {
  return validateProfile(cfg);
}
