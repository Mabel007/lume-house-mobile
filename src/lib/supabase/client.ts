import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, processLock, type SupabaseClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';
import { readSupabaseConfig } from './config';
let client: SupabaseClient | undefined;
let binding: { url: string; key: string } | undefined;
export function getSupabaseClient(): SupabaseClient {
  // Validate before even returning an existing client; never reuse a different backend binding.
  const { url, key } = readSupabaseConfig();
  if (binding && (binding.url !== url || binding.key !== key)) {
    throw new Error('Backend configuration changed. Relaunch the correct application environment.');
  }
  if (!client) {
    client = createClient(url, key, { auth: {
      storage: AsyncStorage, persistSession: true, autoRefreshToken: true,
      detectSessionInUrl: false, flowType: 'pkce', lock: processLock,
    } });
    binding = { url, key };
  }
  return client;
}
// AuthProvider owns this subscription and its cleanup.
export function watchAuthRefresh() {
  if (Platform.OS === 'web') return () => {};
  let instance: SupabaseClient;
  try { instance = getSupabaseClient(); } catch { return () => {}; }
  const refresh = (state: string | null) => {
    if (state === 'active') instance.auth.startAutoRefresh();
    else instance.auth.stopAutoRefresh();
  };
  refresh(AppState.currentState);
  const subscription = AppState.addEventListener('change', refresh);
  return () => { subscription.remove(); instance.auth.stopAutoRefresh(); };
}
