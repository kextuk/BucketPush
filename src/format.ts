/** Formatage tailles / débit / ETA. Pur, testé (voir __tests__/format.test.ts). */

const UNITS = ['o', 'ko', 'Mo', 'Go', 'To', 'Po'];

/**
 * Base **1000** (comme la console Backblaze), pas 1024 — pour que les tailles
 * affichées correspondent à celles du bucket.
 */
export function formatBytes(bytes: number, decimals = 1): string {
  if (!isFinite(bytes) || bytes <= 0) return '0 o';
  const i = Math.min(UNITS.length - 1, Math.floor(Math.log10(bytes) / 3));
  const value = bytes / Math.pow(1000, i);
  const d = i === 0 ? 0 : decimals;
  return `${value.toFixed(d)} ${UNITS[i]}`;
}

/** `4.83 Go (4 831 838 208 o)` — valeur exacte entre parenthèses. */
export function formatBytesExact(bytes: number): string {
  const n = Math.max(0, Math.round(bytes));
  return `${formatBytes(n)} (${n.toLocaleString('fr-FR')} o)`;
}

export function formatSpeed(bytesPerSec: number): string {
  if (!isFinite(bytesPerSec) || bytesPerSec <= 0) return '—';
  return `${formatBytes(bytesPerSec)}/s`;
}

export function formatEta(seconds: number): string {
  if (!isFinite(seconds) || seconds <= 0) return '—';
  const s = Math.round(seconds);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${s % 60} s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ${m % 60} min`;
  const d = Math.floor(h / 24);
  return `${d} j ${h % 24} h`;
}

export function percent(uploaded: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((uploaded / total) * 100)));
}

/**
 * Estimateur de débit à moyenne mobile exponentielle.
 * `alpha` proche de 1 = réactif, proche de 0 = lissé.
 */
export class SpeedMeter {
  private lastBytes = 0;
  private lastAt = 0;
  private ewma = 0;

  constructor(private alpha = 0.3) {}

  /** @returns débit lissé en octets/s */
  sample(totalUploadedBytes: number, now = Date.now()): number {
    if (this.lastAt === 0) {
      this.lastBytes = totalUploadedBytes;
      this.lastAt = now;
      return 0;
    }
    const dt = (now - this.lastAt) / 1000;
    if (dt <= 0) return this.ewma;
    const inst = Math.max(0, (totalUploadedBytes - this.lastBytes) / dt);
    this.ewma = this.ewma === 0 ? inst : this.alpha * inst + (1 - this.alpha) * this.ewma;
    this.lastBytes = totalUploadedBytes;
    this.lastAt = now;
    return this.ewma;
  }

  reset() {
    this.lastBytes = 0;
    this.lastAt = 0;
    this.ewma = 0;
  }
}
