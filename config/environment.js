const variants = require('./variants.json');
const localBackend = require('./local-backend.json');
const productionProjectRef = 'wyvsbzcltrhnjeuijsva';
// Set only after a separately approved NONPROD provisioning/configuration slice.
const approvedNonprodProjectRef = null;

function identityFor(variant) {
  if (!Object.prototype.hasOwnProperty.call(variants, variant)) {
    throw new Error('Explicit application variant is required.');
  }
  return { ...variants[variant], variant, callback: `${variants[variant].scheme}://auth/callback` };
}

// The optional reference is a trusted registry input, never an environment variable.
// Production callers use the module-owned registry; injection supports offline contract tests.
function validateEnvironment(input, nonprodRef = approvedNonprodProjectRef) {
  const identity = identityFor(input.variant);
  if (input.androidPackage !== identity.androidPackage || input.scheme !== identity.scheme || input.callback !== identity.callback) {
    throw new Error('Application identity or OAuth callback does not match its variant.');
  }
  if (identity.variant === 'development' && input.url === localBackend.origin) {
    const trusted = input.localBackend;
    if (!trusted || trusted.origin !== localBackend.origin || trusted.projectRef !== localBackend.projectRef ||
        typeof input.key !== 'string' || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(input.key) || trusted.publicKey !== input.key) {
      throw new Error('Approved local build configuration is required.');
    }
    return { ...identity, projectRef: localBackend.projectRef, url: localBackend.origin, key: input.key, storageKey: localBackend.storageKey };
  }
  const expectedRef = identity.variant === 'production' ? productionProjectRef : nonprodRef;
  if (!expectedRef || !/^[a-z]{20}$/.test(expectedRef) || (identity.variant !== 'production' && expectedRef === productionProjectRef)) {
    throw new Error('Approved NONPROD backend is not configured.');
  }
  const url = typeof input.url === 'string' ? input.url.trim() : '';
  const key = typeof input.key === 'string' ? input.key.trim() : '';
  if (url !== `https://${expectedRef}.supabase.co` || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) {
    throw new Error('Backend configuration does not match the selected environment.');
  }
  return { ...identity, projectRef: expectedRef, url, key };
}

module.exports = { identityFor, validateEnvironment, productionProjectRef, approvedNonprodProjectRef };
