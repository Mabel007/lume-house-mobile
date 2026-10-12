import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ToastProvider } from '../components/Toast';
import { AuthProvider } from '../features/auth/AuthProvider';
import { ProductProvider } from '../features/products/ProductProvider';
import { BagProvider } from '../features/cart/BagProvider';
export default function RootLayout() {
  return <AuthProvider><ProductProvider><BagProvider><ToastProvider><StatusBar style="dark" /><Stack screenOptions={{ headerShown: false }} /></ToastProvider></BagProvider></ProductProvider></AuthProvider>;
}
