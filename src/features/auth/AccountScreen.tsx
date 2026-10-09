import { Link } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from './AuthContext';

export default function AccountScreen() {
  const { state, busy, message, signIn, signOut } = useAuth();
  const loading = busy || state.status === 'restoring';
  return <SafeAreaView style={styles.root}><ScrollView contentContainerStyle={styles.content}>
    <Text accessibilityRole="header" style={styles.title}>Your account</Text>
    {state.status === 'restoring' ? <Text style={styles.text}>Restoring your session…</Text> : state.status === 'signed-in' ?
      <View key={state.user.id} style={styles.identity}><Text style={styles.text}>Signed in with Google</Text><Text selectable style={styles.text}>{state.user.email || 'Your Google account'}</Text></View> :
      <Text style={styles.text}>Sign in with your Google account. You can browse our collection without signing in.</Text>}
    {loading ? <View accessibilityLiveRegion="polite"><ActivityIndicator color="#535B40" accessibilityLabel="Account loading" /><Text style={styles.text}>{busy ? 'Updating your account…' : 'Please wait…'}</Text></View> : null}
    {message ? <Text accessibilityRole="alert" style={styles.text}>{message}</Text> : null}
    {state.status !== 'restoring' ? <Pressable accessibilityRole="button" accessibilityState={{ disabled: loading, busy: loading }} disabled={loading}
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
});
