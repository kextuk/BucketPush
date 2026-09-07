import React, { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../../App';
import { applyNativeConfig } from '../../App';
import {
  DEFAULT_CONFIG,
  DEFAULT_PREFS,
  PREF_RANGES,
  clearCredentials,
  getActiveProfile,
  getProfile,
  readCredentials,
  readPrefs,
  saveProfile,
  toNativeConfig,
  validatePrefs,
  validateProfile,
  type PrefOverrides,
  type Profile,
  type TransferPrefs,
} from '../config';
import { S3Uploader } from '../native/S3Uploader';
import { Field, IntInput, Row } from '../components/SettingsControls';
import { t, useLang } from '../i18n';

type Props = NativeStackScreenProps<RootStackParamList, 'ProfileEdit'>;

type NumKey = 'partSizeMiB' | 'maxConcurrentParts' | 'maxConcurrentFiles' | 'moveConcurrency';
type BoolKey = 'wifiOnly' | 'skipExisting' | 'timestampKeys';

const has = (ov: PrefOverrides, k: keyof TransferPrefs) =>
  Object.prototype.hasOwnProperty.call(ov, k);

export function SettingsScreen({ navigation, route }: Props) {
  useLang();
  const insets = useSafeAreaInsets();
  const profileId = route.params?.profileId;
  const [cfg, setCfg] = useState<Profile>(DEFAULT_CONFIG);
  const [globalPrefs, setGlobalPrefs] = useState<TransferPrefs>(DEFAULT_PREFS);
  const [accessKeyId, setAccessKeyId] = useState('');
  const [secretAccessKey, setSecretAccessKey] = useState('');
  const [testing, setTesting] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const [p0, gp] = await Promise.all([
        profileId ? getProfile(profileId) : getActiveProfile(),
        readPrefs(),
      ]);
      const p = p0 ?? { ...DEFAULT_CONFIG, name: t('profiles.newName') };
      setCfg({ ...p, overrides: { ...p.overrides } });
      setGlobalPrefs(gp);
      const creds = await readCredentials(p.id);
      if (creds) {
        setAccessKeyId(creds.accessKeyId);
        setSecretAccessKey(creds.secretAccessKey);
      }
      setLoaded(true);
    })();
  }, [profileId]);

  const set = <K extends keyof Profile>(k: K, v: Profile[K]) =>
    setCfg(prev => ({ ...prev, [k]: v }));

  const setOverride = (k: keyof TransferPrefs, v: TransferPrefs[keyof TransferPrefs]) =>
    setCfg(prev => ({ ...prev, overrides: { ...prev.overrides, [k]: v } }));

  const clearOverride = (k: keyof TransferPrefs) =>
    setCfg(prev => {
      const next = { ...prev.overrides };
      delete next[k];
      return { ...prev, overrides: next };
    });

  const persist = async (): Promise<boolean> => {
    const errors = [...validateProfile(cfg), ...validatePrefs(cfg.overrides)];
    if (!accessKeyId.trim() || !secretAccessKey.trim()) {
      errors.push('settings.credsRequired');
    }
    if (errors.length) {
      Alert.alert(t('settings.badFields'), errors.map(k => t(k)).join('\n'));
      return false;
    }
    await saveProfile(cfg, {
      accessKeyId: accessKeyId.trim(),
      secretAccessKey: secretAccessKey.trim(),
    });
    setCfg(prev => ({ ...prev, hasCredentials: true }));
    const active = await getActiveProfile();
    if (active?.id === cfg.id) await applyNativeConfig();
    return true;
  };

  const onSave = async () => {
    if (await persist()) {
      Alert.alert(t('settings.saved'), t('settings.savedBody', { name: cfg.name }));
      navigation.goBack();
    }
  };

  const onTest = async () => {
    if (!(await persist())) return;
    setTesting(true);
    try {
      const native = await toNativeConfig(cfg);
      if (native) await S3Uploader.configure(native);
      const res = await S3Uploader.testConnection();
      await applyNativeConfig();
      Alert.alert(
        res.ok ? t('settings.connOk') : t('common.failure'),
        res.ok ? t('settings.connOkBody') : res.error ?? t('common.error'),
      );
    } catch (e: any) {
      Alert.alert(t('common.failure'), String(e?.message ?? e));
    } finally {
      setTesting(false);
    }
  };

  const onForget = async () => {
    await clearCredentials(cfg.id);
    setAccessKeyId('');
    setSecretAccessKey('');
    set('hasCredentials', false);
    Alert.alert(t('settings.keysCleared'));
  };

  if (!loaded) return <View style={styles.container} />;

  const fmtGlobal = (k: keyof TransferPrefs): string => {
    const v = globalPrefs[k];
    if (k === 'partSizeMiB') return v == null ? t('settings.partAuto') : String(v);
    if (typeof v === 'boolean') return v ? t('common.yes') : t('common.no');
    return String(v);
  };

  const renderInherit = (k: keyof TransferPrefs) => (
    <View style={styles.inheritRow}>
      <Text style={styles.inheritTxt}>
        {has(cfg.overrides, k)
          ? t('settings.specific')
          : t('settings.inheritedValue', { v: fmtGlobal(k) })}
      </Text>
      <Switch
        value={has(cfg.overrides, k)}
        onValueChange={on => {
          if (on) setOverride(k, globalPrefs[k]);
          else clearOverride(k);
        }}
      />
    </View>
  );

  const numRange = (k: NumKey): [number, number] =>
    k === 'partSizeMiB' ? [5, 1024] : PREF_RANGES[k];

  const renderNum = (k: NumKey, label: string, hint?: string) => {
    const [min, max] = numRange(k);
    return (
      <Field label={label} hint={hint}>
        {renderInherit(k)}
        {has(cfg.overrides, k) ? (
          <IntInput
            value={cfg.overrides[k]}
            onChange={v => setOverride(k, k === 'partSizeMiB' ? v : v ?? DEFAULT_PREFS[k])}
            min={min}
            max={max}
            placeholder={k === 'partSizeMiB' ? t('settings.partAuto') : undefined}
          />
        ) : null}
      </Field>
    );
  };

  const renderBool = (k: BoolKey, label: string, hint?: string) => (
    <Field label={label} hint={hint}>
      {renderInherit(k)}
      {has(cfg.overrides, k) ? (
        <View style={styles.inheritRow}>
          <Text style={styles.inheritTxt}>{t('settings.specificValue')}</Text>
          <Switch value={!!cfg.overrides[k]} onValueChange={v => setOverride(k, v)} />
        </View>
      ) : null}
    </Field>
  );

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: 48 + insets.bottom }]}
        keyboardShouldPersistTaps="handled">
        <Field label={t('settings.name')} hint={t('settings.nameHint')}>
          <TextInput
            style={styles.input}
            placeholderTextColor="#8a8a8e"
            value={cfg.name}
            onChangeText={v => set('name', v)}
            placeholder={t('settings.namePlaceholder')}
          />
        </Field>

        <Field label={t('settings.endpoint')} hint={t('settings.endpointHint')}>
          <TextInput
            style={styles.input}
            placeholderTextColor="#8a8a8e"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="https://…"
            value={cfg.endpoint}
            onChangeText={v => set('endpoint', v)}
          />
        </Field>

        <Field label={t('settings.bucket')}>
          <TextInput
            style={styles.input}
            placeholderTextColor="#8a8a8e"
            autoCapitalize="none"
            autoCorrect={false}
            value={cfg.bucket}
            onChangeText={v => set('bucket', v)}
          />
        </Field>

        <Field label={t('settings.keyPrefix')} hint={t('settings.keyPrefixHint')}>
          <TextInput
            style={styles.input}
            placeholderTextColor="#8a8a8e"
            autoCapitalize="none"
            autoCorrect={false}
            value={cfg.keyPrefix}
            onChangeText={v => set('keyPrefix', v)}
          />
        </Field>

        <Field label={t('settings.accessKeyId')}>
          <TextInput
            style={styles.input}
            placeholderTextColor="#8a8a8e"
            autoCapitalize="none"
            autoCorrect={false}
            value={accessKeyId}
            onChangeText={setAccessKeyId}
          />
        </Field>

        <Field label={t('settings.secret')}>
          <TextInput
            style={styles.input}
            placeholderTextColor="#8a8a8e"
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            value={secretAccessKey}
            onChangeText={setSecretAccessKey}
          />
        </Field>

        <Row label={t('settings.pathStyle')} hint={t('settings.pathStyleHint')}>
          <Switch
            value={cfg.forcePathStyle}
            onValueChange={v => set('forcePathStyle', v)}
          />
        </Row>

        <Field label={t('settings.region')} hint={t('settings.regionHint')}>
          <TextInput
            style={styles.input}
            placeholderTextColor="#8a8a8e"
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="auto"
            value={cfg.region ?? ''}
            onChangeText={v => set('region', v)}
          />
        </Field>

        <Text style={styles.section}>{t('settings.transferSection')}</Text>
        <Text style={styles.intro}>{t('settings.overrideIntro')}</Text>

        {renderNum('partSizeMiB', t('settings.partSize'), t('settings.partSizeHint'))}
        {renderNum(
          'maxConcurrentParts',
          t('settings.parallelParts'),
          t('settings.parallelPartsHint'),
        )}
        {renderNum(
          'maxConcurrentFiles',
          t('settings.parallelFiles'),
          t('settings.parallelFilesHint'),
        )}
        {renderNum(
          'moveConcurrency',
          t('settings.moveConcurrency'),
          t('settings.moveConcurrencyHint'),
        )}
        {renderBool('wifiOnly', t('settings.wifiOnly'))}
        {renderBool(
          'skipExisting',
          t('settings.skipExisting'),
          t('settings.skipExistingHint'),
        )}
        {renderBool('timestampKeys', t('settings.timestampKeys'))}

        <View style={styles.actions}>
          <Pressable style={[styles.btn, styles.btnGhost]} onPress={onTest} disabled={testing}>
            <Text style={styles.btnGhostText}>
              {testing ? t('settings.testing') : t('settings.testConn')}
            </Text>
          </Pressable>
          <Pressable style={styles.btn} onPress={onSave}>
            <Text style={styles.btnText}>{t('common.save')}</Text>
          </Pressable>
        </View>

        <Pressable style={styles.forget} onPress={onForget}>
          <Text style={styles.forgetText}>{t('settings.forgetKeys')}</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, paddingBottom: 48 },
  label: { fontSize: 13, fontWeight: '600', marginBottom: 6, opacity: 0.8 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#8888',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 12 : 8,
    fontSize: 15,
    color: '#1b1b1f',
    backgroundColor: '#fff',
  },
  section: { fontSize: 15, fontWeight: '700', marginTop: 8, marginBottom: 6 },
  intro: { fontSize: 12, opacity: 0.6, marginBottom: 16 },
  inheritRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  inheritTxt: { flex: 1, fontSize: 13, opacity: 0.75 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 8 },
  btn: {
    flex: 1,
    backgroundColor: '#0a84ff',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  btnGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#0a84ff' },
  btnGhostText: { color: '#0a84ff', fontWeight: '700', fontSize: 15 },
  forget: { marginTop: 24, alignItems: 'center' },
  forgetText: { color: '#c62828', fontSize: 13 },
});
