import * as Keychain from 'react-native-keychain';
import type { S3Config } from './native/S3Uploader';

// Config non secrète et secrets sont stockés dans le trousseau (Keystore Android),
// sous deux services distincts. Pas d'AsyncStorage (évite la dépendance KSP).
const SETTINGS_SERVICE = 's3pusher.settings';
const CREDENTIALS_SERVICE = 's3pusher.credentials';

export type AppConfig = {
  endpoint: string;
  region: string;
  bucket: string;
  forcePathStyle: boolean;
  keyPrefix: string;
  timestampKeys: boolean;
  wifiOnly: boolean;
  partSizeMiB?: number;
  maxConcurrentParts?: number;
  maxConcurrentFiles?: number;
  hasCredentials: boolean;
};

export const DEFAULT_CONFIG: AppConfig = {
  endpoint: '',
  region: '',
  bucket: '',
  forcePathStyle: true,
  keyPrefix: '',
  timestampKeys: false,
  wifiOnly: false,
  partSizeMiB: undefined,
  maxConcurrentParts: 2,
  maxConcurrentFiles: 1,
  hasCredentials: false,
};

export async function loadConfig(): Promise<AppConfig> {
  let parsed: Partial<AppConfig> = {};
  try {
    const stored = await Keychain.getGenericPassword({ service: SETTINGS_SERVICE });
    if (stored && stored.password) parsed = JSON.parse(stored.password);
  } catch {
    parsed = {};
  }
  let hasCredentials = false;
  try {
    const creds = await Keychain.getGenericPassword({ service: CREDENTIALS_SERVICE });
    hasCredentials = !!creds && !!creds.password;
  } catch {
    hasCredentials = false;
  }
  return { ...DEFAULT_CONFIG, ...parsed, hasCredentials };
}

export async function saveConfig(
  cfg: AppConfig,
  creds?: { accessKeyId: string; secretAccessKey: string },
): Promise<void> {
  await Keychain.setGenericPassword('settings', JSON.stringify(cfg), {
    service: SETTINGS_SERVICE,
  });
  if (creds && creds.accessKeyId && creds.secretAccessKey) {
    await Keychain.setGenericPassword(creds.accessKeyId, creds.secretAccessKey, {
      service: CREDENTIALS_SERVICE,
    });
  }
}

export async function readCredentials(): Promise<{
  accessKeyId: string;
  secretAccessKey: string;
} | null> {
  try {
    const creds = await Keychain.getGenericPassword({ service: CREDENTIALS_SERVICE });
    if (!creds || !creds.password) return null;
    return { accessKeyId: creds.username, secretAccessKey: creds.password };
  } catch {
    return null;
  }
}

export async function clearCredentials(): Promise<void> {
  await Keychain.resetGenericPassword({ service: CREDENTIALS_SERVICE });
}

/** Assemble la config native (secrets inclus) à passer à `S3Uploader.configure`. */
export async function toNativeConfig(cfg: AppConfig): Promise<S3Config | null> {
  const creds = await readCredentials();
  if (!creds) return null;
  return {
    endpoint: cfg.endpoint.trim(),
    region: cfg.region.trim(),
    bucket: cfg.bucket.trim(),
    accessKeyId: creds.accessKeyId,
    secretAccessKey: creds.secretAccessKey,
    forcePathStyle: cfg.forcePathStyle,
    partSizeBytes: cfg.partSizeMiB ? Math.round(cfg.partSizeMiB * 1024 * 1024) : undefined,
    maxConcurrentParts: cfg.maxConcurrentParts ?? 2,
    maxConcurrentFiles: cfg.maxConcurrentFiles ?? 1,
    wifiOnly: cfg.wifiOnly,
  };
}

export function validateConfig(cfg: AppConfig): string[] {
  const errors: string[] = [];
  if (!/^https?:\/\/.+/.test(cfg.endpoint.trim())) {
    errors.push('Endpoint invalide (doit commencer par http:// ou https://).');
  }
  if (!cfg.region.trim()) errors.push('Region requise.');
  if (!cfg.bucket.trim()) errors.push('Bucket requis.');
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(cfg.bucket.trim())) {
    errors.push('Nom de bucket invalide.');
  }
  if (cfg.partSizeMiB != null && cfg.partSizeMiB < 5) {
    errors.push('Taille de part minimale : 5 MiB.');
  }
  return errors;
}
