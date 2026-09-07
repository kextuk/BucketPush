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
import { loadConfig, toNativeConfig } from './src/config';
import { S3Uploader } from './src/native/S3Uploader';
import { getLang, initLang, onLangChange, t } from './src/i18n';

export type RootStackParamList = {
  Queue: undefined;
  Profiles: undefined;
  Settings: undefined; // réglages globaux (langue + défauts de transfert)
  ProfileEdit: { profileId?: string } | undefined; // config d'un profil
  Browser: undefined;
  Versions: { objectKey: string };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export async function applyNativeConfig(): Promise<boolean> {
  const cfg = await loadConfig();
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
  const scheme = useColorScheme();
  const [, bump] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    initLang().then(bump);
    const off = onLangChange(bump);
    applyNativeConfig();
    if (Platform.OS === 'android' && Platform.Version >= 33) {
      PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
      ).catch(() => {});
    }
    return off;
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar barStyle={scheme === 'dark' ? 'light-content' : 'dark-content'} />
      <NavigationContainer
        key={getLang()}
        theme={scheme === 'dark' ? DarkTheme : DefaultTheme}>
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
