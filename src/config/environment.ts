import Constants from 'expo-constants';
import { validateEnvironment } from '../../config/environment';

export function readEnvironment() {
  const config = Constants.expoConfig;
  const variant = config?.extra?.appVariant;
  return validateEnvironment({
    variant,
    androidPackage: config?.android?.package,
    scheme: config?.scheme,
    callback: typeof config?.scheme === 'string' ? `${config.scheme}://auth/callback` : undefined,
    url: process.env.EXPO_PUBLIC_SUPABASE_URL,
    key: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    localBackend: config?.extra?.localBackend,
  });
}
