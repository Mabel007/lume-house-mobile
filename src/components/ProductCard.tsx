import { useState } from 'react';
import { Link, router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Product } from '../features/products/products';
import { formatMoney } from '../config/shop';
import { ProductImage } from './ProductImage';
import { cataloguePrice, requiresOptions, selectedVariant, variantAvailable, variantLabel } from '../features/products/variants';
import { useAuth } from '../features/auth/AuthContext';
import { useBag } from '../features/cart/BagContext';
import { MAX_QUANTITY } from '../features/cart/cart';
import { ActionButton } from './ActionButton';
import { useToast } from './Toast';
import { productHref } from '../features/products/productRoute';
export function ProductCard({ product, details = false }: { product: Product; details?: boolean }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // The variant this card just had confirmed, or null. It is an identity and not a message, so a customer who
  // changes the selection cannot be shown a confirmation for a variant they no longer hold.
  const [added, setAdded] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const { state: auth, busy: authBusy } = useAuth();
  const bag = useBag();
  const toast = useToast();
  const variants = product.variants ?? [];
  const optionsRequired = requiresOptions(variants);
  const variant = selectedVariant(variants, selectedId);
  const price = cataloguePrice({ ...product, variants });
  const available = variantAvailable(variant);
  const selection = variant ? variantLabel(variant) : '';
  const addedUnits = bag.state.items.reduce((total, item) => total + item.quantity, 0);
  const limitReached = bag.state.items.some(item => item.variantId === variant?.id && item.quantity >= MAX_QUANTITY);
  // Only genuine in-flight work reads as busy. A definite failure or an unconfirmed one is finished, and
  // reporting it as progress both lies to the screen reader and hides the recovery the customer needs.
  const working = bag.signedIn && (bag.state.status === 'loading' || bag.state.status === 'saving');
  const recovering = bag.signedIn && (bag.state.status === 'error' || bag.state.status === 'uncertain');
  // `pending` is this card's own press. The shared Bag status can trail it by a frame, and a second tap in that
  // window must be refused here rather than reach the controller as a duplicate intent.
  const busy = authBusy || auth.status === 'restoring' || working || pending;
  const plural = (units: number) => `${units} ${units === 1 ? 'item' : 'items'} in your Bag`;
  async function add() {
    setAdded(null);
    if (!available || !variant || busy || recovering || limitReached) return;
    if (!bag.signedIn) { router.navigate('/account'); return; }
    setPending(true);
    const saved = await bag.dispatch({ type: 'add', variantId: variant.id });
    setPending(false);
    if (!saved) return;
    // Read the Bag back rather than guessing the new count: the server cart is the only authority here, and the
    // answer the customer gets must be the one the shop is now holding.
    const units = bag.current().items.reduce((total, item) => total + item.quantity, 0);
    setAdded(variant.id);
    toast.notify({ variant: 'success', title: 'Added to your Bag', description: `${product.name}${selection ? ` · ${selection}` : ''}. ${plural(units)}.` });
  }
  const information = <>
    <View style={[styles.photo, { backgroundColor: product.color }]}>
      <ProductImage image={product.image} name={product.name} />
    </View>
    <Text style={styles.category}>{product.category}</Text>
    <Text accessibilityRole={details ? 'header' : undefined} style={styles.name}>{product.name}</Text>
    <Text style={styles.price}>{!variant && price.from ? 'From ' : ''}{formatMoney(variant?.price ?? price.price)}</Text>
  </>;
  return <View style={styles.card}>
    {details ? <View>{information}</View> : <Pressable accessibilityRole="link" accessibilityLabel={`View details for ${product.name}`}
      onPress={() => router.navigate(productHref(product.id))}>{information}</Pressable>}
    {details ? <>
      <Text style={styles.description}>{product.description}</Text>
      <Text accessibilityLiveRegion="polite" style={styles.optionText}>{variant ? available ? 'Available' : 'Unavailable' :
        variants.filter(choice => !optionsRequired || !choice.isDefault).some(variantAvailable) ? 'Choose an available selection below.' : 'Unavailable'}</Text>
    </> : null}
    {optionsRequired ? <View style={styles.options}>
      <Text style={styles.category}>Choose a selection</Text>
      {variants.filter(variant => !variant.isDefault).map(choice => {
        const inStock = variantAvailable(choice);
        const selected = selectedId === choice.id;
        const label = variantLabel(choice);
        return <Pressable key={choice.id} accessibilityRole="radio"
          accessibilityLabel={`${product.name}, ${label}, ${formatMoney(choice.price)}${inStock ? '' : ', unavailable'}`}
          accessibilityState={{ checked: selected, disabled: !inStock }} disabled={!inStock}
          onPress={() => { setSelectedId(choice.id); setAdded(null); }}
          style={[styles.option, selected && styles.selected, !inStock && styles.dim]}>
          <Text style={styles.optionText}>{label}</Text>
          <Text style={styles.optionText}>{formatMoney(choice.price)}{inStock ? '' : ' · Unavailable'}</Text>
        </Pressable>;
      })}
    </View> : null}
    <View style={styles.actions}>
      {details && recovering && bag.state.message ? <View style={styles.recovery}>
        <Text accessible accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.optionText}>{bag.state.message}</Text>
        <View style={styles.recoveryActions}>
          <ActionButton label="Refresh Bag" secondary busy={busy} disabled={busy} onPress={() => { void bag.refresh(); }} />
          {bag.state.canRetry ? <ActionButton label="Retry saved change" secondary busy={busy} disabled={busy} onPress={() => { void bag.retry(); }} /> : null}
        </View>
      </View> : null}
      <ActionButton label={pending ? 'Adding to your Bag…' : limitReached ? 'Quantity limit reached' : !variant ? optionsRequired ? 'Choose a selection' : 'Unavailable' :
        !available ? 'Unavailable' : bag.signedIn ? 'Add to Bag' : 'Sign in to add'}
        accessibilityLabel={`Add ${product.name}${variant ? `, ${variantLabel(variant) || 'standard selection'}` : ''} to Bag`}
        busy={busy} disabled={!available || busy || recovering || limitReached} onPress={() => { void add(); }} />
      {product.variants === undefined ? <Text style={styles.category}>Selections are unavailable. Refresh the catalogue to try again.</Text> : null}
      {/* The record states a Bag count, so it is only honest while the cart is known: `ready`. */}
      {details && added && added === variant?.id && bag.state.status === 'ready' ? <View style={styles.added}>
        <View accessible accessibilityLabel={`${product.name}${selection ? `, ${selection}` : ''} added to your Bag. ${plural(addedUnits)}.`} style={styles.addedCopy}>
          <Text style={styles.addedTitle}>Added to your Bag</Text>
          <Text style={styles.optionText}>{`${product.name}${selection ? ` · ${selection}` : ''} · ${formatMoney(variant?.price ?? price.price)}`}</Text>
          <Text style={styles.optionText}>{plural(addedUnits)}</Text>
        </View>
        <Link href="/bag" asChild><Pressable accessibilityRole="link" accessibilityLabel={`View Bag. ${plural(addedUnits)}.`} style={styles.viewBag}>
          <Text style={styles.addedTitle}>View Bag</Text>
        </Pressable></Link>
      </View> : null}
    </View>
  </View>;
}
const styles = StyleSheet.create({
  card: { flex: 1, minWidth: 0, margin: 6, paddingBottom: 16 },
  photo: { aspectRatio: 0.9, borderRadius: 12, overflow: 'hidden', justifyContent: 'center', alignItems: 'center' },
  category: { color: '#665F52', fontSize: 12, marginTop: 12 },
  name: { color: '#292820', fontSize: 17, fontWeight: '500', marginTop: 4 },
  price: { color: '#423F38', fontSize: 15, marginTop: 6 },
  description: { color: '#423F38', fontSize: 16, lineHeight: 25, marginVertical: 16 },
  options: { gap: 8, marginTop: 8 }, option: { minHeight: 48, borderWidth: 1, borderColor: '#A59C8B',
    borderRadius: 8, padding: 10, gap: 4 }, selected: { borderColor: '#535B40', backgroundColor: '#E7E8DB', borderWidth: 2 },
  optionText: { color: '#423F38', fontSize: 13, lineHeight: 19 }, dim: { opacity: 0.55 }, actions: { marginTop: 12, gap: 8 },
  recovery: { gap: 8, padding: 12, borderRadius: 8, backgroundColor: '#EFEBE1' },
  recoveryActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  added: { gap: 8, padding: 12, borderRadius: 8, backgroundColor: '#EFEBE1' },
  addedCopy: { gap: 2 }, addedTitle: { color: '#535B40', fontSize: 15, fontWeight: '600' },
  viewBag: { minHeight: 48, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 8, backgroundColor: '#E7E8DB',
    alignItems: 'center', justifyContent: 'center' },
});
