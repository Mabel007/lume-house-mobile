import { Pressable, StyleSheet, Text } from 'react-native';

export function ActionButton({ label, onPress, disabled = false, secondary = false, accessibilityLabel }: {
  label: string; onPress: () => void; disabled?: boolean; secondary?: boolean; accessibilityLabel?: string;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label}
    accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.button, secondary && styles.secondary, (pressed || disabled) && styles.dim]}>
    <Text style={[styles.text, secondary && styles.secondaryText]}>{label}</Text>
  </Pressable>;
}
const styles = StyleSheet.create({
  button: { minHeight: 48, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 8,
    backgroundColor: '#535B40', alignItems: 'center', justifyContent: 'center' },
  secondary: { backgroundColor: '#EBE5D9' }, dim: { opacity: 0.55 },
  text: { color: '#FFFFFF', fontSize: 15, fontWeight: '600', textAlign: 'center' },
  secondaryText: { color: '#423F38' },
});
