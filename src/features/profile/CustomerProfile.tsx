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
  const [editing, setEditing] = useState(false);
  useEffect(() => { controller.activate(); void controller.refresh(); return () => controller.deactivate(); }, [controller]);
  const busy = state.status === 'loading' || state.status === 'saving';
  function field(key: ProfileField, label: string) {
    return <View style={styles.field} key={key}><Text style={styles.label}>{label}</Text>
      <TextInput accessibilityLabel={label} accessibilityHint={state.errors[key] || 'Optional saved profile detail'} value={state.draft[key]} onChangeText={value => controller.edit(key, value)} editable={!busy}
        keyboardType={key === 'phone' ? 'phone-pad' : 'default'} autoComplete={key === 'phone' ? 'tel' : 'name'} autoCapitalize={key === 'phone' ? 'none' : 'words'} style={styles.input} />
      {state.errors[key] ? <Text accessibilityRole="alert" style={styles.error}>{state.errors[key]}</Text> : null}</View>;
  }
  return <View style={styles.surface}>
    <Text accessibilityRole="header" style={styles.heading}>{state.saved.full_name || 'Profile details'}</Text>
    <Text selectable style={styles.text}>{email || 'Email unavailable'}</Text>
    <Text style={styles.text}>Your sign-in email is managed by your identity provider.</Text>
    {busy ? <ActivityIndicator accessibilityLabel="Profile loading or saving" color="#535B40" /> : null}
    {state.message ? <Text accessibilityLiveRegion="polite" style={styles.text}>{state.message}</Text> : null}
    {state.status === 'error' ? <ActionButton label="Retry loading details" onPress={() => void controller.refresh()} /> : state.status !== 'loading' ? <>
      {editing ? <>{field('full_name', 'Full name')}{field('phone', 'Contact phone')}
        <ActionButton label={state.status === 'saving' ? 'Saving…' : 'Save profile'} busy={busy} disabled={busy} onPress={() => { void controller.save(['full_name', 'phone']).then(saved => { if (saved) setEditing(false); }); }} />
        <ActionButton label="Cancel profile changes" secondary disabled={busy} onPress={() => { controller.cancel(); setEditing(false); }} /></> : <>
        <Text style={styles.text}>{state.saved.phone || 'No contact phone saved.'}</Text>
        <ActionButton label="Edit profile" secondary onPress={() => setEditing(true)} />
        <ActionButton label="Refresh account details" secondary onPress={() => void controller.refresh()} />
      </>}
    </> : null}
  </View>;
}
const styles = StyleSheet.create({
  surface: { gap: 14, padding: 20, borderRadius: 12, backgroundColor: '#FFFFFF' }, field: { gap: 6 },
  heading: { fontSize: 23, color: '#292820' }, label: { fontSize: 16, fontWeight: '600', color: '#423F38' }, text: { fontSize: 16, lineHeight: 25, color: '#423F38' },
  error: { color: '#9B2828', fontSize: 16 }, input: { minHeight: 48, borderWidth: 1, borderColor: '#797566', borderRadius: 8, padding: 12, fontSize: 16, color: '#292820' },
});
