import type { SupabaseClient } from '@supabase/supabase-js';
import type { CartOperation, VariantCart } from './cart';

const messages: Record<string, string> = {
  AUTH_REQUIRED: 'Please sign in again to load your Bag.',
  CART_CHANGED: 'Your Bag changed in another session. Refresh it and review before trying again.',
  PRODUCT_UNAVAILABLE: 'This selection is unavailable. Refresh your Bag and catalogue.',
  CART_LIMIT: 'Your Bag has reached its item limit. Remove an item before adding another.',
  INVALID_REQUEST: 'This Bag change could not be saved. Refresh and review your Bag.',
  SCHEMA_NOT_READY: 'Your saved Bag is unavailable. Please try again later.',
};
export class VariantCartError extends Error {
  constructor(public readonly code: string, public readonly definite = true) {
    super(messages[code] ?? 'The Bag response could not be confirmed. Refresh or retry the saved change.');
  }
}

export function parseVariantCart(value: unknown): VariantCart {
  if (!value || typeof value !== 'object') throw new VariantCartError('INVALID_RESPONSE', false);
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || !row.id || !Array.isArray(row.items) || row.items.length > 100) {
    throw new VariantCartError('INVALID_RESPONSE', false);
  }
  const ids = new Set<string>();
  const items = row.items.map(item => {
    if (!item || typeof item.product_id !== 'string' || !item.product_id || typeof item.variant_id !== 'string' ||
      !item.variant_id || item.variant_id.length > 150 || ids.has(item.variant_id) || !Number.isInteger(item.quantity) ||
      item.quantity < 1 || item.quantity > 99) throw new VariantCartError('INVALID_RESPONSE', false);
    ids.add(item.variant_id);
    return { productId: item.product_id, variantId: item.variant_id, quantity: item.quantity };
  });
  return { id: row.id, items };
}

function rpcError(error: { code?: string; message?: string }) {
  if (error.code === 'PGRST202') return new VariantCartError('SCHEMA_NOT_READY');
  // Only known database rejections prove that a change did not commit.
  if (error.code === 'P0001' && error.message && Object.hasOwn(messages, error.message)) {
    return new VariantCartError(error.message);
  }
  return new VariantCartError('UNCONFIRMED', false);
}

export async function sessionToken(client: SupabaseClient, userId: string, isActive: () => boolean): Promise<string> {
  if (!isActive()) throw new VariantCartError('AUTH_REQUIRED');
  const { data, error } = await client.auth.getSession();
  if (!isActive() || error || !data.session || data.session.user.id !== userId) throw new VariantCartError('AUTH_REQUIRED');
  return data.session.access_token;
}

export async function loadVariantCart(client: SupabaseClient, accessToken: string): Promise<VariantCart> {
  const { data, error } = await client.rpc('load_variant_cart').setHeader('Authorization', `Bearer ${accessToken}`);
  if (error) throw rpcError(error);
  return parseVariantCart(data);
}

export async function changeVariantCart(client: SupabaseClient, accessToken: string, operation: CartOperation): Promise<VariantCart> {
  const { data, error } = await client.rpc('change_variant_cart', {
    p_variant_id: operation.variantId, p_mode: operation.mode, p_quantity: operation.quantity,
    p_expected_quantity: operation.expectedQuantity, p_operation_id: operation.operationId,
  }).setHeader('Authorization', `Bearer ${accessToken}`);
  if (error) throw rpcError(error);
  return parseVariantCart(data);
}
