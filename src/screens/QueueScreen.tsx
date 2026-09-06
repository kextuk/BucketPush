import React, { useCallback, useLayoutEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { pick, types } from '@react-native-documents/picker';

import type { RootStackParamList } from '../../App';
import { applyNativeConfig } from '../../App';
import { useUploader, type UiItem } from '../useUploader';
import { S3Uploader } from '../native/S3Uploader';
import { getActiveProfile, loadConfig } from '../config';
import { buildKey, dedupeKeys } from '../keys';
import { formatBytes, formatEta, formatSpeed, percent } from '../format';

type Props = NativeStackScreenProps<RootStackParamList, 'Queue'>;

export function QueueScreen({ navigation }: Props) {
  const { items, queueStatus, hydrate, pause, resume, cancel, retry, clearCompleted } =
    useUploader();
  const [busy, setBusy] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [profileName, setProfileName] = useState('');

  useLayoutEffect(() => {
    navigation.setOptions({
      // eslint-disable-next-line react/no-unstable-nested-components
      headerRight: () => (
        <View style={styles.headerBtns}>
          <Pressable onPress={() => navigation.navigate('Browser')} hitSlop={12}>
            <Text style={styles.headerBtn}>Parcourir</Text>
          </Pressable>
          <Pressable onPress={() => navigation.navigate('Profiles')} hitSlop={12}>
            <Text style={styles.headerBtn}>Profils</Text>
          </Pressable>
        </View>
      ),
    });
  }, [navigation]);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const ok = await applyNativeConfig();
        setConfigured(ok);
        setProfileName((await getActiveProfile())?.name ?? '');
        hydrate();
      })();
    }, [hydrate]),
  );

  const addFiles = useCallback(async () => {
    try {
      setBusy(true);
      const cfg = await loadConfig();
      if (!cfg.endpoint || !cfg.bucket || !cfg.hasCredentials) {
        Alert.alert(
          'Profil incomplet',
          'Choisis ou complète un profil S3 (endpoint, bucket, clés) dans « Profils ».',
        );
        return;
      }
      const picked = await pick({
        allowMultiSelection: true,
        // ACTION_OPEN_DOCUMENT + permission persistée : pas de copie, survit au
        // redémarrage du process (indispensable pour la reprise d'upload).
        mode: 'open',
        requestLongTermAccess: true,
        type: [types.allFiles],
      });
      if (!picked.length) return;

      const rawKeys = picked.map(f =>
        buildKey(f.name ?? 'fichier', {
          prefix: cfg.keyPrefix,
          timestamp: cfg.timestampKeys,
        }),
      );
      const keys = dedupeKeys(rawKeys);
      const payload = picked.map((f, i) => ({
        id: `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`,
        uri: f.uri,
        key: keys[i],
        displayName: f.name ?? keys[i].split('/').pop() ?? 'fichier',
        sizeBytes: typeof f.size === 'number' ? f.size : -1,
        contentType: f.type ?? undefined,
      }));

      const res = await S3Uploader.enqueue(payload);
      hydrate();
      const skipped = res.skippedExisting + res.skippedInQueue;
      if (skipped > 0) {
        const parts: string[] = [];
        if (res.skippedExisting) parts.push(`${res.skippedExisting} déjà en ligne`);
        if (res.skippedInQueue) parts.push(`${res.skippedInQueue} déjà dans la file`);
        Alert.alert(
          'Fichiers ignorés',
          `${skipped} fichier(s) non ajouté(s) : ${parts.join(', ')}.` +
            (res.queued ? `\n${res.queued} ajouté(s) à la file.` : ''),
        );
      }
    } catch (e: any) {
      if (e?.code === 'OPERATION_CANCELED') return;
      Alert.alert('Erreur', String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }, [hydrate]);

  const onItemPress = useCallback(
    (item: UiItem) => {
      const actions: { text: string; onPress?: () => void; style?: 'cancel' | 'destructive' }[] =
        [];
      if (item.status === 'uploading' || item.status === 'queued') {
        actions.push({
          text: "Annuler l'upload",
          style: 'destructive',
          onPress: () => cancel(item.id),
        });
      }
      if (item.status === 'failed' || item.status === 'canceled') {
        actions.push({ text: 'Réessayer', onPress: () => retry(item.id) });
      }
      if (item.status === 'skipped') {
        actions.push({
          text: "Forcer l'upload (écrase)",
          style: 'destructive',
          onPress: () => retry(item.id),
        });
      }
      actions.push({ text: 'Fermer', style: 'cancel' });
      Alert.alert(item.displayName, item.error ?? item.key, actions);
    },
    [cancel, retry],
  );

  const anyActive = items.some(i => i.status === 'uploading' || i.status === 'queued');

  return (
    <View style={styles.container}>
      {!configured && (
        <Pressable style={styles.banner} onPress={() => navigation.navigate('Profiles')}>
          <Text style={styles.bannerText}>
            Aucun profil S3 actif (ou clés manquantes) — appuie pour choisir un profil.
          </Text>
        </Pressable>
      )}

      <View style={styles.toolbar}>
        <Pressable onPress={() => navigation.navigate('Profiles')}>
          <Text style={styles.status}>
            {profileName ? `${profileName} · ` : ''}
            {labelForQueue(queueStatus)}
          </Text>
        </Pressable>
        <View style={styles.toolbarBtns}>
          {anyActive && queueStatus !== 'paused' ? (
            <Pressable style={styles.btn} onPress={pause}>
              <Text style={styles.btnText}>Pause</Text>
            </Pressable>
          ) : (
            <Pressable style={styles.btn} onPress={resume}>
              <Text style={styles.btnText}>Reprendre</Text>
            </Pressable>
          )}
          <Pressable style={styles.btn} onPress={clearCompleted}>
            <Text style={styles.btnText}>Nettoyer</Text>
          </Pressable>
        </View>
      </View>

      <FlatList
        data={items}
        keyExtractor={i => i.id}
        contentContainerStyle={items.length ? undefined : styles.emptyWrap}
        refreshControl={<RefreshControl refreshing={false} onRefresh={hydrate} />}
        ListEmptyComponent={
          <Text style={styles.empty}>Aucun fichier. Appuie sur « Ajouter des fichiers ».</Text>
        }
        renderItem={({ item }) => <Row item={item} onPress={() => onItemPress(item)} />}
      />

      <Pressable
        style={[styles.fab, busy && styles.fabDisabled]}
        onPress={addFiles}
        disabled={busy}>
        <Text style={styles.fabText}>{busy ? '…' : '+ Ajouter des fichiers'}</Text>
      </Pressable>
    </View>
  );
}

function Row({ item, onPress }: { item: UiItem; onPress: () => void }) {
  const pct = percent(item.uploadedBytes, item.totalBytes || item.sizeBytes);
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <View style={styles.rowHead}>
        <Text style={styles.name} numberOfLines={1}>
          {item.displayName}
        </Text>
        <Text style={[styles.badge, badgeStyle(item.status)]}>{labelForItem(item.status)}</Text>
      </View>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${pct}%` }]} />
      </View>
      <View style={styles.rowMeta}>
        <Text style={styles.meta}>
          {formatBytes(item.uploadedBytes)} / {formatBytes(item.totalBytes || item.sizeBytes)} ·{' '}
          {pct}%
        </Text>
        <Text style={styles.meta}>
          {item.status === 'uploading'
            ? `${formatSpeed(item.speedBps)} · ${formatEta(item.etaSeconds)}`
            : item.partsTotal
              ? `${item.partsCompleted}/${item.partsTotal} parts`
              : ''}
        </Text>
      </View>
      {item.error ? (
        <Text style={styles.error} numberOfLines={2}>
          {item.error}
        </Text>
      ) : null}
    </Pressable>
  );
}

function labelForQueue(s: string) {
  return s === 'running' ? 'en cours' : s === 'paused' ? 'en pause' : 'au repos';
}
function labelForItem(s: string) {
  switch (s) {
    case 'queued':
      return 'en attente';
    case 'uploading':
      return 'en cours';
    case 'completed':
      return 'terminé';
    case 'failed':
      return 'échec';
    case 'canceled':
      return 'annulé';
    case 'paused':
      return 'pause';
    case 'skipped':
      return 'déjà en ligne';
    default:
      return s;
  }
}
function badgeStyle(s: string) {
  if (s === 'completed') return { backgroundColor: '#1b5e20', color: '#fff' };
  if (s === 'skipped') return { backgroundColor: '#37474f', color: '#fff' };
  if (s === 'failed') return { backgroundColor: '#b71c1c', color: '#fff' };
  if (s === 'uploading') return { backgroundColor: '#0d47a1', color: '#fff' };
  if (s === 'canceled') return { backgroundColor: '#555', color: '#fff' };
  return { backgroundColor: '#e0e0e0', color: '#222' };
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerBtns: { flexDirection: 'row', gap: 16 },
  headerBtn: { color: '#0a84ff', fontSize: 15, fontWeight: '600' },
  banner: { backgroundColor: '#8a6d00', padding: 12 },
  bannerText: { color: '#fff', fontSize: 13 },
  toolbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#8886',
  },
  status: { fontSize: 13, opacity: 0.7 },
  toolbarBtns: { flexDirection: 'row', gap: 8 },
  btn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: '#0a84ff' },
  btnText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  emptyWrap: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { opacity: 0.6, textAlign: 'center', paddingHorizontal: 32 },
  row: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#8884',
  },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { flex: 1, fontSize: 15, fontWeight: '600' },
  badge: {
    fontSize: 11,
    overflow: 'hidden',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  barTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: '#8883',
    marginTop: 8,
    overflow: 'hidden',
  },
  barFill: { height: 6, backgroundColor: '#0a84ff' },
  rowMeta: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  meta: { fontSize: 12, opacity: 0.65 },
  error: { fontSize: 12, color: '#c62828', marginTop: 4 },
  fab: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 20,
    backgroundColor: '#0a84ff',
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    elevation: 4,
  },
  fabDisabled: { opacity: 0.5 },
  fabText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
