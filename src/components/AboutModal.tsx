import React from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { t } from '../i18n';

const PERMS: { key: string; why: string }[] = [
  { key: 'about.permNetwork', why: 'about.permNetworkWhy' },
  { key: 'about.permNotif', why: 'about.permNotifWhy' },
  { key: 'about.permBackground', why: 'about.permBackgroundWhy' },
  { key: 'about.permNearby', why: 'about.permNearbyWhy' },
  { key: 'about.permBiometric', why: 'about.permBiometricWhy' },
];

export function AboutModal({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose}>
        <Pressable style={s.card} onPress={() => {}}>
          <Text style={s.title}>{t('about.title')}</Text>
          <ScrollView style={s.scroll} contentContainerStyle={s.scrollBody}>
            <Text style={s.para}>{t('about.what')}</Text>
            <Text style={s.para}>{t('about.oss')}</Text>
            <Text style={s.para}>{t('about.privacy')}</Text>

            <Text style={s.section}>{t('about.permsTitle')}</Text>
            {PERMS.map(p => (
              <View key={p.key} style={s.perm}>
                <Text style={s.permName}>{t(p.key)}</Text>
                <Text style={s.permWhy}>{t(p.why)}</Text>
              </View>
            ))}
          </ScrollView>
          <Pressable style={s.closeBtn} onPress={onClose}>
            <Text style={s.closeTxt}>{t('common.close')}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: '#0009',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    backgroundColor: '#1c1c1e',
    borderRadius: 16,
    paddingTop: 18,
    paddingBottom: 8,
    maxHeight: '85%',
  },
  title: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  scroll: { flexGrow: 0 },
  scrollBody: { paddingHorizontal: 20, paddingVertical: 8 },
  para: { color: '#d8d8dc', fontSize: 13, lineHeight: 19, marginBottom: 12 },
  section: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    marginTop: 6,
    marginBottom: 10,
  },
  perm: { marginBottom: 12 },
  permName: { color: '#fff', fontSize: 13, fontWeight: '600', marginBottom: 2 },
  permWhy: { color: '#a8a8ad', fontSize: 12, lineHeight: 17 },
  closeBtn: { paddingVertical: 14, alignItems: 'center' },
  closeTxt: { color: '#0a84ff', fontSize: 16, fontWeight: '700' },
});
