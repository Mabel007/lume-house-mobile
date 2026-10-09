export type ProductVariant = {
  id: string;
  productId: string;
  options: Readonly<Record<string, string>>;
  isDefault: boolean;
  price: number;
  currency: 'NLE';
  inventoryPolicy: 'untracked' | 'tracked';
  available?: boolean;
};

// Matches the existing web variant boundary; never synthesize a purchasable ID.
export function parseVariants(value: unknown): ProductVariant[] {
  if (!Array.isArray(value)) throw new Error('Invalid variant response.');
  const ids = new Set<string>();
  const defaults = new Set<string>();
  return value.map(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid variant.');
    const row = value as Record<string, unknown>;
    if (typeof row.id !== 'string' || !row.id || row.id.length > 150 || ids.has(row.id) ||
      typeof row.product_id !== 'string' || !row.product_id || typeof row.is_default !== 'boolean' ||
      row.active !== true || row.currency !== 'NLE' || !Number.isSafeInteger(row.price_cents) ||
      (row.price_cents as number) < 0 || (row.price_cents as number) > 2147483647 ||
      !['untracked', 'tracked'].includes(String(row.inventory_policy))) throw new Error('Invalid variant identity or price.');
    if (!row.options || typeof row.options !== 'object' || Array.isArray(row.options)) throw new Error('Invalid variant options.');
    const options = row.options as Record<string, unknown>;
    if (Object.keys(options).length > 8 || Object.entries(options).some(([key, value]) =>
      !key.trim() || key.length > 40 || typeof value !== 'string' || !value.trim() || value.length > 100) ||
      row.is_default !== (Object.keys(options).length === 0) || row.is_default && defaults.has(row.product_id)) {
      throw new Error('Invalid variant options.');
    }
    ids.add(row.id);
    if (row.is_default) defaults.add(row.product_id);
    return {
      id: row.id, productId: row.product_id, options: options as Record<string, string>,
      isDefault: row.is_default, price: row.price_cents as number, currency: 'NLE',
      inventoryPolicy: row.inventory_policy as ProductVariant['inventoryPolicy'],
    };
  });
}

export function variantAvailable(variant: ProductVariant | undefined): boolean {
  return !!variant && (variant.inventoryPolicy === 'untracked' || variant.available === true);
}

export function variantLabel(variant: ProductVariant): string {
  return Object.entries(variant.options).map(([key, value]) => `${key}: ${value}`).join(' · ');
}

export function requiresOptions(variants: readonly ProductVariant[]): boolean {
  return variants.some(variant => !variant.isDefault);
}

export function selectedVariant(variants: readonly ProductVariant[], selectedId: string | null): ProductVariant | undefined {
  // Options remain an explicit customer choice, even when only one is available.
  return requiresOptions(variants) ? variants.find(variant => !variant.isDefault && variant.id === selectedId) :
    variants.find(variant => variant.isDefault);
}

export function cataloguePrice(product: { price: number; variants: readonly ProductVariant[] }): { price: number; from: boolean } {
  const choices = product.variants.filter(variant => !variant.isDefault);
  if (!choices.length) return { price: product.variants.find(variant => variant.isDefault)?.price ?? product.price, from: false };
  const available = choices.filter(variantAvailable);
  return { price: Math.min(...(available.length ? available : choices).map(variant => variant.price)), from: true };
}

export function applyAvailability(variants: ProductVariant[], value: unknown): ProductVariant[] {
  if (!Array.isArray(value)) throw new Error('Invalid availability response.');
  const availability = new Map<string, boolean>();
  for (const row of value) {
    if (!row || typeof row.variant_id !== 'string' || typeof row.available !== 'boolean' || availability.has(row.variant_id)) {
      throw new Error('Invalid availability response.');
    }
    availability.set(row.variant_id, row.available);
  }
  return variants.map(variant => ({ ...variant, available: availability.get(variant.id) === true }));
}
