import { Link } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from './AuthContext';
import { localFixtureAvailable } from './localFixtureAuth';
import { revealField, type FieldReveal, type RevealerNode, type ScrollFrame } from '../../lib/scrollReveal';
import { AccountDashboard } from '../account/AccountDashboard';
import { BagLink } from '../../components/CommerceNav';

function metadataName(user: { user_metadata?: Record<string, unknown> } | undefined) {
  const metadata = user?.user_metadata;
  for (const key of ['full_name', 'name']) {
    const value = metadata?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

export default function AccountScreen() {
  const { state, busy, message, signIn, signOut, signInFixture } = useAuth();
  const [alias, setAlias] = useState('customer-a');
  const [code, setCode] = useState('');
  const scroll = useRef<ScrollView>(null);
  const content = useRef<View>(null);
  const focused = useRef<RevealerNode | null>(null);
  const frame = useRef<ScrollFrame>({ offset: 0, viewport: 0 });
  const [imeHeight, setImeHeight] = useState(0);
  const reveal: FieldReveal = node => {
    if (node) focused.current = node;
    revealField({ scroll: scroll.current, content: content.current, frame: frame.current }, focused.current);
  };
  useEffect(() => {
    // Android overlays the keyboard instead of resizing the window, so the scroll view owns the inset.
    if (Platform.OS === 'ios') return;
    const shown = Keyboard.addListener('keyboardDidShow', event => { const height = event.endCoordinates?.height ?? 0; frame.current.keyboard = height; setImeHeight(height); });
    const hidden = Keyboard.addListener('keyboardDidHide', () => { frame.current.keyboard = 0; setImeHeight(0); });
    return () => { shown.remove(); hidden.remove(); };
  }, []);
  const local = localFixtureAvailable();
  const loading = busy || state.status === 'restoring';
  const user = state.status === 'signed-in' ? state.user : undefined;
  return <SafeAreaView style={styles.root}><KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><ScrollView ref={scroll} contentContainerStyle={[styles.content, { paddingBottom: Math.max(56, imeHeight + 24) }]} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" scrollEventThrottle={16} onScroll={event => { frame.current.offset = event.nativeEvent.contentOffset.y; }} onLayout={event => { frame.current.viewport = event.nativeEvent.layout.height; reveal(null); }} onContentSizeChange={() => reveal(null)}>
    <View ref={content} style={styles.flow}>
      <Text accessibilityElementsHidden style={styles.eyebrow}>MY ACCOUNT</Text>
      <Text accessibilityRole="header" style={styles.title}>Your account</Text>
      {state.status === 'restoring' ? <Text style={styles.text}>Restoring your session…</Text> : null}
      {loading ? <View accessibilityLiveRegion="polite"><ActivityIndicator color="#535B40" accessibilityLabel="Account loading" /><Text style={styles.text}>{busy ? 'Updating your account…' : 'Please wait…'}</Text></View> : null}
      {message ? <Text accessibilityRole="alert" style={styles.text}>{message}</Text> : null}
      {user ? <AccountDashboard key={user.id} userId={user.id} email={user.email} accountName={metadataName(user)} local={local} busy={busy} revealField={reveal} onSignOut={() => { void signOut(); }} /> : null}
      {!user && state.status !== 'restoring' ? <>
        <Text style={styles.text}>{local ? 'Use a private enrollment code from the local fixture helper. You can browse without signing in.' : 'Sign in with your Google account. You can browse our collection without signing in.'}</Text>
        {local ? <View style={styles.identity}>
          {['customer-a', 'customer-b'].map(value => <Pressable key={value} accessibilityRole="radio" accessibilityLabel={value === 'customer-a' ? 'Customer A' : 'Customer B'} accessibilityState={{ checked: alias === value, disabled: loading }} disabled={loading} onPress={() => setAlias(value)} style={styles.link}><Text style={styles.text}>{alias === value ? '● ' : '○ '}{value === 'customer-a' ? 'Customer A' : 'Customer B'}</Text></Pressable>)}
          <TextInput accessibilityLabel="Private enrollment code" value={code} onChangeText={setCode} editable={!loading} secureTextEntry autoCapitalize='none' autoCorrect={false} style={styles.input} />
          <Pressable accessibilityRole="button" accessibilityLabel="Sign in to local QA" accessibilityState={{ disabled: loading || !code, busy: loading }} disabled={loading || !code} onPress={() => { const enrollment = code.trim(); setCode(''); void signInFixture(alias, enrollment); }} style={[styles.button, (loading || !code) && styles.disabled]}><Text style={styles.buttonText}>Sign in to local QA</Text></Pressable>
        </View> : null}
        {!local ? <Pressable accessibilityRole="button" accessibilityLabel="Continue with Google" accessibilityState={{ disabled: loading, busy: loading }} disabled={loading} onPress={() => { void signIn(); }} style={[styles.button, loading && styles.disabled]}><Text style={styles.buttonText}>Continue with Google</Text></Pressable> : null}
      </> : null}
      <BagLink label="View your Bag" />
      <Link href="/" asChild><Pressable accessibilityRole="link" style={styles.link}><Text style={styles.text}>Browse the collection</Text></Pressable></Link>
    </View>
  </ScrollView></KeyboardAvoidingView></SafeAreaView>;
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F6F2EB' }, content: { padding: 24, paddingBottom: 56, maxWidth: 650, width: '100%', alignSelf: 'center' }, flow: { gap: 18 },
  eyebrow: { fontSize: 11, fontWeight: '600', letterSpacing: 1.9, color: '#665F52' },
  title: { fontSize: 30, lineHeight: 36, letterSpacing: -1, color: '#292820' }, text: { fontSize: 16, lineHeight: 25, color: '#423F38' }, identity: { gap: 10 },
  button: { minHeight: 48, padding: 16, borderRadius: 8, backgroundColor: '#535B40', alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' }, disabled: { opacity: 0.6 }, link: { minHeight: 48, justifyContent: 'center' },
  input: { minHeight: 48, borderWidth: 1, borderColor: '#535B40', borderRadius: 8, padding: 12, color: '#292820' },
});
