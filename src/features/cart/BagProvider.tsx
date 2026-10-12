import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { randomUUID } from 'expo-crypto';
import { getSupabaseClient } from '../../lib/supabase/client';
import { useAuth } from '../auth/AuthContext';
import { BagContext, type BagContextValue } from './BagContext';
import { BagController, type BagState } from './BagController';
import { changeVariantCart, loadVariantCart, sessionToken, VariantCartError } from './variantCartRepository';

const guestBag: BagState = { status: 'ready', items: [], message: null, canRetry: false };
const signedOut: BagContextValue = {
  signedIn: false, state: guestBag,
  current: () => guestBag,
  refresh: async () => {}, retry: async () => false, dispatch: async () => false,
};

export function BagProvider({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  // A different identity receives a new controller synchronously, before paint.
  // The outgoing user's items are never copied into a guest or next user's Bag.
  if (state.status !== 'signed-in') return <BagContext.Provider value={signedOut}>{children}</BagContext.Provider>;
  return <CustomerBag key={state.user.id} userId={state.user.id}>{children}</CustomerBag>;
}

function CustomerBag({ userId, children }: { userId: string; children: ReactNode }) {
  const [controller] = useState(() => {
    const instance: BagController = new BagController({
      load: async () => {
        const client = getSupabaseClient();
        const token = await sessionToken(client, userId, instance.isActive);
        if (!instance.isActive()) throw new VariantCartError('AUTH_REQUIRED');
        return loadVariantCart(client, token);
      },
      change: async operation => {
        const client = getSupabaseClient();
        const token = await sessionToken(client, userId, instance.isActive);
        if (!instance.isActive()) throw new VariantCartError('AUTH_REQUIRED');
        return changeVariantCart(client, token, operation);
      },
    }, randomUUID);
    return instance;
  });
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => {
    controller.activate();
    void controller.refresh();
    return () => controller.deactivate();
  }, [controller]);
  return <BagContext.Provider value={{ signedIn: true, state, current: controller.getSnapshot, dispatch: controller.dispatch,
    refresh: controller.refresh, retry: controller.retry }}>{children}</BagContext.Provider>;
}
