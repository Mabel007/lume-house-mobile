export type Profile = { full_name: string; phone: string; default_street_address: string; default_area: string; default_city: string };
export type ProfileField = keyof Profile;
export const emptyProfile: Profile = { full_name: '', phone: '', default_street_address: '', default_area: '', default_city: '' };
export const profileFields = Object.keys(emptyProfile) as ProfileField[];
export function mapProfile(row: unknown): Profile {
  const values = row && typeof row === 'object' ? row as Record<string, unknown> : {};
  return Object.fromEntries(profileFields.map(key => [key, typeof values[key] === 'string' ? values[key] : ''])) as Profile;
}
// Keep the canonical web phone and optional-profile semantics.
export function normalizePhone(value: string) {
  const compact = value.trim().replace(/[\s()-]/g, '');
  if (/^00232\d+$/.test(compact)) return '+' + compact.slice(2);
  if (/^232\d+$/.test(compact)) return '+' + compact;
  if (/^0\d{8}$/.test(compact)) return '+232' + compact.slice(1);
  if (/^\d{8}$/.test(compact)) return '+232' + compact;
  return compact;
}
export function profileErrors(profile: Profile): Partial<Record<ProfileField, string>> {
  const errors: Partial<Record<ProfileField, string>> = {};
  for (const key of profileFields) if (profile[key].trim().length > 200) errors[key] = 'Please keep this field within 200 characters.';
  if (profile.phone.trim() && !/^\+232\d{8}$/.test(normalizePhone(profile.phone))) errors.phone = 'Enter a Sierra Leone phone number, for example +23276521208.';
  return errors;
}
export function profileValues(profile: Profile, fields: readonly ProfileField[]) {
  const errors = profileErrors(profile);
  for (const key of fields) if (errors[key]) throw new Error(errors[key]);
  return Object.fromEntries(fields.map(key => [key, profile[key].trim() ? key === 'phone' ? normalizePhone(profile[key]) : profile[key].trim() : null]));
}
