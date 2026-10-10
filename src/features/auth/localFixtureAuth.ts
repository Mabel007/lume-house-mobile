import { readEnvironment } from '../../config/environment';
import { getSupabaseClient } from '../../lib/supabase/client';
import { helperOrigin, requireNativeEnrollment } from '../../../config/fixture-enrollment';

export function localFixtureAvailable() {
  try {
    const environment = readEnvironment();
    requireNativeEnrollment({ ...environment, origin: environment.url, alias: 'customer-a' });
    return environment.projectRef === 'local:lume-house';
  } catch { return false; }
}

export async function signInLocalFixture(alias: string, code: string) {
  const environment = readEnvironment();
  const identity = { ...environment, origin: environment.url, alias };
  requireNativeEnrollment(identity);
  if (environment.projectRef !== 'local:lume-house' || !/^[A-Za-z0-9_-]{43}$/.test(code)) throw new Error('Enrollment refused.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  let session: { access_token?: unknown; refresh_token?: unknown };
  try {
    const response = await fetch(`${helperOrigin}/native-session`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, redirect: 'error', signal: controller.signal,
      body: JSON.stringify({ variant: identity.variant, androidPackage: identity.androidPackage, callback: identity.callback, origin: identity.origin, alias, code }),
    });
    if (!response.ok) throw new Error('Enrollment refused.');
    session = await response.json() as typeof session;
  } finally { clearTimeout(timeout); }
  if (typeof session.access_token !== 'string' || typeof session.refresh_token !== 'string') throw new Error('Enrollment refused.');
  const payload = session.access_token.split('.')[1];
  if (!payload) throw new Error('Enrollment refused.');
  const claims = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as { role?: string; iss?: string };
  if (claims.role !== 'authenticated' || claims.iss !== `${environment.url}/auth/v1`) throw new Error('Enrollment refused.');
  const client = getSupabaseClient();
  const verified = await client.auth.getUser(session.access_token);
  if (verified.error || !verified.data.user) throw new Error('Enrollment refused.');
  const result = await client.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
  if (result.error || result.data.user?.id !== verified.data.user.id) throw new Error('Enrollment refused.');
}
