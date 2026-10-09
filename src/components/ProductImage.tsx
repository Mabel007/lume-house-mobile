import { useState } from 'react';
import { Image } from 'expo-image';
import { StyleSheet, Text } from 'react-native';
import { resolveProductImage } from '../utils/productImage';

export function ProductImage({ image, name }: { image: string; name: string }) {
  let uri: string | null = null;
  try { uri = resolveProductImage(image); } catch { /* Never fetch rejected media. */ }
  // Remount only the image when its resolved source changes. Card selection and
  // Bag intent stay intact; an old source's late error cannot mark the new one failed.
  return <ImageAttempt key={uri ?? 'missing'} uri={uri} name={name} />;
}

function ImageAttempt({ uri, name }: { uri: string | null; name: string }) {
  const [failed, setFailed] = useState(false);
  if (!uri || failed) return <Text accessible accessibilityRole="image"
    accessibilityLabel={`Image unavailable for ${name}`} style={styles.fallback}>Image unavailable</Text>;
  return <Image source={{ uri }} style={styles.image} contentFit="cover" accessible
    accessibilityLabel={name} onError={() => setFailed(true)} />;
}

const styles = StyleSheet.create({
  image: { width: '100%', height: '100%' },
  fallback: { color: '#423F38', padding: 12, textAlign: 'center' },
});
