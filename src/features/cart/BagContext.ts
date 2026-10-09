import { createContext, useContext } from 'react';
import type { BagState } from './BagController';
import type { CartAction } from './cart';

export type BagContextValue = {
  state: BagState; signedIn: boolean;
  refresh: () => Promise<void>; retry: () => Promise<boolean>;
  dispatch: (action: CartAction) => Promise<boolean>;
};
export const BagContext = createContext<BagContextValue | null>(null);
export function useBag() {
  const context = useContext(BagContext);
  if (!context) throw new Error('BagProvider is required.');
  return context;
}
