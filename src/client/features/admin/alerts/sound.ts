import { readStorage, removeStorage, writeStorage } from '../../../lib/storage';
import soundUrl from '../assets/new-order.wav';

export const SOUND_KEY = 'bbc.admin.sound';

export function readSoundEnabled(): boolean {
  try {
    return readStorage(SOUND_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeSoundEnabled(on: boolean): void {
  if (on) {
    writeStorage(SOUND_KEY, '1');
  } else {
    removeStorage(SOUND_KEY);
  }
}

export async function playNewOrderSound(): Promise<'played' | 'blocked' | 'off'> {
  if (!readSoundEnabled()) {
    return 'off';
  }
  try {
    if (typeof Audio === 'undefined') {
      return 'off';
    }
    const audio = new Audio(soundUrl);
    await audio.play();
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate?.(200);
    }
    return 'played';
  } catch {
    return 'blocked';
  }
}
