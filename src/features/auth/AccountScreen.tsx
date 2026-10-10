import { Link } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from './AuthContext';
import { localFixtureAvailable } from './localFixtureAuth';

export default function AccountScreen() {
  const { state, busy, message, signIn, signOut, signInFixture } = useAuth();
  const [alias, setAlias] = useState('customer-a');
  const [code, setCode] = useState('');
  const local = localFixtureAvailable();
  const loading = busy || state.status === 'restoring';
  return <SafeAreaView style={styles.root}><ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <Text accessibilityRole="header" style={styles.title}>Your account</Text>
    {state.status === 'restoring' ? <Text style={styles.text}>Restoring your session…</Text> : state.status === 'signed-in' ?
      <View key={state.user.id} style={styles.identity}><Text style={styles.text}>{local ? 'Signed in to local QA' : 'Signed in with Google'}</Text>{local ? null : <Text selectable style={styles.text}>{state.user.email || 'Your Google account'}</Text>}</View> :
      <Text style={styles.text}>{local ? 'Use a private enrollment code from the local fixture helper. You can browse without signing in.' : 'Sign in with your Google account. You can browse our collection without signing in.'}</Text>}
    {loading ? <View accessibilityLiveRegion="polite"><ActivityIndicator color="#535B40" accessibilityLabel="Account loading" /><Text style={styles.text}>{busy ? 'Updating your account…' : 'Please wait…'}</Text></View> : null}
    {message ? <Text accessibilityRole="alert" style={styles.text}>{message}</Text> : null}
    {local && state.status === 'signed-out' ? <View style={styles.identity}>
      {['customer-a', 'customer-b'].map(value => <Pressable key={value} accessibilityRole="radio" accessibilityLabel={value === 'customer-a' ? 'Customer A' : 'Customer B'} accessibilityState={{ checked: alias === value, disabled: loading }} disabled={loading} onPress={() => setAlias(value)} style={styles.link}><Text style={styles.text}>{alias === value ? '● ' : '○ '}{value === 'customer-a' ? 'Customer A' : 'Customer B'}</Text></Pressable>)}
      <TextInput accessibilityLabel="Private enrollment code" value={code} onChangeText={setCode} editable={!loading} secureTextEntry autoCapitalize="none" autoCorrect={false} style={styles.input} />
      <Pressable accessibilityRole="button" accessibilityLabel="Sign in to local QA" accessibilityState={{ disabled: loading || !code, busy: loading }} disabled={loading || !code} onPress={() => { const enrollment = code.trim(); setCode(''); void signInFixture(alias, enrollment); }} style={[styles.button, (loading || !code) && styles.disabled]}><Text style={styles.buttonText}>Sign in to local QA</Text></Pressable>
    </View> : null}
    {state.status !== 'restoring' && (!local || state.status === 'signed-in') ? <Pressable accessibilityRole="button" accessibilityLabel={state.status === 'signed-in' ? 'Sign out of your account' : 'Continue with Google'} accessibilityState={{ disabled: loading, busy: loading }} disabled={loading}
      onPress={() => { void (state.status === 'signed-in' ? signOut() : signIn()); }} style={[styles.button, loading && styles.disabled]}>
      <Text style={styles.buttonText}>{state.status === 'signed-in' ? 'Sign out' : 'Continue with Google'}</Text>
    </Pressable> : null}
    <Link href="/bag" asChild><Pressable accessibilityRole="link" style={styles.link}><Text style={styles.text}>View your Bag</Text></Pressable></Link>
    <Link href="/" asChild><Pressable accessibilityRole="link" style={styles.link}><Text style={styles.text}>Browse the collection</Text></Pressable></Link>
  </ScrollView></SafeAreaView>;
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F6F2EB' }, content: { padding: 24, gap: 24, maxWidth: 650, width: '100%', alignSelf: 'center' },
  title: { fontSize: 30, color: '#292820' }, text: { fontSize: 16, lineHeight: 25, color: '#423F38' }, identity: { gap: 10 },
  button: { minHeight: 48, padding: 16, borderRadius: 8, backgroundColor: '#535B40', alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' }, disabled: { opacity: 0.6 }, link: { minHeight: 48, justifyContent: 'center' },
  input: { minHeight: 48, borderWidth: 1, borderColor: '#535B40', borderRadius: 8, padding: 12, color: '#292820' },
});
