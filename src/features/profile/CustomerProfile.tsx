import { useEffect, useRef, useSyncExternalStore } from 'react';
import { ActivityIndicator, Alert, BackHandler, Keyboard, StyleSheet, Text, TextInput, View } from 'react-native';
import { ActionButton } from '../../components/ActionButton';
import type { ProfileController } from './ProfileController';
import { editorFields, hasUnsavedChanges, type ProfileField } from './profile';

type Props = {
  controller: ProfileController;
  editor: 'profile' | 'delivery' | null;
  onEditorChange: (editor: 'profile' | 'delivery' | null) => void;
};

export function CustomerProfile({ controller, editor, onEditorChange }: Props) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const busy = state.status === 'loading' || state.status === 'saving';
  const dirty = !busy && editor !== null && hasUnsavedChanges(state.saved, state.draft, editorFields[editor]);
  const keyboardOpen = useRef(false);
  const backPress = useRef<() => boolean>(() => false);
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => backPress.current());
    const shown = Keyboard.addListener('keyboardDidShow', () => { keyboardOpen.current = true; });
    const hidden = Keyboard.addListener('keyboardDidHide', () => { keyboardOpen.current = false; });
    return () => { subscription.remove(); shown.remove(); hidden.remove(); };
  }, []);
  useEffect(() => {
    backPress.current = () => {
      // Android can spend the first Back on hiding the keyboard, so never treat that as leaving the editor.
      if (keyboardOpen.current) { Keyboard.dismiss(); return true; }
      if (!dirty) return false;
      Alert.alert('Discard your changes?', 'These details are not saved yet. Discarding restores your last saved values.', [
        { text: 'Continue editing', style: 'cancel' },
        { text: 'Discard changes', style: 'destructive', onPress: () => { controller.cancel(); onEditorChange(null); } },
      ]);
      return true;
    };
  });
  function field(key: ProfileField, label: string) {
    return <View style={styles.field} key={key}><Text style={styles.label}>{label}</Text>
      <TextInput accessibilityLabel={label} accessibilityHint={state.errors[key] || 'Optional saved profile detail'} value={state.draft[key]} onChangeText={value => controller.edit(key, value)} editable={!busy}
        keyboardType={key === 'phone' ? 'phone-pad' : 'default'} autoComplete={key === 'phone' ? 'tel' : key === 'full_name' ? 'name' : key === 'default_street_address' ? 'street-address' : 'off'} autoCapitalize={key === 'phone' ? 'none' : 'words'} style={styles.input} />
      {state.errors[key] ? <Text accessibilityRole="alert" style={styles.error}>{state.errors[key]}</Text> : null}</View>;
  }
  return <View style={styles.surface}>
    {busy ? <ActivityIndicator accessibilityLabel="Profile loading or saving" color="#535B40" /> : null}
    {state.message ? <Text accessibilityLiveRegion="polite" style={styles.text}>{state.message}</Text> : null}
    {state.status === 'error' ? <ActionButton label="Retry loading details" onPress={() => void controller.refresh()} /> : state.status !== 'loading' ? <>
      <Text accessibilityRole="header" style={styles.heading}>Personal Information</Text>
      {editor === 'profile' ? <>
        {field('full_name', 'Full name')}{field('phone', 'Contact phone')}
        <ActionButton label={state.status === 'saving' ? 'Saving…' : 'Save profile'} busy={busy} disabled={busy} onPress={() => { void controller.save(editorFields.profile).then(saved => { if (saved) onEditorChange(null); }); }} />
        <ActionButton label="Cancel profile changes" secondary disabled={busy} onPress={() => { controller.cancel(); onEditorChange(null); }} />
      </> : <>
        <Text style={styles.text}>{state.saved.full_name || 'No name saved.'}</Text>
        <Text style={styles.text}>{state.saved.phone || 'No contact phone saved.'}</Text>
        <ActionButton label="Edit profile" secondary onPress={() => onEditorChange('profile')} />
        <ActionButton label="Refresh account details" secondary onPress={() => void controller.refresh()} />
      </>}
      <Text accessibilityRole="header" style={styles.heading}>Delivery Details</Text>
      <Text style={styles.text}>One saved default address. Your profile name and phone are the delivery contact defaults. You can change these for each order at checkout.</Text>
      {editor === 'delivery' ? <>
        {field('full_name', 'Delivery contact name')}{field('phone', 'Delivery contact phone')}
        {field('default_street_address', 'Street address / landmark')}{field('default_area', 'Area / community')}{field('default_city', 'City / town')}
        <Text style={styles.text}>Saved defaults are optional. Checkout will ask for any required missing details.</Text>
        <ActionButton label={state.status === 'saving' ? 'Saving…' : 'Save delivery details'} disabled={busy} busy={busy} onPress={() => { void controller.save(editorFields.delivery).then(saved => { if (saved) onEditorChange(null); }); }} />
        <ActionButton label="Cancel delivery changes" secondary disabled={busy} onPress={() => { controller.cancel(); onEditorChange(null); }} />
      </> : <>
        <Text style={styles.text}>{[state.saved.default_street_address, state.saved.default_area, state.saved.default_city].filter(Boolean).join('\n') || 'No delivery address saved.'}</Text>
        {!state.saved.full_name || !state.saved.phone || !state.saved.default_street_address || !state.saved.default_area || !state.saved.default_city ? <Text style={styles.text}>Your delivery defaults are incomplete. You can fill them in now or at checkout.</Text> : null}
        <ActionButton label="Edit delivery details" secondary onPress={() => onEditorChange('delivery')} />
      </>}
    </> : null}
  </View>;
}
const styles = StyleSheet.create({
  surface: { gap: 14, padding: 20, borderRadius: 12, backgroundColor: '#FFFFFF' }, field: { gap: 6 },
  heading: { fontSize: 23, color: '#292820' }, label: { fontSize: 16, fontWeight: '600', color: '#423F38' }, text: { fontSize: 16, lineHeight: 25, color: '#423F38' },
  error: { color: '#9B2828', fontSize: 16 }, input: { minHeight: 48, borderWidth: 1, borderColor: '#797566', borderRadius: 8, padding: 12, fontSize: 16, color: '#292820' },
});
