import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { t } from '../i18n';

const TOOLS: { label: string; why: string }[] = [
  { label: 'guide.s7Item1', why: 'guide.s7Item1Why' },
  { label: 'guide.s7Item2', why: 'guide.s7Item2Why' },
  { label: 'guide.s7Item3', why: 'guide.s7Item3Why' },
];

const FAQ: { q: string; a: string }[] = [
  { q: 'guide.s9Q1', a: 'guide.s9A1' },
  { q: 'guide.s9Q2', a: 'guide.s9A2' },
  { q: 'guide.s9Q3', a: 'guide.s9A3' },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <View style={s.bulletRow}>
      <Text style={s.bulletDot}>·</Text>
      <Text style={s.bulletTxt}>{children}</Text>
    </View>
  );
}

export function GuideModal({
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
          <Text style={s.title}>{t('guide.title')}</Text>
          <ScrollView style={s.scroll} contentContainerStyle={s.scrollBody}>
            <Section title={t('guide.s1Title')}>
              <Text style={s.para}>{t('guide.s1Body')}</Text>
              <Text style={s.para}>{t('guide.s1Note')}</Text>
            </Section>

            <Section title={t('guide.s2Title')}>
              <Bullet>{t('guide.s2Step1')}</Bullet>
              <Bullet>{t('guide.s2Step2')}</Bullet>
              <Bullet>{t('guide.s2Step3')}</Bullet>
              <Bullet>{t('guide.s2Step4')}</Bullet>
              <Text style={s.para}>{t('guide.s2Body')}</Text>
            </Section>

            <Section title={t('guide.s3Title')}>
              <Text style={s.para}>{t('guide.s3Body')}</Text>
            </Section>

            <Section title={t('guide.s4Title')}>
              <Text style={s.para}>{t('guide.s4Body1')}</Text>
              <Text style={s.para}>{t('guide.s4Body2')}</Text>
            </Section>

            <Section title={t('guide.s5Title')}>
              <Text style={s.para}>{t('guide.s5Body')}</Text>
            </Section>

            <Section title={t('guide.s6Title')}>
              <Text style={s.para}>{t('guide.s6Body')}</Text>
            </Section>

            <Section title={t('guide.s7Title')}>
              {TOOLS.map(item => (
                <View key={item.label} style={s.toolItem}>
                  <Text style={s.toolLabel}>{t(item.label)}</Text>
                  <Text style={s.toolWhy}>{t(item.why)}</Text>
                </View>
              ))}
            </Section>

            <Section title={t('guide.s8Title')}>
              <Text style={s.para}>{t('guide.s8Body')}</Text>
              <Bullet>{t('guide.s8Bullet1')}</Bullet>
              <Bullet>{t('guide.s8Bullet2')}</Bullet>
              <Bullet>{t('guide.s8Bullet3')}</Bullet>
            </Section>

            <Section title={t('guide.s9Title')}>
              {FAQ.map(item => (
                <View key={item.q} style={s.toolItem}>
                  <Text style={s.toolLabel}>{t(item.q)}</Text>
                  <Text style={s.toolWhy}>{t(item.a)}</Text>
                </View>
              ))}
            </Section>
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
    maxHeight: '88%',
  },
  title: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  scroll: { flexGrow: 1, flexShrink: 1 },
  scrollBody: { paddingHorizontal: 20, paddingVertical: 8, paddingBottom: 16 },
  section: {
    marginBottom: 16,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#3a3a3c',
  },
  sectionTitle: { color: '#fff', fontSize: 14, fontWeight: '700', marginBottom: 8 },
  para: { color: '#d8d8dc', fontSize: 13, lineHeight: 19, marginBottom: 8 },
  bulletRow: { flexDirection: 'row', marginBottom: 6, paddingRight: 4 },
  bulletDot: { color: '#0a84ff', fontSize: 13, width: 14 },
  bulletTxt: { color: '#d8d8dc', fontSize: 13, lineHeight: 19, flex: 1 },
  toolItem: { marginBottom: 10 },
  toolLabel: { color: '#fff', fontSize: 13, fontWeight: '600', marginBottom: 2 },
  toolWhy: { color: '#a8a8ad', fontSize: 12, lineHeight: 17 },
  closeBtn: { paddingVertical: 14, alignItems: 'center' },
  closeTxt: { color: '#0a84ff', fontSize: 16, fontWeight: '700' },
});
