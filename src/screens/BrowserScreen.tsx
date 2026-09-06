import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../../App';
import { S3Uploader, type S3ListEntry } from '../native/S3Uploader';
import { formatBytes } from '../format';

type Props = NativeStackScreenProps<RootStackParamList, 'Browser'>;

type Row =
  | { kind: 'folder'; prefix: string; name: string }
  | { kind: 'object'; entry: S3ListEntry; name: string };

export function BrowserScreen(_props: Props) {
  const [prefix, setPrefix] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [nextToken, setNextToken] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (p: string, token?: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await S3Uploader.listObjects(p, token);
        const folders: Row[] = res.prefixes.map(cp => ({
          kind: 'folder',
          prefix: cp,
          name: cp.slice(p.length).replace(/\/$/, ''),
        }));
        const objects: Row[] = res.objects
          .filter(o => o.key !== p) // l'objet "dossier" lui-même
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

  const goUp = () => setPrefix(p => p.replace(/[^/]+\/$/, ''));

  const onDelete = (entry: S3ListEntry) => {
    Alert.alert(
      'Supprimer cet objet ?',
      `${entry.key}\n${formatBytes(entry.size)}`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: async () => {
            try {
              await S3Uploader.deleteObject(entry.key);
              setRows(prev =>
                prev.filter(r => !(r.kind === 'object' && r.entry.key === entry.key)),
              );
            } catch (e: any) {
              Alert.alert('Échec', String(e?.message ?? e));
            }
          },
        },
      ],
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.pathBar}>
        <Text style={styles.path} numberOfLines={1}>
          /{prefix}
        </Text>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <FlatList
        data={rows}
        keyExtractor={(r, i) => (r.kind === 'folder' ? `f:${r.prefix}` : `o:${r.entry.key}`) + i}
        refreshControl={
          <RefreshControl refreshing={loading && rows.length === 0} onRefresh={() => load(prefix)} />
        }
        ListHeaderComponent={
          prefix ? (
            <Pressable style={styles.row} onPress={goUp}>
              <Text style={styles.folder}>📁 ..</Text>
            </Pressable>
          ) : undefined
        }
        ListEmptyComponent={
          loading ? undefined : <Text style={styles.empty}>Dossier vide</Text>
        }
        renderItem={({ item }) =>
          item.kind === 'folder' ? (
            <Pressable style={styles.row} onPress={() => setPrefix(item.prefix)}>
              <Text style={styles.folder}>📁 {item.name}/</Text>
            </Pressable>
          ) : (
            <Pressable style={styles.row} onLongPress={() => onDelete(item.entry)}>
              <Text style={styles.objName} numberOfLines={1}>
                {item.name || item.entry.key}
              </Text>
              <View style={styles.objMeta}>
                <Text style={styles.meta}>{formatBytes(item.entry.size)}</Text>
                <Text style={styles.meta}>{shortDate(item.entry.lastModified)}</Text>
              </View>
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
            <Text style={styles.hint}>Appui long sur un objet pour le supprimer.</Text>
          </View>
        }
      />
    </View>
  );
}

function shortDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString();
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  pathBar: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#8886',
  },
  path: { fontFamily: 'monospace', fontSize: 13, opacity: 0.8 },
  error: { color: '#c62828', padding: 12, fontSize: 13 },
  row: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#8884',
  },
  folder: { fontSize: 15, fontWeight: '600' },
  objName: { fontSize: 15 },
  objMeta: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  meta: { fontSize: 12, opacity: 0.6 },
  empty: { opacity: 0.6, textAlign: 'center', padding: 32 },
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
});
