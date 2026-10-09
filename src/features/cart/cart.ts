import type { Product } from '../products/products';
import { variantAvailable } from '../products/variants';

export const MAX_QUANTITY = 99;
export type CartItem = { productId: string; variantId: string; quantity: number };
export type VariantCart = { id: string; items: CartItem[] };
export type CartOperation = {
  variantId: string; mode: 'add' | 'set' | 'remove'; quantity: number | null;
  expectedQuantity: number | null; operationId: string;
};
export type CartAction = { type: 'add'; variantId: string } |
  { type: 'set'; variantId: string; quantity: number } | { type: 'remove'; variantId: string };

export function makeOperation(items: readonly CartItem[], action: CartAction, newId: () => string): CartOperation | null {
  if (!action.variantId || action.variantId.length > 150) return null;
  const existing = items.find(item => item.variantId === action.variantId);
  if (action.type === 'add' && existing?.quantity === MAX_QUANTITY) return null;
  if (action.type !== 'add' && !existing) return null;
  if (action.type === 'set' && (!Number.isInteger(action.quantity) || action.quantity < 1 ||
    action.quantity > MAX_QUANTITY || action.quantity === existing?.quantity)) return null;
  return {
    variantId: action.variantId, mode: action.type,
    quantity: action.type === 'add' ? 1 : action.type === 'set' ? action.quantity : null,
    expectedQuantity: action.type === 'add' ? null : existing!.quantity, operationId: newId(),
  };
}

export function cartLine(item: CartItem, products: readonly Product[]) {
  const product = products.find(product => product.id === item.productId);
  const variant = product?.variants?.find(variant => variant.id === item.variantId);
  return { item, product, variant, available: variantAvailable(variant),
    lineTotal: variant ? variant.price * item.quantity : null };
}
