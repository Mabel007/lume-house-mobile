import { Link } from 'expo-router';
import type { ComponentProps } from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useBag } from '../features/cart/BagContext';
import type { BagState } from '../features/cart/BagController';

// Named from the font itself, so a glyph that does not exist in the installed set is a compile error rather than
// an empty box on someone's phone.
type Glyph = ComponentProps<typeof MaterialCommunityIcons>['name'];

export type BagBadge = { shown: string; spoken: string };

// A badge is a count the shop published, so anything that puts the cart in question puts the number in question
// with it: while the Bag is being read, or a change is unconfirmed, there is no honest count to show. A signed-out
// browse has no server Bag at all, and an empty one is shown as nothing rather than as a alarming zero.
export function bagBadge(signedIn: boolean, state: BagState): BagBadge | null {
  if (!signedIn || (state.status !== 'ready' && state.status !== 'saving')) return null;
  const units = state.items.reduce((total, item) => total + item.quantity, 0);
  if (!units) return null;
  return units > 99
    ? { shown: '99+', spoken: 'more than 99 items in your Bag' }
    : { shown: String(units), spoken: `${units} ${units === 1 ? 'item' : 'items'} in your Bag` };
}

type Destination = { href: '/account' | '/bag'; icon: Glyph; label: string; badge: BagBadge | null };

// One component so the two destinations can never drift apart in size, wording or announcement. The glyph is
// decorative and the words stay: a font that fails to load costs a shape, never the meaning of the control.
function DestinationLink({ href, icon, label, badge }: Destination) {
  return <Link href={href} asChild><Pressable accessibilityRole="link"
    accessibilityLabel={badge ? `${label}. ${badge.spoken}.` : label} style={styles.link}>
    <MaterialCommunityIcons accessibilityElementsHidden name={icon} size={18} color="#423F38" />
    <Text style={styles.text}>{label}</Text>
    {badge ? <Text accessibilityElementsHidden style={styles.badge}>{badge.shown}</Text> : null}
  </Pressable></Link>;
}

export function AccountLink({ label = 'Your account' }: { label?: string } = {}) {
  return <DestinationLink href="/account" icon="account-circle-outline" label={label} badge={null} />;
}

export function BagLink({ label = 'Your Bag' }: { label?: string } = {}) {
  const bag = useBag();
  return <DestinationLink href="/bag" icon="bag-personal-outline" label={label} badge={bagBadge(bag.signedIn, bag.state)} />;
}

const styles = StyleSheet.create({
  link: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 48, paddingVertical: 12 },
  text: { fontSize: 16, lineHeight: 24, color: '#423F38' },
  // No fixed height: at a large system font the count has to grow, and a clipped badge would be a wrong number.
  badge: { minWidth: 22, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 11, textAlign: 'center',
    backgroundColor: '#535B40', color: '#FFFFFF', fontSize: 12, lineHeight: 17, fontWeight: '600', overflow: 'hidden' },
});
