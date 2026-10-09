import { useState } from 'react';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Product } from '../features/products/products';
import { formatMoney } from '../config/shop';
import { ProductImage } from './ProductImage';
import { cataloguePrice, requiresOptions, selectedVariant, variantAvailable, variantLabel } from '../features/products/variants';
import { useAuth } from '../features/auth/AuthContext';
import { useBag } from '../features/cart/BagContext';
import { MAX_QUANTITY } from '../features/cart/cart';
import { ActionButton } from './ActionButton';
import { productHref } from '../features/products/productRoute';
export function ProductCard({ product, details = false }: { product: Product; details?: boolean }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const { state: auth, busy: authBusy } = useAuth();
  const bag = useBag();
  const variants = product.variants ?? [];
  const optionsRequired = requiresOptions(variants);
  const variant = selectedVariant(variants, selectedId);
  const price = cataloguePrice({ ...product, variants });
  const available = variantAvailable(variant);
  const limitReached = bag.state.items.some(item => item.variantId === variant?.id && item.quantity >= MAX_QUANTITY);
  const busy = authBusy || auth.status === 'restoring' || bag.signedIn && bag.state.status !== 'ready';
  async function add() {
    setConfirmation(null);
    if (!available || !variant || busy || limitReached) return;
    if (!bag.signedIn) { router.navigate('/account'); return; }
    if (await bag.dispatch({ type: 'add', variantId: variant.id })) setConfirmation('Added to your Bag.');
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
          onPress={() => { setSelectedId(choice.id); setConfirmation(null); }}
          style={[styles.option, selected && styles.selected, !inStock && styles.dim]}>
          <Text style={styles.optionText}>{label}</Text>
          <Text style={styles.optionText}>{formatMoney(choice.price)}{inStock ? '' : ' · Unavailable'}</Text>
        </Pressable>;
      })}
    </View> : null}
    <View style={styles.actions}>
      <ActionButton label={limitReached ? 'Quantity limit reached' : !variant ? optionsRequired ? 'Choose a selection' : 'Unavailable' :
        !available ? 'Unavailable' : bag.signedIn ? 'Add to Bag' : 'Sign in to add'}
        accessibilityLabel={`Add ${product.name}${variant ? `, ${variantLabel(variant) || 'standard selection'}` : ''} to Bag`}
        busy={busy} disabled={!available || busy || limitReached} onPress={() => { void add(); }} />
      {product.variants === undefined ? <Text style={styles.category}>Selections are unavailable. Refresh the catalogue to try again.</Text> : null}
      {confirmation ? <Text accessibilityLiveRegion="polite" style={styles.optionText}>{confirmation}</Text> : null}
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
});
