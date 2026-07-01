import { MAX_PROFILE_SLOTS } from './profile-slots.js';
import { readProfileValue, writeProfileValue } from './profile-storage.js';

export const PROFILE_MENU_SELECTION_PREFIX = 'lingo-profile-user-menu-selection:';

export function getProfileMenuSelectionStorageKey(userId) {
  return `${PROFILE_MENU_SELECTION_PREFIX}${userId}`;
}

export function loadActiveProfileSlot(userId) {
  if (!userId) return null;
  try {
    const raw = readProfileValue(getProfileMenuSelectionStorageKey(userId));
    const number = Number(raw);
    if (Number.isInteger(number) && number >= 1 && number <= MAX_PROFILE_SLOTS) {
      return number;
    }
  } catch {
    // ignore storage errors
  }
  return 1;
}

export function voiceSlotQuery(slotNumber) {
  return `slot=${encodeURIComponent(String(slotNumber))}`;
}

export function voiceApiPath(basePath, slotNumber) {
  return `${basePath}?${voiceSlotQuery(slotNumber)}`;
}
