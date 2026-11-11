import React from 'react';
import {
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { t } from '../i18n';

type Provider = {
  name: string;
  url: string;
  note: string; // clé i18n
};

const PROVIDERS: Provider[] = [
  {
    name: 'Backblaze B2',
    url: 'https://www.backblaze.com/cloud-storage',
    note: 'providers.note.b2',
  },
  {
    name: 'Cloudflare R2',
    url: 'https://developers.cloudflare.com/r2/',
    note: 'providers.note.r2',
  },
  {
    name: 'Scaleway Object Storage',
    url: 'https://www.scaleway.com/en/object-storage/',
    note: 'providers.note.scaleway',
  },
  {
    name: 'Storj',
    url: 'https://www.storj.io/',
    note: 'providers.note.storj',
  },
  {
    name: 'Tebi',
    url: 'https://tebi.io/',
    note: 'providers.note.tebi',
  },
  {
    name: 'IDrive e2',
    url: 'https://www.idrive.com/e2/',
    note: 'providers.note.idrive',
  },
  {
    name: 'Wasabi',
    url: 'https://wasabi.com/',
    note: 'providers.note.wasabi',
  },
  {
    name: 'Amazon S3',
    url: 'https://aws.amazon.com/s3/',
    note: 'providers.note.aws',
  },
  {
    name: 'MinIO',
    url: 'https://min.io/',
    note: 'providers.note.minio',
  },
];

export function ProvidersModal({
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
          <Text style={s.title}>{t('providers.title')}</Text>
          <ScrollView style={s.scroll} contentContainerStyle={s.scrollBody}>
            <Text style={s.intro}>{t('providers.intro')}</Text>
            {PROVIDERS.map(p => (
              <Pressable
                key={p.name}
                style={s.prov}
                onPress={() => Linking.openURL(p.url).catch(() => {})}>
                <View style={s.provHead}>
                  <Text style={s.provName}>{p.name}</Text>
                  <Text style={s.open}>↗</Text>
                </View>
                <Text style={s.provNote}>{t(p.note)}</Text>
              </Pressable>
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
  intro: { color: '#a8a8ad', fontSize: 12, lineHeight: 17, marginBottom: 14 },
  prov: {
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#3a3a3c',
  },
  provHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  provName: { color: '#fff', fontSize: 14, fontWeight: '600', flexShrink: 1 },
  open: { color: '#0a84ff', fontSize: 15, marginLeft: 'auto' },
  provNote: { color: '#a8a8ad', fontSize: 12, lineHeight: 17, marginTop: 3 },
  closeBtn: { paddingVertical: 14, alignItems: 'center' },
  closeTxt: { color: '#0a84ff', fontSize: 16, fontWeight: '700' },
});
