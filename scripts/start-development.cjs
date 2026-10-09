const fs = require('node:fs');
const path = require('node:path');
const { parseEnv } = require('node:util');
const { spawnSync } = require('node:child_process');
const { identityFor, validateEnvironment } = require('../config/environment');
const root = path.resolve(__dirname, '..');
const publicNames = ['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY'];

function developmentPlan(content, inherited = {}, validate = validateEnvironment) {
  const values = parseEnv(content);
  if (Object.keys(values).some(name => !publicNames.includes(name)) || publicNames.some(name => !values[name])) {
    throw new Error('Development configuration must contain only the two required public Supabase settings.');
  }
  const identity = identityFor('development');
  validate({ ...identity, url: values.EXPO_PUBLIC_SUPABASE_URL, key: values.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY });
  const env = Object.fromEntries(Object.entries(inherited).filter(([name]) => !name.toUpperCase().startsWith('EXPO_PUBLIC_')));
  Object.assign(env, values, { APP_VARIANT: 'development', EXPO_NO_DOTENV: '1', EXPO_NO_CLIENT_ENV_VARS: '0' });
  return {
    command: process.execPath,
    args: [path.join(root, 'node_modules/expo/bin/cli'), 'start', '--dev-client', '--localhost', '--port', '8081'],
    options: { cwd: root, env, stdio: 'inherit', shell: false },
    identity,
  };
}

function main(args = process.argv.slice(2)) {
  if (args.length > 1 || (args.length && args[0] !== '--check')) throw new Error('Unsupported launcher arguments.');
  const content = fs.readFileSync(path.join(root, '.env.development.local'), 'utf8');
  const plan = developmentPlan(content, process.env);
  if (args[0] === '--check') {
    console.log(`Development configuration accepted: ${plan.identity.androidPackage}; dotenv disabled. Metro not started.`);
    return;
  }
  const result = spawnSync(plan.command, plan.args, plan.options);
  if (result.error || result.status !== 0) throw new Error('Development launcher did not complete successfully.');
}
if (require.main === module) {
  try { main(); } catch { console.error('Development refused: verify approved NONPROD public configuration and launcher arguments.'); process.exitCode = 1; }
}
module.exports = { developmentPlan, main };
