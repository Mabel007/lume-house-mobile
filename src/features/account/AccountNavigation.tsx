import { Pressable, StyleSheet, Text, View } from 'react-native';

export type AccountSection = 'profile' | 'delivery' | 'orders' | 'help';

type Props = {
  active: AccountSection | null;
  busy: boolean;
  local: boolean;
  onSelect: (section: AccountSection) => void;
  onSignOut: () => void;
};

export function AccountNavigation({ active, busy, local, onSelect, onSignOut }: Props) {
  const rows: { key: AccountSection; glyph: string; title: string; description: string }[] = [
    { key: 'profile', glyph: 'P', title: 'Personal Information', description: 'Your saved name and contact phone.' },
    { key: 'delivery', glyph: 'D', title: 'Delivery Details', description: 'Your default street address, area and city.' },
    { key: 'orders', glyph: 'O', title: 'My Orders', description: local ? 'Order history is not available in this app.' : 'Order history opens on the Lumé House website.' },
    { key: 'help', glyph: 'H', title: 'Help & Support', description: local ? 'Account and delivery guidance.' : 'Help, delivery, returns and contact pages.' },
  ];
  return <View accessibilityLabel="Account sections" style={styles.group}>
    {rows.map(row => <Pressable key={row.key} accessibilityRole="button" accessibilityLabel={`${row.title}. ${row.description}`} accessibilityState={{ selected: active === row.key, busy }} disabled={busy}
      onPress={() => onSelect(row.key)} style={({ pressed }) => [styles.row, active === row.key && styles.active, pressed && styles.pressed]}>
      <Text accessibilityElementsHidden style={styles.chip}>{row.glyph}</Text>
      <View style={styles.copy}><Text style={styles.rowTitle}>{row.title}</Text><Text style={styles.rowDescription}>{row.description}</Text></View>
      <Text accessibilityElementsHidden style={styles.chevron}>{active === row.key ? '▾' : '›'}</Text>
    </Pressable>)}
    <Pressable accessibilityRole="button" accessibilityLabel="Sign out of your account" accessibilityState={{ busy }} disabled={busy} onPress={onSignOut} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <Text accessibilityElementsHidden style={styles.chip}>S</Text>
      <View style={styles.copy}><Text style={styles.rowTitle}>Sign Out</Text><Text style={styles.rowDescription}>End this session on this device.</Text></View>
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  group: { gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 64, paddingHorizontal: 16, paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: 'transparent', backgroundColor: '#FFFFFF' },
  active: { borderColor: '#535B40' }, pressed: { backgroundColor: '#EEEBE1' },
  chip: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#EEEBE1', color: '#535B40', fontFamily: 'serif', fontSize: 18, lineHeight: 40, textAlign: 'center' },
  copy: { flex: 1, gap: 3 }, rowTitle: { fontSize: 17, fontWeight: '600', color: '#292820' },
  rowDescription: { fontSize: 14, lineHeight: 21, color: '#665F52' }, chevron: { fontSize: 20, color: '#797566' },
});
