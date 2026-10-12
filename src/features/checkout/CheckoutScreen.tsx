import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Link, router, useFocusEffect } from 'expo-router';
import { Alert, BackHandler, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';
import { SafeAreaView } from 'react-native-safe-area-context';
import { revealField as revealIn, type FieldReveal, type RevealerNode, type ScrollFrame } from '../../lib/scrollReveal';
import { useAuth } from '../auth/AuthContext';
import { useBag } from '../cart/BagContext';
import { cartLine, type CartItem } from '../cart/cart';
import { useProducts } from '../products/ProductContext';
import { variantLabel } from '../products/variants';
import type { Product } from '../products/products';
import { emptyProfile, type Profile } from '../profile/profile';
import { loadProfile } from '../profile/profileRepository';
import { getSupabaseClient } from '../../lib/supabase/client';
import { CheckoutController, type KeyStorage } from './CheckoutController';
import { CheckoutDetails } from './CheckoutDetails';
import { CheckoutPayment } from './CheckoutPayment';
import { checkoutErrors, deliveryFee, deliveryNotice, emptyCheckout, prefillDefaults, shownErrors, type CheckoutDraft, type CheckoutField, type CheckoutLine, type TouchedFields } from './checkout';

const keyStorage: KeyStorage = {
  getItem: key => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value).then(() => undefined),
  removeItem: key => AsyncStorage.removeItem(key).then(() => undefined),
};

export default function CheckoutScreen() {
  const { state: auth, busy: authBusy } = useAuth();
  const bag = useBag();
  const { state: catalogue, refresh: refreshCatalogue } = useProducts();
  const { refresh, signedIn } = bag;
  useFocusEffect(useCallback(() => { if (signedIn) void refresh(); }, [signedIn, refresh]));
  const scroll = useRef<ScrollView>(null);
  const content = useRef<View>(null);
  const focused = useRef<RevealerNode | null>(null);
  const frame = useRef<ScrollFrame>({ offset: 0, viewport: 0 });
  const [imeHeight, setImeHeight] = useState(0);
  const reveal: FieldReveal = node => {
    if (node) focused.current = node;
    revealIn({ scroll: scroll.current, content: content.current, frame: frame.current }, focused.current);
  };
  useEffect(() => {
    // Android overlays the keyboard instead of resizing the window, so the scroll view owns the inset.
    if (Platform.OS === 'ios') return;
    const shown = Keyboard.addListener('keyboardDidShow', event => { const height = event.endCoordinates?.height ?? 0; frame.current.keyboard = height; setImeHeight(height); });
    const hidden = Keyboard.addListener('keyboardDidHide', () => { frame.current.keyboard = 0; setImeHeight(0); focused.current = null; });
    return () => { shown.remove(); hidden.remove(); };
  }, []);
  const user = auth.status === 'signed-in' ? auth.user : undefined;
  const items = signedIn ? bag.state.items : [];
  const priced = catalogue.status === 'ready' ? catalogue.products : [];
  const pieces: CheckoutLine[] = items.map(item => {
    const line = cartLine(item, priced);
    const options = line.variant ? variantLabel(line.variant) : '';
    return { key: item.variantId, quantity: item.quantity, available: line.available, lineTotal: line.lineTotal,
      label: `${line.product?.name ?? 'Unavailable selection'}${options ? ` · ${options}` : ''}` };
  });
  const unavailable = pieces.filter(piece => !piece.available);
  const busy = authBusy || bag.state.status === 'loading' || bag.state.status === 'saving' || catalogue.status === 'loading';
  return <SafeAreaView style={styles.root}><KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView ref={scroll} contentContainerStyle={[styles.content, { paddingBottom: Math.max(56, imeHeight + 24) }]}
      keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" scrollEventThrottle={16}
      onScroll={event => { frame.current.offset = event.nativeEvent.contentOffset.y; }}
      onLayout={event => { frame.current.viewport = event.nativeEvent.layout.height; reveal(null); }} onContentSizeChange={() => reveal(null)}>
      <View ref={content} style={styles.flow}>
        <Text accessibilityElementsHidden style={styles.eyebrow}>CHECKOUT</Text>
        <Text accessibilityRole="header" style={styles.title}>Checkout.</Text>
        <Link href="/bag" asChild><Pressable accessibilityRole="link" style={styles.link}><Text style={styles.text}>Back to your Bag</Text></Pressable></Link>
        {auth.status === 'restoring' ? <Text style={styles.text}>Restoring your session…</Text> : !signedIn ? <>
          <Text style={styles.text}>Sign in to check out with the Bag and details saved to your account.</Text>
          <Link href="/account" asChild><Pressable accessibilityRole="link" style={styles.signIn}><Text style={styles.signInText}>Go to your account</Text></Pressable></Link>
        </> : <>
          {busy && !items.length ? <Text style={styles.text}>Loading your Bag…</Text> : null}
          {bag.state.message ? <Text style={styles.text}>{bag.state.message}</Text> : null}
          {bag.state.canRetry ? <Pressable accessibilityRole="button" accessibilityLabel="Retry saved change" accessibilityState={{ disabled: busy, busy }} disabled={busy}
            onPress={() => { void bag.retry(); }} style={styles.secondary}><Text style={styles.secondaryText}>Retry saved change</Text></Pressable> : null}
          {catalogue.status === 'error' ? <Text style={styles.text}>Current prices and selections could not be loaded. Your Bag is still saved.</Text> : null}
          {signedIn && bag.state.status === 'ready' && !items.length ? <>
            <Text style={styles.text}>Your Bag is empty. Add something from the collection before checking out.</Text>
            <Link href="/" asChild><Pressable accessibilityRole="link" style={styles.link}><Text style={styles.text}>Browse the collection</Text></Pressable></Link>
          </> : null}
          {items.length ? <>
            <Text style={styles.name}>{`${items.length === 1 ? '1 selection' : `${items.length} selections`} in your Bag.`}</Text>
            {unavailable.length ? <Text style={styles.text}>Some selections are no longer available. Update your Bag before continuing.</Text> : null}
            <Pressable accessibilityRole="button" accessibilityLabel="Refresh Bag" accessibilityState={{ disabled: busy, busy }} disabled={busy}
              onPress={() => { refreshCatalogue(); void refresh(); }} style={styles.secondary}><Text style={styles.secondaryText}>Refresh Bag</Text></Pressable>
            {user ? <CheckoutFlow key={user.id} userId={user.id} email={user.email ?? ''} busy={busy} pieces={pieces}
              items={items} products={priced} reveal={reveal} refreshBag={() => { void refresh(); }} /> : null}
          </> : null}
          <Text accessibilityRole="alert" style={styles.notice}>Payment awaits confirmation. Placing an order saves your order and requests a confirmation email. Selecting mobile money does not charge or verify your account.</Text>
        </>}
      </View>
    </ScrollView>
  </KeyboardAvoidingView></SafeAreaView>;
}

// One draft and one submission per signed-in customer: a new identity gets a new component, so no detail
// or reserved request id can carry over between accounts.
function CheckoutFlow({ userId, email, busy, pieces, items, products, reveal, refreshBag }: {
  userId: string; email: string; busy: boolean; pieces: readonly CheckoutLine[]; items: readonly CartItem[];
  products: readonly Product[]; reveal: FieldReveal; refreshBag: () => void;
}) {
  const [draft, setDraft] = useState<CheckoutDraft>(emptyCheckout);
  const [saved, setSaved] = useState<Profile | null>(null);
  const [touched, setTouched] = useState<TouchedFields>({});
  const dirty = useRef(false);
  const keyboardOpen = useRef(false);
  const backPress = useRef<() => boolean>(() => false);
  const keepBag = useRef(refreshBag);
  const confirmed = useRef(false);
  const [controller] = useState(() => new CheckoutController(getSupabaseClient(), userId, keyStorage, randomUUID));
  const submission = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => {
    let active = true;
    // A missing or unreadable profile simply leaves the draft empty; checkout never blocks on saved defaults.
    void loadProfile(getSupabaseClient(), userId, () => active).then(profile => { if (active) setSaved(profile); })
      .catch(() => { if (active) setSaved(emptyProfile); });
    return () => { active = false; };
  }, [userId]);
  useEffect(() => { if (saved && !dirty.current) setDraft(current => prefillDefaults(current, saved, email)); }, [saved, email]);
  useEffect(() => {
    controller.activate();
    // An interrupted placement is checked before the customer is offered a new one.
    void controller.recover();
    return () => controller.deactivate();
  }, [controller]);
  useEffect(() => { keepBag.current = refreshBag; });
  useEffect(() => {
    // The Bag is server state: the order service emptied it, so this screen reloads instead of editing a local copy.
    if (submission.status === 'placed') { dirty.current = false; keepBag.current(); }
  }, [submission.status]);
  useEffect(() => {
    // The confirmation screen reads the committed order back from the database, so this hand-off carries only
    // its identity. The email state is not carried here: the order service is asked about it, because a route
    // parameter can be typed or deep-linked and would otherwise let a device assert a send that never happened.
    if (submission.status !== 'placed' || !submission.orderId) return;
    if (confirmed.current) return;
    confirmed.current = true;
    router.replace({ pathname: '/orders/[orderId]', params: { orderId: submission.orderId, received: '1' } });
  }, [submission]);
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => backPress.current());
    const shown = Keyboard.addListener('keyboardDidShow', () => { keyboardOpen.current = true; });
    const hidden = Keyboard.addListener('keyboardDidHide', () => { keyboardOpen.current = false; });
    return () => { subscription.remove(); shown.remove(); hidden.remove(); };
  }, []);
  useEffect(() => {
    backPress.current = () => {
      // Android can spend the first Back on hiding the keyboard, so never treat that as leaving checkout.
      if (keyboardOpen.current) { Keyboard.dismiss(); return true; }
      if (!dirty.current) return false;
      Alert.alert('Leave checkout?', 'These checkout details are not saved with an order yet. Leaving now discards them.', [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Leave checkout', style: 'destructive', onPress: () => { dirty.current = false; router.back(); } },
      ]);
      return true;
    };
  });
  const errors = shownErrors(checkoutErrors(draft), touched);
  const change = (changes: Partial<CheckoutDraft>) => { dirty.current = true; setDraft(current => ({ ...current, ...changes })); };
  // A field only reports once the customer has entered it and moved on, so an untouched form never reads as a wall of errors.
  const touch = (field: CheckoutField) => setTouched(current => current[field] ? current : { ...current, [field]: true });
  const fee = deliveryFee(draft);
  if (submission.status === 'placed') return <Text accessible accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.notice}>Your order is saved. Opening your order confirmation…</Text>;
  const blocked = busy || !pieces.length || pieces.some(piece => !piece.available) || fee === null ||
    submission.status === 'submitting' || submission.status === 'checking';
  const place = () => {
    const problems = checkoutErrors(draft);
    // Pressing Place order is an explicit request to review everything, so every remaining problem becomes visible.
    if (Object.keys(problems).length) setTouched(current => { const next = { ...current }; for (const field of Object.keys(problems) as CheckoutField[]) next[field] = true; return next; });
    void controller.submit(draft, items, products);
  };
  return <>
    <CheckoutDetails draft={draft} errors={errors} notice={deliveryNotice(draft)} busy={busy} revealField={reveal} onChange={change} onTouch={touch} />
    <CheckoutPayment draft={draft} errors={errors} lines={pieces} fee={fee} busy={busy} revealField={reveal} onChange={change} onTouch={touch} />
    <View style={styles.submit}>
      {submission.message ? <Text accessible accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.notice}>{submission.message}</Text> : null}
      <Pressable accessibilityRole="button" accessibilityLabel="Place order"
        accessibilityHint={blocked ? 'Complete the highlighted details first.' : 'Saves your order with the shop. No payment is taken.'}
        accessibilityState={{ disabled: blocked, busy: submission.status === 'submitting' }}
        disabled={blocked} onPress={place} style={({ pressed }) => [styles.place, pressed && styles.pressed]}>
        <Text style={styles.placeText}>{submission.status === 'submitting' ? 'Placing your order…' : 'Place order'}</Text>
      </Pressable>
      {submission.canRetry ? <Pressable accessibilityRole="button" accessibilityLabel="Retry the same request"
        accessibilityHint="Repeats your last order request exactly, so an order is never placed twice."
        accessibilityState={{ disabled: busy }} disabled={busy} onPress={() => { void controller.retry(); }} style={styles.secondary}>
        <Text style={styles.secondaryText}>Retry the same request</Text>
      </Pressable> : null}
      <Text style={styles.note}>Placing an order saves it with the shop. It does not confirm payment, and nothing is charged by this app.</Text>
    </View>
  </>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F6F2EB' },
  content: { padding: 24, paddingBottom: 56, maxWidth: 650, width: '100%', alignSelf: 'center' },
  flow: { gap: 16 },
  eyebrow: { fontSize: 11, fontWeight: '600', letterSpacing: 1.9, color: '#665F52' },
  title: { fontSize: 30, lineHeight: 36, letterSpacing: -1, color: '#292820' },
  text: { fontSize: 16, lineHeight: 25, color: '#423F38' },
  name: { fontSize: 19, fontWeight: '600', color: '#292820' },
  notice: { fontSize: 16, lineHeight: 25, color: '#535B40', fontWeight: '600' },
  submit: { gap: 12, padding: 20, borderRadius: 12, backgroundColor: '#FFFFFF' },
  place: { minHeight: 56, justifyContent: 'center', alignItems: 'center', borderRadius: 8, backgroundColor: '#535B40' },
  placeText: { color: '#FFFFFF', fontSize: 17, fontWeight: '600' },
  note: { fontSize: 15, lineHeight: 23, color: '#665F52' },
  pressed: { opacity: 0.7 },
  link: { minHeight: 48, justifyContent: 'center' },
  secondary: { minHeight: 48, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 8, backgroundColor: '#EBE5D9', alignItems: 'center' },
  secondaryText: { color: '#423F38', fontSize: 15, fontWeight: '600' },
  signIn: { minHeight: 48, borderRadius: 8, padding: 16, backgroundColor: '#535B40', alignItems: 'center' },
  signInText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
});
