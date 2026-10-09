import { useCallback } from 'react';
import { Link, useFocusEffect } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ActionButton } from '../../components/ActionButton';
import { formatMoney } from '../../config/shop';
import { useAuth } from '../auth/AuthContext';
import { useProducts } from '../products/ProductContext';
import { variantLabel } from '../products/variants';
import { useBag } from './BagContext';
import { cartLine, MAX_QUANTITY, type CartItem } from './cart';

function BagLine({ item }: { item: CartItem }) {
  const { state: catalogue } = useProducts();
  const bag = useBag();
  const { busy: authBusy } = useAuth();
  const line = cartLine(item, catalogue.status === 'ready' ? catalogue.products : []);
  const disabled = authBusy || bag.state.status !== 'ready';
  const name = line.product?.name ?? 'Unavailable selection';
  const label = line.variant ? variantLabel(line.variant) : '';
  return <View style={styles.line}>
    <Text style={styles.name}>{name}</Text>
    {label ? <Text style={styles.text}>{label}</Text> : null}
    {catalogue.status === 'ready' ? line.available && line.variant ?
      <Text style={styles.text}>{formatMoney(line.variant.price)} each · {formatMoney(line.lineTotal!)}</Text> :
      <Text style={styles.text}>This selection is unavailable. You can remove it from your Bag.</Text> :
      <Text style={styles.text}>Refresh the catalogue to see current prices and availability.</Text>}
    <Text style={styles.text}>Quantity: {item.quantity}</Text>
    <View style={styles.quantity}>
      <ActionButton label="−" accessibilityLabel={`Decrease ${name}${label ? `, ${label}` : ''} quantity`} secondary
        disabled={disabled || !line.available || item.quantity <= 1}
        onPress={() => { void bag.dispatch({ type: 'set', variantId: item.variantId, quantity: item.quantity - 1 }); }} />
      <ActionButton label="+" accessibilityLabel={`Increase ${name}${label ? `, ${label}` : ''} quantity`} secondary
        disabled={disabled || !line.available || item.quantity >= MAX_QUANTITY}
        onPress={() => { void bag.dispatch({ type: 'set', variantId: item.variantId, quantity: item.quantity + 1 }); }} />
      <ActionButton label="Remove" accessibilityLabel={`Remove ${name}${label ? `, ${label}` : ''} from Bag`} secondary disabled={disabled}
        onPress={() => { void bag.dispatch({ type: 'remove', variantId: item.variantId }); }} />
    </View>
  </View>;
}

export default function BagScreen() {
  const bag = useBag();
  const { state: auth, busy: authBusy } = useAuth();
  const { state: catalogue, refresh: refreshCatalogue } = useProducts();
  const { refresh, signedIn } = bag;
  useFocusEffect(useCallback(() => { if (signedIn) void refresh(); }, [signedIn, refresh]));
  const busy = authBusy || bag.state.status === 'loading' || bag.state.status === 'saving';
  const items = signedIn ? bag.state.items : [];
  const lines = items.map(item => cartLine(item, catalogue.status === 'ready' ? catalogue.products : []));
  const completePrices = catalogue.status === 'ready' && lines.every(line => line.available && line.lineTotal !== null);
  const subtotal = lines.reduce((sum, line) => sum + (line.available ? line.lineTotal ?? 0 : 0), 0);
  return <SafeAreaView style={styles.root}>
    <FlatList data={items} keyExtractor={item => item.variantId} renderItem={({ item }) => <BagLine item={item} />}
      contentContainerStyle={styles.content}
      ListHeaderComponent={<View style={styles.header}>
        <Link href="/" asChild><Pressable accessibilityRole="link" style={styles.link}><Text style={styles.text}>Continue shopping</Text></Pressable></Link>
        <Text accessibilityRole="header" style={styles.title}>Your Bag</Text>
        {auth.status === 'restoring' ? <Text style={styles.text}>Restoring your session…</Text> : !signedIn ? <>
          <Text style={styles.text}>Sign in with Google to save your Bag across web and mobile.</Text>
          <Link href="/account" asChild><Pressable accessibilityRole="link" style={styles.signIn}><Text style={styles.signInText}>Go to your account</Text></Pressable></Link>
        </> : <>
          <Text style={styles.text}>Saved to your account. Refresh to load changes from another device.</Text>
          <ActionButton label="Refresh Bag" busy={busy} disabled={busy} onPress={() => { refreshCatalogue(); void refresh(); }} />
          <Link href="/account" asChild><Pressable accessibilityRole="link" style={styles.link}><Text style={styles.text}>Your account</Text></Pressable></Link>
          {busy ? <View accessibilityLiveRegion="polite" style={styles.progress}><ActivityIndicator color="#535B40" accessibilityLabel={bag.state.status === 'saving' ? 'Saving your Bag' : 'Loading your Bag'} />
            <Text style={styles.text}>{bag.state.status === 'saving' ? 'Saving your Bag…' : 'Loading your Bag…'}</Text></View> : null}
          {bag.state.message ? <Text accessibilityRole="alert" style={styles.text}>{bag.state.message}</Text> : null}
          {bag.state.canRetry ? <ActionButton label="Retry saved change" busy={busy} disabled={busy} secondary onPress={() => { void bag.retry(); }} /> : null}
          {catalogue.status === 'error' ? <><Text accessibilityRole="alert" style={styles.text}>Current prices and selections could not be loaded.</Text>
            <ActionButton label="Retry catalogue" secondary onPress={refreshCatalogue} /></> : null}
        </>}
      </View>}
      ListEmptyComponent={signedIn && bag.state.status === 'ready' ? <Text accessibilityLiveRegion="polite" style={styles.empty}>Your Bag is empty. Find something beautiful in the collection.</Text> : null}
      ListFooterComponent={items.length ? <View style={styles.summary}>
        {completePrices ? <Text style={styles.name}>Subtotal {formatMoney(subtotal)}</Text> : <Text style={styles.text}>Subtotal is unavailable until current selections are available.</Text>}
        <Text style={styles.text}>Current prices are shown. Refresh after making changes on the web.</Text>
      </View> : null} />
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F6F2EB' }, content: { padding: 24, maxWidth: 650, width: '100%', alignSelf: 'center', gap: 16 },
  header: { gap: 16, paddingBottom: 8 }, title: { fontSize: 30, color: '#292820' },
  text: { fontSize: 16, lineHeight: 24, color: '#423F38' }, name: { fontSize: 19, fontWeight: '600', color: '#292820' },
  line: { padding: 18, gap: 12, borderRadius: 12, backgroundColor: '#FFFDF8' },
  quantity: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, link: { minHeight: 48, justifyContent: 'center' },
  signIn: { minHeight: 48, borderRadius: 8, padding: 16, backgroundColor: '#535B40', alignItems: 'center' },
  signInText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' }, progress: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, alignItems: 'center' },
  empty: { fontSize: 17, lineHeight: 26, color: '#423F38', paddingVertical: 24 }, summary: { paddingVertical: 24, gap: 12 },
});
