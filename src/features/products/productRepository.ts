import type { SupabaseClient } from "@supabase/supabase-js";
import { parseProducts } from "./products";
import { applyAvailability, cataloguePrice, parseVariants } from './variants';

export async function loadProducts(
  client: SupabaseClient,
  currency: string,
  signal: AbortSignal,
) {
  const { data, error } = await client
    .from("products")
    .select(
      "id,name,description,price_cents,currency,image_path,category,background_color,active",
    )
    .eq("active", true)
    .order("display_order", { ascending: true })
    .order("id", { ascending: true })
    .abortSignal(signal);
  // Do not show raw provider errors or connection values to customers.
  if (error) throw new Error("Products could not be loaded.");
  const products = parseProducts(data, currency);
  const variants = await client.from('product_variants')
    .select('id,product_id,options,is_default,price_cents,currency,active,inventory_policy')
    .eq('active', true).order('id').abortSignal(signal);
  // Preserve public browsing for expand-first schemas, but never invent Bag IDs.
  if (variants.error) {
    if (variants.error.code === 'PGRST205' || variants.error.code === '42P01') return products;
    throw new Error('Products could not be loaded.');
  }
  let rows = parseVariants(variants.data);
  if (rows.some(variant => variant.inventoryPolicy === 'tracked')) {
    const availability = await client.rpc('catalogue_variant_availability').abortSignal(signal);
    if (availability.error) throw new Error('Product availability could not be loaded.');
    rows = applyAvailability(rows, availability.data);
  }
  if (rows.some(variant => !products.some(product => product.id === variant.productId))) throw new Error('Invalid variant catalogue.');
  return products.map(product => {
    const variants = rows.filter(variant => variant.productId === product.id);
    return { ...product, variants, price: cataloguePrice({ ...product, variants }).price };
  });
}
