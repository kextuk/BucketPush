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
        name: 'Nouveau profil',
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
      errors.push('Access key et secret requis.');
    }
    if (errors.length) {
      Alert.alert('Champs invalides', errors.join('\n'));
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
      Alert.alert('Enregistré', `Profil « ${cfg.name} » mis à jour.`);
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
        res.ok ? 'Connexion OK' : 'Échec',
        res.ok ? 'Le bucket est accessible.' : res.error ?? 'Erreur inconnue',
      );
    } catch (e: any) {
      Alert.alert('Échec', String(e?.message ?? e));
    } finally {
      setTesting(false);
    }
  };

  const onForget = async () => {
    await clearCredentials(cfg.id);
    setAccessKeyId('');
    setSecretAccessKey('');
    set('hasCredentials', false);
    Alert.alert('Clés effacées');
  };

  if (!loaded) return <View style={styles.container} />;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Field label="Nom du profil" hint="ex. Scaleway prod, MinIO maison">
          <TextInput
            style={styles.input}
            value={cfg.name}
            onChangeText={t => set('name', t)}
            placeholder="Nom du profil"
          />
        </Field>

        <Field label="Endpoint" hint="ex. https://s3.fr-par.scw.cloud">
          <TextInput
            style={styles.input}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="https://…"
            value={cfg.endpoint}
            onChangeText={t => set('endpoint', t)}
          />
        </Field>

        <Field label="Bucket">
          <TextInput
            style={styles.input}
            autoCapitalize="none"
            autoCorrect={false}
            value={cfg.bucket}
            onChangeText={t => set('bucket', t)}
          />
        </Field>

        <Field label="Préfixe de clé (dossier)" hint="optionnel, ex. sauvegardes/2026">
          <TextInput
            style={styles.input}
            autoCapitalize="none"
            autoCorrect={false}
            value={cfg.keyPrefix}
            onChangeText={t => set('keyPrefix', t)}
          />
        </Field>

        <Field label="Access key ID">
          <TextInput
            style={styles.input}
            autoCapitalize="none"
            autoCorrect={false}
            value={accessKeyId}
            onChangeText={setAccessKeyId}
          />
        </Field>

        <Field label="Secret access key">
          <TextInput
            style={styles.input}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            value={secretAccessKey}
            onChangeText={setSecretAccessKey}
          />
        </Field>

        <Row label="Path-style (bucket dans l'URL)" hint="requis par la plupart des S3-compatibles">
          <Switch
            value={cfg.forcePathStyle}
            onValueChange={v => set('forcePathStyle', v)}
          />
        </Row>

        <Row label="Wi-Fi uniquement">
          <Switch value={cfg.wifiOnly} onValueChange={v => set('wifiOnly', v)} />
        </Row>

        <Row
          label="Ne pas ré-uploader si déjà sur le serveur"
          hint="HEAD avant chaque upload ; l'objet existant n'est jamais touché">
          <Switch value={cfg.skipExisting} onValueChange={v => set('skipExisting', v)} />
        </Row>

        <Row label="Horodater les clés (anti-écrasement)">
          <Switch
            value={cfg.timestampKeys}
            onValueChange={v => set('timestampKeys', v)}
          />
        </Row>

        <Text style={styles.section}>Avancé</Text>

        <Field label="Region (SigV4)" hint="vide = dérivée de l'endpoint (ex. us-west-004)">
          <TextInput
            style={styles.input}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="auto"
            value={cfg.region ?? ''}
            onChangeText={t => set('region', t)}
          />
        </Field>

        <Field label="Taille de part (MiB)" hint="vide = adaptatif (32 MiB, agrandi si besoin)">
          <TextInput
            style={styles.input}
            keyboardType="number-pad"
            value={cfg.partSizeMiB != null ? String(cfg.partSizeMiB) : ''}
            onChangeText={t => set('partSizeMiB', t ? Math.max(5, parseInt(t, 10) || 0) : undefined)}
          />
        </Field>

        <Field label="Parts en parallèle" hint="défaut 2">
          <TextInput
            style={styles.input}
            keyboardType="number-pad"
            value={String(cfg.maxConcurrentParts ?? 2)}
            onChangeText={t =>
              set('maxConcurrentParts', Math.min(8, Math.max(1, parseInt(t, 10) || 2)))
            }
          />
        </Field>

        <Field label="Fichiers en parallèle" hint="défaut 1 (recommandé pour très gros fichiers)">
          <TextInput
            style={styles.input}
            keyboardType="number-pad"
            value={String(cfg.maxConcurrentFiles ?? 1)}
            onChangeText={t =>
              set('maxConcurrentFiles', Math.min(4, Math.max(1, parseInt(t, 10) || 1)))
            }
          />
        </Field>

        <Field
          label="Déplacements en parallèle"
          hint="défaut 4 ; monte à 8‑10 si ton fournisseur l'encaisse (sinon 503)">
          <TextInput
            style={styles.input}
            keyboardType="number-pad"
            value={String(cfg.moveConcurrency ?? 4)}
            onChangeText={t =>
              set('moveConcurrency', Math.min(16, Math.max(1, parseInt(t, 10) || 4)))
            }
          />
        </Field>

        <View style={styles.actions}>
          <Pressable style={[styles.btn, styles.btnGhost]} onPress={onTest} disabled={testing}>
            <Text style={styles.btnGhostText}>
              {testing ? 'Test…' : 'Tester la connexion'}
            </Text>
          </Pressable>
          <Pressable style={styles.btn} onPress={onSave}>
            <Text style={styles.btnText}>Enregistrer</Text>
          </Pressable>
        </View>

        <Pressable style={styles.forget} onPress={onForget}>
          <Text style={styles.forgetText}>Effacer les clés stockées</Text>
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
});
