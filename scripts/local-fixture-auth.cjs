// Local server tooling only. Never import this file into the mobile application.
const assert = require('node:assert/strict');
const { Buffer } = require('node:buffer');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createServer } = require('node:http');
const { createClient } = require('@supabase/supabase-js');
const { localBuildConfig } = require('../config/local-build');
const { createEnrollmentStore } = require('./fixture-enrollment-store.cjs');
const webOrigin = 'http://127.0.0.1:5188';
const helperOrigin = 'http://127.0.0.1:5190';
const aliases = ['customer-a', 'customer-b', 'admin-a', 'admin-b'];
function sql(statement) {
  return execFileSync('docker', ['exec', '-i', 'supabase_db_lume-house', 'psql', '-X', '-q', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'], { input: statement, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}
function restoreLatestConfirmed(cli) {
  assert(cli && path.basename(cli).toLowerCase() === 'supabase.exe');
  const db = JSON.parse(execFileSync('docker', ['inspect', 'supabase_db_lume-house'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))[0];
  assert.equal(db.Config.Labels['com.supabase.cli.project'], 'lume-house');
  assert.deepEqual(db.HostConfig.PortBindings['5432/tcp'][0], { HostIp: '127.0.0.1', HostPort: '54322' });
  const web = path.resolve(__dirname, '../../lume-house');
  const status = JSON.parse(execFileSync(cli, ['status', '--workdir', path.join(web, '.codex/local-stack'), '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  assert.equal(status.API_URL, 'http://127.0.0.1:54321');
  assert(localBuildConfig('development', status.API_URL, status.PUBLISHABLE_KEY));
  assert(status.SECRET_KEY?.startsWith('sb_secret_'));
  const rows = JSON.parse(sql(`select coalesce(json_agg(t),'[]') from (select id,email,created_at,exists(select 1 from public.business_admins b where b.user_id=u.id and b.active) as admin from auth.users u where email ~ '^(customer|admin)-(a|b)-[a-f0-9-]+@lume-local[.]example[.]invalid$' order by created_at desc,id desc limit 4) t;`));
  assert.equal(rows.length, 4);
  assert(Math.max(...rows.map(u => Date.parse(u.created_at))) - Math.min(...rows.map(u => Date.parse(u.created_at))) < 60000);
  const mapping = Object.fromEntries(rows.map(user => [user.email.split('-').slice(0, 2).join('-'), user]));
  assert.deepEqual(Object.keys(mapping).sort(), [...aliases].sort());
  for (const alias of aliases) assert.equal(mapping[alias].admin, alias.startsWith('admin'));
  const localFetch = (input, options) => {
    assert.equal(new URL(typeof input === 'string' ? input : input.url).origin, status.API_URL);
    return fetch(input, { ...options, redirect: 'error', signal: AbortSignal.timeout(10000) });
  };
  const options = { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: localFetch } };
  const admin = createClient(status.API_URL, status.SECRET_KEY, options);
  async function issueSession(alias) {
    if (!aliases.includes(alias)) throw new Error('Fixture refused.');
    const fixture = mapping[alias]; if (!fixture) throw new Error('Fixture refused.');
    const existing = await admin.auth.admin.getUserById(fixture.id);
    assert.equal(existing.error, null); assert.equal(existing.data.user.email, fixture.email);
    // Recovery generates a token for an existing user; it neither signs up users nor sends email.
    const link = await admin.auth.admin.generateLink({ type: 'recovery', email: fixture.email });
    assert.equal(link.error, null); assert.equal(link.data.user.id, fixture.id);
    const ordinary = createClient(status.API_URL, status.PUBLISHABLE_KEY, options);
    const result = await ordinary.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: 'recovery' });
    assert.equal(result.error, null); assert.equal(result.data.user.id, fixture.id);
    const role = await ordinary.rpc('is_business_admin');
    assert.equal(role.error, null); assert.equal(role.data, alias.startsWith('admin'));
    ordinary.auth.stopAutoRefresh();
    assert.equal(JSON.parse(Buffer.from(result.data.session.access_token.split('.')[1], 'base64url')).role, 'authenticated');
    return { access_token: result.data.session.access_token, refresh_token: result.data.session.refresh_token };
  }
  return { issueSession, fixtureCount: rows.length, createOrdinaryClient: () => createClient(status.API_URL, status.PUBLISHABLE_KEY, options) };
}
const page = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Local mobile enrollment</title><h1>Lumé House Dev enrollment</h1><p>Existing synthetic customers only. Codes expire in two minutes and work once.</p><label>Customer <select id="alias"><option value="customer-a">Customer A</option><option value="customer-b">Customer B</option></select></label><button id="issue">Create enrollment code</button><p id="status" role="status"></p><input id="code" readonly aria-label="Enrollment code"><script>document.querySelector('#issue').onclick=async()=>{const r=await fetch('/enrollment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({alias:document.querySelector('#alias').value})});if(!r.ok){document.querySelector('#status').textContent='Enrollment unavailable';return;}document.querySelector('#code').value=(await r.json()).code;document.querySelector('#status').textContent='Enter this code in Lumé House Dev Account. Keep it private.';};</script></html>`;
function createFixtureServer(context, store = createEnrollmentStore()) {
  return createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    if (req.headers.host !== '127.0.0.1:5190') { res.writeHead(403); res.end(); return; }
    const origin = req.headers.origin;
    if (req.method === 'GET' && req.url === '/enroll' && !origin) { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(page); return; }
    if (req.url === '/session' || req.url === '/health') {
      if (origin !== webOrigin) { res.writeHead(403); res.end(); return; }
      res.setHeader('Access-Control-Allow-Origin', webOrigin);
      res.setHeader('Access-Control-Allow-Headers', 'content-type');
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
      if (req.method === 'GET' && req.url === '/health') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ project: 'lume-house', purpose: 'local-qa', restored: true })); return; }
    }
    try {
      if (req.method !== 'POST' || req.headers['content-type'] !== 'application/json') throw new Error();
      let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 1024) throw new Error(); }
      const input = JSON.parse(body); let result;
      if (req.url === '/session' && origin === webOrigin) result = await context.issueSession(input.role);
      else if (req.url === '/enrollment' && origin === helperOrigin) result = { code: store.issue(input.alias) };
      else if (req.url === '/native-session' && origin === undefined) result = await context.issueSession(store.consume(input));
      else throw new Error();
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(result));
    } catch { res.writeHead(403); res.end(); }
  });
}
function main() {
  if (process.argv.length !== 3 || process.argv[2] !== '--restore-latest-confirmed') throw new Error();
  const context = restoreLatestConfirmed(process.env.LOCAL_SUPABASE_CLI);
  const server = createFixtureServer(context);
  server.on('error', () => { console.error('Local fixture server refused; no credentials printed.'); process.exitCode = 1; });
  server.listen(5190, '127.0.0.1', () => console.log('Local fixture helper restored for four existing aliases. Private native enrollment: http://127.0.0.1:5190/enroll'));
}
if (require.main === module) { try { main(); } catch { console.error('Local fixture recovery refused; inspect safely.'); process.exitCode = 1; } }
module.exports = { restoreLatestConfirmed, createFixtureServer };
