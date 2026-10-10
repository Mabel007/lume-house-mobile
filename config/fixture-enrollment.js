const origin = 'http://127.0.0.1:54321';
const helperOrigin = 'http://127.0.0.1:5190';
const nativeIdentity = Object.freeze({ variant: 'development', androidPackage: 'com.najbuilds.lumehouse.dev', callback: 'lumehousemobile-dev://auth/callback', origin });
const customerAliases = Object.freeze(['customer-a', 'customer-b']);
function requireNativeEnrollment(input) {
  if (!input || Object.entries(nativeIdentity).some(([key, value]) => input[key] !== value) || !customerAliases.includes(input.alias)) {
    throw new Error('Local fixture enrollment refused.');
  }
}
module.exports = { nativeIdentity, customerAliases, helperOrigin, requireNativeEnrollment };
