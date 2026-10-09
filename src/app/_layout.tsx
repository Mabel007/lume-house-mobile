import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider } from '../features/auth/AuthProvider';
import { ProductProvider } from '../features/products/ProductProvider';
import { BagProvider } from '../features/cart/BagProvider';
export default function RootLayout() {
  return <AuthProvider><ProductProvider><BagProvider><StatusBar style="dark" /><Stack screenOptions={{ headerShown: false }} /></BagProvider></ProductProvider></AuthProvider>;
}
