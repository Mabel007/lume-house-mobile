import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ActionButton } from '../../components/ActionButton';
import { useAuth } from '../auth/AuthContext';
import { getSupabaseClient } from '../../lib/supabase/client';
import { emailCopy, moneyAt, orderDateTime, orderLabel, type OrderDetail } from './orders';
import type { EmailStatus } from '../checkout/order';
import { paymentProviders } from '../checkout/checkout';
import { checkConfirmation, loadOrder } from './orderRepository';
import { placedEmail } from './placedConfirmation';
import { CancellationPanel } from './CancellationPanel';

const identifier = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const money = (value: number) => moneyAt(value);
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
// A repository failure is always given as customer-facing text, and a read that returns nothing at all is
// reported as the generic retry line rather than as an empty success.
const failure = (reason: unknown) => (reason && typeof (reason as Error).message === 'string' && (reason as Error).message
  ? (reason as Error).message : 'This order could not be loaded. Check your connection and retry.');

type Read = { key: string; status: 'loading' | 'ready' | 'error'; order: OrderDetail | null; message: string | null };
type EmailRead = { key: string; status: EmailStatus | null; message: string | null };

export default function OrderDetailsScreen() {
  const { state: auth } = useAuth();
  const { orderId, received } = useLocalSearchParams<{ orderId?: string | string[]; received?: string | string[] }>();
  const id = first(orderId);
  const trusted = id && identifier.test(id) ? id : null;
  const justPlaced = first(received) === '1';
  const userId = auth.status === 'signed-in' ? auth.user.id : null;
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<Read>({ key: '', status: 'loading', order: null, message: null });
  // A read answer only belongs to the screen while its own customer, order and attempt still match, so a
  // session change or a retry shows loading instead of leaving the previous answer on screen.
  const readKey = userId && trusted ? `${userId}:${trusted}:${revision}` : '';
  const read = state.key === readKey ? state : { status: 'loading' as const, order: null, message: null };
  const [emailRevision, setEmailRevision] = useState(0);
  const emailKey = userId && trusted ? `${userId}:${trusted}:${emailRevision}` : '';
  // The email line is either what this device heard from the order service when it placed this order, or what the
  // customer explicitly asked it to check. A route parameter is never trusted, and arriving here never re-asks,
  // because that call claims the job and attempts a send.
  const [emailState, setEmailState] = useState<EmailRead>({ key: '', status: placedEmail(trusted), message: null });
  const emailBusy = emailRevision > 0 && emailState.key !== emailKey;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!readKey || !userId || !trusted) return;
    let live = true;
    void loadOrder(getSupabaseClient(), userId, trusted, () => live && mounted.current)
      .then(order => { if (live) setState({ key: readKey, status: 'ready', order, message: null }); })
      .catch(reason => { if (live) setState({ key: readKey, status: 'error', order: null, message: failure(reason) }); });
    return () => { live = false; };
  }, [readKey, userId, trusted]);
  useEffect(() => {
    if (!emailRevision || !emailKey || !userId || !trusted) return;
    let live = true;
    void checkConfirmation(getSupabaseClient(), userId, trusted, () => live && mounted.current)
      .then(status => { if (live) setEmailState({ key: emailKey, status, message: null }); })
      .catch(reason => { if (live) setEmailState(current => ({ key: emailKey, status: current.status, message: failure(reason) })); });
    return () => { live = false; };
  }, [emailKey, emailRevision, userId, trusted]);
  if (!userId) return <Frame title="Your order">
    <Text style={styles.text}>{auth.status === 'restoring' ? 'Restoring your session…' : 'Sign in to your Lumé House account to see this order.'}</Text>
    {auth.status === 'restoring' ? null : <Link href="/account" asChild><Pressable accessibilityRole="link" style={styles.link}><Text style={styles.text}>Go to your account</Text></Pressable></Link>}
  </Frame>;
  if (!trusted) return <Frame title="Your order">
    <Text accessibilityRole="alert" style={styles.text}>No order reference reached this screen, so nothing is shown. Your orders are listed from your account.</Text>
    <Link href="/account" asChild><Pressable accessibilityRole="link" style={styles.link}><Text style={styles.text}>Go to your account</Text></Pressable></Link>
  </Frame>;
  if (read.status === 'loading') return <Frame title={justPlaced ? 'Order received' : 'Order details'}>
    <View accessibilityLiveRegion="polite" style={styles.status}>
      <ActivityIndicator color="#535B40" accessibilityLabel="Loading your order" /><Text style={styles.text}>Loading your order…</Text>
    </View>
  </Frame>;
  if (read.status === 'error') return <Frame title={justPlaced ? 'Order received' : 'Order details'}>
    <Text accessible accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.text}>{read.message}</Text>
    <ActionButton label="Retry this order" onPress={() => setRevision(value => value + 1)} />
  </Frame>;
  if (!read.order) return <Frame title="Your order">
    <Text accessibilityRole="alert" style={styles.text}>This order is not on your account. Order records belong to the account that placed them.</Text>
    <Link href="/account" asChild><Pressable accessibilityRole="link" style={styles.link}><Text style={styles.text}>Go to your account</Text></Pressable></Link>
  </Frame>;
  const order = read.order;
  const pickup = order.fulfilment === 'pickup';
  return <Frame title={justPlaced ? 'Order received' : 'Order details'} eyebrow={justPlaced ? 'ORDER RECEIVED' : 'ORDER DETAILS'} heading={order.reference}>
    {justPlaced ? <Text accessible accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.notice}>Your order has been placed. Payment is awaiting confirmation, and your selected mobile-money method has not been charged or verified by Lumé House.</Text> : null}
    <Text style={styles.text}>{orderDateTime(order.placedAt)}</Text>
    <Section title="Operational status">
      <Text style={styles.pill}>{`Order: ${orderLabel(order.status)}`}</Text>
      <Text style={styles.note}>{pickup ? 'Pickup fulfilment uses ready for pickup before completion.' : 'Delivery fulfilment uses out for delivery before completion.'} Completion describes fulfilment, not payment settlement.</Text>
    </Section>
    <Section title="Your selected pieces">
      {order.lines.map(line => <View key={line.key} accessible
        accessibilityLabel={`${line.name}${line.options ? `, ${line.options}` : ''}, quantity ${line.quantity}. ${money(line.lineTotal)}`} style={styles.row}>
        <Text style={styles.text}>{line.options ? `${line.name} · ${line.options}` : line.name}</Text>
        <Text style={styles.text}>{`${line.quantity} × ${money(line.unitPrice)}`}</Text>
        <Text style={styles.text}>{money(line.lineTotal)}</Text>
      </View>)}
    </Section>
    <Section title={pickup ? 'Pickup' : 'Delivery'}>
      <Text style={styles.text}>{`${order.customer.name} · ${order.customer.phone}`}</Text>
      <Text style={styles.text}>{order.customer.email}</Text>
      {pickup ? <Text style={styles.text}>{order.pickupLocation ?? 'The pickup location recorded with your order'}</Text>
        : order.delivery ? <>
          <Text style={styles.text}>{order.delivery.street}</Text>
          <Text style={styles.text}>{`${order.delivery.area}, ${order.delivery.city}`}</Text>
          <Text style={styles.text}>{order.delivery.zoneLabel}</Text>
          {order.delivery.instructions ? <Text style={styles.text}>Instructions: {order.delivery.instructions}</Text> : null}
        </> : null}
    </Section>
    <Section title="Payment status">
      <Text style={styles.pill}>{`Payment: ${orderLabel(order.paymentStatus)}`}</Text>
      <Text style={styles.text}>{`Selected method: ${paymentProviders[order.provider].name}${order.phoneLast4 ? ` · number ending ${order.phoneLast4}` : ''}`}</Text>
      {order.paymentStatus === 'awaiting_payment' ? <Text accessible accessibilityLiveRegion="polite" style={styles.note}>Payment is awaiting confirmation. The selected method has not been charged or verified by this app.</Text> : null}
      <Text style={styles.note}>This app does not process or verify mobile-money payments. The recorded payment state is separate from fulfilment.</Text>
    </Section>
    <Section title="Order summary">
      <Total label="Subtotal" value={money(order.subtotal)} />
      <Total label={pickup ? 'Pickup' : 'Delivery'} value={money(order.fee)} />
      <Total label="Total" value={money(order.total)} strong />
    </Section>
    <CancellationPanel userId={userId} order={order} />
    <Section title="Confirmation email">
      <Text accessible accessibilityLiveRegion="polite" style={styles.text}>{emailState.status ? emailCopy[emailState.status] : emailBusy ? 'Checking the confirmation email status with the shop…' : 'The confirmation email status for this order has not been checked on this device.'}</Text>
      {!emailBusy && emailState.message ? <Text accessible accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.text}>{emailState.message}</Text> : null}
      <Text style={styles.note}>Your order is saved even if the confirmation email is delayed.</Text>
      <ActionButton label="Check the confirmation email" secondary busy={emailBusy} disabled={emailBusy}
        accessibilityLabel="Check the confirmation email status for this order" onPress={() => setEmailRevision(value => value + 1)} />
    </Section>
    <View style={styles.actions}>
      <Link href="/orders" asChild><Pressable accessibilityRole="link" style={styles.link}><Text style={styles.text}>Your orders</Text></Pressable></Link>
      <Link href="/" asChild><Pressable accessibilityRole="link" style={styles.link}><Text style={styles.text}>Continue shopping</Text></Pressable></Link>
    </View>
  </Frame>;
}

function Frame({ title, eyebrow = 'YOUR ORDER', heading, children }: { title: string; eyebrow?: string; heading?: string; children: ReactNode }) {
  return <SafeAreaView style={styles.root}><ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <ActionButton label="Back" accessibilityLabel="Go back, or open your order history" secondary onPress={() => { if (router.canGoBack()) router.back(); else router.replace('/account'); }} />
    <Text accessibilityElementsHidden style={styles.eyebrow}>{eyebrow}</Text>
    <Text accessibilityRole="header" style={styles.title}>{heading ?? title}</Text>
    {children}
  </ScrollView></SafeAreaView>;
}
function Section({ title, children }: { title: string; children: ReactNode }) {
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text>
    <View style={styles.rows}>{children}</View>
  </View>;
}
function Total({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <View accessible accessibilityLabel={`${label}. ${value}`} style={styles.row}>
    <Text style={strong ? styles.strong : styles.text}>{label}</Text>
    <Text style={strong ? styles.strong : styles.text}>{value}</Text>
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F6F2EB' },
  content: { padding: 24, gap: 18, maxWidth: 650, width: '100%', alignSelf: 'center' },
  eyebrow: { fontSize: 11, fontWeight: '600', letterSpacing: 1.9, color: '#665F52' },
  title: { fontSize: 28, lineHeight: 34, letterSpacing: -0.8, color: '#292820' },
  text: { fontSize: 16, lineHeight: 25, color: '#423F38' },
  strong: { fontSize: 17, fontWeight: '600', color: '#292820' },
  note: { fontSize: 15, lineHeight: 23, color: '#665F52' },
  pill: { alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: '#EEEBE1', color: '#535B40', fontSize: 15, fontWeight: '600' },
  notice: { fontSize: 16, lineHeight: 25, color: '#535B40', fontWeight: '600' },
  section: { gap: 10 }, rows: { gap: 8 },
  sectionTitle: { fontSize: 19, fontWeight: '600', color: '#292820' },
  row: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' },
  status: { gap: 12, paddingVertical: 20 }, actions: { gap: 12 }, link: { minHeight: 48, justifyContent: 'center' },
});
