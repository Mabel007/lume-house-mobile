const fs = require('node:fs');
const path = require('node:path');
const { parseEnv } = require('node:util');
const { identityFor, validateEnvironment } = require('../config/environment');
const buildProfiles = require('../eas.json').build;
const root = path.resolve(__dirname, '..');
const policy = {
  development: ['development', 'development', true, 'internal', 'apk'],
  staging: ['staging', 'preview', false, 'internal', 'apk'],
  production: ['production', 'production', false, 'store', 'app-bundle'],
  preview: ['production', 'production', false, 'internal', 'apk'],
};

function checkEnvironment(input, resolved, profiles = buildProfiles, validate = validateEnvironment) {
  const identity = identityFor(input.variant);
  if (!Object.hasOwn(policy, input.profile) || !Object.hasOwn(profiles, input.profile)) {
    throw new Error('Unknown EAS profile.');
  }
  const [variant, environment, developmentClient, distribution, binary] = policy[input.profile];
  const profile = profiles[input.profile];
  if (variant !== identity.variant || profile.env?.APP_VARIANT !== variant || profile.env?.EXPO_NO_DOTENV !== '1' ||
      profile.environment !== environment || profile.developmentClient !== developmentClient ||
      profile.distribution !== distribution || profile.android?.buildType !== binary) {
    throw new Error('EAS profile is incompatible with the selected variant.');
  }
  if (resolved.extra?.appVariant !== identity.variant || resolved.name !== identity.name ||
      resolved.extra?.eas?.projectId !== '9d32b9a1-6da9-415c-b7ea-d0cd86137350') {
    throw new Error('Resolved application configuration is incompatible.');
  }
  const validated = validate({
    variant: input.variant, androidPackage: resolved.android?.package, scheme: resolved.scheme,
    callback: typeof resolved.scheme === 'string' ? `${resolved.scheme}://auth/callback` : undefined,
    url: input.url, key: input.key,
    localBackend: resolved.extra?.localBackend,
  });
  // Explicit projection: never return or log the public key or inherited credentials.
  return {
    variant: validated.variant, name: validated.name, androidPackage: validated.androidPackage,
    projectRef: validated.projectRef, scheme: validated.scheme, callback: validated.callback,
    profile: input.profile, easEnvironment: environment,
  };
}

function main(args = process.argv.slice(2)) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    if (!['--profile', '--env-file'].includes(option) || !args[index + 1] || Object.hasOwn(options, option)) {
      throw new Error('Invalid preflight arguments.');
    }
    options[option] = args[index + 1];
  }
  let publicConfig = process.env;
  if (options['--env-file']) {
    publicConfig = parseEnv(fs.readFileSync(path.resolve(root, options['--env-file']), 'utf8'));
    const allowed = ['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY'];
    if (Object.keys(publicConfig).some(name => !allowed.includes(name))) throw new Error('Unexpected environment-file settings.');
  }
  // Explicit file values must also drive the build-time local fingerprint guard.
  const previous = {};
  for (const name of ['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY']) {
    previous[name] = process.env[name];
    if (publicConfig[name] === undefined) delete process.env[name]; else process.env[name] = publicConfig[name];
  }
  let resolved;
  try { resolved = require('../app.config.js')({ config: require('../app.json').expo }); }
  finally {
    for (const name of Object.keys(previous)) {
      if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name];
    }
  }
  const summary = checkEnvironment({
    variant: process.env.APP_VARIANT, profile: options['--profile'],
    url: publicConfig.EXPO_PUBLIC_SUPABASE_URL, key: publicConfig.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  }, resolved);
  console.log(JSON.stringify({ status: 'PASS', ...summary, readOnly: true }, null, 2));
}
if (require.main === module) {
  try { main(); } catch {
    console.error('Environment preflight refused. Check variant, profile, identity and approved public backend settings. No runtime started.');
    process.exitCode = 1;
  }
}
module.exports = { checkEnvironment, main };
