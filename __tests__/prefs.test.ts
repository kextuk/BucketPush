import {
  DEFAULT_PREFS,
  clampPrefs,
  pickOverrides,
  resolvePrefs,
  validatePrefs,
} from '../src/prefs';

describe('resolvePrefs', () => {
  it('sans surcharge -> le global tel quel', () => {
    expect(resolvePrefs(DEFAULT_PREFS, {})).toEqual(DEFAULT_PREFS);
    expect(resolvePrefs(DEFAULT_PREFS, null)).toEqual(DEFAULT_PREFS);
  });
  it('une surcharge écrase la clé correspondante', () => {
    const out = resolvePrefs(DEFAULT_PREFS, { maxConcurrentParts: 6, partSizeMiB: 128 });
    expect(out.maxConcurrentParts).toBe(6);
    expect(out.partSizeMiB).toBe(128);
    expect(out.moveConcurrency).toBe(DEFAULT_PREFS.moveConcurrency);
  });
  it('une surcharge booléenne false écrase un global true', () => {
    const global = { ...DEFAULT_PREFS, skipExisting: true };
    expect(resolvePrefs(global, { skipExisting: false }).skipExisting).toBe(false);
  });
  it('undefined dans la surcharge = hérité (pas d’écrasement)', () => {
    const global = { ...DEFAULT_PREFS, maxConcurrentParts: 4 };
    expect(resolvePrefs(global, { maxConcurrentParts: undefined }).maxConcurrentParts).toBe(4);
  });
});

describe('pickOverrides', () => {
  it('ne garde que les clés connues et définies', () => {
    expect(
      pickOverrides({ maxConcurrentParts: 6, hack: 1, wifiOnly: undefined, moveConcurrency: 8 }),
    ).toEqual({ maxConcurrentParts: 6, moveConcurrency: 8 });
  });
  it('non-objet -> {}', () => {
    expect(pickOverrides(null)).toEqual({});
    expect(pickOverrides('x')).toEqual({});
  });
});

describe('clampPrefs', () => {
  it('borne les concurrences dans leurs plages', () => {
    const out = clampPrefs({
      maxConcurrentParts: 99,
      maxConcurrentFiles: 0,
      moveConcurrency: 999,
    });
    expect(out.maxConcurrentParts).toBe(8);
    expect(out.maxConcurrentFiles).toBe(1);
    expect(out.moveConcurrency).toBe(16);
  });
  it('partSizeMiB : null -> undefined, sinon plancher à 5', () => {
    expect(clampPrefs({}).partSizeMiB).toBeUndefined();
    expect(clampPrefs({ partSizeMiB: 3 }).partSizeMiB).toBe(5);
    expect(clampPrefs({ partSizeMiB: 64 }).partSizeMiB).toBe(64);
  });
  it('valeurs non finies -> défaut', () => {
    expect(clampPrefs({ maxConcurrentParts: NaN }).maxConcurrentParts).toBe(
      DEFAULT_PREFS.maxConcurrentParts,
    );
  });
});

describe('validatePrefs', () => {
  it('part size < 5 MiB rejetée', () => {
    expect(validatePrefs({ partSizeMiB: 4 })).toContain('err.partSize');
  });
  it('part size auto (undefined) ou ≥ 5 -> OK', () => {
    expect(validatePrefs({})).toEqual([]);
    expect(validatePrefs({ partSizeMiB: 5 })).toEqual([]);
  });
});
