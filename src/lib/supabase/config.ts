import { readEnvironment } from '../../config/environment';

export function readSupabaseConfig() {
  const { url, key } = readEnvironment();
  return { url, key };
}
