export function readSupabaseConfig() {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (url !== 'https://wyvsbzcltrhnjeuijsva.supabase.co' || !key?.startsWith('sb_publishable_') || key.length <= 15) {
    throw new Error('Catalogue configuration is unavailable.');
  }
  return { url, key };
}
