import { buildKey, dedupeKeys, normalizePrefix, sanitizeSegment } from '../src/keys';

describe('sanitizeSegment', () => {
  it('remplace les séparateurs de chemin', () => {
    expect(sanitizeSegment('a/b\\c')).toBe('a_b_c');
  });
  it('retire les "." de tête', () => {
    expect(sanitizeSegment('..evil')).toBe('evil');
    expect(sanitizeSegment('.hidden')).toBe('hidden');
  });
  it('compacte les espaces', () => {
    expect(sanitizeSegment('  mon   fichier  ')).toBe('mon fichier');
  });
  it('conserve accents et tirets', () => {
    expect(sanitizeSegment('Sauvegarde-Été_2026.tar.gz')).toBe('Sauvegarde-Été_2026.tar.gz');
  });
});

describe('normalizePrefix', () => {
  it('nettoie chaque segment et retire les vides', () => {
    expect(normalizePrefix('/sauvegardes//2026/')).toBe('sauvegardes/2026');
  });
  it('vide -> vide', () => {
    expect(normalizePrefix('')).toBe('');
  });
});

describe('buildKey', () => {
  it('préfixe + nom', () => {
    expect(buildKey('film.mkv', { prefix: 'videos/2026' })).toBe('videos/2026/film.mkv');
  });
  it('sans préfixe', () => {
    expect(buildKey('film.mkv')).toBe('film.mkv');
  });
  it('horodatage inséré avant l’extension', () => {
    const now = new Date(2026, 8, 6, 14, 3, 9); // 2026-09-06 14:03:09 local
    expect(buildKey('backup.tar.gz', { timestamp: true, now })).toBe(
      'backup.tar-20260906-140309.gz',
    );
  });
  it('nom vide -> "fichier"', () => {
    expect(buildKey('   ')).toBe('fichier');
  });
});

describe('dedupeKeys', () => {
  it('suffixe les doublons en gardant l’extension', () => {
    expect(dedupeKeys(['d/a.txt', 'd/a.txt', 'd/a.txt', 'd/b.txt'])).toEqual([
      'd/a.txt',
      'd/a-1.txt',
      'd/a-2.txt',
      'd/b.txt',
    ]);
  });
  it('doublon sans extension', () => {
    expect(dedupeKeys(['x', 'x'])).toEqual(['x', 'x-1']);
  });
  it('un point dans le dossier seulement', () => {
    expect(dedupeKeys(['a.b/c', 'a.b/c'])).toEqual(['a.b/c', 'a.b/c-1']);
  });
});
