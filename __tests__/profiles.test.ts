import {
  blankProfile,
  duplicateMeta,
  nextActiveId,
  pickMeta,
  removeProfile,
  uniqueName,
  upsert,
  validateProfile,
  type ProfileMeta,
  type ProfileStore,
} from '../src/profiles';

const mk = (id: string, name: string): ProfileMeta => ({
  ...blankProfile(name),
  id,
});

describe('uniqueName', () => {
  it('garde le nom si libre', () => {
    expect(uniqueName(['a', 'b'], 'c')).toBe('c');
  });
  it('suffixe si pris', () => {
    expect(uniqueName(['Prod', 'Prod 2'], 'Prod')).toBe('Prod 3');
  });
});

describe('upsert', () => {
  const store: ProfileStore = { activeId: null, profiles: [] };
  it('le premier profil devient actif', () => {
    const p = mk('p1', 'Un');
    const next = upsert(store, p);
    expect(next.activeId).toBe('p1');
    expect(next.profiles).toHaveLength(1);
  });
  it('remplace un profil existant sans changer l’actif', () => {
    const s: ProfileStore = { activeId: 'p1', profiles: [mk('p1', 'Un'), mk('p2', 'Deux')] };
    const next = upsert(s, { ...mk('p2', 'Deux'), bucket: 'x' });
    expect(next.activeId).toBe('p1');
    expect(next.profiles.find(p => p.id === 'p2')?.bucket).toBe('x');
    expect(next.profiles).toHaveLength(2);
  });
});

describe('nextActiveId / removeProfile', () => {
  const s: ProfileStore = {
    activeId: 'p2',
    profiles: [mk('p1', 'Un'), mk('p2', 'Deux'), mk('p3', 'Trois')],
  };
  it('supprimer un profil non actif ne change pas l’actif', () => {
    expect(nextActiveId(s, 'p1')).toBe('p2');
  });
  it('supprimer l’actif bascule sur le premier restant', () => {
    expect(nextActiveId(s, 'p2')).toBe('p1');
  });
  it('supprimer le dernier profil -> null', () => {
    const one: ProfileStore = { activeId: 'p1', profiles: [mk('p1', 'Un')] };
    expect(removeProfile(one, 'p1')).toEqual({ activeId: null, profiles: [] });
  });
  it('removeProfile retire bien la ligne', () => {
    expect(removeProfile(s, 'p2').profiles.map(p => p.id)).toEqual(['p1', 'p3']);
  });
});

describe('duplicateMeta', () => {
  it('nouvel id, nom « (copie) » unique, config copiée', () => {
    const src = { ...mk('p1', 'Prod'), bucket: 'b', region: 'r' };
    const copy = duplicateMeta(src, ['Prod', 'Prod (copie)']);
    expect(copy.id).not.toBe('p1');
    expect(copy.name).toBe('Prod (copie) 2');
    expect(copy.bucket).toBe('b');
    expect(copy.region).toBe('r');
  });
});

describe('pickMeta', () => {
  it('ne garde que les clés connues', () => {
    const out = pickMeta({ endpoint: 'e', bucket: 'b', hack: 1 } as never);
    expect(out).toEqual({ endpoint: 'e', bucket: 'b' });
  });
  it('null -> {}', () => {
    expect(pickMeta(null)).toEqual({});
  });
});

describe('validateProfile', () => {
  const base = { ...blankProfile('P'), endpoint: 'https://s3.example.com', region: 'r', bucket: 'my-bucket' };
  it('profil valide -> aucune erreur', () => {
    expect(validateProfile(base)).toEqual([]);
  });
  it('nom vide, endpoint sans schéma, bucket invalide', () => {
    const errs = validateProfile({ ...base, name: '', endpoint: 's3.example.com', bucket: 'A' });
    expect(errs.length).toBeGreaterThanOrEqual(3);
  });
  it('part size < 5 MiB rejetée', () => {
    expect(validateProfile({ ...base, partSizeMiB: 4 })).toContain(
      'Taille de part minimale : 5 MiB.',
    );
  });
});
