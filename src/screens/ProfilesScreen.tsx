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
import { t, useLang } from '../i18n';

type Props = NativeStackScreenProps<RootStackParamList, 'Profiles'>;

const PENDING = new Set(['queued', 'uploading', 'paused']);

export function ProfilesScreen({ navigation }: Props) {
  useLang();
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
          Alert.alert(t('profiles.activated'), t('profiles.activatedNoKeys'));
        }
      };
      if (pending.length) {
        Alert.alert(
          t('profiles.switchTitle'),
          t('profiles.switchBody', { n: pending.length }),
          [
            { text: t('profiles.stay'), style: 'cancel' },
            { text: t('profiles.switch'), style: 'destructive', onPress: go },
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
    const p = await createProfile(t('profiles.newName'));
    navigation.navigate('ProfileEdit', { profileId: p.id });
  }, [navigation]);

  const confirmDelete = useCallback(
    (p: Profile) => {
      Alert.alert(
        t('profiles.deleteQ'),
        t('profiles.deleteBody', { name: p.name }),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('common.delete'),
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
          label: t('profiles.edit'),
          onPress: () =>
            navigation.navigate('ProfileEdit', { profileId: menuProfile.id }),
        },
        {
          label: t('profiles.duplicate'),
          onPress: async () => {
            await duplicateProfile(menuProfile.id);
            load();
          },
        },
        {
          label: t('common.delete'),
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
          <Text style={styles.empty}>{t('profiles.empty')}</Text>
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
                  {item.name || t('profiles.noName')}
                </Text>
                <Text style={styles.sub} numberOfLines={1}>
                  {item.endpoint || t('profiles.noEndpoint')}
                  {item.bucket ? ` · ${item.bucket}` : ''}
                </Text>
                {!item.hasCredentials ? (
                  <Text style={styles.warn}>{t('profiles.noKeys')}</Text>
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
        <Text style={styles.fabText}>{t('profiles.new')}</Text>
      </Pressable>

      <ActionSheet
        visible={menuProfile != null}
        title={menuProfile?.name || t('nav.profiles')}
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
