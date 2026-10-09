import { useEffect } from 'react';
import { router } from 'expo-router';
import * as Linking from 'expo-linking';
import { ActivityIndicator, Text, View } from 'react-native';
import { useAuth } from '../../features/auth/AuthContext';

export default function AuthCallback() {
  const url = Linking.useLinkingURL();
  const { completeCallback } = useAuth();
  useEffect(() => {
    let active = true;
    // No URL/parameter is ever rendered. Replace removes credentials from this route.
    async function finish() {
      const incoming = url || await Linking.getInitialURL().catch(() => null);
      if (!active) return;
      await completeCallback(incoming || '');
      if (active) router.replace('/account');
    }
    void finish();
    return () => { active = false; };
  }, [url, completeCallback]);
  return <View style={{ flex: 1, backgroundColor: '#F6F2EB', alignItems: 'center', justifyContent: 'center', gap: 18 }} accessibilityLiveRegion="polite">
    <ActivityIndicator color="#535B40" accessibilityLabel="Completing sign-in" /><Text>Completing sign-in…</Text>
  </View>;
}
