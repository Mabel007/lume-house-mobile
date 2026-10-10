// Explicit local-only integration. No hosted requests, fixture resets or durable commerce mutations.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createClient } = require('@supabase/supabase-js');
const { localBuildConfig } = require('../config/local-build');
const { restoreLatestConfirmed } = require('./local-fixture-auth.cjs');
const { load } = require('../tests/helpers/source.cjs');
const origin = 'http://127.0.0.1:54321';
const helper = 'http://127.0.0.1:5190';
const webRoot = path.resolve(__dirname, '../../lume-house');

async function localFetch(input, options) {
  const url = new URL(typeof input === 'string' ? input : input.url);
  if (url.origin !== origin && url.origin !== helper) throw new Error('NONLOCAL_REQUEST_REFUSED');
  return fetch(input, { ...options, redirect: 'error' });
}
function sql(query) {
  return execFileSync('docker', ['exec', '-i', 'supabase_db_lume-house', 'psql', '-X', '-q', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'], {
    input: query, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}
function verifyDatabase() {
  const db = JSON.parse(execFileSync('docker', ['inspect', 'supabase_db_lume-house'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))[0];
  assert.equal(db.Config.Labels['com.supabase.cli.project'], 'lume-house');
  assert.equal(db.HostConfig.PortBindings['5432/tcp'][0].HostIp, '127.0.0.1');
  assert.equal(db.HostConfig.PortBindings['5432/tcp'][0].HostPort, '54322');
}
function businessSnapshot() {
  const tables = ['products', 'product_variants', 'variant_inventory', 'carts', 'cart_items', 'variant_cart_items', 'variant_cart_operations', 'orders', 'order_items', 'order_confirmation_jobs', 'business_admins', 'inventory_ledger'];
  return sql(tables.map(table => `select '${table}|' || count(*) || '|' || coalesce(md5(string_agg(row_to_json(t)::text, '|' order by row_to_json(t)::text)),'') from public.${table} t;`).join('\n'));
}
function rollbackContract(a, b) {
  assert.match(a, /^[a-f0-9-]{36}$/); assert.match(b, /^[a-f0-9-]{36}$/);
  const ids = Array.from({ length: 6 }, () => randomUUID());
  return `begin; set local lock_timeout='2s'; set local statement_timeout='20s';
create function pg_temp.check_it(ok boolean,label text) returns text language plpgsql as $$ begin if ok is distinct from true then raise exception 'CONTRACT_CHECK_FAILED'; end if; return 'PASS|'||label; end $$;
create function pg_temp.rejected(statement text,expected text,label text) returns text language plpgsql as $$ begin begin execute statement; exception when others then if sqlerrm=expected or sqlstate=expected then return 'PASS|'||label; end if; raise exception 'WRONG_REJECTION'; end; raise exception 'EXPECTED_REJECTION'; end $$;
select set_config('qa.variant',(select v.id from public.product_variants v join public.products p on p.id=v.product_id where v.active and p.active and v.inventory_policy='untracked' and not exists(select 1 from public.variant_cart_items i join public.carts c on c.id=i.cart_id where i.variant_id=v.id and c.user_id='${a}') order by v.id limit 1),true);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"${a}","role":"authenticated"}',true);
select pg_temp.check_it(not public.is_business_admin(),'Customer A is not admin');
select pg_temp.rejected('select public.admin_list_products(null)','42501','Customer admin denial');
select 'BASE|'||public.load_variant_cart()::text;
select set_config('qa.cart_a',(public.load_variant_cart()->>'id'),true);
select 'WEB|'||public.change_variant_cart(current_setting('qa.variant'),'add',1,null,'${ids[0]}')::text;
select pg_temp.check_it((select quantity=1 from public.variant_cart_items where cart_id=current_setting('qa.cart_a')::uuid and variant_id=current_setting('qa.variant')),'Add actual variant');
select public.change_variant_cart(current_setting('qa.variant'),'add',1,null,'${ids[0]}');
select pg_temp.check_it((select quantity=1 from public.variant_cart_items where cart_id=current_setting('qa.cart_a')::uuid and variant_id=current_setting('qa.variant')),'Mutation UUID replay');
select 'MOBILE|'||public.load_variant_cart()::text;
select 'UPDATED|'||public.change_variant_cart(current_setting('qa.variant'),'set',2,1,'${ids[1]}')::text;
select pg_temp.rejected(format('select public.change_variant_cart(%L,''set'',3,1,%L)',current_setting('qa.variant'),'${ids[2]}'),'CART_CHANGED','Stale quantity conflict');
select pg_temp.rejected(format('select public.change_variant_cart(%L,''set'',100,2,%L)',current_setting('qa.variant'),'${ids[2]}'),'INVALID_REQUEST','Quantity boundary');
select public.change_variant_cart(current_setting('qa.variant'),'remove',null,2,'${ids[3]}');
select pg_temp.check_it(not exists(select 1 from public.variant_cart_items where cart_id=current_setting('qa.cart_a')::uuid and variant_id=current_setting('qa.variant')),'Removal');
select public.change_variant_cart(current_setting('qa.variant'),'merge',2,null,'${ids[4]}');
select public.change_variant_cart(current_setting('qa.variant'),'merge',2,null,'${ids[4]}');
select pg_temp.check_it((select quantity=2 from public.variant_cart_items where cart_id=current_setting('qa.cart_a')::uuid and variant_id=current_setting('qa.variant')),'Guest merge receipt replay');
select pg_temp.rejected('select public.change_variant_cart(''no-such-local-qa-variant'',''add'',1,null,''${ids[2]}'')','PRODUCT_UNAVAILABLE','Unavailable variant denial');
do $$ declare item record; begin for item in select variant_id,quantity from public.variant_cart_items where cart_id=current_setting('qa.cart_a')::uuid and variant_id<>current_setting('qa.variant') loop perform public.change_variant_cart(item.variant_id,'remove',null,item.quantity,gen_random_uuid()); end loop; end $$;
select set_config('qa.order',(public.place_variant_order('${ids[5]}',jsonb_build_object('full_name','LOCAL QA','email','qa'||chr(64)||'example.invalid','contact_phone','+23276521208','payment_phone','+23276521209','provider','orange','fulfilment','pickup','payment_status','paid','total',0),
 (select jsonb_agg(jsonb_build_object('product_id',v.product_id,'variant_id',v.id,'quantity',i.quantity,'unit_price',v.price_cents)) from public.variant_cart_items i join public.product_variants v on v.id=i.variant_id where i.cart_id=current_setting('qa.cart_a')::uuid))->>'id'),true);
select pg_temp.check_it((select status='placed' and payment_status='awaiting_payment' and user_id='${a}' and delivery_fee_cents=0 and total_cents>0 from public.orders where id=current_setting('qa.order')::uuid),'Trusted pickup order never accepts paid or zero total');
select pg_temp.check_it(public.place_variant_order('${ids[5]}','{}','[]')->>'id'=current_setting('qa.order'),'Order idempotency retry');
select pg_temp.check_it(not exists(select 1 from public.variant_cart_items where cart_id=current_setting('qa.cart_a')::uuid),'Atomic Bag conversion');
reset role;
select pg_temp.check_it((select status='pending' and attempts=0 from public.order_confirmation_jobs where order_id=current_setting('qa.order')::uuid),'Order email remains pending without provider invocation');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"${b}","role":"authenticated"}',true);
select pg_temp.check_it(not exists(select 1 from public.carts where id=current_setting('qa.cart_a')::uuid),'Customer B cart isolation');
select pg_temp.check_it(not exists(select 1 from public.variant_cart_items where cart_id=current_setting('qa.cart_a')::uuid),'Customer B line isolation');
select pg_temp.check_it(not exists(select 1 from public.orders where user_id='${a}'),'Customer B order isolation');
select pg_temp.check_it(not has_function_privilege('anon','public.load_variant_cart()','EXECUTE'),'Signed-out RPC denial');
rollback;`;
}
function requireFixtureRecovery(args) {
  if (args.length !== 1 || args[0] !== '--restore-latest-confirmed') throw new Error('Confirmed existing fixture mapping is required.');
}
async function run() {
  requireFixtureRecovery(process.argv.slice(2));
  const clients = []; const passed = [];
  const check = (ok, label) => { assert.ok(ok, label); passed.push(label); console.log(`PASS ${label}`); };
  verifyDatabase();
  const cli = process.env.LOCAL_SUPABASE_CLI;
  assert.ok(cli && path.basename(cli).toLowerCase() === 'supabase.exe');
  const status = JSON.parse(execFileSync(cli, ['status', '--workdir', path.join(webRoot, '.codex/local-stack'), '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  assert.equal(status.API_URL, origin);
  assert.ok(localBuildConfig('development', status.API_URL, status.PUBLISHABLE_KEY));
  const fixtures = restoreLatestConfirmed(cli);
  const before = businessSnapshot();
  try {
    const users = {};
    for (const alias of ['customer-a', 'customer-b', 'admin-a', 'admin-b']) {
      const ordinarySession = await fixtures.issueSession(alias);
      const client = createClient(origin, status.PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: localFetch } });
      clients.push(client);
      const session = await client.auth.setSession(ordinarySession); assert.equal(session.error, null);
      const verified = await client.auth.getUser(); assert.equal(verified.error, null);
      users[alias] = { client, id: verified.data.user.id };
      check(Boolean(verified.data.user.id), `Existing synthetic ${alias} authenticated locally`);
      const member = await client.rpc('is_business_admin');
      check(!member.error && member.data === alias.startsWith('admin'), `${alias} authorization role`);
    }
    const mobileProducts = load(path.resolve('src/features/products/productRepository.ts'));
    const webProducts = await import(pathToFileURL(path.join(webRoot, 'src/features/products/productRepository.ts')).href);
    const client = users['customer-a'].client;
    const mobile = await mobileProducts.loadProducts(client, 'NLE', new AbortController().signal);
    const web = await webProducts.loadProducts(client, 'NLE', new AbortController().signal);
    check(mobile.length > 0 && mobile.length === web.length, 'Actual web/mobile catalogue repositories agree');
    const variants = products => products.flatMap(product => product.variants.map(variant => `${variant.id}|${variant.price}|${variant.available}`)).sort();
    assert.deepEqual(variants(mobile), variants(web)); check(true, 'Actual variant identities prices and availability agree');
    const output = sql(rollbackContract(users['customer-a'].id, users['customer-b'].id));
    const records = output.split(/\r?\n/);
    for (const line of records.filter(line => line.startsWith('PASS|'))) check(true, line.slice(5));
    const mobileCart = load(path.resolve('src/features/cart/variantCartRepository.ts'));
    const webCart = await import(pathToFileURL(path.join(webRoot, 'src/features/cart/variantCartRepository.ts')).href);
    for (const prefix of ['BASE|', 'WEB|', 'MOBILE|', 'UPDATED|']) {
      const row = JSON.parse(records.find(line => line.startsWith(prefix)).slice(prefix.length));
      assert.deepEqual(JSON.parse(JSON.stringify(mobileCart.parseVariantCart(row))), webCart.parseVariantCart(row));
      check(true, `${prefix.slice(0, -1)} canonical payload accepted by both repositories`);
    }
  } finally {
    for (const client of clients) { const result = await client.auth.signOut({ scope: 'local' }); assert.equal(result.error, null); }
    assert.equal(businessSnapshot(), before);
  }
  check(true, 'Commerce data unchanged after rollback; only test Auth sessions revoked');
  console.log(JSON.stringify({ passed: passed.length, failed: 0, evidence: 'local Auth/API reads + rolled-back SQL; no device/browser synchronization claim' }));
}
if (require.main === module) run().catch(() => { console.error('Local contract QA failed; inspect safely before retrying. No raw credentials or database errors printed.'); process.exitCode = 1; });
module.exports = { localFetch, rollbackContract, verifyDatabase, requireFixtureRecovery };
