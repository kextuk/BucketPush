import React, { useEffect, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../../App';
import { applyNativeConfig } from '../../App';
import {
  DEFAULT_PREFS,
  PREF_RANGES,
  readPrefs,
  savePrefs,
  validatePrefs,
  type TransferPrefs,
} from '../config';
import {
  Field,
  IntInput,
  Row,
  controlStyles,
} from '../components/SettingsControls';
import { AboutModal } from '../components/AboutModal';
import { getLangPref, setLangPref, t, useLang, type LangPref } from '../i18n';

type Props = NativeStackScreenProps<RootStackParamList, 'Settings'>;

export function AppSettingsScreen({ navigation }: Props) {
  useLang();
  const [prefs, setPrefs] = useState<TransferPrefs>(DEFAULT_PREFS);
  const [loaded, setLoaded] = useState(false);
  const [about, setAbout] = useState(false);

  useEffect(() => {
    readPrefs().then(p => {
      setPrefs(p);
      setLoaded(true);
    });
  }, []);

  const set = <K extends keyof TransferPrefs>(k: K, v: TransferPrefs[K]) =>
    setPrefs(prev => ({ ...prev, [k]: v }));

  const onSave = async () => {
    const errors = validatePrefs(prefs);
    if (errors.length) {
      Alert.alert(t('settings.badFields'), errors.map(k => t(k)).join('\n'));
      return;
    }
    const saved = await savePrefs(prefs);
    setPrefs(saved);
    await applyNativeConfig(); // pousse les nouveaux défauts au profil actif
    Alert.alert(t('settings.saved'), t('settings.prefsSavedBody'));
    navigation.goBack();
  };

  if (!loaded) return <View style={styles.container} />;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled">
      <Row label={t('settings.language')}>
        <View style={styles.langRow}>
          {(['auto', 'fr', 'en'] as LangPref[]).map(l => (
            <Pressable
              key={l}
              onPress={() => setLangPref(l)}
              style={[styles.langBtn, getLangPref() === l && styles.langBtnOn]}>
              <Text style={[styles.langTxt, getLangPref() === l && styles.langTxtOn]}>
                {l === 'auto' ? t('settings.langAuto') : l === 'fr' ? 'FR' : 'EN'}
              </Text>
            </Pressable>
          ))}
        </View>
      </Row>

      <Text style={styles.section}>{t('settings.transferSection')}</Text>
      <Text style={styles.intro}>{t('settings.transferIntro')}</Text>

      <Field label={t('settings.partSize')} hint={t('settings.partSizeHint')}>
        <IntInput
          value={prefs.partSizeMiB}
          onChange={v => set('partSizeMiB', v)}
          min={5}
          max={1024}
          placeholder={t('settings.partAuto')}
        />
      </Field>

      <Field label={t('settings.parallelParts')} hint={t('settings.parallelPartsHint')}>
        <IntInput
          value={prefs.maxConcurrentParts}
          onChange={v => set('maxConcurrentParts', v ?? DEFAULT_PREFS.maxConcurrentParts)}
          min={PREF_RANGES.maxConcurrentParts[0]}
          max={PREF_RANGES.maxConcurrentParts[1]}
        />
      </Field>

      <Field label={t('settings.parallelFiles')} hint={t('settings.parallelFilesHint')}>
        <IntInput
          value={prefs.maxConcurrentFiles}
          onChange={v => set('maxConcurrentFiles', v ?? DEFAULT_PREFS.maxConcurrentFiles)}
          min={PREF_RANGES.maxConcurrentFiles[0]}
          max={PREF_RANGES.maxConcurrentFiles[1]}
        />
      </Field>

      <Field
        label={t('settings.moveConcurrency')}
        hint={t('settings.moveConcurrencyHint')}>
        <IntInput
          value={prefs.moveConcurrency}
          onChange={v => set('moveConcurrency', v ?? DEFAULT_PREFS.moveConcurrency)}
          min={PREF_RANGES.moveConcurrency[0]}
          max={PREF_RANGES.moveConcurrency[1]}
        />
      </Field>

      <Row label={t('settings.wifiOnly')}>
        <Switch value={prefs.wifiOnly} onValueChange={v => set('wifiOnly', v)} />
      </Row>

      <Row label={t('settings.skipExisting')} hint={t('settings.skipExistingHint')}>
        <Switch value={prefs.skipExisting} onValueChange={v => set('skipExisting', v)} />
      </Row>

      <Row label={t('settings.timestampKeys')}>
        <Switch
          value={prefs.timestampKeys}
          onValueChange={v => set('timestampKeys', v)}
        />
      </Row>

      <Pressable style={styles.btn} onPress={onSave}>
        <Text style={styles.btnText}>{t('common.save')}</Text>
      </Pressable>

      <Text style={styles.section}>{t('about.title')}</Text>
      <Pressable style={styles.aboutBtn} onPress={() => setAbout(true)}>
        <Text style={styles.aboutTxt}>{t('about.button')}</Text>
      </Pressable>

      <AboutModal visible={about} onClose={() => setAbout(false)} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, paddingBottom: 48 },
  section: { fontSize: 15, fontWeight: '700', marginTop: 8, marginBottom: 6 },
  intro: { fontSize: 12, opacity: 0.6, marginBottom: 16 },
  input: controlStyles.input,
  btn: {
    backgroundColor: '#0a84ff',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  aboutBtn: {
    borderWidth: 1,
    borderColor: '#0a84ff',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  aboutTxt: { color: '#0a84ff', fontWeight: '700', fontSize: 15 },
  langRow: { flexDirection: 'row', gap: 6 },
  langBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#0a84ff',
  },
  langBtnOn: { backgroundColor: '#0a84ff' },
  langTxt: { color: '#0a84ff', fontSize: 12, fontWeight: '700' },
  langTxtOn: { color: '#fff' },
});
