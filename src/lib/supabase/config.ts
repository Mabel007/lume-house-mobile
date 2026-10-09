import { readEnvironment } from '../../config/environment';

export function readSupabaseConfig() {
  const { url, key, storageKey } = readEnvironment();
  return { url, key, ...(storageKey ? { storageKey } : {}) };
}
