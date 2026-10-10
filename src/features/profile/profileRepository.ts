import type { SupabaseClient } from '@supabase/supabase-js';
import { mapProfile, profileValues, type Profile, type ProfileField } from './profile';
const columns = 'full_name,phone,default_street_address,default_area,default_city';
async function requireOwner(client: SupabaseClient, userId: string, active: () => boolean) {
  const { data, error } = await client.auth.getUser();
  if (error || data.user?.id !== userId || !active()) throw new Error('Please sign in again to update your account.');
}
export async function loadProfile(client: SupabaseClient, userId: string, active: () => boolean) {
  await requireOwner(client, userId, active);
  const { data, error } = await client.from('profiles').select(columns).eq('id', userId).maybeSingle();
  if (error) throw new Error('Your details could not be loaded. Check your connection and retry.');
  return mapProfile(data);
}
export async function saveProfile(client: SupabaseClient, userId: string, profile: Profile, fields: readonly ProfileField[], active: () => boolean) {
  const values = profileValues(profile, fields);
  await requireOwner(client, userId, active);
  const existing = await client.from('profiles').select('id').eq('id', userId).maybeSingle();
  if (existing.error) throw new Error('Your details could not be saved. Please retry.');
  if (!active()) throw new Error('Your account changed. Please sign in again.');
  if (!existing.data) {
    const inserted = await client.from('profiles').insert({ id: userId, ...values }).select(columns).single();
    if (!inserted.error) return mapProfile(inserted.data);
    if (inserted.error.code !== '23505') throw new Error('Your details could not be saved. Refresh before retrying.');
  }
  // Recheck identity before a later mutation; RLS remains the final authority.
  await requireOwner(client, userId, active);
  const updated = await client.from('profiles').update(values).eq('id', userId).select(columns).single();
  if (updated.error) throw new Error('Your details could not be saved. Refresh before retrying.');
  return mapProfile(updated.data);
}
