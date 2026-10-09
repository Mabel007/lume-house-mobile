import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { shop } from '../../config/shop';
import { getSupabaseClient } from '../../lib/supabase/client';
import { ProductContext, type CatalogueState } from './ProductContext';
import { loadProducts } from './productRepository';

export function ProductProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CatalogueState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const refresh = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt(value => value + 1);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    async function restore() {
      try {
        const products = await loadProducts(getSupabaseClient(), shop.currency, controller.signal);
        if (!controller.signal.aborted) setState({ status: 'ready', products });
      } catch {
        if (!controller.signal.aborted) setState({ status: 'error' });
      }
    }
    void restore();
    return () => controller.abort();
  }, [attempt]);
  return <ProductContext.Provider value={{ state, refresh }}>{children}</ProductContext.Provider>;
}
