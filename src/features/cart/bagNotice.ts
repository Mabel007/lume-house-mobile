import type { ToastNotice } from '../../components/Toast';
import type { BagState } from './BagController';

// A notice never repeats the controller's own message. That text is written to explain a specific rejection at the
// shop and belongs with the recovery controls; a banner that disappeared in three seconds would leave the customer
// holding the only copy of a reason they cannot act on. This says only which of the honest outcomes happened.
export function bagNotice(state: BagState): ToastNotice | null {
  if (state.status === 'error') {
    return { variant: 'error', title: 'Your Bag could not be updated', description: 'The shop did not accept the change. Nothing in your Bag has moved.' };
  }
  if (state.status === 'uncertain') {
    return { variant: 'warning', title: 'Your Bag change is unconfirmed', description: 'Refresh your Bag to see what the shop has, or retry the saved change.' };
  }
  return null;
}
