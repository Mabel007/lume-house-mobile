// Node-only Expo configuration/tooling. Never import Node crypto into native source.
const { createHash } = require('node:crypto');
const approved = require('./local-backend.json');

function localBuildConfig(variant, url, key) {
  if (variant !== 'development' || url !== approved.origin) return undefined;
  if (typeof key !== 'string' || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(key) ||
      createHash('sha256').update(key).digest('hex') !== approved.publicKeySha256) {
    throw new Error('Approved local public configuration is required.');
  }
  // This public key is already embedded by Expo's EXPO_PUBLIC mechanism.
  // Runtime equality prevents a different key from being paired with this approved manifest.
  return { origin: approved.origin, projectRef: approved.projectRef, publicKey: key };
}
module.exports = { localBuildConfig };
