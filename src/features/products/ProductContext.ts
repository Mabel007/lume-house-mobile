import { createContext, useContext } from 'react';
import type { Product } from './products';

export type CatalogueState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; products: Product[] };
export const ProductContext = createContext<{ state: CatalogueState; refresh: () => void } | null>(null);

export function useProducts() {
  const context = useContext(ProductContext);
  if (!context) throw new Error('ProductProvider is required.');
  return context;
}
