import { Link } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ProductCard } from '../../components/ProductCard';
import { useProducts } from './ProductContext';
import { useBag } from '../cart/BagContext';
import { ActionButton } from '../../components/ActionButton';
export default function CatalogueScreen() {
  const { state, refresh } = useProducts();
  const bag = useBag();
  const { width, fontScale } = useWindowDimensions();
  const columns = width < 360 || fontScale > 1.3 ? 1 : width >= 700 ? 3 : 2;
  return <SafeAreaView style={styles.root}>
    <FlatList key={columns} numColumns={columns} data={state.status === 'ready' ? state.products : []} keyExtractor={item => item.id}
      contentContainerStyle={styles.content} renderItem={({ item }) => <ProductCard product={item} />}
      ListHeaderComponent={<View style={styles.header}><Text accessibilityRole="header" style={styles.brand}>Lumé House</Text>
        <View style={styles.links}><Link href="/account" asChild><Pressable accessibilityRole="link" style={styles.link}><Text style={styles.intro}>Your account</Text></Pressable></Link>
          <Link href="/bag" asChild><Pressable accessibilityRole="link" style={styles.link}><Text style={styles.intro}>Your Bag</Text></Pressable></Link></View>
        <Text style={styles.tagline}>Beautiful things live here.</Text><Text accessibilityRole="header" style={styles.title}>Considered living</Text><Text style={styles.intro}>Warm textures and thoughtful essentials for your home.</Text>
        {bag.signedIn && bag.state.message ? <View style={styles.bagMessage}><Text accessibilityRole="alert" style={styles.intro}>{bag.state.message}</Text>
          <Link href="/bag" asChild><Pressable accessibilityRole="link" style={styles.link}><Text style={styles.intro}>Review your Bag</Text></Pressable></Link></View> : null}
        {state.status === 'ready' ? <View style={styles.refresh}><ActionButton label="Refresh catalogue" secondary onPress={refresh} /></View> : null}
      </View>}
      ListEmptyComponent={<View style={styles.status} accessibilityLiveRegion="polite">
        {state.status === 'loading' ? <><ActivityIndicator size="large" color="#535B40" accessibilityLabel="Loading catalogue" /><Text style={styles.message}>Loading beautiful things…</Text></> : state.status === 'error' ? <><Text accessibilityRole="alert" style={styles.message}>We couldn’t load the catalogue. Please try again.</Text><ActionButton label="Retry catalogue" onPress={refresh} /></> : <Text style={styles.message}>New pieces are on their way. Check back soon.</Text>}
      </View>} />
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F6F2EB' }, content: { padding: 18, maxWidth: 1000, width: '100%', alignSelf: 'center' },
  header: { paddingHorizontal: 6, paddingTop: 12, paddingBottom: 28 }, brand: { fontSize: 30, fontFamily: 'serif', color: '#292820' },
  tagline: { fontSize: 14, color: '#665F52', marginTop: 6 }, title: { fontSize: 28, color: '#292820', marginTop: 36 },
  intro: { fontSize: 16, lineHeight: 24, color: '#665F52', marginTop: 10 }, status: { padding: 24, alignItems: 'center', gap: 18 },
  message: { fontSize: 16, lineHeight: 24, textAlign: 'center', color: '#423F38' },
  links: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 24 }, link: { minHeight: 48, justifyContent: 'center' },
  refresh: { marginTop: 18, alignSelf: 'flex-start' }, bagMessage: { marginTop: 12 },
});
