import { CryptoDigestAlgorithm, digest, getRandomValues } from 'expo-crypto';
import { Platform } from 'react-native';

// Supply missing WebCrypto primitives used by the SDK with Expo native crypto.
export function ensurePKCECrypto() {
  if (Platform.OS !== 'web') {
    const crypto = globalThis.crypto || {};
    if (!('getRandomValues' in crypto)) Object.defineProperty(crypto, 'getRandomValues', { value: getRandomValues });
    if (!('subtle' in crypto)) Object.defineProperty(crypto, 'subtle', { value: {
      digest: (algorithm: string, data: BufferSource) => {
        if (algorithm !== 'SHA-256') throw new Error('Unsupported digest.');
        return digest(CryptoDigestAlgorithm.SHA256, data);
      },
    } });
    if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: crypto, configurable: true });
  }
  if (typeof globalThis.crypto?.getRandomValues !== 'function' || typeof globalThis.crypto?.subtle?.digest !== 'function' ||
      typeof TextEncoder === 'undefined' || typeof btoa === 'undefined') throw new Error('Secure sign-in is unavailable.');
}
