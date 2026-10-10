const variants = require('./config/variants.json');
const { localBuildConfig } = require('./config/local-build');

module.exports = ({ config }) => {
  const variant = process.env.APP_VARIANT;
  if (!Object.prototype.hasOwnProperty.call(variants, variant)) {
    throw new Error('APP_VARIANT must explicitly select development, staging or production.');
  }
  const identity = variants[variant];
  const localBackend = localBuildConfig(variant, process.env.EXPO_PUBLIC_SUPABASE_URL, process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  return {
    ...config,
    name: identity.name,
    scheme: identity.scheme,
    ...(variant === 'development' ? {
      plugins: [...(config.plugins || []), ['expo-dev-client', { addGeneratedScheme: false, launchMode: 'launcher' }]],
    } : {}),
    android: { ...config.android, package: identity.androidPackage },
    extra: { ...config.extra, appVariant: variant, ...(localBackend ? { localBackend } : {}) },
  };
};
