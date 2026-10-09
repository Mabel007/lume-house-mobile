import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import * as Linking from 'expo-linking';
import { getSupabaseClient, watchAuthRefresh } from '../../lib/supabase/client';
import { AuthContext, type AuthState } from './AuthContext';
import { completeNativeOAuth, isNativeCallback, startNativeGoogleOAuth } from './nativeOAuth';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'restoring' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const mounted = useRef(false);
  const action = useRef(false);
  const callbacks = useRef(0);

  const completeCallback = useCallback(async (url: string) => {
    callbacks.current += 1;
    if (mounted.current) { setBusy(true); setMessage(null); }
    const result = await completeNativeOAuth(url);
    callbacks.current -= 1;
    if (mounted.current) {
      setBusy(action.current || callbacks.current > 0);
      setMessage(result === 'success' ? null : 'Sign-in could not be completed. Please try again.');
    }
    return result;
  }, []);

  useEffect(() => {
    mounted.current = true;
    let active = true;
    let observed = false;
    let cleanup = () => {};
    try {
      const client = getSupabaseClient();
      const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
        observed = true;
        if (active) setState(session ? { status: 'signed-in', user: session.user } : { status: 'signed-out' });
      });
      const stopRefresh = watchAuthRefresh();
      const listener = Linking.addEventListener('url', ({ url }) => {
        if (isNativeCallback(url)) void completeCallback(url);
      });
      cleanup = () => { subscription.unsubscribe(); listener.remove(); stopRefresh(); };
      void client.auth.getSession().then(({ data, error }) => {
        if (!active || observed) return;
        setState(!error && data.session ? { status: 'signed-in', user: data.session.user } : { status: 'signed-out' });
        if (error) setMessage('Your session could not be restored. Please sign in again.');
      }).catch(() => {
        if (active && !observed) { setState({ status: 'signed-out' }); setMessage('Your session could not be restored. Please sign in again.'); }
      });
      void Linking.getInitialURL().then(url => {
        if (active && url && isNativeCallback(url)) void completeCallback(url);
      }).catch(() => {});
    } catch {
      queueMicrotask(() => {
        if (active) { setState({ status: 'signed-out' }); setMessage('Account services are unavailable. Please try again later.'); }
      });
    }
    return () => { active = false; mounted.current = false; cleanup(); };
  }, [completeCallback]);

  async function signIn() {
    if (action.current || callbacks.current || state.status !== 'signed-out') return;
    action.current = true;
    setBusy(true); setMessage(null);
    try {
      const result = await startNativeGoogleOAuth();
      if (mounted.current) setMessage(result === 'cancelled' ? 'Sign-in cancelled. You can try again.' : result === 'error' ? 'Google sign-in could not be completed. Use the installed native app and try again.' : null);
    } finally {
      action.current = false;
      if (mounted.current) setBusy(callbacks.current > 0);
    }
  }

  async function signOut() {
    if (action.current || callbacks.current || state.status !== 'signed-in') return;
    action.current = true;
    setBusy(true); setMessage(null);
    try {
      // Revoke this mobile session, preserving independently authenticated web sessions.
      const { error } = await getSupabaseClient().auth.signOut({ scope: 'local' });
      if (error) throw error;
      if (mounted.current) setState({ status: 'signed-out' });
    } catch {
      if (mounted.current) setMessage('Sign-out could not be completed. Please try again.');
    } finally {
      action.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return <AuthContext.Provider value={{ state, busy, message, signIn, signOut, completeCallback }}>{children}</AuthContext.Provider>;
}
