import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../../App';
import { applyNativeConfig } from '../../App';
import {
  S3Uploader,
  type ObjectVersion,
  type S3ListEntry,
} from '../native/S3Uploader';
import { useUploader } from '../useUploader';
import { addFilesTo, addFolderTo, joinKey, summarizeEnqueue } from '../upload';
import { sanitizeSegment } from '../keys';
import { ActionSheet, PromptModal } from '../components/Sheets';
import { formatBytes, formatSpeed } from '../format';

type Props = NativeStackScreenProps<RootStackParamList, 'Browser'>;

type Folder = { kind: 'folder'; prefix: string; name: string };
type FileRow = { kind: 'file'; entry: S3ListEntry; name: string };
type VersionRow = { kind: 'version'; v: ObjectVersion; name: string; child?: boolean };
type VersionGroup = {
  key: string;
  name: string;
  versions: ObjectVersion[];
  latestIsDelete: boolean;
  totalBytes: number;
};
type VGroupRow = { kind: 'vgroup'; group: VersionGroup };
type Row = Folder | FileRow | VersionRow | VGroupRow;

const verKey = (v: ObjectVersion) => `${v.key}\t${v.versionId}`;
type Mode = 'browse' | 'select' | 'move';
type SortMode = 'name' | 'size' | 'recent';
type Cursor = { token?: string; km?: string; vm?: string };

const prefixOf = (key: string) => key.slice(0, key.lastIndexOf('/') + 1);
const baseName = (key: string) => key.slice(key.lastIndexOf('/') + 1);
const uniq = (a: string[]) => Array.from(new Set(a));

export function BrowserScreen({ navigation }: Props) {
  const [prefix, setPrefix] = useState('');
  const [folders, setFolders] = useState<Folder[]>([]);
  const [files, setFiles] = useState<FileRow[]>([]);
  const [versionRows, setVersionRows] = useState<VersionRow[]>([]);
  const [showVersions, setShowVersions] = useState(false);
  const [nextToken, setNextToken] = useState<string | undefined>();
  const [nextVer, setNextVer] = useState<{ km?: string; vm?: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [configured, setConfigured] = useState(true);

  const [mode, setMode] = useState<Mode>('browse');
  const [selected, setSelected] = useState<string[]>([]);
  const [selVers, setSelVers] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [folderSizes, setFolderSizes] = useState<
    Record<string, { bytes: number; count: number } | 'loading'>
  >({});
  const [sortMode, setSortMode] = useState<SortMode>('name');
  const [op, setOp] = useState<
    { label: string; done: number; total: number; pct?: number } | null
  >(null);
  const [sheet, setSheet] = useState(false);
  const [toolsMenu, setToolsMenu] = useState(false);
  const [folderMenu, setFolderMenu] = useState<{ prefix: string; name: string } | null>(null);
  const [prompt, setPrompt] = useState<
    { kind: 'newFolder' } | { kind: 'rename'; key: string } | null
  >(null);

  const { summary, hydrate: hydrateQueue } = useUploader();

  useLayoutEffect(() => {
    navigation.setOptions({
      // eslint-disable-next-line react/no-unstable-nested-components
      headerRight: () => (
        <Pressable onPress={() => navigation.navigate('Profiles')} hitSlop={12}>
          <Text style={styles.headerBtn}>Profils</Text>
        </Pressable>
      ),
    });
  }, [navigation]);

  const load = useCallback(
    async (p: string, cursor?: Cursor) => {
      setLoading(true);
      setError(null);
      const more = cursor != null;
      if (!more) setFolderSizes({}); // tailles recalculées à chaque changement de dossier
      const toFolders = (prefixes: string[], markers: string[]): Folder[] =>
        uniq([...prefixes, ...markers])
          .map(cp => ({
            kind: 'folder' as const,
            prefix: cp,
            name: cp.slice(p.length).replace(/\/$/, ''),
          }))
          .sort((a, b) => a.name.localeCompare(b.name));
      try {
        if (showVersions) {
          // récursif (sans delimiter) : les dossiers sont dérivés des clés, donc
          // même un dossier entièrement supprimé (que des delete markers) apparaît
          const res = await S3Uploader.listObjectVersions(p, cursor?.km, cursor?.vm, true);
          const subFolders = new Set<string>();
          const vr: VersionRow[] = [];
          for (const v of res.versions) {
            if (v.key === p) continue; // marqueur du dossier courant lui-même
            const rel = v.key.slice(p.length);
            const slash = rel.indexOf('/');
            if (slash >= 0) {
              subFolders.add(p + rel.slice(0, slash + 1));
            } else if (!v.key.endsWith('/')) {
              vr.push({ kind: 'version', v, name: rel });
            }
          }
          const fs: Folder[] = Array.from(subFolders)
            .map(pfx => ({
              kind: 'folder' as const,
              prefix: pfx,
              name: pfx.slice(p.length).replace(/\/$/, ''),
            }))
            .sort((a, b) => a.name.localeCompare(b.name));
          setFolders(prev => {
            const all = more ? [...prev, ...fs] : fs;
            const seen = new Set<string>();
            return all.filter(f => (seen.has(f.prefix) ? false : seen.add(f.prefix)));
          });
          setVersionRows(prev => (more ? [...prev, ...vr] : vr));
          setNextVer(
            res.nextKeyMarker || res.nextVersionIdMarker
              ? { km: res.nextKeyMarker, vm: res.nextVersionIdMarker }
              : null,
          );
          setNextToken(undefined);
        } else {
          const res = await S3Uploader.listObjects(p, cursor?.token);
          const markers = res.objects
            .filter(o => o.key.endsWith('/') && o.key !== p)
            .map(o => o.key);
          const fs = toFolders(res.prefixes, markers);
          const os: FileRow[] = res.objects
            .filter(o => !o.key.endsWith('/'))
            .map(o => ({ kind: 'file' as const, entry: o, name: o.key.slice(p.length) }));
          setFolders(prev => (more ? [...prev, ...fs] : fs));
          setFiles(prev => (more ? [...prev, ...os] : os));
          setNextToken(res.nextToken);
          setNextVer(null);
        }
      } catch (e: any) {
        setError(String(e?.message ?? e));
        if (!more) {
          setFolders([]);
          setFiles([]);
          setVersionRows([]);
        }
      } finally {
        setLoading(false);
      }
    },
    [showVersions],
  );

  useEffect(() => {
    load(prefix);
  }, [prefix, load]);

  useEffect(() => {
    const sub = S3Uploader.onMoveProgress(e => {
      if (e.filesTotal <= 0) return;
      const pct =
        e.bytesTotal > 0 ? Math.round((e.bytesCopied / e.bytesTotal) * 100) : 0;
      setOp({ label: 'Déplacement', done: e.filesDone, total: e.filesTotal, pct });
    });
    return () => sub.remove();
  }, []);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const ok = await applyNativeConfig();
        setConfigured(ok);
        if (ok) load(prefix);
        hydrateQueue();
      })();
    }, [prefix, load, hydrateQueue]),
  );

  const reload = useCallback(() => load(prefix), [load, prefix]);

  const sortedFiles = useMemo(() => {
    const arr = [...files];
    if (sortMode === 'size') arr.sort((a, b) => b.entry.size - a.entry.size);
    else if (sortMode === 'recent') {
      arr.sort(
        (a, b) =>
          (Date.parse(b.entry.lastModified ?? '') || 0) -
          (Date.parse(a.entry.lastModified ?? '') || 0),
      );
    } else arr.sort((a, b) => a.name.localeCompare(b.name));
    return arr;
  }, [files, sortMode]);

  // versions groupées par objet (petite arborescence)
  const versionGroups = useMemo(() => {
    const map = new Map<string, ObjectVersion[]>();
    for (const r of versionRows) {
      const a = map.get(r.v.key) ?? [];
      a.push(r.v);
      map.set(r.v.key, a);
    }
    const groups: VersionGroup[] = [];
    for (const [key, vs] of map) {
      vs.sort(
        (a, b) =>
          (Date.parse(b.lastModified ?? '') || 0) - (Date.parse(a.lastModified ?? '') || 0),
      );
      groups.push({
        key,
        name: key.slice(prefix.length),
        versions: vs,
        latestIsDelete: vs[0]?.isDeleteMarker ?? false,
        totalBytes: vs.reduce((s, v) => s + v.size, 0),
      });
    }
    if (sortMode === 'size') groups.sort((a, b) => b.totalBytes - a.totalBytes);
    else if (sortMode === 'recent') {
      groups.sort(
        (a, b) =>
          (Date.parse(b.versions[0]?.lastModified ?? '') || 0) -
          (Date.parse(a.versions[0]?.lastModified ?? '') || 0),
      );
    } else groups.sort((a, b) => a.name.localeCompare(b.name));
    return groups;
  }, [versionRows, prefix, sortMode]);

  const versionDisplayRows = useMemo(() => {
    const out: Row[] = [...folders];
    for (const g of versionGroups) {
      if (g.versions.length <= 1) {
        out.push({ kind: 'version', v: g.versions[0], name: g.name });
      } else {
        out.push({ kind: 'vgroup', group: g });
        if (expanded.includes(g.key)) {
          for (const v of g.versions) {
            out.push({ kind: 'version', v, name: g.name, child: true });
          }
        }
      }
    }
    return out;
  }, [folders, versionGroups, expanded]);

  const rows: Row[] = useMemo(
    () => (showVersions ? versionDisplayRows : [...folders, ...sortedFiles]),
    [showVersions, versionDisplayRows, folders, sortedFiles],
  );

  // en mode déplacement : on n'affiche que les dossiers (destinations) + les fichiers déplacés
  const displayRows = useMemo(
    () =>
      mode === 'move'
        ? rows.filter(r => r.kind === 'folder' || (r.kind === 'file' && selected.includes(r.entry.key)))
        : rows,
    [rows, mode, selected],
  );

  // --- Sélection --------------------------------------------------------------

  const exitMode = () => {
    setMode('browse');
    setSelected([]);
    setSelVers([]);
  };
  const toggle = (key: string) =>
    setSelected(prev => {
      const next = prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key];
      if (next.length === 0 && mode === 'select') setMode('browse');
      return next;
    });
  const toggleVer = (v: ObjectVersion) => {
    const id = verKey(v);
    setMode('select');
    setSelVers(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
      if (next.length === 0) setMode('browse');
      return next;
    });
  };
  const selectAllOldVersions = () =>
    setSelVers(versionRows.filter(r => !r.v.isLatest).map(r => verKey(r.v)));
  const toggleExpand = (key: string) =>
    setExpanded(prev => (prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]));
  const selectAll = () => setSelected(sortedFiles.map(f => f.entry.key));

  const onFilePress = (entry: S3ListEntry) => {
    if (mode === 'move') return;
    if (mode === 'browse') {
      setMode('select');
      setSelected([entry.key]);
    } else {
      toggle(entry.key);
    }
  };

  // --- Opérations batch -----------------------------------------------------

  const runBatch = async (
    label: string,
    keys: string[],
    fn: (key: string) => Promise<void>,
  ) => {
    setOp({ label, done: 0, total: keys.length });
    let failed = 0;
    for (let i = 0; i < keys.length; i++) {
      try {
        await fn(keys[i]);
      } catch {
        failed++;
      }
      setOp({ label, done: i + 1, total: keys.length });
    }
    setOp(null);
    exitMode();
    reload();
    if (failed) Alert.alert('Terminé avec des erreurs', `${failed}/${keys.length} en échec.`);
  };

  const runMove = async (pairs: { src: string; dst: string }[]) => {
    if (!pairs.length) return;
    setOp({ label: 'Déplacement', done: 0, total: pairs.length, pct: 0 });
    try {
      const res = await S3Uploader.moveObjects(pairs);
      if (res.failed) {
        Alert.alert(
          'Déplacement terminé',
          `${res.moved} ok · ${res.failed} en échec\n` + res.errors.slice(0, 6).join('\n'),
        );
      }
    } catch (e: any) {
      Alert.alert('Échec', String(e?.message ?? e));
    } finally {
      setOp(null);
      exitMode();
      reload();
    }
  };

  const pasteHere = () => {
    const conflict = selected.some(k => prefixOf(k) === prefix);
    if (conflict) {
      Alert.alert('Destination invalide', 'Certains fichiers sont déjà dans ce dossier.');
      return;
    }
    runMove(selected.map(k => ({ src: k, dst: joinKey(prefix, baseName(k)) })));
  };

  const deleteSelected = () => {
    Alert.alert(
      `Supprimer ${selected.length} fichier(s) ?`,
      'Action irréversible.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: () => runBatch('Suppression', selected, k => S3Uploader.deleteObject(k)),
        },
      ],
      { cancelable: true },
    );
  };

  const deleteSelectedVersions = () => {
    const targets = versionRows
      .filter(r => selVers.includes(verKey(r.v)))
      .map(r => r.v);
    if (!targets.length) return;
    Alert.alert(
      `Supprimer ${targets.length} version(s) ?`,
      'Définitif. Supprimer un marqueur 🗑 restaure le fichier.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: () =>
            runBatch('Suppression', targets.map(verKey), async id => {
              const [k, vid] = id.split('\t');
              await S3Uploader.deleteVersion(k, vid);
            }),
        },
      ],
      { cancelable: true },
    );
  };

  const computeFolderSize = async (folderPrefix: string) => {
    setFolderSizes(s => ({ ...s, [folderPrefix]: 'loading' }));
    try {
      const { totalBytes, objectCount } = await S3Uploader.prefixStats(folderPrefix);
      setFolderSizes(s => ({ ...s, [folderPrefix]: { bytes: totalBytes, count: objectCount } }));
    } catch {
      setFolderSizes(s => {
        const n = { ...s };
        delete n[folderPrefix];
        return n;
      });
    }
  };

  const showScopeSize = async (scopePrefix: string, label: string) => {
    setOp({ label: 'Calcul de la taille', done: 0, total: 0 });
    const sub = S3Uploader.onScanProgress(e => {
      setOp({
        label: `${formatBytes(e.bytes)} · ${e.count} objets`,
        done: 0,
        total: 0,
      });
    });
    try {
      const { totalBytes, objectCount } = await S3Uploader.prefixStats(scopePrefix);
      Alert.alert(label, `${formatBytes(totalBytes)} · ${objectCount} objet(s)`);
    } catch (e: any) {
      Alert.alert('Échec du calcul', String(e?.message ?? e));
    } finally {
      sub.remove();
      setOp(null);
    }
  };

  const submitPrompt = (value: string) => {
    const p = prompt;
    setPrompt(null);
    const name = sanitizeSegment(value);
    if (!p || !name) return;
    if (p.kind === 'newFolder') {
      runBatch('Création', ['x'], async () => {
        await S3Uploader.createFolder(prefix, name);
      });
    } else {
      runMove([{ src: p.key, dst: joinKey(prefixOf(p.key), name) }]);
    }
  };

  // --- Ajouts (FAB) --------------------------------------------------------

  const addFiles = async () => {
    try {
      const res = await addFilesTo(prefix);
      if (res) {
        hydrateQueue();
        const msg = summarizeEnqueue(res);
        if (msg) Alert.alert('File d’attente', msg);
      }
    } catch (e: any) {
      if (e?.code !== 'OPERATION_CANCELED') Alert.alert('Erreur', String(e?.message ?? e));
    }
  };
  const addFolder = async () => {
    setOp({ label: 'Lecture du dossier', done: 0, total: 0 });
    try {
      const res = await addFolderTo(prefix, (rootName, count) => {
        setOp(null);
        return new Promise(resolve => {
          Alert.alert(
            `Importer « ${rootName} »`,
            `${count} fichier(s) → /${prefix}\nUploader le dossier lui-même, ou seulement son contenu ?`,
            [
              { text: 'Annuler', style: 'cancel', onPress: () => resolve(null) },
              { text: 'Le contenu', onPress: () => resolve('contents') },
              { text: `« ${rootName}/ »`, onPress: () => resolve('root') },
            ],
            { cancelable: true, onDismiss: () => resolve(null) },
          );
        });
      });
      if (res) {
        hydrateQueue();
        const msg = summarizeEnqueue(res);
        if (msg) Alert.alert('File d’attente', msg);
      }
    } catch (e: any) {
      if (e?.code !== 'OPERATION_CANCELED') Alert.alert('Erreur', String(e?.message ?? e));
    } finally {
      setOp(null);
    }
  };

  const deleteFolder = (folderPrefix: string) => {
    Alert.alert(
      'Supprimer ce dossier ?',
      folderPrefix + '\nTout son contenu sera supprimé.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: async () => {
            setOp({ label: 'Suppression', done: 0, total: 0 });
            try {
              const { deleted } = await S3Uploader.deletePrefix(folderPrefix);
              reload();
              Alert.alert('Supprimé', `${deleted} objet(s).`);
            } catch (e: any) {
              Alert.alert('Échec', String(e?.message ?? e));
            } finally {
              setOp(null);
            }
          },
        },
      ],
      { cancelable: true },
    );
  };

  const deleteOrRestore = (v: ObjectVersion) => {
    const restore = v.isDeleteMarker && v.isLatest;
    Alert.alert(
      restore
        ? 'Restaurer ce fichier ?'
        : v.isDeleteMarker
          ? 'Supprimer ce marqueur ?'
          : 'Supprimer cette version ?',
      restore
        ? `${v.key}\nLe marqueur de suppression sera retiré, la version précédente redevient l’actuelle.`
        : `${v.key}\n${v.isDeleteMarker ? 'marqueur de suppression' : formatBytes(v.size)} · ${shortDate(
            v.lastModified,
          )}`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: restore ? 'Restaurer' : 'Supprimer',
          style: 'destructive',
          onPress: async () => {
            setOp({ label: 'Suppression', done: 0, total: 0 });
            try {
              await S3Uploader.deleteVersion(v.key, v.versionId);
              reload();
            } catch (e: any) {
              Alert.alert('Échec', String(e?.message ?? e));
            } finally {
              setOp(null);
            }
          },
        },
      ],
      { cancelable: true },
    );
  };

  const purgeVersions = (scopePrefix: string, label: string) => {
    Alert.alert(
      'Purger les anciennes versions ?',
      `${label}\nToutes les versions non courantes seront supprimées (irréversible).`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Purger',
          style: 'destructive',
          onPress: async () => {
            setOp({ label: 'Purge des versions', done: 0, total: 0 });
            try {
              const { deleted } = await S3Uploader.purgeOldVersions(scopePrefix);
              reload();
              Alert.alert('Purge terminée', `${deleted} version(s) supprimée(s).`);
            } catch (e: any) {
              Alert.alert('Échec', String(e?.message ?? e));
            } finally {
              setOp(null);
            }
          },
        },
      ],
      { cancelable: true },
    );
  };

  // --- Rendu -------------------------------------------------------------

  if (!configured) {
    return (
      <View style={styles.container}>
        <Pressable style={styles.center} onPress={() => navigation.navigate('Profiles')}>
          <Text style={styles.dimText}>
            Aucun profil S3 actif (ou clés manquantes).{'\n'}Appuie pour en configurer un.
          </Text>
        </Pressable>
      </View>
    );
  }

  const segments = prefix.split('/').filter(Boolean);

  return (
    <View style={styles.container}>
      {/* Barre supérieure : mode-dépendante */}
      {mode === 'browse' ? (
        <View style={styles.topBar}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.crumbScroll}
            contentContainerStyle={styles.crumbs}>
            <Crumb label="Bucket" onPress={() => setPrefix('')} active={!segments.length} />
            {segments.map((seg, i) => (
              <React.Fragment key={i}>
                <Text style={styles.sep}>›</Text>
                <Crumb
                  label={seg}
                  active={i === segments.length - 1}
                  onPress={() => setPrefix(segments.slice(0, i + 1).join('/') + '/')}
                />
              </React.Fragment>
            ))}
          </ScrollView>
          {!showVersions ? (
            <Pressable
              onPress={() => setPrompt({ kind: 'newFolder' })}
              hitSlop={8}
              style={styles.topAction}>
              <Text style={styles.topActionText}>＋dossier</Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={() => {
              setShowVersions(v => !v);
              exitMode();
            }}
            hitSlop={8}
            style={styles.topAction}>
            <Text style={[styles.topActionText, showVersions && styles.topActionOn]}>
              {showVersions ? '← fichiers' : 'versions'}
            </Text>
          </Pressable>
          <Pressable onPress={cycleSort(sortMode, setSortMode)} hitSlop={8} style={styles.topAction}>
            <Text style={styles.sortBtn}>{sortLabel(sortMode)}</Text>
          </Pressable>
          <Pressable onPress={() => setToolsMenu(true)} hitSlop={8} style={styles.topAction}>
            <Text style={styles.topActionText}>⋮</Text>
          </Pressable>
        </View>
      ) : (
        <View style={[styles.actionBar, mode === 'move' && styles.actionBarMove]}>
          <Pressable onPress={exitMode} hitSlop={10}>
            <Text style={styles.abClose}>✕</Text>
          </Pressable>
          {mode === 'select' && showVersions ? (
            <>
              <Text style={styles.abTitle}>{selVers.length} version(s)</Text>
              <Pressable onPress={selectAllOldVersions} hitSlop={8}>
                <Text style={styles.abAction}>Anciennes</Text>
              </Pressable>
              <Pressable onPress={deleteSelectedVersions} hitSlop={8} disabled={!selVers.length}>
                <Text
                  style={[styles.abAction, styles.abDanger, !selVers.length && styles.abDisabled]}>
                  Suppr.
                </Text>
              </Pressable>
            </>
          ) : mode === 'select' ? (
            <>
              <Text style={styles.abTitle}>{selected.length} sélectionné(s)</Text>
              <Pressable onPress={selectAll} hitSlop={8}>
                <Text style={styles.abAction}>Tout</Text>
              </Pressable>
              <Pressable onPress={() => setMode('move')} hitSlop={8} disabled={!selected.length}>
                <Text style={[styles.abAction, !selected.length && styles.abDisabled]}>
                  Déplacer
                </Text>
              </Pressable>
              {selected.length === 1 ? (
                <>
                  <Pressable
                    onPress={() => setPrompt({ kind: 'rename', key: selected[0] })}
                    hitSlop={8}>
                    <Text style={styles.abAction}>Renommer</Text>
                  </Pressable>
                  <Pressable
                    onPress={() =>
                      navigation.navigate('Versions', { objectKey: selected[0] })
                    }
                    hitSlop={8}>
                    <Text style={styles.abAction}>Versions</Text>
                  </Pressable>
                </>
              ) : null}
              <Pressable onPress={deleteSelected} hitSlop={8} disabled={!selected.length}>
                <Text style={[styles.abAction, styles.abDanger, !selected.length && styles.abDisabled]}>
                  Suppr.
                </Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.abTitle} numberOfLines={1}>
                Déplacer {selected.length} → /{prefix}
              </Text>
              <Pressable onPress={pasteHere} hitSlop={8}>
                <Text style={styles.abPaste}>Coller ici</Text>
              </Pressable>
            </>
          )}
        </View>
      )}

      {mode === 'move' ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.crumbs}
          style={styles.moveCrumbs}>
          <Crumb label="Bucket" onPress={() => setPrefix('')} active={!segments.length} />
          {segments.map((seg, i) => (
            <React.Fragment key={i}>
              <Text style={styles.sep}>›</Text>
              <Crumb
                label={seg}
                active={i === segments.length - 1}
                onPress={() => setPrefix(segments.slice(0, i + 1).join('/') + '/')}
              />
            </React.Fragment>
          ))}
        </ScrollView>
      ) : null}

      {op ? (
        <View>
          <View style={styles.opBar}>
            <ActivityIndicator size="small" color="#fff" />
            <Text style={styles.opText}>
              {op.label}
              {op.total > 1 ? ` ${op.done}/${op.total}` : ''}
              {op.pct != null ? ` · ${op.pct}%` : op.total > 1 ? '' : '…'}
            </Text>
          </View>
          {op.pct != null ? (
            <View style={styles.opTrack}>
              <View style={[styles.opFill, { width: `${op.pct}%` }]} />
            </View>
          ) : null}
        </View>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <FlatList
        data={displayRows}
        keyExtractor={r =>
          r.kind === 'folder'
            ? `f:${r.prefix}`
            : r.kind === 'vgroup'
              ? `g:${r.group.key}`
              : r.kind === 'version'
                ? `v:${r.v.key}:${r.v.versionId}`
                : `o:${r.entry.key}`
        }
        contentContainerStyle={rows.length ? styles.listPad : styles.emptyWrap}
        refreshControl={
          <RefreshControl refreshing={loading && rows.length === 0} onRefresh={reload} />
        }
        ListEmptyComponent={loading ? undefined : <Text style={styles.dimText}>Dossier vide</Text>}
        renderItem={({ item }) =>
          item.kind === 'folder' ? (
            <Pressable
              style={styles.row}
              onPress={() => setPrefix(item.prefix)}
              onLongPress={() =>
                mode === 'browse' && setFolderMenu({ prefix: item.prefix, name: item.name })
              }>
              <Text style={styles.folderIcon}>📁</Text>
              <View style={styles.rowMain}>
                <Text style={styles.rowName} numberOfLines={1}>
                  {item.name}
                </Text>
                {folderSizes[item.prefix] && folderSizes[item.prefix] !== 'loading' ? (
                  <Text style={styles.rowMeta}>
                    {formatBytes((folderSizes[item.prefix] as { bytes: number }).bytes)} ·{' '}
                    {(folderSizes[item.prefix] as { count: number }).count} obj.
                  </Text>
                ) : null}
              </View>
              {folderSizes[item.prefix] === 'loading' ? (
                <ActivityIndicator size="small" />
              ) : !folderSizes[item.prefix] ? (
                <Pressable hitSlop={10} onPress={() => computeFolderSize(item.prefix)}>
                  <Text style={styles.sumBtn}>∑</Text>
                </Pressable>
              ) : null}
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          ) : item.kind === 'vgroup' ? (
            <Pressable
              style={[styles.row, item.group.latestIsDelete && styles.rowGhost]}
              onPress={() => toggleExpand(item.group.key)}>
              <Text style={styles.chevron}>
                {expanded.includes(item.group.key) ? '▾' : '▸'}
              </Text>
              <View style={styles.rowMain}>
                <Text style={styles.rowName} numberOfLines={1}>
                  {item.group.name || baseName(item.group.key)}
                </Text>
                <Text style={styles.rowMeta}>
                  {item.group.versions.length} versions ·{' '}
                  {formatBytes(item.group.totalBytes)}
                </Text>
              </View>
              <Text
                style={[
                  styles.verTag,
                  item.group.latestIsDelete ? styles.verTagDeleted : styles.verTagCurrent,
                ]}>
                {item.group.latestIsDelete ? 'supprimé' : 'actuelle'}
              </Text>
            </Pressable>
          ) : item.kind === 'version' ? (
            <Pressable
              style={[
                styles.row,
                item.child && styles.rowChild,
                !item.v.isLatest && styles.rowGhost,
              ]}
              onPress={() => toggleVer(item.v)}
              onLongPress={() => deleteOrRestore(item.v)}>
              {mode === 'select' ? (
                <View
                  style={[styles.check, selVers.includes(verKey(item.v)) && styles.checkOn]}>
                  {selVers.includes(verKey(item.v)) ? (
                    <Text style={styles.checkMark}>✓</Text>
                  ) : null}
                </View>
              ) : (
                <Text style={styles.fileIcon}>{item.v.isDeleteMarker ? '🗑' : '·'}</Text>
              )}
              <View style={styles.rowMain}>
                <Text style={styles.rowName} numberOfLines={1}>
                  {item.name || baseName(item.v.key)}
                </Text>
                <Text style={styles.rowMeta}>
                  {item.v.isDeleteMarker ? 'marqueur de suppression' : formatBytes(item.v.size)}
                  {item.v.lastModified ? ` · ${shortDate(item.v.lastModified)}` : ''}
                </Text>
              </View>
              <Text
                style={[
                  styles.verTag,
                  item.v.isLatest && !item.v.isDeleteMarker && styles.verTagCurrent,
                  item.v.isDeleteMarker && styles.verTagDeleted,
                ]}>
                {item.v.isDeleteMarker ? 'supprimé' : item.v.isLatest ? 'actuelle' : 'ancienne'}
              </Text>
            </Pressable>
          ) : (
            <Pressable
              style={[styles.row, mode === 'move' && styles.rowMoving]}
              onPress={() => onFilePress(item.entry)}
              onLongPress={() => onFilePress(item.entry)}>
              {mode === 'select' ? (
                <View style={[styles.check, selected.includes(item.entry.key) && styles.checkOn]}>
                  {selected.includes(item.entry.key) ? <Text style={styles.checkMark}>✓</Text> : null}
                </View>
              ) : (
                <Text style={styles.fileIcon}>·</Text>
              )}
              <View style={styles.rowMain}>
                <Text style={styles.rowName} numberOfLines={1}>
                  {item.name || baseName(item.entry.key)}
                </Text>
                <Text style={styles.rowMeta}>
                  {formatBytes(item.entry.size)}
                  {item.entry.lastModified ? ` · ${shortDate(item.entry.lastModified)}` : ''}
                </Text>
              </View>
            </Pressable>
          )
        }
        ListHeaderComponent={
          showVersions ? (
            <Text style={styles.verHint}>
              Toutes les versions. Tape pour sélectionner, appui long = supprimer / restaurer.
              {'\n'}Un fichier « supprimé » se restaure en retirant son marqueur 🗑.
            </Text>
          ) : undefined
        }
        ListFooterComponent={
          <View style={styles.footer}>
            {loading && rows.length > 0 ? <ActivityIndicator /> : null}
            {!loading && (showVersions ? nextVer != null : nextToken != null) ? (
              <Pressable
                style={styles.moreBtn}
                onPress={() =>
                  load(prefix, showVersions ? { km: nextVer?.km, vm: nextVer?.vm } : { token: nextToken })
                }>
                <Text style={styles.moreText}>Charger plus</Text>
              </Pressable>
            ) : null}
          </View>
        }
      />

      {summary.totalCount > 0 ? (
        <Pressable style={styles.queueBanner} onPress={() => navigation.navigate('Queue')}>
          <View style={styles.queueBarTrack}>
            <View style={[styles.queueBarFill, { width: `${summary.pct}%` }]} />
          </View>
          <View style={styles.queueRow}>
            <Text style={styles.queueText}>{queueLabel(summary)}</Text>
            <Text style={styles.queueChevron}>›</Text>
          </View>
        </Pressable>
      ) : null}

      {mode === 'browse' && !op ? (
        <Pressable style={styles.fab} onPress={() => setSheet(true)}>
          <Text style={styles.fabText}>+</Text>
        </Pressable>
      ) : null}

      <ActionSheet
        visible={sheet}
        title={`Ajouter dans ${prefix ? '/' + prefix : 'la racine'}`}
        options={[
          { label: 'Fichiers…', onPress: addFiles },
          { label: 'Dossier Android…', onPress: addFolder },
        ]}
        onClose={() => setSheet(false)}
      />

      <ActionSheet
        visible={toolsMenu}
        title="Outils"
        options={[
          {
            label: 'Taille de ce dossier',
            onPress: () =>
              showScopeSize(prefix, prefix ? `/${prefix}` : 'Racine du bucket'),
          },
          {
            label: 'Taille du dépôt',
            onPress: () => showScopeSize('', 'Dépôt entier'),
          },
          {
            label: 'Purger les anciennes versions (dossier courant)',
            destructive: true,
            onPress: () =>
              purgeVersions(prefix, prefix ? `/${prefix}` : 'racine du bucket'),
          },
          {
            label: 'Purger les anciennes versions (tout le bucket)',
            destructive: true,
            onPress: () => purgeVersions('', 'tout le bucket'),
          },
        ]}
        onClose={() => setToolsMenu(false)}
      />

      <ActionSheet
        visible={folderMenu != null}
        title={folderMenu ? folderMenu.name + '/' : undefined}
        options={
          folderMenu
            ? [
                {
                  label: 'Purger les anciennes versions',
                  onPress: () =>
                    purgeVersions(folderMenu.prefix, `/${folderMenu.prefix}`),
                },
                {
                  label: 'Supprimer le dossier et son contenu',
                  destructive: true,
                  onPress: () => deleteFolder(folderMenu.prefix),
                },
              ]
            : []
        }
        onClose={() => setFolderMenu(null)}
      />

      <PromptModal
        visible={prompt != null}
        title={prompt?.kind === 'rename' ? 'Renommer' : 'Nouveau dossier'}
        initial={prompt?.kind === 'rename' ? baseName(prompt.key) : ''}
        placeholder={prompt?.kind === 'rename' ? 'Nouveau nom' : 'Nom du dossier'}
        onCancel={() => setPrompt(null)}
        onSubmit={submitPrompt}
      />
    </View>
  );
}

// --- Sous-composants -------------------------------------------------------

function Crumb({ label, onPress, active }: { label: string; onPress: () => void; active: boolean }) {
  return (
    <Pressable onPress={onPress} hitSlop={6}>
      <Text style={[styles.crumb, active && styles.crumbActive]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

// --- Helpers -------------------------------------------------------------

function shortDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString();
}
function sortLabel(m: SortMode): string {
  return m === 'name' ? 'A→Z' : m === 'size' ? 'Taille' : 'Récent';
}
function cycleSort(m: SortMode, set: (m: SortMode) => void) {
  return () => set(m === 'name' ? 'size' : m === 'size' ? 'recent' : 'name');
}
function queueLabel(s: {
  failedCount: number;
  activeCount: number;
  pct: number;
  speedBps: number;
  doneCount: number;
  totalCount: number;
}): string {
  if (s.failedCount > 0) return `File d’attente — ${s.failedCount} échec(s)`;
  if (s.activeCount > 0)
    return `${s.activeCount} en cours · ${s.pct}% · ${formatSpeed(s.speedBps)}`;
  return `${s.doneCount}/${s.totalCount} terminé(s)`;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerBtn: { color: '#0a84ff', fontSize: 15, fontWeight: '600' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  dimText: { textAlign: 'center', opacity: 0.6, fontSize: 14, lineHeight: 20 },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#8886',
  },
  crumbScroll: { flex: 1 },
  topAction: { paddingLeft: 12 },
  topActionText: { fontSize: 12, color: '#0a84ff', fontWeight: '600' },
  topActionOn: { color: '#fff', backgroundColor: '#0a84ff', paddingHorizontal: 6, borderRadius: 4 },
  crumbs: { alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, gap: 6 },
  moveCrumbs: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#8886' },
  crumb: { fontSize: 13, color: '#0a84ff', maxWidth: 160 },
  crumbActive: { color: '#8e8e93', fontWeight: '700' },
  sep: { opacity: 0.4, marginHorizontal: 2 },
  sortBtn: { fontSize: 12, color: '#0a84ff', fontWeight: '600' },

  actionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#0a84ff',
  },
  actionBarMove: { backgroundColor: '#1b5e20' },
  abClose: { color: '#fff', fontSize: 16, fontWeight: '700' },
  abTitle: { color: '#fff', fontSize: 14, fontWeight: '600', flex: 1 },
  abAction: { color: '#fff', fontSize: 13, fontWeight: '700' },
  abDanger: { color: '#ffd7d7' },
  abDisabled: { opacity: 0.4 },
  abPaste: { color: '#fff', fontSize: 14, fontWeight: '800' },

  opBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#333',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  opText: { color: '#fff', fontSize: 13 },
  opTrack: { height: 3, backgroundColor: '#555' },
  opFill: { height: 3, backgroundColor: '#0a84ff' },

  error: { color: '#c62828', padding: 12, fontSize: 13 },
  listPad: { paddingBottom: 180 },
  emptyWrap: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 120 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#8884',
  },
  rowMoving: { backgroundColor: 'rgba(27,94,32,0.12)' },
  rowGhost: { opacity: 0.5 },
  rowChild: { paddingLeft: 40, backgroundColor: 'rgba(128,128,128,0.06)' },
  sumBtn: { fontSize: 18, color: '#0a84ff', paddingHorizontal: 8 },
  verHint: { fontSize: 11, opacity: 0.55, paddingHorizontal: 16, paddingVertical: 10 },
  verTag: {
    fontSize: 11,
    opacity: 0.6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#888',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  verTagCurrent: { color: '#fff', backgroundColor: '#1b5e20', borderColor: '#1b5e20', opacity: 1 },
  verTagDeleted: { color: '#fff', backgroundColor: '#b71c1c', borderColor: '#b71c1c', opacity: 1 },
  rowMain: { flex: 1 },
  rowName: { flex: 1, fontSize: 15 },
  rowMeta: { fontSize: 12, opacity: 0.55, marginTop: 3 },
  folderIcon: { fontSize: 18 },
  fileIcon: { width: 18, textAlign: 'center', opacity: 0.4, fontSize: 18 },
  chevron: { fontSize: 20, opacity: 0.35 },
  check: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#0a84ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: '#0a84ff' },
  checkMark: { color: '#fff', fontSize: 13, fontWeight: '800' },

  footer: { padding: 16, gap: 12, alignItems: 'center' },
  moreBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#0a84ff',
  },
  moreText: { color: '#0a84ff', fontWeight: '600' },

  queueBanner: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: '#1c1c1e' },
  queueBarTrack: { height: 3, backgroundColor: '#3a3a3c' },
  queueBarFill: { height: 3, backgroundColor: '#0a84ff' },
  queueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  queueText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  queueChevron: { color: '#fff', fontSize: 20 },

  fab: {
    position: 'absolute',
    right: 18,
    bottom: 76,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#0a84ff',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 5,
  },
  fabText: { color: '#fff', fontSize: 28, fontWeight: '700', marginTop: -2 },
});

