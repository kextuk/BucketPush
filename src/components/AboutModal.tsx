import React from 'react';
import { Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { t } from '../i18n';

const PERMS: { key: string; why: string }[] = [
  { key: 'about.permNetwork', why: 'about.permNetworkWhy' },
  { key: 'about.permNotif', why: 'about.permNotifWhy' },
  { key: 'about.permBackground', why: 'about.permBackgroundWhy' },
];

const KOFI_URL = 'https://ko-fi.com/kextuk';

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
      <Pressable style={s.backdrop} onPress={onClose} />
      <View style={s.centerWrap} pointerEvents="box-none">
        <View style={s.card}>
          <Text style={s.title}>{t('about.title')}</Text>
          <ScrollView style={s.scroll} contentContainerStyle={s.scrollBody}>
            <Text style={s.para}>{t('about.what')}</Text>
            <Text style={s.para}>{t('about.oss')}</Text>
            <Text style={s.para}>{t('about.privacy')}</Text>

            <Pressable
              style={s.donateRow}
              onPress={() => Linking.openURL(KOFI_URL).catch(() => {})}>
              <Text style={s.donateTxt}>{t('about.donateButton')}</Text>
              <Text style={s.open}>↗</Text>
            </Pressable>

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
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  // Fond et carte sont des FRÈRES (pas carte dans fond) : un tap sur le fond
  // ferme la modale, un tap sur la carte ne remonte jamais jusqu'au fond —
  // sans passer par un Pressable autour de la ScrollView, qui lui dispute
  // aléatoirement le geste de scroll (scroll qui « colle » par intermittence).
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#0009',
  },
  centerWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
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
  scroll: { flexGrow: 1, flexShrink: 1 },
  scrollBody: { paddingHorizontal: 20, paddingVertical: 8 },
  para: { color: '#d8d8dc', fontSize: 13, lineHeight: 19, marginBottom: 12 },
  donateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    marginBottom: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#3a3a3c',
  },
  donateTxt: { color: '#0a84ff', fontSize: 14, fontWeight: '600', flex: 1 },
  open: { color: '#0a84ff', fontSize: 15, marginLeft: 8 },
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
