/**
 * S3 Pusher — upload de très gros fichiers vers un serveur S3-compatible,
 * sans crash (streaming natif) et en arrière-plan (Foreground Service + WorkManager).
 */
import React, { useEffect } from 'react';
import { PermissionsAndroid, Platform, StatusBar, useColorScheme } from 'react-native';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { QueueScreen } from './src/screens/QueueScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { BrowserScreen } from './src/screens/BrowserScreen';
import { ProfilesScreen } from './src/screens/ProfilesScreen';
import { VersionsScreen } from './src/screens/VersionsScreen';
import { loadConfig, toNativeConfig } from './src/config';
import { S3Uploader } from './src/native/S3Uploader';

export type RootStackParamList = {
  Queue: undefined;
  Profiles: undefined;
  Settings: { profileId?: string } | undefined;
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

  useEffect(() => {
    applyNativeConfig();
    if (Platform.OS === 'android' && Platform.Version >= 33) {
      PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
      ).catch(() => {});
    }
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar barStyle={scheme === 'dark' ? 'light-content' : 'dark-content'} />
      <NavigationContainer theme={scheme === 'dark' ? DarkTheme : DefaultTheme}>
        <Stack.Navigator>
          <Stack.Screen
            name="Browser"
            component={BrowserScreen}
            options={{ title: 'BucketPush' }}
          />
          <Stack.Screen
            name="Queue"
            component={QueueScreen}
            options={{ title: 'File d’attente' }}
          />
          <Stack.Screen
            name="Profiles"
            component={ProfilesScreen}
            options={{ title: 'Profils S3' }}
          />
          <Stack.Screen
            name="Settings"
            component={SettingsScreen}
            options={{ title: 'Profil S3' }}
          />
          <Stack.Screen
            name="Versions"
            component={VersionsScreen}
            options={{ title: 'Versions' }}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

export default App;
