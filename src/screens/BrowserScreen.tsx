import React, { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../../App';
import { applyNativeConfig } from '../../App';
import { S3Uploader, type S3ListEntry } from '../native/S3Uploader';
import { useUploader } from '../useUploader';
import { addFilesTo, addFolderTo, joinKey, summarizeEnqueue } from '../upload';
import { sanitizeSegment } from '../keys';
import { formatBytes, formatSpeed } from '../format';

type Props = NativeStackScreenProps<RootStackParamList, 'Browser'>;

type Row =
  | { kind: 'folder'; prefix: string; name: string }
  | { kind: 'object'; entry: S3ListEntry; name: string };

const prefixOf = (key: string) => key.slice(0, key.lastIndexOf('/') + 1);
const baseName = (key: string) => key.slice(key.lastIndexOf('/') + 1);
const uniq = (a: string[]) => Array.from(new Set(a));

export function BrowserScreen({ navigation }: Props) {
  const [prefix, setPrefix] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [nextToken, setNextToken] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [moveSource, setMoveSource] = useState<{ key: string; name: string } | null>(null);
  const [configured, setConfigured] = useState(true);
  const [prompt, setPrompt] = useState<
    { kind: 'newFolder' } | { kind: 'rename'; key: string; name: string } | null
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
    async (p: string, token?: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await S3Uploader.listObjects(p, token);
        const markerFolders = res.objects
          .filter(o => o.key.endsWith('/') && o.key !== p)
          .map(o => o.key);
        const folderPrefixes = uniq([...res.prefixes, ...markerFolders]);
        const folders: Row[] = folderPrefixes.map(cp => ({
          kind: 'folder',
          prefix: cp,
          name: cp.slice(p.length).replace(/\/$/, ''),
        }));
        const objects: Row[] = res.objects
          .filter(o => !o.key.endsWith('/'))
          .map(o => ({ kind: 'object', entry: o, name: o.key.slice(p.length) }));
        setRows(prev => (token ? [...prev, ...folders, ...objects] : [...folders, ...objects]));
        setNextToken(res.nextToken);
      } catch (e: any) {
        setError(String(e?.message ?? e));
        if (!token) setRows([]);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    load(prefix);
  }, [prefix, load]);

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
  const goUp = () => setPrefix(p => p.replace(/[^/]+\/$/, ''));

  const withBusy = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
    } catch (e: any) {
      Alert.alert('Échec', String(e?.message ?? e));
    } finally {
      setBusy(null);
    }
  };

  // --- Ajouts ---------------------------------------------------------------

  const onAdd = () => {
    if (moveSource) return;
    Alert.alert('Ajouter dans ' + (prefix ? `/${prefix}` : 'la racine'), undefined, [
      {
        text: 'Fichiers…',
        onPress: () =>
          withBusy('Ajout…', async () => {
            const res = await addFilesTo(prefix);
            if (res) {
              hydrateQueue();
              const msg = summarizeEnqueue(res);
              if (msg) Alert.alert('File d’attente', msg);
            }
          }),
      },
      {
        text: 'Dossier Android…',
        onPress: () =>
          withBusy('Lecture du dossier…', async () => {
            const res = await addFolderTo(prefix);
            if (res) {
              hydrateQueue();
              const msg = summarizeEnqueue(res);
              if (msg) Alert.alert('File d’attente', msg);
            }
          }),
      },
      { text: 'Nouveau dossier…', onPress: () => setPrompt({ kind: 'newFolder' }) },
      { text: 'Annuler', style: 'cancel' },
    ]);
  };

  const submitPrompt = (value: string) => {
    const p = prompt;
    setPrompt(null);
    const name = sanitizeSegment(value);
    if (!p || !name) return;
    if (p.kind === 'newFolder') {
      withBusy('Création…', async () => {
        await S3Uploader.createFolder(prefix, name);
        reload();
      });
    } else {
      const dst = joinKey(prefixOf(p.key), name);
      withBusy('Renommage…', async () => {
        await S3Uploader.moveObject(p.key, dst);
        reload();
      });
    }
  };

  // --- Actions objet / dossier -------------------------------------------

  const onObjectLongPress = (entry: S3ListEntry) => {
    Alert.alert(baseName(entry.key), `${formatBytes(entry.size)}\n${entry.key}`, [
      { text: 'Déplacer…', onPress: () => setMoveSource({ key: entry.key, name: baseName(entry.key) }) },
      {
        text: 'Renommer…',
        onPress: () => setPrompt({ kind: 'rename', key: entry.key, name: baseName(entry.key) }),
      },
      {
        text: 'Supprimer',
        style: 'destructive',
        onPress: () =>
          Alert.alert('Supprimer ?', entry.key, [
            { text: 'Annuler', style: 'cancel' },
            {
              text: 'Supprimer',
              style: 'destructive',
              onPress: () =>
                withBusy('Suppression…', async () => {
                  await S3Uploader.deleteObject(entry.key);
                  reload();
                }),
            },
          ]),
      },
      { text: 'Fermer', style: 'cancel' },
    ]);
  };

  const onFolderLongPress = (folderPrefix: string, name: string) => {
    Alert.alert(name + '/', folderPrefix, [
      {
        text: 'Supprimer le dossier et son contenu',
        style: 'destructive',
        onPress: () =>
          Alert.alert('Tout supprimer sous ' + folderPrefix + ' ?', 'Action irréversible.', [
            { text: 'Annuler', style: 'cancel' },
            {
              text: 'Supprimer',
              style: 'destructive',
              onPress: () =>
                withBusy('Suppression…', async () => {
                  const { deleted } = await S3Uploader.deletePrefix(folderPrefix);
                  reload();
                  Alert.alert('Supprimé', `${deleted} objet(s) supprimé(s).`);
                }),
            },
          ]),
      },
      { text: 'Fermer', style: 'cancel' },
    ]);
  };

  const pasteHere = () => {
    if (!moveSource) return;
    const dst = joinKey(prefix, baseName(moveSource.key));
    if (dst === moveSource.key) {
      Alert.alert('Même emplacement', 'Le fichier est déjà dans ce dossier.');
      return;
    }
    withBusy('Déplacement…', async () => {
      await S3Uploader.moveObject(moveSource.key, dst);
      setMoveSource(null);
      reload();
    });
  };

  // --- Rendu -------------------------------------------------------------

  const queueLabel =
    summary.failedCount > 0
      ? `File d’attente — ${summary.failedCount} échec(s)`
      : summary.activeCount > 0
        ? `${summary.activeCount} en cours · ${summary.pct}% · ${formatSpeed(summary.speedBps)}`
        : summary.totalCount > 0
          ? `${summary.doneCount}/${summary.totalCount} terminé(s)`
          : '';

  if (!configured) {
    return (
      <View style={styles.container}>
        <Pressable style={styles.noProfile} onPress={() => navigation.navigate('Profiles')}>
          <Text style={styles.noProfileText}>
            Aucun profil S3 actif (ou clés manquantes).{'\n'}Appuie pour en configurer un.
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.pathBar}>
        {prefix ? (
          <Pressable onPress={goUp} hitSlop={8}>
            <Text style={styles.up}>⬆</Text>
          </Pressable>
        ) : null}
        <Text style={styles.path} numberOfLines={1}>
          /{prefix}
        </Text>
        <Pressable onPress={reload} hitSlop={8}>
          <Text style={styles.reload}>⟳</Text>
        </Pressable>
      </View>

      {moveSource ? (
        <View style={styles.moveBar}>
          <Text style={styles.moveText} numberOfLines={1}>
            Déplacer « {moveSource.name} » ici :
          </Text>
          <View style={styles.moveBtns}>
            <Pressable style={styles.moveBtn} onPress={pasteHere}>
              <Text style={styles.moveBtnText}>Coller ici</Text>
            </Pressable>
            <Pressable onPress={() => setMoveSource(null)} hitSlop={8}>
              <Text style={styles.moveCancel}>Annuler</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <FlatList
        data={rows}
        keyExtractor={(r, i) =>
          (r.kind === 'folder' ? `f:${r.prefix}` : `o:${r.entry.key}`) + i}
        contentContainerStyle={rows.length ? styles.listPad : styles.emptyWrap}
        refreshControl={
          <RefreshControl refreshing={loading && rows.length === 0} onRefresh={reload} />
        }
        ListEmptyComponent={
          loading ? undefined : <Text style={styles.empty}>Dossier vide</Text>
        }
        renderItem={({ item }) =>
          item.kind === 'folder' ? (
            <Pressable
              style={styles.row}
              onPress={() => setPrefix(item.prefix)}
              onLongPress={() => onFolderLongPress(item.prefix, item.name)}>
              <Text style={styles.folder}>📁 {item.name}/</Text>
            </Pressable>
          ) : (
            <Pressable
              style={[styles.row, moveSource?.key === item.entry.key && styles.dim]}
              onLongPress={() => onObjectLongPress(item.entry)}>
              <Text style={styles.objName} numberOfLines={1}>
                {item.name || item.entry.key}
              </Text>
              <Text style={styles.meta}>
                {formatBytes(item.entry.size)}
                {item.entry.lastModified ? ` · ${shortDate(item.entry.lastModified)}` : ''}
              </Text>
            </Pressable>
          )
        }
        ListFooterComponent={
          <View style={styles.footer}>
            {loading && rows.length > 0 ? <ActivityIndicator /> : null}
            {nextToken && !loading ? (
              <Pressable style={styles.moreBtn} onPress={() => load(prefix, nextToken)}>
                <Text style={styles.moreText}>Charger plus</Text>
              </Pressable>
            ) : null}
            <Text style={styles.hint}>Appui long : déplacer / renommer / supprimer.</Text>
          </View>
        }
      />

      {queueLabel ? (
        <Pressable style={styles.queueBanner} onPress={() => navigation.navigate('Queue')}>
          <Text style={styles.queueText}>⬆ {queueLabel}</Text>
          <Text style={styles.queueChevron}>›</Text>
        </Pressable>
      ) : null}

      <Pressable
        style={[styles.fab, busy != null && styles.fabDisabled]}
        onPress={onAdd}
        disabled={busy != null}>
        <Text style={styles.fabText}>{busy ?? '+'}</Text>
      </Pressable>

      <PromptModal
        visible={prompt != null}
        title={prompt?.kind === 'rename' ? 'Renommer' : 'Nouveau dossier'}
        initial={prompt?.kind === 'rename' ? prompt.name : ''}
        placeholder={prompt?.kind === 'rename' ? 'Nouveau nom' : 'Nom du dossier'}
        onCancel={() => setPrompt(null)}
        onSubmit={submitPrompt}
      />
    </View>
  );
}

function PromptModal({
  visible,
  title,
  initial,
  placeholder,
  onCancel,
  onSubmit,
}: {
  visible: boolean;
  title: string;
  initial: string;
  placeholder: string;
  onCancel: () => void;
  onSubmit: (v: string) => void;
}) {
  const [v, setV] = useState(initial);
  useEffect(() => {
    if (visible) setV(initial);
  }, [visible, initial]);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={mstyles.backdrop} onPress={onCancel}>
        <Pressable style={mstyles.card} onPress={() => {}}>
          <Text style={mstyles.title}>{title}</Text>
          <TextInput
            style={mstyles.input}
            value={v}
            onChangeText={setV}
            placeholder={placeholder}
            autoFocus
            autoCapitalize="none"
          />
          <View style={mstyles.actions}>
            <Pressable onPress={onCancel} hitSlop={8}>
              <Text style={mstyles.cancel}>Annuler</Text>
            </Pressable>
            <Pressable onPress={() => onSubmit(v.trim())} disabled={!v.trim()} hitSlop={8}>
              <Text style={[mstyles.ok, !v.trim() && mstyles.okDisabled]}>OK</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString();
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerBtn: { color: '#0a84ff', fontSize: 15, fontWeight: '600' },
  noProfile: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  noProfileText: { textAlign: 'center', opacity: 0.7, fontSize: 14, lineHeight: 20 },
  pathBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#8886',
  },
  up: { fontSize: 18 },
  reload: { fontSize: 18, opacity: 0.6 },
  path: { flex: 1, fontFamily: 'monospace', fontSize: 13, opacity: 0.8 },
  moveBar: { backgroundColor: '#0a84ff', paddingHorizontal: 16, paddingVertical: 10 },
  moveText: { color: '#fff', fontSize: 13 },
  moveBtns: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 8 },
  moveBtn: { backgroundColor: '#fff', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 6 },
  moveBtnText: { color: '#0a84ff', fontWeight: '700' },
  moveCancel: { color: '#fff', fontWeight: '600' },
  error: { color: '#c62828', padding: 12, fontSize: 13 },
  listPad: { paddingBottom: 170 },
  emptyWrap: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 120 },
  empty: { opacity: 0.6, textAlign: 'center' },
  row: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#8884',
  },
  dim: { opacity: 0.4 },
  folder: { fontSize: 15, fontWeight: '600' },
  objName: { fontSize: 15 },
  meta: { fontSize: 12, opacity: 0.6, marginTop: 4 },
  footer: { padding: 16, gap: 12, alignItems: 'center' },
  moreBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#0a84ff',
  },
  moreText: { color: '#0a84ff', fontWeight: '600' },
  hint: { fontSize: 11, opacity: 0.5 },
  queueBanner: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1c1c1e',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  queueText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  queueChevron: { color: '#fff', fontSize: 20 },
  fab: {
    position: 'absolute',
    right: 16,
    bottom: 64,
    minWidth: 56,
    height: 56,
    paddingHorizontal: 16,
    borderRadius: 28,
    backgroundColor: '#0a84ff',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
  },
  fabDisabled: { opacity: 0.6 },
  fabText: { color: '#fff', fontSize: 22, fontWeight: '700' },
});

const mstyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: '#0008',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  card: { width: '100%', backgroundColor: '#1c1c1e', borderRadius: 14, padding: 20 },
  title: { color: '#fff', fontSize: 16, fontWeight: '700', marginBottom: 12 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#888',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: '#fff',
  },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 24, marginTop: 16 },
  cancel: { color: '#aaa', fontSize: 15 },
  ok: { color: '#0a84ff', fontSize: 15, fontWeight: '700' },
  okDisabled: { opacity: 0.4 },
});
