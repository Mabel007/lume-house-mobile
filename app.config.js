const variants = require('./config/variants.json');

module.exports = ({ config }) => {
  const variant = process.env.APP_VARIANT;
  if (!Object.prototype.hasOwnProperty.call(variants, variant)) {
    throw new Error('APP_VARIANT must explicitly select development, staging or production.');
  }
  const identity = variants[variant];
  return {
    ...config,
    name: identity.name,
    scheme: identity.scheme,
    android: { ...config.android, package: identity.androidPackage },
    extra: { ...config.extra, appVariant: variant },
  };
};
