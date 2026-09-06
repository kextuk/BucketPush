import { SpeedMeter, formatBytes, formatEta, formatSpeed, percent } from '../src/format';

describe('formatBytes (base 1000)', () => {
  it('octets sans décimale', () => {
    expect(formatBytes(512)).toBe('512 o');
    expect(formatBytes(999)).toBe('999 o');
  });
  it('ko / Mo / Go décimaux', () => {
    expect(formatBytes(1000)).toBe('1.0 ko');
    expect(formatBytes(5_000_000)).toBe('5.0 Mo');
    expect(formatBytes(3_500_000_000)).toBe('3.5 Go');
  });
  it('zéro / négatif', () => {
    expect(formatBytes(0)).toBe('0 o');
    expect(formatBytes(-10)).toBe('0 o');
  });
});

describe('formatEta', () => {
  it('secondes', () => expect(formatEta(42)).toBe('42 s'));
  it('minutes', () => expect(formatEta(125)).toBe('2 min 5 s'));
  it('heures', () => expect(formatEta(3 * 3600 + 12 * 60)).toBe('3 h 12 min'));
  it('jours', () => expect(formatEta(50 * 3600)).toBe('2 j 2 h'));
  it('invalide', () => expect(formatEta(0)).toBe('—'));
});

describe('formatSpeed', () => {
  it('affiche un débit', () => expect(formatSpeed(1_000_000)).toBe('1.0 Mo/s'));
  it('nul', () => expect(formatSpeed(0)).toBe('—'));
});

describe('percent', () => {
  it('borne 0..100', () => {
    expect(percent(0, 100)).toBe(0);
    expect(percent(50, 100)).toBe(50);
    expect(percent(200, 100)).toBe(100);
    expect(percent(1, 0)).toBe(0);
  });
});

describe('SpeedMeter', () => {
  it('premier échantillon = 0, puis converge vers le débit réel', () => {
    const m = new SpeedMeter(0.5);
    expect(m.sample(0, 1000)).toBe(0);
    const s1 = m.sample(1_000_000, 2000); // 1 Mo en 1 s
    expect(s1).toBeCloseTo(1_000_000, -3);
    const s2 = m.sample(2_000_000, 3000); // encore 1 Mo/s
    expect(s2).toBeGreaterThan(0);
    expect(s2).toBeLessThanOrEqual(1_000_000 * 1.01);
  });
  it('reset remet à zéro', () => {
    const m = new SpeedMeter();
    m.sample(0, 1000);
    m.sample(1_000_000, 2000);
    m.reset();
    expect(m.sample(5_000_000, 3000)).toBe(0);
  });
});
