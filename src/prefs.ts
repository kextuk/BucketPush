/**
 * Réglages de transfert **globaux** : valeurs par défaut communes à tous les profils.
 * Un profil peut en surcharger certaines via `ProfileMeta.overrides` (voir profiles.ts).
 * Logique pure, aucune dépendance native — I/O trousseau dans config.ts, testé dans
 * __tests__/prefs.test.ts.
 */

export type TransferPrefs = {
  partSizeMiB?: number; // undefined = auto (plan de parts adaptatif côté natif)
  maxConcurrentParts: number;
  maxConcurrentFiles: number;
  moveConcurrency: number;
  wifiOnly: boolean;
  skipExisting: boolean;
  timestampKeys: boolean;
};

/** Sous-ensemble surchargeable par profil : une clé absente = héritée du global. */
export type PrefOverrides = Partial<TransferPrefs>;

export const PREF_KEYS: (keyof TransferPrefs)[] = [
  'partSizeMiB',
  'maxConcurrentParts',
  'maxConcurrentFiles',
  'moveConcurrency',
  'wifiOnly',
  'skipExisting',
  'timestampKeys',
];

export const DEFAULT_PREFS: TransferPrefs = {
  partSizeMiB: undefined,
  maxConcurrentParts: 2,
  maxConcurrentFiles: 1,
  moveConcurrency: 4,
  wifiOnly: false,
  skipExisting: true,
  timestampKeys: false,
};

const RANGES: Record<
  'maxConcurrentParts' | 'maxConcurrentFiles' | 'moveConcurrency',
  [number, number]
> = {
  maxConcurrentParts: [1, 8],
  maxConcurrentFiles: [1, 4],
  moveConcurrency: [1, 16],
};

const clampInt = (v: unknown, [lo, hi]: [number, number], dflt: number): number => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
};

/** Ne garde que les clés de pref connues et non-`undefined` d'un objet quelconque. */
export function pickOverrides(src: unknown): PrefOverrides {
  const out: PrefOverrides = {};
  if (!src || typeof src !== 'object') return out;
  const rec = src as Record<string, unknown>;
  for (const k of PREF_KEYS) {
    if (rec[k] !== undefined && rec[k] !== null) {
      (out as Record<string, unknown>)[k] = rec[k];
    }
  }
  return out;
}

/** Prefs effectives d'un profil : global, puis chaque surcharge définie écrase. */
export function resolvePrefs(
  global: TransferPrefs,
  overrides: PrefOverrides | null | undefined,
): TransferPrefs {
  const out: TransferPrefs = { ...global };
  const ov = overrides ?? {};
  for (const k of PREF_KEYS) {
    if (ov[k] !== undefined) (out as Record<string, unknown>)[k] = ov[k];
  }
  return out;
}

/** Borne/normalise des prefs (à l'enregistrement). `partSizeMiB` : `undefined` ou ≥ 5. */
export function clampPrefs(p: Partial<TransferPrefs>): TransferPrefs {
  const ps =
    p.partSizeMiB == null || Number.isNaN(Number(p.partSizeMiB))
      ? undefined
      : Math.max(5, Math.round(Number(p.partSizeMiB)));
  return {
    partSizeMiB: ps,
    maxConcurrentParts: clampInt(
      p.maxConcurrentParts,
      RANGES.maxConcurrentParts,
      DEFAULT_PREFS.maxConcurrentParts,
    ),
    maxConcurrentFiles: clampInt(
      p.maxConcurrentFiles,
      RANGES.maxConcurrentFiles,
      DEFAULT_PREFS.maxConcurrentFiles,
    ),
    moveConcurrency: clampInt(
      p.moveConcurrency,
      RANGES.moveConcurrency,
      DEFAULT_PREFS.moveConcurrency,
    ),
    wifiOnly: !!p.wifiOnly,
    skipExisting: p.skipExisting == null ? DEFAULT_PREFS.skipExisting : !!p.skipExisting,
    timestampKeys: !!p.timestampKeys,
  };
}

/** Bornes des sélecteurs numériques, réutilisées par l'UI. */
export { RANGES as PREF_RANGES };

/** Renvoie des **clés i18n** (`err.*`), traduites par l'appelant. */
export function validatePrefs(p: Partial<TransferPrefs>): string[] {
  const errors: string[] = [];
  if (p.partSizeMiB != null && Number(p.partSizeMiB) < 5) errors.push('err.partSize');
  return errors;
}
