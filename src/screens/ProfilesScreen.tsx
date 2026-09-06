import React, { useCallback, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../../App';
import { applyNativeConfig } from '../../App';
import {
  createProfile,
  deleteProfile,
  duplicateProfile,
  listProfiles,
  setActiveProfile,
  type Profile,
} from '../config';
import { S3Uploader } from '../native/S3Uploader';
import { ActionSheet } from '../components/Sheets';

type Props = NativeStackScreenProps<RootStackParamList, 'Profiles'>;

const PENDING = new Set(['queued', 'uploading', 'paused']);

export function ProfilesScreen({ navigation }: Props) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [menuProfile, setMenuProfile] = useState<Profile | null>(null);

  const load = useCallback(async () => {
    const { activeId: a, profiles: p } = await listProfiles();
    setProfiles(p);
    setActiveId(a);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const pendingUploads = useCallback(async () => {
    try {
      const state = await S3Uploader.getState();
      return state.items.filter(i => PENDING.has(i.status));
    } catch {
      return [];
    }
  }, []);

  const activate = useCallback(
    async (id: string) => {
      if (id === activeId) return;
      const pending = await pendingUploads();
      const go = async () => {
        await Promise.all(pending.map(i => S3Uploader.cancel(i.id).catch(() => {})));
        await S3Uploader.clearCompleted().catch(() => {}); // la file appartient au profil
        await setActiveProfile(id);
        const ok = await applyNativeConfig();
        await load();
        if (!ok) {
          Alert.alert(
            'Profil activé',
            'Ce profil n’a pas de clés S3. Ajoute-les via « Modifier ».',
          );
        }
      };
      if (pending.length) {
        Alert.alert(
          'Changer de profil',
          `${pending.length} upload(s) en attente seront annulés et la liste vidée.`,
          [
            { text: 'Rester', style: 'cancel' },
            { text: 'Changer', style: 'destructive', onPress: go },
          ],
          { cancelable: true },
        );
      } else {
        go();
      }
    },
    [activeId, load, pendingUploads],
  );

  const addProfile = useCallback(async () => {
    const p = await createProfile('Nouveau profil');
    navigation.navigate('Settings', { profileId: p.id });
  }, [navigation]);

  const confirmDelete = useCallback(
    (p: Profile) => {
      Alert.alert(
        'Supprimer ce profil ?',
        `« ${p.name} » et ses clés S3 seront effacés.`,
        [
          { text: 'Annuler', style: 'cancel' },
          {
            text: 'Supprimer',
            style: 'destructive',
            onPress: async () => {
              if (p.id === activeId) {
                const pending = await pendingUploads();
                await Promise.all(pending.map(i => S3Uploader.cancel(i.id).catch(() => {})));
              }
              await deleteProfile(p.id);
              await applyNativeConfig();
              load();
            },
          },
        ],
        { cancelable: true },
      );
    },
    [activeId, load, pendingUploads],
  );

  const menuOptions = menuProfile
    ? [
        {
          label: 'Modifier',
          onPress: () =>
            navigation.navigate('Settings', { profileId: menuProfile.id }),
        },
        {
          label: 'Dupliquer',
          onPress: async () => {
            await duplicateProfile(menuProfile.id);
            load();
          },
        },
        {
          label: 'Supprimer',
          destructive: true,
          onPress: () => confirmDelete(menuProfile),
        },
      ]
    : [];

  return (
    <View style={styles.container}>
      <FlatList
        data={profiles}
        keyExtractor={p => p.id}
        contentContainerStyle={profiles.length ? undefined : styles.emptyWrap}
        ListEmptyComponent={
          <Text style={styles.empty}>
            Aucun profil. Crée-en un pour te connecter à un serveur S3.
          </Text>
        }
        renderItem={({ item }) => {
          const active = item.id === activeId;
          return (
            <Pressable
              style={[styles.row, active && styles.rowActive]}
              onPress={() => activate(item.id)}
              onLongPress={() => setMenuProfile(item)}>
              <View style={styles.rowMain}>
                <Text style={styles.name}>
                  {active ? '● ' : '○ '}
                  {item.name || '(sans nom)'}
                </Text>
                <Text style={styles.sub} numberOfLines={1}>
                  {item.endpoint || 'endpoint non renseigné'}
                  {item.bucket ? ` · ${item.bucket}` : ''}
                </Text>
                {!item.hasCredentials ? (
                  <Text style={styles.warn}>clés S3 manquantes</Text>
                ) : null}
              </View>
              <Pressable hitSlop={12} onPress={() => setMenuProfile(item)}>
                <Text style={styles.more}>⋯</Text>
              </Pressable>
            </Pressable>
          );
        }}
      />
      <Pressable style={styles.fab} onPress={addProfile}>
        <Text style={styles.fabText}>+ Nouveau profil</Text>
      </Pressable>

      <ActionSheet
        visible={menuProfile != null}
        title={menuProfile?.name || 'Profil'}
        options={menuOptions}
        onClose={() => setMenuProfile(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  emptyWrap: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { opacity: 0.6, textAlign: 'center', paddingHorizontal: 32 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#8884',
  },
  rowActive: { backgroundColor: '#0a84ff18' },
  rowMain: { flex: 1 },
  name: { fontSize: 16, fontWeight: '600' },
  sub: { fontSize: 12, opacity: 0.6, marginTop: 3 },
  warn: { fontSize: 11, color: '#c62828', marginTop: 3 },
  more: { fontSize: 22, opacity: 0.5, paddingHorizontal: 6 },
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
  fabText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
