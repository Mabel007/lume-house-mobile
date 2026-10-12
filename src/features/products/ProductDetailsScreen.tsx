import { router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ActionButton } from '../../components/ActionButton';
import { ProductCard } from '../../components/ProductCard';
import { AccountLink, BagLink } from '../../components/CommerceNav';
import { useProducts } from './ProductContext';
import { findRouteProduct } from './productRoute';

export default function ProductDetailsScreen() {
  const { productId } = useLocalSearchParams<{ productId?: string | string[] }>();
  const { state, refresh } = useProducts();
  const product = state.status === 'ready' ? findRouteProduct(state.products, productId) : undefined;
  return <SafeAreaView style={styles.root}><ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <ActionButton label="Back" accessibilityLabel="Go back, or return to the collection" secondary onPress={() => { if (router.canGoBack()) router.back(); else router.replace('/'); }} />
    <View style={styles.links}>
      <BagLink /><AccountLink />
    </View>
    {state.status === 'loading' ? <View accessibilityLiveRegion="polite" style={styles.status}>
      <ActivityIndicator color="#535B40" accessibilityLabel="Loading product" /><Text style={styles.text}>Loading product…</Text>
    </View> : state.status === 'error' ? <View style={styles.status}>
      <Text accessibilityRole="alert" style={styles.text}>We couldn’t load this product. Please try again.</Text>
      <ActionButton label="Retry product" onPress={refresh} />
    </View> : product ? <>
      <ProductCard key={product.id} product={product} details />
      <ActionButton label="Refresh product" secondary onPress={refresh} />
    </> : <View accessibilityLiveRegion="polite" style={styles.status}>
      <Text accessibilityRole="header" style={styles.title}>Product unavailable</Text>
      <Text style={styles.text}>This product is not in the current collection. It may no longer be available.</Text>
      <ActionButton label="Refresh product" secondary onPress={refresh} />
    </View>}
  </ScrollView></SafeAreaView>;
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F6F2EB' }, content: { padding: 24, gap: 16, maxWidth: 650, width: '100%', alignSelf: 'center' },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: 24 },
  text: { fontSize: 16, lineHeight: 25, color: '#423F38' }, title: { fontSize: 28, color: '#292820' }, status: { gap: 16, paddingVertical: 24 },
});
