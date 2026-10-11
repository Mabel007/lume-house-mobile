import { useEffect, useState, useSyncExternalStore } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { shop } from '../../config/shop';
import { AccountNavigation, type AccountSection } from './AccountNavigation';
import { accountInitials } from './accountInitials';
import { CustomerProfile } from '../profile/CustomerProfile';
import { ProfileController } from '../profile/ProfileController';
import { loadProfile, saveProfile } from '../profile/profileRepository';
import { getSupabaseClient } from '../../lib/supabase/client';
import type { FieldReveal } from '../../lib/scrollReveal';

type Props = { userId: string; email: string | undefined; accountName: string; local: boolean; busy: boolean; revealField: FieldReveal; onSignOut: () => void };

const helpPages = [
  { title: 'Help & Contact', path: '/help' },
  { title: 'Delivery & Pickup', path: '/help/delivery-pickup' },
  { title: 'Returns & Refunds', path: '/help/returns-refunds' },
];

export function AccountDashboard({ userId, email, accountName, local, busy, revealField, onSignOut }: Props) {
  const [controller] = useState(() => {
    const instance: ProfileController = new ProfileController({
      load: () => loadProfile(getSupabaseClient(), userId, instance.isActive),
      save: (profile, fields) => saveProfile(getSupabaseClient(), userId, profile, fields, instance.isActive),
    }); return instance;
  });
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => { controller.activate(); void controller.refresh(); return () => controller.deactivate(); }, [controller]);
  const [section, setSection] = useState<AccountSection | null>(null);
  const [linkStatus, setLinkStatus] = useState<string | null>(null);
  const editor = section === 'profile' || section === 'delivery' ? section : null;
  const displayName = state.saved.full_name.trim() || (local ? '' : accountName.trim());
  function select(next: AccountSection) { setLinkStatus(null); setSection(current => current === next ? null : next); }
  function openPage(path: string) {
    void WebBrowser.openBrowserAsync(`${shop.webOrigin}${path}`).catch(() => setLinkStatus('That page could not be opened right now. Please try again later.'));
  }
  return <View style={styles.group}>
    <View style={styles.summary}>
      <Text accessibilityElementsHidden style={styles.avatar}>{accountInitials(displayName)}</Text>
      <View style={styles.summaryCopy}>
        <Text style={styles.name}>{displayName || 'Your account'}</Text>
        {local ? null : <Text selectable style={styles.email}>{email || 'Email unavailable'}</Text>}
        <Text style={styles.email}>{local ? 'Signed in to local QA' : 'Signed in with Google'}</Text>
      </View>
    </View>
    <AccountNavigation active={section} busy={busy} local={local} onSelect={select} onSignOut={onSignOut} />
    {section === 'orders' ? <View style={styles.panel}>
      <Text accessibilityRole="header" style={styles.panelHeading}>My Orders</Text>
      <Text style={styles.text}>Order history is not available in this app yet, so this screen does not list any order.</Text>
      {local ? <Text style={styles.text}>This build reads local QA data, which has no orders. Nothing here replaces your real order records.</Text> : <>
        <Text style={styles.text}>Your orders, their delivery details and recorded payment status are on the Lumé House website. You may need to sign in there with the same Google account.</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Open My Orders on the Lumé House website" onPress={() => openPage('/account/orders')} style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}>
          <Text style={styles.link}>Open My Orders on the Lumé House website ›</Text>
        </Pressable>
      </>}
    </View> : null}
    {section === 'help' ? <View style={styles.panel}>
      <Text accessibilityRole="header" style={styles.panelHeading}>Help & Support</Text>
      <Text style={styles.text}>{local ? 'You are signed in with a private local enrollment code.' : 'You sign in with Google. Lumé House does not manage a password for this account.'}</Text>
      <Text style={styles.text}>Checkout edits apply to that order only. They do not change the saved details on this screen.</Text>
      <Text style={styles.text}>Saved delivery defaults are optional. Checkout will ask for any required missing details.</Text>
      {local ? <Text style={styles.text}>Help pages are published on the Lumé House website and are not linked from this local QA build.</Text> : helpPages.map(page => <Pressable key={page.path} accessibilityRole="button" accessibilityLabel={`${page.title} on the Lumé House website`} onPress={() => openPage(page.path)} style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}>
        <Text style={styles.link}>{page.title} ›</Text>
      </Pressable>)}
      {linkStatus ? <Text accessibilityRole="alert" style={styles.text}>{linkStatus}</Text> : null}
    </View> : null}
    <CustomerProfile controller={controller} editor={editor} revealField={revealField} onEditorChange={next => setSection(next)} />
  </View>;
}

const styles = StyleSheet.create({
  group: { gap: 20 },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#EEEBE1', color: '#535B40', fontFamily: 'serif', fontSize: 22, lineHeight: 56, textAlign: 'center' },
  summaryCopy: { flex: 1, gap: 4 }, name: { fontSize: 24, fontFamily: 'serif', color: '#292820' },
  email: { fontSize: 14, lineHeight: 22, color: '#665F52' },
  panel: { gap: 12, padding: 20, borderRadius: 12, backgroundColor: '#EEEBE1' },
  panelHeading: { fontSize: 20, color: '#292820' }, text: { fontSize: 16, lineHeight: 25, color: '#423F38' },
  linkRow: { minHeight: 48, justifyContent: 'center' }, link: { fontSize: 16, lineHeight: 25, color: '#535B40', fontWeight: '600' },
  pressed: { opacity: 0.7 },
});
