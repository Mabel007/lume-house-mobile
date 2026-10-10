// Explicit local-only acceptance. Profile mutations exist only inside a rolled-back SQL transaction.
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { restoreLatestConfirmed } = require('./local-fixture-auth.cjs');
const { load } = require('../tests/helpers/source.cjs');
const sql = input => execFileSync('docker', ['exec', '-i', 'supabase_db_lume-house', 'psql', '-X', '-q', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'], { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const snapshot = () => sql("select coalesce(md5(string_agg(row_to_json(p)::text,'|' order by id)),'empty') from public.profiles p;");
async function run() {
  assert.deepEqual(process.argv.slice(2), ['--restore-latest-confirmed']);
  const context = restoreLatestConfirmed(process.env.LOCAL_SUPABASE_CLI);
  const before = snapshot(); const clients = []; let passed = 0;
  const mobile = load('src/features/profile/profileRepository.ts');
  const webRoot = path.resolve(__dirname, '../../lume-house');
  const payment = load(path.join(webRoot, 'src/features/checkout/payment.ts'));
  const web = load(path.join(webRoot, 'src/features/account/profile.ts'), { '../checkout/payment.ts': payment });
  try {
    const ids = [];
    for (const alias of ['customer-a', 'customer-b']) {
      const client = context.createOrdinaryClient(); clients.push(client);
      const session = await client.auth.setSession(await context.issueSession(alias)); assert.equal(session.error, null);
      const user = await client.auth.getUser(); assert.equal(user.error, null); const id = user.data.user.id; ids.push(id);
      assert.match(id, /^[a-f0-9-]{36}$/);
      const actual = await mobile.loadProfile(client, id, () => true);
      const expected = await web.loadProfile(client, id);
      assert.deepEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(expected || web.emptyProfile))); passed++;
    }
    const foreign = await clients[1].from('profiles').select('id').eq('id', ids[0]); assert.equal(foreign.error, null); assert.equal(foreign.data.length, 0); passed++;
    const [a, b] = ids;
    const result = sql(`begin; set local lock_timeout='2s'; set local statement_timeout='10s';
create function pg_temp.check_it(ok boolean,label text) returns text language plpgsql as $$ begin if ok is distinct from true then raise exception 'PROFILE_CHECK_FAILED'; end if; return 'PASS|'||label; end $$;
create function pg_temp.denied(statement text,code text,label text) returns text language plpgsql as $$ begin begin execute statement; exception when others then if sqlstate=code then return 'PASS|'||label; end if; raise exception 'WRONG_PROFILE_REJECTION'; end; raise exception 'EXPECTED_PROFILE_REJECTION'; end $$;
set local role authenticated; select set_config('request.jwt.claims','{"sub":"${a}","role":"authenticated"}',true);
insert into public.profiles(id,full_name,phone,default_street_address,default_area,default_city) values('${a}','Synthetic profile QA','+23276521208','Synthetic landmark','Synthetic community','Synthetic town') on conflict(id) do update set full_name=excluded.full_name,phone=excluded.phone,default_street_address=excluded.default_street_address,default_area=excluded.default_area,default_city=excluded.default_city;
select pg_temp.check_it((select full_name='Synthetic profile QA' and default_city='Synthetic town' from public.profiles where id='${a}'),'Owner profile and delivery save');
update public.profiles set full_name='Synthetic update' where id='${a}';
select pg_temp.check_it((select default_city='Synthetic town' and phone='+23276521208' from public.profiles where id='${a}'),'Partial profile update preserves delivery');
select pg_temp.denied('update public.profiles set phone=''invalid'' where id=''${a}''','23514','Invalid phone rejected');
select pg_temp.denied('update public.profiles set default_area=repeat(''x'',201) where id=''${a}''','23514','Oversized address rejected');
select pg_temp.check_it((select phone='+23276521208' and default_area='Synthetic community' from public.profiles where id='${a}'),'Invalid mutations preserve valid values');
select set_config('request.jwt.claims','{"sub":"${b}","role":"authenticated"}',true);
select pg_temp.check_it(not exists(select 1 from public.profiles where id='${a}'),'Customer B cannot read A');
with changed as (update public.profiles set full_name='Forbidden' where id='${a}' returning id) select pg_temp.check_it(not exists(select 1 from changed),'Customer B cannot update A');
select pg_temp.denied('insert into public.profiles(id,full_name) values(''${a}'',''Forbidden'')','42501','Customer B cannot insert A');
reset role; select pg_temp.check_it((select full_name='Synthetic update' from public.profiles where id='${a}'),'A values intact after B attempts');
set local role anon; select pg_temp.denied('select id from public.profiles','42501','Guest profile denied');
rollback;`);
    passed += result.split('\n').filter(line => line.startsWith('PASS|')).length;
    assert.equal(snapshot(), before); passed++;
    console.log(`PASS ${passed} local profile checks: actual mobile/web HTTP reads, owner/RLS/validation transaction, complete profile snapshot preserved. No orders/email/payment.`);
  } finally { for (const client of clients) await client.auth.signOut({ scope: 'local' }); }
}
run().catch(() => { console.error('Local profile acceptance FAILED; raw customer/session/SQL details suppressed.'); process.exitCode = 1; });
