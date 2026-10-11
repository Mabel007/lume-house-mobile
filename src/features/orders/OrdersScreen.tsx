import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Link, router } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ActionButton } from '../../components/ActionButton';
import { useAuth } from '../auth/AuthContext';
import { getSupabaseClient } from '../../lib/supabase/client';
import { loadOrders } from './orderRepository';
import { moneyAt, orderDate, orderLabel, type OrderSummary } from './orders';
import { OrdersController } from './OrdersController';

function Row({ order }: { order: OrderSummary }) {
  const fulfilment = order.fulfilment === 'pickup' ? 'Pickup' : 'Delivery';
  return <Link href={{ pathname: '/orders/[orderId]', params: { orderId: order.id } }} asChild>
    <Pressable accessibilityRole="link" accessibilityLabel={`${order.reference}. ${orderDate(order.placedAt)}. ${fulfilment}. ${moneyAt(order.total)}. Order ${orderLabel(order.status)}. Payment ${orderLabel(order.paymentStatus)}.`}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <View style={styles.rowTop}>
        <Text style={styles.reference}>{order.reference}</Text>
        <Text style={styles.pill}>{orderLabel(order.status)}</Text>
      </View>
      <Text style={styles.text}>{orderDate(order.placedAt)} · {fulfilment} · {moneyAt(order.total)}</Text>
      <Text style={styles.note}>Payment: {orderLabel(order.paymentStatus)}</Text>
      <Text accessibilityElementsHidden style={styles.chevron}>›</Text>
    </Pressable>
  </Link>;
}

export default function OrdersScreen() {
  const { state: auth, busy: authBusy } = useAuth();
  const userId = auth.status === 'signed-in' ? auth.user.id : null;
  const [controller] = useState(() => {
    const instance: OrdersController = new OrdersController((customer, page) =>
      loadOrders(getSupabaseClient(), customer, page, instance.isActive));
    return instance;
  });
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => {
    if (!userId) return;
    controller.activate();
    void controller.refresh(userId);
    // A different session gets a fresh read: an order list never carries over from another customer.
    return () => controller.deactivate();
  }, [userId, controller]);
  if (!userId) return <Frame>
    <Text style={styles.text}>{auth.status === 'restoring' ? 'Restoring your session…' : 'Sign in to your Lumé House account to see your orders.'}</Text>
    {auth.status === 'restoring' ? null : <Link href="/account" asChild><Pressable accessibilityRole="link" style={styles.link}><Text style={styles.text}>Go to your account</Text></Pressable></Link>}
  </Frame>;
  if (state.status === 'loading' && !state.orders.length) return <Frame>
    <View accessibilityLiveRegion="polite" style={styles.status}>
      <ActivityIndicator color="#535B40" accessibilityLabel="Loading your orders" /><Text style={styles.text}>Loading your orders…</Text>
    </View>
  </Frame>;
  if (state.status === 'error') return <Frame>
    <Text accessible accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.text}>{state.message}</Text>
    <ActionButton label="Retry your orders" onPress={() => void controller.refresh(userId)} />
  </Frame>;
  return <Frame>
    {state.message ? <Text accessible accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.text}>{state.message}</Text> : null}
    {state.orders.length ? <>
      <Text style={styles.note}>Order status describes fulfilment. Payment stays awaiting confirmation until the shop records it.</Text>
      {state.orders.map(order => <Row key={order.id} order={order} />)}
      {state.older ? <ActionButton label="Load earlier orders" secondary busy={state.loadingMore} disabled={state.loadingMore || authBusy}
        accessibilityLabel="Load earlier orders" onPress={() => void controller.loadMore()} />
        : <Text accessibilityLiveRegion="polite" style={styles.note}>That is every order on this account.</Text>}
    </> : <View accessible accessibilityLiveRegion="polite" style={styles.empty}>
      <Text style={styles.text}>No orders on this account yet.</Text>
      <Text style={styles.note}>When you place an order it appears here with the status the shop recorded.</Text>
    </View>}
    {!state.orders.length || !state.older ? <Link href="/" asChild><Pressable accessibilityRole="link" style={styles.link}>
      <Text style={styles.text}>{state.orders.length ? 'Continue shopping' : 'Browse the catalogue'}</Text>
    </Pressable></Link> : null}
  </Frame>;
}

function Frame({ children }: { children: ReactNode }) {
  return <SafeAreaView style={styles.root}><ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <ActionButton label="Back" accessibilityLabel="Go back, or open your account" secondary
      onPress={() => { if (router.canGoBack()) router.back(); else router.replace('/account'); }} />
    <Text accessibilityElementsHidden style={styles.eyebrow}>MY ORDERS</Text>
    <Text accessibilityRole="header" style={styles.title}>My Orders</Text>
    {children}
  </ScrollView></SafeAreaView>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F6F2EB' },
  content: { padding: 24, gap: 14, maxWidth: 650, width: '100%', alignSelf: 'center' },
  eyebrow: { fontSize: 11, fontWeight: '600', letterSpacing: 1.9, color: '#665F52' },
  title: { fontSize: 28, lineHeight: 34, letterSpacing: -0.8, color: '#292820' },
  text: { fontSize: 16, lineHeight: 25, color: '#423F38' },
  note: { fontSize: 15, lineHeight: 23, color: '#665F52' },
  reference: { fontSize: 17, fontWeight: '600', color: '#292820' },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: '#EEEBE1', color: '#535B40', fontSize: 14, fontWeight: '600' },
  row: { gap: 6, padding: 16, borderRadius: 12, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E4DFD3' },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  chevron: { fontSize: 20, color: '#797566' }, pressed: { opacity: 0.7 },
  status: { gap: 12, paddingVertical: 20 }, empty: { gap: 8 }, link: { minHeight: 48, justifyContent: 'center' },
});
