import {
  STORE_VERSION,
  blankProfile,
  deriveRegion,
  duplicateMeta,
  migrateStore,
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
  it('copie profonde des overrides (pas de partage de référence)', () => {
    const src = { ...mk('p1', 'Prod'), overrides: { maxConcurrentParts: 6 } };
    const copy = duplicateMeta(src, ['Prod']);
    copy.overrides.maxConcurrentParts = 3;
    expect(src.overrides.maxConcurrentParts).toBe(6);
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
  it('replie les anciennes clés de réglage à plat dans overrides', () => {
    const out = pickMeta({
      endpoint: 'e',
      maxConcurrentParts: 6,
      wifiOnly: true,
      partSizeMiB: 64,
    } as never);
    expect(out).toEqual({
      endpoint: 'e',
      overrides: { maxConcurrentParts: 6, wifiOnly: true, partSizeMiB: 64 },
    });
  });
});

describe('migrateStore', () => {
  it('null / vide -> store v2 vide', () => {
    expect(migrateStore(null)).toEqual({
      activeId: null,
      profiles: [],
      version: STORE_VERSION,
    });
  });
  it('store v1 (réglages à plat) -> connexion + overrides, tague la version', () => {
    const v1 = {
      activeId: 'p1',
      profiles: [
        {
          id: 'p1',
          name: 'Prod',
          endpoint: 'https://s3.example.com',
          bucket: 'b',
          forcePathStyle: true,
          keyPrefix: '',
          maxConcurrentParts: 6,
          maxConcurrentFiles: 1,
          moveConcurrency: 4,
          wifiOnly: true,
          skipExisting: true,
          timestampKeys: false,
          partSizeMiB: 64,
        },
      ],
    } as unknown as ProfileStore;
    const out = migrateStore(v1);
    expect(out.version).toBe(STORE_VERSION);
    expect(out.profiles[0].endpoint).toBe('https://s3.example.com');
    expect(out.profiles[0]).not.toHaveProperty('maxConcurrentParts');
    // seules les valeurs ≠ défaut global sont épinglées ; le reste est hérité
    expect(out.profiles[0].overrides).toEqual({
      maxConcurrentParts: 6,
      wifiOnly: true,
      partSizeMiB: 64,
    });
  });
  it('déjà v2 -> renvoyé tel quel', () => {
    const v2: ProfileStore = {
      activeId: null,
      profiles: [],
      version: STORE_VERSION,
    };
    expect(migrateStore(v2)).toBe(v2);
  });
});

describe('deriveRegion', () => {
  it('Backblaze B2', () =>
    expect(deriveRegion('https://s3.us-west-004.backblazeb2.com')).toBe('us-west-004'));
  it('Scaleway', () =>
    expect(deriveRegion('https://s3.fr-par.scw.cloud')).toBe('fr-par'));
  it('AWS régional', () =>
    expect(deriveRegion('https://s3.eu-west-1.amazonaws.com')).toBe('eu-west-1'));
  it('AWS global -> us-east-1', () =>
    expect(deriveRegion('https://s3.amazonaws.com')).toBe('us-east-1'));
  it('MinIO custom -> us-east-1', () =>
    expect(deriveRegion('http://minio.local:9000')).toBe('us-east-1'));
  it('override prioritaire', () =>
    expect(deriveRegion('https://s3.fr-par.scw.cloud', 'eu-central-1')).toBe('eu-central-1'));
});

describe('validateProfile', () => {
  const base = { ...blankProfile('P'), endpoint: 'https://s3.example.com', bucket: 'my-bucket' };
  it('profil valide -> aucune erreur', () => {
    expect(validateProfile(base)).toEqual([]);
  });
  it('renvoie des clés i18n', () => {
    const errs = validateProfile({ ...base, name: '', endpoint: 's3.example.com', bucket: 'A' });
    expect(errs).toEqual(
      expect.arrayContaining(['err.name', 'err.endpoint', 'err.bucketInvalid']),
    );
  });
});
