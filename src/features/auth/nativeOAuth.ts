import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import { readEnvironment } from '../../config/environment';
import { getSupabaseClient } from '../../lib/supabase/client';
import { parseCallback, pendingIsFresh } from './callback';
import { ensurePKCECrypto } from './pkceCrypto';

const pendingKey = 'lume-mobile-oauth-started-v1';
export type OAuthResult = 'success' | 'cancelled' | 'error';
let lastCallback: { url: string; result: Promise<OAuthResult> } | undefined;
let browserTask: Promise<OAuthResult> | undefined;
let exchangeTask: Promise<OAuthResult> | undefined;
function currentCallbackResult() { return lastCallback?.result; }

export function nativeCallbackURL() {
  if (Platform.OS === 'web' || Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
    throw new Error('Use a native build for Google sign-in.');
  }
  const environment = readEnvironment();
  const callback = Linking.createURL('auth/callback', { scheme: environment.scheme, isTripleSlashed: false });
  // Fail closed if a development runtime changes the allowlisted callback contract.
  if (callback !== environment.callback) throw new Error('Native callback configuration is unavailable.');
  return callback;
}

export function isNativeCallback(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === `${readEnvironment().scheme}:` && url.hostname === 'auth' && url.pathname === '/callback';
  } catch { return false; }
}

// One exchange shared by Router, Android URL events and the browser's result.
// Only the most recent callback is retained in memory; never persisted or logged.
export function completeNativeOAuth(url: string): Promise<OAuthResult> {
  if (lastCallback?.url === url) return lastCallback.result;
  if (exchangeTask) return exchangeTask;
  const result = exchange(url).finally(() => { exchangeTask = undefined; });
  exchangeTask = result;
  lastCallback = { url, result };
  return result;
}

async function exchange(url: string): Promise<OAuthResult> {
  let consumesAttempt = false;
  try {
    const parsed = parseCallback(url, nativeCallbackURL());
    if (!isNativeCallback(url)) return 'error';
    if (!pendingIsFresh(await AsyncStorage.getItem(pendingKey), Date.now())) return 'error';
    consumesAttempt = true;
    if (parsed.kind !== 'code') return 'error';
    const { data, error } = await getSupabaseClient().auth.exchangeCodeForSession(parsed.code, parsed.flowId ? { flowId: parsed.flowId } : undefined);
    return !error && data.session ? 'success' : 'error';
  } catch { return 'error'; }
  finally { if (consumesAttempt) await AsyncStorage.removeItem(pendingKey).catch(() => {}); }
}

export function startNativeGoogleOAuth(): Promise<OAuthResult> {
  if (browserTask) return browserTask;
  browserTask = launch().finally(() => { browserTask = undefined; });
  return browserTask;
}

async function launch(): Promise<OAuthResult> {
  try {
    const redirectTo = nativeCallbackURL();
    ensurePKCECrypto();
    lastCallback = undefined;
    await AsyncStorage.setItem(pendingKey, String(Date.now()));
    const { data, error } = await getSupabaseClient().auth.signInWithOAuth({
      provider: 'google', options: { redirectTo, skipBrowserRedirect: true },
    });
    if (error || !data.url) return 'error';
    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    if (result.type === 'success') return await completeNativeOAuth(result.url);
    // A warm URL event may have started the exchange before Android reports dismissal.
    const callbackResult = currentCallbackResult();
    if (callbackResult) return await callbackResult;
    return result.type === 'cancel' || result.type === 'dismiss' ? 'cancelled' : 'error';
  } catch { return 'error'; }
  finally { await AsyncStorage.removeItem(pendingKey).catch(() => {}); }
}
