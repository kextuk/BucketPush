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
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../../App';
import { applyNativeConfig } from '../../App';
import {
  DEFAULT_CONFIG,
  clearCredentials,
  getActiveProfile,
  getProfile,
  readCredentials,
  saveProfile,
  toNativeConfig,
  validateProfile,
  type Profile,
} from '../config';
import { S3Uploader } from '../native/S3Uploader';
import { getLangPref, setLangPref, t, type LangPref } from '../i18n';

type Props = NativeStackScreenProps<RootStackParamList, 'Settings'>;

export function SettingsScreen({ navigation, route }: Props) {
  const profileId = route.params?.profileId;
  const [cfg, setCfg] = useState<Profile>(DEFAULT_CONFIG);
  const [accessKeyId, setAccessKeyId] = useState('');
  const [secretAccessKey, setSecretAccessKey] = useState('');
  const [testing, setTesting] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const p = (profileId ? await getProfile(profileId) : await getActiveProfile()) ?? {
        ...DEFAULT_CONFIG,
        name: t('profiles.newName'),
      };
      setCfg(p);
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

  const persist = async (): Promise<boolean> => {
    const errors = validateProfile(cfg);
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
    // si ce profil est l'actif, pousse sa config au moteur natif
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
      // teste CE profil, puis restaure la config du profil actif
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

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Field label={t('settings.name')} hint={t('settings.nameHint')}>
          <TextInput
            style={styles.input}
            value={cfg.name}
            onChangeText={v => set('name', v)}
            placeholder={t('settings.namePlaceholder')}
          />
        </Field>

        <Field label={t('settings.endpoint')} hint={t('settings.endpointHint')}>
          <TextInput
            style={styles.input}
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
            autoCapitalize="none"
            autoCorrect={false}
            value={cfg.bucket}
            onChangeText={v => set('bucket', v)}
          />
        </Field>

        <Field label={t('settings.keyPrefix')} hint={t('settings.keyPrefixHint')}>
          <TextInput
            style={styles.input}
            autoCapitalize="none"
            autoCorrect={false}
            value={cfg.keyPrefix}
            onChangeText={v => set('keyPrefix', v)}
          />
        </Field>

        <Field label={t('settings.accessKeyId')}>
          <TextInput
            style={styles.input}
            autoCapitalize="none"
            autoCorrect={false}
            value={accessKeyId}
            onChangeText={setAccessKeyId}
          />
        </Field>

        <Field label={t('settings.secret')}>
          <TextInput
            style={styles.input}
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

        <Row label={t('settings.wifiOnly')}>
          <Switch value={cfg.wifiOnly} onValueChange={v => set('wifiOnly', v)} />
        </Row>

        <Row
          label={t('settings.skipExisting')}
          hint={t('settings.skipExistingHint')}>
          <Switch value={cfg.skipExisting} onValueChange={v => set('skipExisting', v)} />
        </Row>

        <Row label={t('settings.timestampKeys')}>
          <Switch
            value={cfg.timestampKeys}
            onValueChange={v => set('timestampKeys', v)}
          />
        </Row>

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

        <Text style={styles.section}>{t('settings.advanced')}</Text>

        <Field label={t('settings.region')} hint={t('settings.regionHint')}>
          <TextInput
            style={styles.input}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="auto"
            value={cfg.region ?? ''}
            onChangeText={v => set('region', v)}
          />
        </Field>

        <Field label={t('settings.partSize')} hint={t('settings.partSizeHint')}>
          <TextInput
            style={styles.input}
            keyboardType="number-pad"
            value={cfg.partSizeMiB != null ? String(cfg.partSizeMiB) : ''}
            onChangeText={v => set('partSizeMiB', v ? Math.max(5, parseInt(v, 10) || 0) : undefined)}
          />
        </Field>

        <Field label={t('settings.parallelParts')} hint={t('settings.parallelPartsHint')}>
          <TextInput
            style={styles.input}
            keyboardType="number-pad"
            value={String(cfg.maxConcurrentParts ?? 2)}
            onChangeText={v =>
              set('maxConcurrentParts', Math.min(8, Math.max(1, parseInt(v, 10) || 2)))
            }
          />
        </Field>

        <Field label={t('settings.parallelFiles')} hint={t('settings.parallelFilesHint')}>
          <TextInput
            style={styles.input}
            keyboardType="number-pad"
            value={String(cfg.maxConcurrentFiles ?? 1)}
            onChangeText={v =>
              set('maxConcurrentFiles', Math.min(4, Math.max(1, parseInt(v, 10) || 1)))
            }
          />
        </Field>

        <Field
          label={t('settings.moveConcurrency')}
          hint={t('settings.moveConcurrencyHint')}>
          <TextInput
            style={styles.input}
            keyboardType="number-pad"
            value={String(cfg.moveConcurrency ?? 4)}
            onChangeText={v =>
              set('moveConcurrency', Math.min(16, Math.max(1, parseInt(v, 10) || 4)))
            }
          />
        </Field>

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

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {children}
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.switchRow}>
      <View style={styles.switchLabel}>
        <Text style={styles.label}>{label}</Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, paddingBottom: 48 },
  field: { marginBottom: 16 },
  label: { fontSize: 13, fontWeight: '600', marginBottom: 6, opacity: 0.8 },
  hint: { fontSize: 11, opacity: 0.55, marginTop: 4 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#8888',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 12 : 8,
    fontSize: 15,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    gap: 12,
  },
  switchLabel: { flex: 1 },
  section: { fontSize: 15, fontWeight: '700', marginTop: 8, marginBottom: 12 },
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
