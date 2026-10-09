import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, processLock, type SupabaseClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';
import { readSupabaseConfig } from './config';
let client: SupabaseClient | undefined;
export function getSupabaseClient(): SupabaseClient {
  if (!client) {
    const { url, key } = readSupabaseConfig();
    client = createClient(url, key, { auth: {
      storage: AsyncStorage, persistSession: true, autoRefreshToken: true,
      detectSessionInUrl: false, flowType: 'pkce', lock: processLock,
    } });
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
