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
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../../App';
import { applyNativeConfig } from '../../App';
import { S3Uploader, type ObjectVersion } from '../native/S3Uploader';
import { useUploader } from '../useUploader';
import { addFilesTo, addFolderTo, downloadTo, joinKey, summarizeEnqueue } from '../upload';
import { sanitizeSegment } from '../keys';
import { ActionSheet, PromptModal, type SheetOption } from '../components/Sheets';
import { formatBytes, formatBytesExact, formatSpeed } from '../format';

type Props = NativeStackScreenProps<RootStackParamList, 'Browser'>;

type Folder = { kind: 'folder'; prefix: string; name: string; ghost: boolean };
type FileRow = {
  kind: 'file';
  key: string;
  name: string;
  ghost: boolean; // dernière version = marqueur de suppression
  size: number;
  lastModified?: string;
  versionCount: number; // versions réelles (hors marqueurs)
  totalBytes: number; // somme des versions réelles
};
type Row = Folder | FileRow;
type Mode = 'browse' | 'select' | 'move';
type SortMode = 'name' | 'size' | 'recent';
type Cursor = { km?: string; vm?: string };

const prefixOf = (key: string) => key.slice(0, key.lastIndexOf('/') + 1);
const baseName = (key: string) => key.slice(key.lastIndexOf('/') + 1);
const uniq = (a: string[]) => Array.from(new Set(a));

export function BrowserScreen({ navigation }: Props) {
  const [prefix, setPrefix] = useState('');
  const [versions, setVersions] = useState<ObjectVersion[]>([]);
  const [commonPrefixes, setCommonPrefixes] = useState<string[]>([]);
  const [nextVer, setNextVer] = useState<Cursor | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [configured, setConfigured] = useState(true);

  const [mode, setMode] = useState<Mode>('browse');
  const [selected, setSelected] = useState<string[]>([]);
  const [folderSizes, setFolderSizes] = useState<
    Record<string, { bytes: number; count: number } | 'loading'>
  >({});
  const [sortMode, setSortMode] = useState<SortMode>('name');
  const [filter, setFilter] = useState('');
  const [showFilter, setShowFilter] = useState(false);
  const [op, setOp] = useState<
    { label: string; done: number; total: number; pct?: number } | null
  >(null);
  const [sheet, setSheet] = useState(false);
  const [toolsMenu, setToolsMenu] = useState(false);
  const [selMenu, setSelMenu] = useState(false);
  const [folderMenu, setFolderMenu] = useState<{
    prefix: string;
    name: string;
    ghost: boolean;
  } | null>(null);
  const [prompt, setPrompt] = useState<
    | { kind: 'newFolder' }
    | { kind: 'rename'; key: string }
    | { kind: 'renameFolder'; prefix: string }
    | null
  >(null);
  const [moveFolder, setMoveFolder] = useState<{ prefix: string; name: string } | null>(null);

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

  const load = useCallback(async (p: string, cursor?: Cursor) => {
    setLoading(true);
    setError(null);
    const more = cursor != null;
    if (!more) setFolderSizes({});
    try {
      // ?versions avec delimiter "/" : versions + marqueurs des enfants directs,
      // + CommonPrefixes pour les sous-dossiers « vivants »
      const res = await S3Uploader.listObjectVersions(p, cursor?.km, cursor?.vm, false);
      setCommonPrefixes(prev => (more ? uniq([...prev, ...res.prefixes]) : res.prefixes));
      setVersions(prev => (more ? [...prev, ...res.versions] : res.versions));
      setNextVer(
        res.nextKeyMarker || res.nextVersionIdMarker
          ? { km: res.nextKeyMarker, vm: res.nextVersionIdMarker }
          : null,
      );
    } catch (e: any) {
      setError(String(e?.message ?? e));
      if (!more) {
        setVersions([]);
        setCommonPrefixes([]);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(prefix);
  }, [prefix, load]);

  useEffect(() => {
    const m = S3Uploader.onMoveProgress(e => {
      if (e.filesTotal <= 0) return;
      const pct = e.bytesTotal > 0 ? Math.round((e.bytesCopied / e.bytesTotal) * 100) : 0;
      setOp({ label: 'Déplacement', done: e.filesDone, total: e.filesTotal, pct });
    });
    const d = S3Uploader.onDownloadProgress(e => {
      const pct = e.bytesTotal > 0 ? Math.round((e.bytesDone / e.bytesTotal) * 100) : 0;
      setOp({
        label: `Téléchargement · ${e.currentName}`,
        done: e.filesDone,
        total: e.filesTotal,
        pct,
      });
    });
    return () => {
      m.remove();
      d.remove();
    };
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

  // --- Dérivation dossiers + fichiers depuis les versions -------------------

  const folders = useMemo<Folder[]>(() => {
    const map = new Map<string, boolean>(); // prefix -> ghost
    for (const cp of commonPrefixes) map.set(cp, false);
    for (const v of versions) {
      if (v.key === prefix) continue;
      const rel = v.key.slice(prefix.length);
      const slash = rel.indexOf('/');
      if (slash < 0) continue;
      const fp = prefix + rel.slice(0, slash + 1);
      if (map.get(fp) === false) continue; // déjà « vivant »
      const cur = map.get(fp);
      const ghostNow = v.isDeleteMarker && (cur === undefined || cur);
      map.set(fp, ghostNow);
    }
    return Array.from(map.entries())
      .map(([pfx, ghost]) => ({
        kind: 'folder' as const,
        prefix: pfx,
        name: pfx.slice(prefix.length).replace(/\/$/, ''),
        ghost,
      }))
      .sort(
        (a, b) => Number(a.ghost) - Number(b.ghost) || a.name.localeCompare(b.name),
      );
  }, [versions, commonPrefixes, prefix]);

  const fileRows = useMemo<FileRow[]>(() => {
    const byKey = new Map<string, ObjectVersion[]>();
    for (const v of versions) {
      if (v.key === prefix || v.key.endsWith('/')) continue;
      const rel = v.key.slice(prefix.length);
      if (rel.includes('/') || rel === '') continue;
      const a = byKey.get(v.key);
      if (a) a.push(v);
      else byKey.set(v.key, [v]);
    }
    const rows: FileRow[] = [];
    for (const [key, vs] of byKey) {
      vs.sort(
        (a, b) =>
          Number(!!b.isLatest) - Number(!!a.isLatest) ||
          (Date.parse(b.lastModified ?? '') || 0) - (Date.parse(a.lastModified ?? '') || 0),
      );
      const latest = vs.find(x => x.isLatest) ?? vs[0];
      const liveVer = vs.find(x => !x.isDeleteMarker);
      const ghost = !!latest.isDeleteMarker;
      rows.push({
        kind: 'file',
        key,
        name: key.slice(prefix.length),
        ghost,
        size: ghost ? liveVer?.size ?? 0 : latest.size,
        lastModified: latest.lastModified,
        versionCount: vs.filter(x => !x.isDeleteMarker).length,
        totalBytes: vs.reduce((s, x) => s + (x.isDeleteMarker ? 0 : x.size), 0),
      });
    }
    const cmp =
      sortMode === 'size'
        ? (a: FileRow, b: FileRow) => b.size - a.size
        : sortMode === 'recent'
          ? (a: FileRow, b: FileRow) =>
              (Date.parse(b.lastModified ?? '') || 0) - (Date.parse(a.lastModified ?? '') || 0)
          : (a: FileRow, b: FileRow) => a.name.localeCompare(b.name);
    return rows.sort((a, b) => Number(a.ghost) - Number(b.ghost) || cmp(a, b));
  }, [versions, prefix, sortMode]);

  const rows = useMemo<Row[]>(() => [...folders, ...fileRows], [folders, fileRows]);

  const displayRows = useMemo(() => {
    let r = rows;
    if (filter.trim()) {
      const q = filter.trim().toLowerCase();
      r = r.filter(x =>
        (x.kind === 'folder' ? x.name : x.name).toLowerCase().includes(q),
      );
    }
    if (mode === 'move') {
      r = r.filter(x => {
        if (x.kind === 'folder') {
          // en déplacement de dossier : masquer le dossier déplacé et son sous-arbre
          return !moveFolder || !x.prefix.startsWith(moveFolder.prefix);
        }
        return !moveFolder && selected.includes(x.key);
      });
    }
    return r;
  }, [rows, filter, mode, selected, moveFolder]);

  // --- Sélection --------------------------------------------------------------

  const selMeta = useMemo(() => {
    const set = new Set(selected);
    const sel = fileRows.filter(f => set.has(f.key));
    return {
      ghostKeys: sel.filter(f => f.ghost).map(f => f.key),
      liveKeys: sel.filter(f => !f.ghost).map(f => f.key),
      hasGhost: sel.some(f => f.ghost),
      allLive: sel.length > 0 && sel.every(f => !f.ghost),
    };
  }, [selected, fileRows]);

  const exitMode = () => {
    setMode('browse');
    setSelected([]);
    setMoveFolder(null);
  };
  const startMove = () => {
    setFilter('');
    setShowFilter(false);
    setMode('move');
  };
  const startFolderMove = (fp: string, name: string) => {
    setFilter('');
    setShowFilter(false);
    setFolderMenu(null);
    setMoveFolder({ prefix: fp, name });
    setMode('move');
  };
  const toggle = (key: string) =>
    setSelected(prev => {
      const next = prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key];
      if (next.length === 0) setMode('browse');
      return next;
    });
  const selectAll = () => setSelected(fileRows.map(f => f.key));

  const onFileTap = (key: string) => {
    if (mode === 'move') return;
    if (mode === 'browse') {
      setMode('select');
      setSelected([key]);
    } else {
      toggle(key);
    }
  };
  const onFileLongPress = (key: string) => {
    if (mode === 'select' && selected.length) setSelMenu(true);
    else if (mode !== 'move') {
      setMode('select');
      setSelected(prev => (prev.includes(key) ? prev : [...prev, key]));
    }
  };

  // --- Opérations batch -----------------------------------------------------

  const runBatch = async (label: string, keys: string[], fn: (key: string) => Promise<void>) => {
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

  const moveFolderKeys = async (oldPrefix: string, newPrefix: string) => {
    setOp({ label: 'Déplacement', done: 0, total: 0, pct: 0 });
    try {
      const { keys } = await S3Uploader.listKeys(oldPrefix);
      if (!keys.length) {
        Alert.alert('Dossier vide', 'Rien à déplacer.');
        return;
      }
      const pairs = keys.map(k => ({ src: k, dst: newPrefix + k.slice(oldPrefix.length) }));
      const res = await S3Uploader.moveObjects(pairs);
      if (res.failed) {
        Alert.alert('Terminé', `${res.moved} ok · ${res.failed} en échec`);
      }
    } catch (e: any) {
      Alert.alert('Échec', String(e?.message ?? e));
    } finally {
      setOp(null);
      setMoveFolder(null);
      exitMode();
      reload();
    }
  };

  const pasteHere = () => {
    if (moveFolder) {
      const dst = prefix + moveFolder.name + '/';
      if (dst === moveFolder.prefix) {
        Alert.alert('Même emplacement', 'Le dossier est déjà là.');
        return;
      }
      if (prefix.startsWith(moveFolder.prefix)) {
        Alert.alert('Destination invalide', 'On ne peut pas déplacer un dossier dans lui-même.');
        return;
      }
      moveFolderKeys(moveFolder.prefix, dst);
      return;
    }
    if (selected.some(k => prefixOf(k) === prefix)) {
      Alert.alert('Destination invalide', 'Certains fichiers sont déjà dans ce dossier.');
      return;
    }
    runMove(selected.map(k => ({ src: k, dst: joinKey(prefix, baseName(k)) })));
  };

  const softDeleteSelected = () => {
    Alert.alert(
      `Supprimer ${selected.length} fichier(s) ?`,
      'Récupérable via « Restaurer » tant que la version n’est pas purgée.',
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

  const purgeSelected = () => {
    Alert.alert(
      `Supprimer définitivement ${selected.length} objet(s) ?`,
      'Toutes les versions ET les marqueurs seront supprimés. Irréversible.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer déf.',
          style: 'destructive',
          onPress: async () => {
            setOp({ label: 'Suppression définitive', done: 0, total: 0 });
            try {
              const { deleted } = await S3Uploader.purgeKeys(selected);
              Alert.alert('Terminé', `${deleted} version(s) supprimée(s).`);
            } catch (e: any) {
              Alert.alert('Échec', String(e?.message ?? e));
            } finally {
              setOp(null);
              exitMode();
              reload();
            }
          },
        },
      ],
      { cancelable: true },
    );
  };

  const downloadSelected = async () => {
    const items = fileRows
      .filter(f => selected.includes(f.key) && !f.ghost)
      .map(f => ({ key: f.key, size: f.size }));
    if (!items.length) return;
    setOp({ label: 'Téléchargement', done: 0, total: items.length, pct: 0 });
    try {
      const res = await downloadTo(items);
      if (res) {
        Alert.alert(
          res.failed ? 'Terminé avec des erreurs' : 'Téléchargé',
          res.failed
            ? `${res.downloaded} ok · ${res.failed} en échec\n` + res.errors.slice(0, 6).join('\n')
            : `${res.downloaded} fichier(s) enregistré(s).`,
        );
      }
    } catch (e: any) {
      if (e?.code !== 'OPERATION_CANCELED') Alert.alert('Échec', String(e?.message ?? e));
    } finally {
      setOp(null);
      exitMode();
    }
  };

  const restoreSelected = async () => {
    const keys = selMeta.ghostKeys;
    if (!keys.length) return;
    setOp({ label: 'Restauration', done: 0, total: 0 });
    try {
      const { restored } = await S3Uploader.restoreKeys(keys);
      Alert.alert('Restauré', `${restored} fichier(s) restauré(s).`);
    } catch (e: any) {
      Alert.alert('Échec', String(e?.message ?? e));
    } finally {
      setOp(null);
      exitMode();
      reload();
    }
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

  const showScopeSize = async (scopePrefix: string, label: string, allVersions = false) => {
    setOp({ label: 'Calcul de la taille', done: 0, total: 0 });
    const sub = S3Uploader.onScanProgress(e => {
      setOp({ label: `${formatBytes(e.bytes)} · ${e.count} objets`, done: 0, total: 0 });
    });
    try {
      const { totalBytes, objectCount } = await S3Uploader.prefixStats(scopePrefix, allVersions);
      Alert.alert(
        `${label}${allVersions ? ' — toutes versions' : ''}`,
        `${formatBytesExact(totalBytes)}\n${objectCount} objet(s)` +
          (allVersions
            ? ''
            : '\n\n(versions actuelles seulement — « taille réelle » pour le total facturé B2)'),
      );
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
    } else if (p.kind === 'renameFolder') {
      const parent = p.prefix.replace(/[^/]+\/$/, '');
      moveFolderKeys(p.prefix, parent + name + '/');
    } else {
      runMove([{ src: p.key, dst: joinKey(prefixOf(p.key), name) }]);
    }
  };

  // --- Ajouts / dossiers -------------------------------------------------

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
      folderPrefix + '\nTout son contenu sera supprimé (récupérable jusqu’à purge).',
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

  const restoreFolder = async (folderPrefix: string) => {
    setOp({ label: 'Restauration', done: 0, total: 0 });
    try {
      // toutes les clés supprimées sous le préfixe
      const dead = new Set<string>();
      let km: string | undefined;
      let vm: string | undefined;
      let more = true;
      while (more) {
        const r = await S3Uploader.listObjectVersions(folderPrefix, km, vm, true);
        for (const v of r.versions) if (v.isDeleteMarker && v.isLatest) dead.add(v.key);
        km = r.nextKeyMarker;
        vm = r.nextVersionIdMarker;
        more = !!(km || vm);
      }
      const { restored } = await S3Uploader.restoreKeys(Array.from(dead));
      reload();
      Alert.alert('Restauré', `${restored} fichier(s) restauré(s).`);
    } catch (e: any) {
      Alert.alert('Échec', String(e?.message ?? e));
    } finally {
      setOp(null);
    }
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
  const crumbs = (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
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
  );

  const selMenuOptions: SheetOption[] = [];
  if (selected.length === 1 && selMeta.allLive) {
    selMenuOptions.push({
      label: 'Renommer',
      onPress: () => setPrompt({ kind: 'rename', key: selected[0] }),
    });
  }
  if (selMeta.liveKeys.length) {
    selMenuOptions.push({
      label: `Télécharger (${selMeta.liveKeys.length})`,
      onPress: downloadSelected,
    });
  }
  if (selected.length === 1) {
    selMenuOptions.push({
      label: 'Voir les versions',
      onPress: () => navigation.navigate('Versions', { objectKey: selected[0] }),
    });
  }
  if (selMeta.hasGhost) {
    selMenuOptions.push({ label: `Restaurer (${selMeta.ghostKeys.length})`, onPress: restoreSelected });
  }
  selMenuOptions.push({
    label: `Supprimer définitivement (${selected.length})`,
    destructive: true,
    onPress: purgeSelected,
  });

  return (
    <View style={styles.container}>
      {mode === 'browse' ? (
        <View style={styles.topBar}>
          <View style={styles.crumbRow}>{crumbs}</View>
          {showFilter ? (
            <View style={styles.actionsRow}>
              <TextInput
                style={styles.filterInput}
                value={filter}
                onChangeText={setFilter}
                placeholder="Filtrer…"
                placeholderTextColor="#888"
                autoFocus
                autoCapitalize="none"
              />
              <Pressable
                onPress={() => {
                  setFilter('');
                  setShowFilter(false);
                }}
                hitSlop={10}
                style={styles.tBtn}>
                <Text style={styles.tBtnText}>✕</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.actionsRow}>
              <Pressable
                onPress={() => setPrompt({ kind: 'newFolder' })}
                style={styles.tBtn}>
                <Text style={styles.tBtnText}>＋ dossier</Text>
              </Pressable>
              <View style={styles.spacer} />
              <Pressable onPress={() => setShowFilter(true)} style={styles.tBtn}>
                <Text style={styles.tBtnText}>🔍</Text>
              </Pressable>
              <Pressable onPress={cycleSort(sortMode, setSortMode)} style={styles.tBtn}>
                <Text style={styles.tBtnText}>{sortLabel(sortMode)}</Text>
              </Pressable>
              <Pressable onPress={() => setToolsMenu(true)} style={styles.tBtn}>
                <Text style={styles.tBtnText}>⋮</Text>
              </Pressable>
            </View>
          )}
        </View>
      ) : (
        <View style={[styles.actionBar, mode === 'move' && styles.actionBarMove]}>
          <Pressable onPress={exitMode} hitSlop={10}>
            <Text style={styles.abClose}>✕</Text>
          </Pressable>
          {mode === 'select' ? (
            <>
              <Text style={styles.abTitle} numberOfLines={1}>
                {selected.length} sél.
                {selMeta.hasGhost ? ` · ${selMeta.ghostKeys.length} 🗑` : ''}
              </Text>
              <Pressable onPress={selectAll} hitSlop={8}>
                <Text style={styles.abAction}>Tout</Text>
              </Pressable>
              {selMeta.allLive ? (
                <>
                  <Pressable onPress={startMove} hitSlop={8}>
                    <Text style={styles.abAction}>Déplacer</Text>
                  </Pressable>
                  <Pressable onPress={downloadSelected} hitSlop={8}>
                    <Text style={styles.abAction}>Téléch.</Text>
                  </Pressable>
                  <Pressable onPress={() => setSelMenu(true)} hitSlop={8}>
                    <Text style={styles.abAction}>⋯</Text>
                  </Pressable>
                  <Pressable onPress={softDeleteSelected} hitSlop={8}>
                    <Text style={[styles.abAction, styles.abDanger]}>Suppr.</Text>
                  </Pressable>
                </>
              ) : (
                <>
                  {selMeta.hasGhost ? (
                    <Pressable onPress={restoreSelected} hitSlop={8}>
                      <Text style={styles.abAction}>Restaurer</Text>
                    </Pressable>
                  ) : null}
                  <Pressable onPress={() => setSelMenu(true)} hitSlop={8}>
                    <Text style={styles.abAction}>⋯</Text>
                  </Pressable>
                  <Pressable onPress={purgeSelected} hitSlop={8}>
                    <Text style={[styles.abAction, styles.abDanger]}>Suppr. déf.</Text>
                  </Pressable>
                </>
              )}
            </>
          ) : (
            <>
              <Text style={styles.abTitle} numberOfLines={1}>
                {moveFolder
                  ? `Déplacer « ${moveFolder.name} » → /${prefix}`
                  : `Déplacer ${selected.length} → /${prefix}`}
              </Text>
              <Pressable onPress={pasteHere} hitSlop={8}>
                <Text style={styles.abPaste}>Coller ici</Text>
              </Pressable>
            </>
          )}
        </View>
      )}

      {mode === 'move' ? <View style={styles.moveCrumbs}>{crumbs}</View> : null}

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
        keyExtractor={r => (r.kind === 'folder' ? `f:${r.prefix}` : `o:${r.key}`)}
        contentContainerStyle={displayRows.length ? styles.listPad : styles.emptyWrap}
        refreshControl={
          <RefreshControl refreshing={loading && rows.length === 0} onRefresh={reload} />
        }
        ListEmptyComponent={
          loading ? undefined : (
            <Text style={styles.dimText}>{filter ? 'Aucun résultat' : 'Dossier vide'}</Text>
          )
        }
        renderItem={({ item }) =>
          item.kind === 'folder' ? (
            <Pressable
              style={[styles.row, item.ghost && styles.rowGhost]}
              onPress={() => setPrefix(item.prefix)}
              onLongPress={() =>
                mode === 'browse' &&
                setFolderMenu({ prefix: item.prefix, name: item.name, ghost: item.ghost })
              }>
              <Text style={styles.folderIcon}>{item.ghost ? '🗑' : '📁'}</Text>
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
              {item.ghost ? (
                <Text style={[styles.tag, styles.tagDel]}>supprimé</Text>
              ) : folderSizes[item.prefix] === 'loading' ? (
                <ActivityIndicator size="small" />
              ) : !folderSizes[item.prefix] ? (
                <Pressable hitSlop={12} onPress={() => computeFolderSize(item.prefix)}>
                  <Text style={styles.sumBtn}>∑</Text>
                </Pressable>
              ) : null}
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          ) : (
            <Pressable
              style={[
                styles.row,
                item.ghost && styles.rowGhost,
                mode === 'move' && styles.rowMoving,
              ]}
              onPress={() => onFileTap(item.key)}
              onLongPress={() => onFileLongPress(item.key)}>
              {mode === 'select' ? (
                <View style={[styles.check, selected.includes(item.key) && styles.checkOn]}>
                  {selected.includes(item.key) ? <Text style={styles.checkMark}>✓</Text> : null}
                </View>
              ) : (
                <Text style={styles.fileIcon}>{item.ghost ? '🗑' : '·'}</Text>
              )}
              <View style={styles.rowMain}>
                <Text style={styles.rowName} numberOfLines={1}>
                  {item.name || baseName(item.key)}
                </Text>
                <Text style={styles.rowMeta}>
                  {formatBytes(item.ghost ? item.totalBytes : item.size)}
                  {item.lastModified ? ` · ${shortDate(item.lastModified)}` : ''}
                  {item.versionCount > 1 ? ` · ${item.versionCount} versions` : ''}
                </Text>
              </View>
              {item.ghost ? (
                <Text style={[styles.tag, styles.tagDel]}>supprimé</Text>
              ) : item.versionCount > 1 ? (
                <Text style={styles.tag}>{item.versionCount}v</Text>
              ) : null}
            </Pressable>
          )
        }
        ListFooterComponent={
          <View style={styles.footer}>
            {loading && rows.length > 0 ? <ActivityIndicator /> : null}
            {!loading && nextVer != null ? (
              <Pressable style={styles.moreBtn} onPress={() => load(prefix, nextVer)}>
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
        visible={selMenu}
        title={`${selected.length} sélectionné(s)`}
        options={selMenuOptions}
        onClose={() => setSelMenu(false)}
      />

      <ActionSheet
        visible={toolsMenu}
        title="Outils"
        options={[
          {
            label: 'Taille de ce dossier',
            onPress: () => showScopeSize(prefix, prefix ? `/${prefix}` : 'Racine du bucket'),
          },
          {
            label: 'Taille du dépôt (versions actuelles)',
            onPress: () => showScopeSize('', 'Dépôt entier'),
          },
          {
            label: 'Taille réelle du dépôt (toutes versions, ≈ B2)',
            onPress: () => showScopeSize('', 'Dépôt entier', true),
          },
          {
            label: 'Purger les anciennes versions (dossier courant)',
            destructive: true,
            onPress: () => purgeVersions(prefix, prefix ? `/${prefix}` : 'racine du bucket'),
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
                  label: 'Renommer',
                  onPress: () =>
                    setPrompt({ kind: 'renameFolder', prefix: folderMenu.prefix }),
                },
                {
                  label: 'Déplacer',
                  onPress: () => startFolderMove(folderMenu.prefix, folderMenu.name),
                },
                ...(folderMenu.ghost
                  ? [
                      {
                        label: 'Restaurer le contenu',
                        onPress: () => restoreFolder(folderMenu.prefix),
                      },
                    ]
                  : []),
                {
                  label: 'Purger les anciennes versions',
                  onPress: () => purgeVersions(folderMenu.prefix, `/${folderMenu.prefix}`),
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
        title={
          prompt?.kind === 'rename' || prompt?.kind === 'renameFolder'
            ? 'Renommer'
            : 'Nouveau dossier'
        }
        initial={
          prompt?.kind === 'rename'
            ? baseName(prompt.key)
            : prompt?.kind === 'renameFolder'
              ? prompt.prefix.slice(prompt.prefix.replace(/[^/]+\/$/, '').length).replace(/\/$/, '')
              : ''
        }
        placeholder={prompt?.kind === 'newFolder' ? 'Nom du dossier' : 'Nouveau nom'}
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
  if (s.activeCount > 0) return `${s.activeCount} en cours · ${s.pct}% · ${formatSpeed(s.speedBps)}`;
  return `${s.doneCount}/${s.totalCount} terminé(s)`;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerBtn: { color: '#0a84ff', fontSize: 15, fontWeight: '600' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  dimText: { textAlign: 'center', opacity: 0.6, fontSize: 14, lineHeight: 20 },

  topBar: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#8886' },
  crumbRow: { minHeight: 44, justifyContent: 'center' },
  crumbs: { alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, gap: 6 },
  crumb: { fontSize: 14, color: '#0a84ff', maxWidth: 180 },
  crumbActive: { color: '#8e8e93', fontWeight: '700' },
  sep: { opacity: 0.4, marginHorizontal: 2, fontSize: 14 },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#8884',
  },
  spacer: { flex: 1 },
  tBtn: { paddingHorizontal: 12, paddingVertical: 8 },
  tBtnText: { fontSize: 14, color: '#0a84ff', fontWeight: '700' },
  filterInput: {
    flex: 1,
    fontSize: 15,
    color: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#888',
    borderRadius: 8,
  },

  actionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#0a84ff',
  },
  actionBarMove: { backgroundColor: '#1b5e20' },
  abClose: { color: '#fff', fontSize: 17, fontWeight: '700' },
  abTitle: { color: '#fff', fontSize: 14, fontWeight: '600', flex: 1 },
  abAction: { color: '#fff', fontSize: 14, fontWeight: '700' },
  abDanger: { color: '#ffd7d7' },
  abPaste: { color: '#fff', fontSize: 15, fontWeight: '800' },

  moveCrumbs: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#8886' },

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
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#8884',
  },
  rowMoving: { backgroundColor: 'rgba(27,94,32,0.12)' },
  rowGhost: { opacity: 0.55 },
  rowMain: { flex: 1 },
  rowName: { flex: 1, fontSize: 15 },
  rowMeta: { fontSize: 12, opacity: 0.55, marginTop: 3 },
  folderIcon: { fontSize: 18 },
  fileIcon: { width: 18, textAlign: 'center', opacity: 0.4, fontSize: 18 },
  chevron: { fontSize: 20, opacity: 0.35 },
  sumBtn: { fontSize: 18, color: '#0a84ff', paddingHorizontal: 8 },
  tag: {
    fontSize: 11,
    opacity: 0.7,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#888',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  tagDel: { color: '#fff', backgroundColor: '#b71c1c', borderColor: '#b71c1c', opacity: 1 },
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
