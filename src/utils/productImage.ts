import { shop } from '../config/shop';

function unsafePath(path: string): boolean {
  // Inspect before URL canonicalization erases dot segments, including repeatedly
  // encoded segments. Each successful decoding shortens the input.
  if (/%(?![0-9a-f]{2})/i.test(path)) return true;
  while (true) {
    if (/[\u0000-\u001f\u007f\\]/.test(path) || /(?:^|\/)\.{1,2}(?:\/|$)/.test(path)) return true;
    if (!/%[0-9a-f]{2}/i.test(path)) return false;
    try {
      const decoded = decodeURIComponent(path);
      if (decoded === path) return false;
      path = decoded;
    } catch { return true; }
  }
}

export function resolveProductImage(value: string): string {
  if (typeof value !== 'string' || /[\s\u0000-\u001f\u007f\\]/.test(value)) {
    throw new Error('Invalid product image');
  }
  // Reviewed local assets use unencoded segments, with no query or fragment.
  // Keep existing flat WebP names while allowing the reviewed formats/folders.
  if (value.length <= 500 && /^\/images\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(webp|png|jpg|jpeg|svg)$/.test(value)) {
    return new URL(value, shop.webOrigin).href;
  }
  try {
    const https = /^https:\/\/[^/?#]+([^?#]*)/i.exec(value);
    if (!https || unsafePath(https[1])) throw new Error('Invalid product image');
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.username && !url.password) return url.href;
  } catch { /* Reject unsafe or unsupported paths. */ }
  throw new Error('Invalid product image');
}
