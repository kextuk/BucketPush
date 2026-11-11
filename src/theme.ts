/**
 * Palette clair / sombre. L'app a longtemps forcé le clair : le texte et les
 * champs n'avaient pas de couleur explicite, donc le texte par défaut (noir)
 * et les placeholders devenaient invisibles sur fond sombre natif. Cette
 * palette donne à chaque écran des jetons de couleur explicites pour les deux
 * modes, pilotés par `useColorScheme()`.
 */
import { useColorScheme } from 'react-native';

export type ThemeColors = {
  bg: string; // fond d'écran
  panel: string; // carte / encart (modales except­ées : toujours sombres par design)
  text: string; // texte principal
  dim: string; // texte secondaire
  placeholder: string; // placeholder de champ texte
  line: string; // séparateurs / bordures
  inputBg: string; // fond des champs texte
  accent: string; // identique dans les deux modes
  danger: string;
  dangerBg: string;
  overlayPressed: string; // fond translucide d'un appui (ripple-like), bordures discrètes
};

const light: ThemeColors = {
  bg: '#ffffff',
  panel: '#f4f4f6',
  text: '#1b1b1f',
  dim: '#6b6f76',
  placeholder: '#8a8a8e',
  line: '#8884',
  inputBg: '#ffffff',
  accent: '#0a84ff',
  danger: '#c62828',
  dangerBg: '#fdeceb',
  overlayPressed: '#8881',
};

const dark: ThemeColors = {
  bg: '#16171a',
  panel: '#1e2024',
  text: '#f2f2f3',
  dim: '#9aa0a8',
  placeholder: '#7a7d84',
  line: '#3a3d44',
  inputBg: '#24262b',
  accent: '#0a84ff',
  danger: '#ff6b6b',
  dangerBg: '#3a1f20',
  overlayPressed: '#ffffff22',
};

export function useThemeColors(): ThemeColors {
  return useColorScheme() === 'dark' ? dark : light;
}
