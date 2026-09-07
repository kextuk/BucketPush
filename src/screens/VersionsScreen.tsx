import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../../App';
import { S3Uploader, type ObjectVersion } from '../native/S3Uploader';
import { formatBytes } from '../format';
import { t, useLang } from '../i18n';

type Props = NativeStackScreenProps<RootStackParamList, 'Versions'>;

export function VersionsScreen({ route }: Props) {
  useLang();
  const { objectKey } = route.params;
  const [versions, setVersions] = useState<ObjectVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const all: ObjectVersion[] = [];
      let km: string | undefined;
      let vm: string | undefined;
      let more = true;
      while (more) {
        const res = await S3Uploader.listObjectVersions(objectKey, km, vm);
        all.push(...res.versions.filter(v => v.key === objectKey));
        km = res.nextKeyMarker;
        vm = res.nextVersionIdMarker;
        more = !!(km || vm);
      }
      all.sort(
        (a, b) =>
          (Date.parse(b.lastModified ?? '') || 0) - (Date.parse(a.lastModified ?? '') || 0),
      );
      setVersions(all);
    } catch (e: any) {
      setError(String(e?.message ?? e));
      setVersions([]);
    } finally {
      setLoading(false);
    }
  }, [objectKey]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const removeOne = (v: ObjectVersion) => {
    Alert.alert(
      t('ver.deleteVersionQ'),
      `${formatBytes(v.size)} · ${shortDateTime(v.lastModified)}`,
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              await S3Uploader.deleteVersion(v.key, v.versionId);
              await load();
            } catch (e: any) {
              Alert.alert(t('common.failure'), String(e?.message ?? e));
            } finally {
              setBusy(false);
            }
          },
        },
      ],
      { cancelable: true },
    );
  };

  const purgeOld = () => {
    const olds = versions.filter(v => !v.isLatest).length;
    if (!olds) return;
    Alert.alert(
      t('ver.purgeQ'),
      t('ver.purgeBody', { n: olds }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('purge.btn2'),
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              for (const v of versions.filter(x => !x.isLatest)) {
                await S3Uploader.deleteVersion(v.key, v.versionId).catch(() => {});
              }
              await load();
            } finally {
              setBusy(false);
            }
          },
        },
      ],
      { cancelable: true },
    );
  };

  const oldCount = versions.filter(v => !v.isLatest).length;

  return (
    <View style={styles.container}>
      <Text style={styles.key} numberOfLines={2}>
        {objectKey}
      </Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <FlatList
        data={versions}
        keyExtractor={v => v.versionId}
        onRefresh={load}
        refreshing={loading}
        ListEmptyComponent={
          loading ? undefined : <Text style={styles.dim}>{t('ver.hintNoVersions')}</Text>
        }
        renderItem={({ item }) => (
          <Pressable
            style={styles.row}
            disabled={busy || item.isLatest}
            onPress={() => !item.isLatest && removeOne(item)}>
            <View style={styles.rowMain}>
              <Text style={styles.line1}>
                {formatBytes(item.size)}
                {item.isDeleteMarker ? `  (${t('ver.deleteMarker')})` : ''}
              </Text>
              <Text style={styles.line2}>{shortDateTime(item.lastModified)}</Text>
            </View>
            {item.isLatest ? (
              <Text style={styles.badge}>{t('ver.current')}</Text>
            ) : (
              <Text style={styles.del}>{t('common.delete')}</Text>
            )}
          </Pressable>
        )}
      />

      {oldCount > 0 ? (
        <Pressable style={styles.purge} onPress={purgeOld} disabled={busy}>
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.purgeText}>{t('ver.purgeBtn', { n: oldCount })}</Text>
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

function shortDateTime(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleString();
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  key: {
    fontFamily: 'monospace',
    fontSize: 12,
    opacity: 0.7,
    padding: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#8886',
  },
  error: { color: '#c62828', padding: 12, fontSize: 13 },
  dim: { opacity: 0.6, textAlign: 'center', padding: 32 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#8884',
  },
  rowMain: { flex: 1 },
  line1: { fontSize: 15 },
  line2: { fontSize: 12, opacity: 0.55, marginTop: 3 },
  badge: {
    fontSize: 11,
    color: '#fff',
    backgroundColor: '#1b5e20',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  del: { fontSize: 12, color: '#c62828', fontWeight: '600' },
  purge: {
    margin: 16,
    backgroundColor: '#b71c1c',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  purgeText: { color: '#fff', fontWeight: '700' },
});
