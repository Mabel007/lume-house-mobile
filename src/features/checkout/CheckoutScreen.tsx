import { useCallback } from 'react';
import { Link, useFocusEffect } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ActionButton } from '../../components/ActionButton';
import { useAuth } from '../auth/AuthContext';
import { useBag } from '../cart/BagContext';
import { cartLine } from '../cart/cart';
import { useProducts } from '../products/ProductContext';

export default function CheckoutScreen() {
  const { state: auth, busy: authBusy } = useAuth();
  const bag = useBag();
  const { state: catalogue, refresh: refreshCatalogue } = useProducts();
  const { refresh, signedIn } = bag;
  useFocusEffect(useCallback(() => { if (signedIn) void refresh(); }, [signedIn, refresh]));
  const items = signedIn ? bag.state.items : [];
  const lines = items.map(item => cartLine(item, catalogue.status === 'ready' ? catalogue.products : []));
  const unavailable = lines.filter(line => !line.available);
  const busy = authBusy || bag.state.status === 'loading' || bag.state.status === 'saving' || catalogue.status === 'loading';
  return <SafeAreaView style={styles.root}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text accessibilityElementsHidden style={styles.eyebrow}>CHECKOUT</Text>
      <View style={styles.flow}>
        <Text accessibilityRole="header" style={styles.title}>Checkout.</Text>
        <Link href="/bag" asChild><Pressable accessibilityRole="link" style={styles.link}><Text style={styles.text}>Back to your Bag</Text></Pressable></Link>
        {auth.status === 'restoring' ? <Text style={styles.text}>Restoring your session…</Text> : !signedIn ? <>
          <Text style={styles.text}>Sign in to check out with the Bag and details saved to your account.</Text>
          <Link href="/account" asChild><Pressable accessibilityRole="link" style={styles.signIn}><Text style={styles.signInText}>Go to your account</Text></Pressable></Link>
        </> : <>
          {busy && !items.length ? <Text style={styles.text}>Loading your Bag…</Text> : null}
          {bag.state.message ? <Text style={styles.text}>{bag.state.message}</Text> : null}
          {bag.state.canRetry ? <ActionButton label="Retry saved change" busy={busy} disabled={busy} secondary onPress={() => { void bag.retry(); }} /> : null}
          {catalogue.status === 'error' ? <Text style={styles.text}>Current prices and selections could not be loaded. Your Bag is still saved.</Text> : null}
          {signedIn && bag.state.status === 'ready' && !items.length ? <>
            <Text style={styles.text}>Your Bag is empty. Add something from the collection before checking out.</Text>
            <Link href="/" asChild><Pressable accessibilityRole="link" style={styles.link}><Text style={styles.text}>Browse the collection</Text></Pressable></Link>
          </> : null}
          {items.length ? <>
            <Text style={styles.name}>{`${items.length === 1 ? '1 selection' : `${items.length} selections`} in your Bag.`}</Text>
            {unavailable.length ? <Text style={styles.text}>Some selections are no longer available. Update your Bag before continuing.</Text> : null}
            <ActionButton label="Refresh Bag" busy={busy} disabled={busy} secondary onPress={() => { refreshCatalogue(); void refresh(); }} />
          </> : null}
          <View accessible accessibilityRole="alert" accessibilityLiveRegion="polite"
            accessibilityLabel="Order placement is not available in this build yet. Your Bag and saved details are unchanged.">
            <Text style={styles.notice}>Order placement is not available in this build yet. Your Bag and saved details are unchanged.</Text>
          </View>
        </>}
      </View>
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F6F2EB' },
  content: { padding: 24, paddingBottom: 56, maxWidth: 650, width: '100%', alignSelf: 'center' },
  flow: { gap: 16 },
  eyebrow: { fontSize: 12, letterSpacing: 1.6, color: '#797566' },
  title: { fontSize: 30, color: '#292820' },
  text: { fontSize: 16, lineHeight: 24, color: '#423F38' },
  name: { fontSize: 19, fontWeight: '600', color: '#292820' },
  notice: { fontSize: 16, lineHeight: 24, color: '#535B40', fontWeight: '600' },
  link: { minHeight: 48, justifyContent: 'center' },
  signIn: { minHeight: 48, borderRadius: 8, padding: 16, backgroundColor: '#535B40', alignItems: 'center' },
  signInText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
});
