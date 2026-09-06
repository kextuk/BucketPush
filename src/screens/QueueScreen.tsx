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

import type { RootStackParamList } from '../../App';
import { useUploader, type UiItem } from '../useUploader';
import { getActiveProfile } from '../config';
import { t } from '../i18n';
import { formatBytes, formatEta, formatSpeed, percent } from '../format';

type Props = NativeStackScreenProps<RootStackParamList, 'Queue'>;

export function QueueScreen({ navigation }: Props) {
  const { items, queueStatus, hydrate, pause, resume, cancel, retry, clearCompleted } =
    useUploader();
  const [profileName, setProfileName] = useState('');

  useLayoutEffect(() => {
    navigation.setOptions({
      // eslint-disable-next-line react/no-unstable-nested-components
      headerRight: () => (
        <Pressable onPress={() => navigation.navigate('Profiles')} hitSlop={12}>
          <Text style={styles.headerBtn}>{t('header.profiles')}</Text>
        </Pressable>
      ),
    });
  }, [navigation]);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        setProfileName((await getActiveProfile())?.name ?? '');
        hydrate();
      })();
    }, [hydrate]),
  );

  const onItemPress = useCallback(
    (item: UiItem) => {
      const actions: {
        text: string;
        onPress?: () => void;
        style?: 'cancel' | 'destructive';
      }[] = [];
      if (item.status === 'uploading' || item.status === 'queued') {
        actions.push({
          text: t('queue.cancelUpload'),
          style: 'destructive',
          onPress: () => cancel(item.id),
        });
      }
      if (item.status === 'failed' || item.status === 'canceled') {
        actions.push({ text: t('common.retry'), onPress: () => retry(item.id) });
      }
      if (item.status === 'skipped') {
        actions.push({
          text: t('queue.forceUpload'),
          style: 'destructive',
          onPress: () => retry(item.id),
        });
      }
      actions.push({ text: t('common.close'), style: 'cancel' });
      Alert.alert(item.displayName, item.error ?? item.key, actions, { cancelable: true });
    },
    [cancel, retry],
  );

  const anyActive = items.some(i => i.status === 'uploading' || i.status === 'queued');

  return (
    <View style={styles.container}>
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
              <Text style={styles.btnText}>{t('queue.pause')}</Text>
            </Pressable>
          ) : (
            <Pressable style={styles.btn} onPress={resume}>
              <Text style={styles.btnText}>{t('queue.resume')}</Text>
            </Pressable>
          )}
          <Pressable style={styles.btn} onPress={clearCompleted}>
            <Text style={styles.btnText}>{t('queue.clean')}</Text>
          </Pressable>
        </View>
      </View>

      <FlatList
        data={items}
        keyExtractor={i => i.id}
        contentContainerStyle={items.length ? styles.listPad : styles.emptyWrap}
        refreshControl={<RefreshControl refreshing={false} onRefresh={hydrate} />}
        ListEmptyComponent={
          <Text style={styles.empty}>{t('queue.empty')}</Text>
        }
        renderItem={({ item }) => <Row item={item} onPress={() => onItemPress(item)} />}
      />
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
              ? t('item.parts', { done: item.partsCompleted, total: item.partsTotal })
              : ''}
        </Text>
      </View>
      {item.error ? (
        <Text style={styles.errorText} numberOfLines={2}>
          {item.error}
        </Text>
      ) : null}
    </Pressable>
  );
}

function labelForQueue(s: string) {
  return s === 'running'
    ? t('queue.status.running')
    : s === 'paused'
      ? t('queue.status.paused')
      : t('queue.status.idle');
}
function labelForItem(s: string) {
  const k = `item.${s}`;
  return t(k) === k ? s : t(k);
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
  headerBtn: { color: '#0a84ff', fontSize: 15, fontWeight: '600' },
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
  listPad: { paddingBottom: 24 },
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
  errorText: { fontSize: 12, color: '#c62828', marginTop: 4 },
});
