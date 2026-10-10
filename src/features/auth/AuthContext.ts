import { createContext, useContext } from 'react';
import type { User } from '@supabase/supabase-js';
import type { OAuthResult } from './nativeOAuth';

export type AuthState = { status: 'restoring' } | { status: 'signed-out' } | { status: 'signed-in'; user: User };
export type AuthContract = {
  state: AuthState;
  busy: boolean;
  message: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  signInFixture: (alias: string, code: string) => Promise<void>;
  completeCallback: (url: string) => Promise<OAuthResult>;
};
export const AuthContext = createContext<AuthContract | null>(null);
export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('AuthProvider is required.');
  return value;
}
