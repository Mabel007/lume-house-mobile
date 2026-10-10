import { useEffect, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native';
import { ActionButton } from '../../components/ActionButton';
import { getSupabaseClient } from '../../lib/supabase/client';
import { ProfileController } from './ProfileController';
import { loadProfile, saveProfile } from './profileRepository';
import type { ProfileField } from './profile';

export function CustomerProfile({ userId, email }: { userId: string; email?: string }) {
  const [controller] = useState(() => {
    const instance: ProfileController = new ProfileController({
      load: () => loadProfile(getSupabaseClient(), userId, instance.isActive),
      save: (profile, fields) => saveProfile(getSupabaseClient(), userId, profile, fields, instance.isActive),
    }); return instance;
  });
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [editing, setEditing] = useState<'profile' | 'delivery' | null>(null);
  useEffect(() => { controller.activate(); void controller.refresh(); return () => controller.deactivate(); }, [controller]);
  const busy = state.status === 'loading' || state.status === 'saving';
  function field(key: ProfileField, label: string) {
    return <View style={styles.field} key={key}><Text style={styles.label}>{label}</Text>
      <TextInput accessibilityLabel={label} accessibilityHint={state.errors[key] || 'Optional saved profile detail'} value={state.draft[key]} onChangeText={value => controller.edit(key, value)} editable={!busy}
        keyboardType={key === 'phone' ? 'phone-pad' : 'default'} autoComplete={key === 'phone' ? 'tel' : key === 'full_name' ? 'name' : key === 'default_street_address' ? 'street-address' : 'off'} autoCapitalize={key === 'phone' ? 'none' : 'words'} style={styles.input} />
      {state.errors[key] ? <Text accessibilityRole="alert" style={styles.error}>{state.errors[key]}</Text> : null}</View>;
  }
  return <View style={styles.surface}>
    <Text accessibilityRole="header" style={styles.heading}>{state.saved.full_name || 'Profile details'}</Text>
    <Text selectable style={styles.text}>{email || 'Email unavailable'}</Text>
    <Text style={styles.text}>Your sign-in email is managed by your identity provider.</Text>
    {busy ? <ActivityIndicator accessibilityLabel="Profile loading or saving" color="#535B40" /> : null}
    {state.message ? <Text accessibilityLiveRegion="polite" style={styles.text}>{state.message}</Text> : null}
    {state.status === 'error' ? <ActionButton label="Retry loading details" onPress={() => void controller.refresh()} /> : state.status !== 'loading' ? <>
      {editing === 'profile' ? <>{field('full_name', 'Full name')}{field('phone', 'Contact phone')}
        <ActionButton label={state.status === 'saving' ? 'Saving…' : 'Save profile'} busy={busy} disabled={busy} onPress={() => { void controller.save(['full_name', 'phone']).then(saved => { if (saved) setEditing(null); }); }} />
        <ActionButton label="Cancel profile changes" secondary disabled={busy} onPress={() => { controller.cancel(); setEditing(null); }} /></> : editing === null ? <>
        <Text style={styles.text}>{state.saved.phone || 'No contact phone saved.'}</Text>
        <ActionButton label="Edit profile" secondary onPress={() => setEditing('profile')} />
        <ActionButton label="Refresh account details" secondary onPress={() => void controller.refresh()} />
      </> : null}
      <Text accessibilityRole="header" style={styles.heading}>Delivery details</Text>
      <Text style={styles.text}>One saved default address. Your profile name and phone are the delivery contact defaults. You can change these for each order at checkout.</Text>
      {editing === 'delivery' ? <>
        {field('full_name', 'Delivery contact name')}{field('phone', 'Delivery contact phone')}
        {field('default_street_address', 'Street address / landmark')}{field('default_area', 'Area / community')}{field('default_city', 'City / town')}
        <Text style={styles.text}>Saved defaults are optional. Checkout will ask for any required missing details.</Text>
        <ActionButton label={state.status === 'saving' ? 'Saving…' : 'Save delivery details'} disabled={busy} busy={busy} onPress={() => { void controller.save(['full_name', 'phone', 'default_street_address', 'default_area', 'default_city']).then(saved => { if (saved) setEditing(null); }); }} />
        <ActionButton label="Cancel delivery changes" secondary disabled={busy} onPress={() => { controller.cancel(); setEditing(null); }} />
      </> : editing === null ? <>
        <Text style={styles.text}>{[state.saved.default_street_address, state.saved.default_area, state.saved.default_city].filter(Boolean).join('\n') || 'No delivery address saved.'}</Text>
        {!state.saved.full_name || !state.saved.phone || !state.saved.default_street_address || !state.saved.default_area || !state.saved.default_city ? <Text style={styles.text}>Your delivery defaults are incomplete. You can fill them in now or at checkout.</Text> : null}
        <ActionButton label="Edit delivery details" secondary onPress={() => setEditing('delivery')} />
      </> : null}
    </> : null}
  </View>;
}
const styles = StyleSheet.create({
  surface: { gap: 14, padding: 20, borderRadius: 12, backgroundColor: '#FFFFFF' }, field: { gap: 6 },
  heading: { fontSize: 23, color: '#292820' }, label: { fontSize: 16, fontWeight: '600', color: '#423F38' }, text: { fontSize: 16, lineHeight: 25, color: '#423F38' },
  error: { color: '#9B2828', fontSize: 16 }, input: { minHeight: 48, borderWidth: 1, borderColor: '#797566', borderRadius: 8, padding: 12, fontSize: 16, color: '#292820' },
});
