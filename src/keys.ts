/**
 * Génération des clés S3 de destination. Pur, testé (voir __tests__/keys.test.ts).
 *
 * - normalise le préfixe (dossier) et le nom de fichier
 * - retire les caractères problématiques
 * - anti-collision optionnel par suffixe horodaté avant l'extension
 */

export function sanitizeSegment(name: string): string {
  return name
    .normalize('NFC')
    .replace(/[\\/]+/g, '_') // pas de séparateur de chemin dans un segment
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, '') // caractères de contrôle
    .replace(/^\.+/, '') // pas de "." ou ".." en tête
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizePrefix(prefix: string): string {
  const parts = (prefix || '')
    .split('/')
    .map(sanitizeSegment)
    .filter(Boolean);
  return parts.join('/');
}

function splitExt(filename: string): [string, string] {
  const dot = filename.lastIndexOf('.');
  if (dot <= 0 || dot === filename.length - 1) return [filename, ''];
  return [filename.slice(0, dot), filename.slice(dot)];
}

export type BuildKeyOptions = {
  prefix?: string;
  /** ajoute `-YYYYMMDD-HHmmss` avant l'extension pour éviter d'écraser */
  timestamp?: boolean;
  now?: Date;
};

export function buildKey(displayName: string, opts: BuildKeyOptions = {}): string {
  const clean = sanitizeSegment(displayName) || 'fichier';
  let name = clean;
  if (opts.timestamp) {
    const d = opts.now ?? new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    const stamp =
      `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
      `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
    const [base, ext] = splitExt(clean);
    name = `${base}-${stamp}${ext}`;
  }
  const prefix = normalizePrefix(opts.prefix ?? '');
  return prefix ? `${prefix}/${name}` : name;
}

/** Rend les clés uniques au sein d'un même lot (suffixe -1, -2, … si doublon). */
export function dedupeKeys(keys: string[]): string[] {
  const seen = new Map<string, number>();
  return keys.map(key => {
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    if (n === 0) return key;
    const dot = key.lastIndexOf('.');
    const slash = key.lastIndexOf('/');
    if (dot > slash && dot >= 0) {
      return `${key.slice(0, dot)}-${n}${key.slice(dot)}`;
    }
    return `${key}-${n}`;
  });
}
