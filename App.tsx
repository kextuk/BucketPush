/**
 * S3 Pusher — upload de très gros fichiers vers un serveur S3-compatible,
 * sans crash (streaming natif) et en arrière-plan (Foreground Service + WorkManager).
 */
import React, { useEffect, useReducer } from 'react';
import { PermissionsAndroid, Platform, StatusBar, useColorScheme } from 'react-native';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { QueueScreen } from './src/screens/QueueScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { AppSettingsScreen } from './src/screens/AppSettingsScreen';
import { BrowserScreen } from './src/screens/BrowserScreen';
import { ProfilesScreen } from './src/screens/ProfilesScreen';
import { VersionsScreen } from './src/screens/VersionsScreen';
import { loadConfig, toNativeConfig, type Profile } from './src/config';
import { S3Uploader } from './src/native/S3Uploader';
import { initLang, t, useLang } from './src/i18n';

export type RootStackParamList = {
  Queue: undefined;
  Profiles: undefined;
  Settings: undefined; // réglages globaux (langue + défauts de transfert)
  ProfileEdit: { profileId?: string } | undefined; // config d'un profil
  Browser: undefined;
  Versions: { objectKey: string };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

/** Pousse la config au moteur natif. `profile` évite une relecture du trousseau. */
export async function applyNativeConfig(profile?: Profile): Promise<boolean> {
  const cfg = profile ?? (await loadConfig());
  const native = await toNativeConfig(cfg);
  if (!native) return false;
  try {
    await S3Uploader.configure(native);
    return true;
  } catch {
    return false;
  }
}

function App(): React.JSX.Element {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useLang(); // re-render à la volée quand la langue change (sans re-monter la nav)
  const scheme = useColorScheme();
  const dark = scheme === 'dark';

  useEffect(() => {
    initLang().then(bump);
    applyNativeConfig();
    if (Platform.OS === 'android' && Platform.Version >= 33) {
      PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
      ).catch(() => {});
    }
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} />
      <NavigationContainer theme={dark ? DarkTheme : DefaultTheme}>
        <Stack.Navigator>
          <Stack.Screen
            name="Browser"
            component={BrowserScreen}
            options={{ title: t('nav.browser') }}
          />
          <Stack.Screen
            name="Queue"
            component={QueueScreen}
            options={{ title: t('nav.queue') }}
          />
          <Stack.Screen
            name="Profiles"
            component={ProfilesScreen}
            options={{ title: t('nav.profiles') }}
          />
          <Stack.Screen
            name="Settings"
            component={AppSettingsScreen}
            options={{ title: t('nav.settings') }}
          />
          <Stack.Screen
            name="ProfileEdit"
            component={SettingsScreen}
            options={{ title: t('nav.profileEdit') }}
          />
          <Stack.Screen
            name="Versions"
            component={VersionsScreen}
            options={{ title: t('nav.versions') }}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

export default App;
