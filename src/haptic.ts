import { Vibration } from 'react-native';

/**
 * Court retour haptique. Appelé au moment où une interaction « appui long » se
 * déclenche (pendant que le doigt est encore posé) pour confirmer l'action.
 */
export function haptic(ms = 12): void {
  try {
    Vibration.vibrate(ms);
  } catch {
    /* pas de vibreur / permission absente : sans effet */
  }
}
