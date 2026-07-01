import { persistKey, readPersistedValue } from './auth-storage.js';

export function readProfileValue(key) {
  return readPersistedValue(key);
}

export function writeProfileValue(key, value) {
  void persistKey(key, value);
}
