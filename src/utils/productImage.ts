import { shop } from '../config/shop';
export function resolveProductImage(value: string): string {
  if (/^\/images\/[a-zA-Z0-9_-]+\.webp$/.test(value)) return new URL(value, shop.webOrigin).href;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.username && !url.password) return url.href;
  } catch { /* Reject unsafe or unsupported paths. */ }
  throw new Error('Invalid product image');
}
