import * as Keychain from 'react-native-keychain';
import type { S3Config } from './native/S3Uploader';
import {
  PROFILE_DEFAULTS,
  blankProfile,
  duplicateMeta,
  pickMeta,
  removeProfile,
  upsert,
  validateProfile,
  type ProfileMeta,
  type ProfileStore,
} from './profiles';

export type { ProfileMeta, ProfileStore } from './profiles';
export { PROFILE_DEFAULTS, validateProfile } from './profiles';

/** Un profil enrichi de l'info « des clés sont stockées ». */
export type Profile = ProfileMeta & { hasCredentials: boolean };

// Compat : les écrans existants manipulent un « AppConfig » = profil actif.
export type AppConfig = Profile;

const STORE_SERVICE = 's3pusher.profiles';
const credService = (id: string) => `s3pusher.cred.${id}`;

// Ancien schéma mono-profil (migration).
const LEGACY_SETTINGS = 's3pusher.settings';
const LEGACY_CREDS = 's3pusher.credentials';

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
  await Keychain.setGenericPassword('profiles', JSON.stringify(store), {
    service: STORE_SERVICE,
  });
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
  const store: ProfileStore = { activeId: p.id, profiles: [p] };

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

async function getStore(): Promise<ProfileStore> {
  return (
    (await readStoreRaw()) ??
    (await migrateLegacy()) ?? { activeId: null, profiles: [] }
  );
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

/** Config native (secrets inclus) à passer à `S3Uploader.configure`. */
export async function toNativeConfig(cfg: Profile): Promise<S3Config | null> {
  const creds = await readCredentials(cfg.id);
  if (!creds) return null;
  return {
    endpoint: cfg.endpoint.trim(),
    region: cfg.region.trim(),
    bucket: cfg.bucket.trim(),
    accessKeyId: creds.accessKeyId,
    secretAccessKey: creds.secretAccessKey,
    forcePathStyle: cfg.forcePathStyle,
    partSizeBytes: cfg.partSizeMiB ? Math.round(cfg.partSizeMiB * 1024 * 1024) : undefined,
    maxConcurrentParts: cfg.maxConcurrentParts ?? PROFILE_DEFAULTS.maxConcurrentParts,
    maxConcurrentFiles: cfg.maxConcurrentFiles ?? PROFILE_DEFAULTS.maxConcurrentFiles,
    wifiOnly: cfg.wifiOnly,
    skipExisting: cfg.skipExisting,
  };
}

/** Compat : ancienne fonction de validation. */
export function validateConfig(cfg: ProfileMeta): string[] {
  return validateProfile(cfg);
}
