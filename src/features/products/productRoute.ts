import type { Href } from 'expo-router';
import type { Product } from './products';

export function productHref(productId: string): Href {
  // Route exists in src/app/products/[productId].tsx. Expo's ignored route cache
  // regenerates at the next dev-server start; isolate that cache boundary here.
  return `/products/${encodeURIComponent(productId)}` as Href;
}
export function findRouteProduct(products: readonly Product[], productId: unknown): Product | undefined {
  return typeof productId === 'string' && productId.length > 0 ? products.find(product => product.id === productId) : undefined;
}
