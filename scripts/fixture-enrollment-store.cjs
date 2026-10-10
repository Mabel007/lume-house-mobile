const { randomBytes, createHash } = require('node:crypto');
const { requireNativeEnrollment, customerAliases } = require('../config/fixture-enrollment');
const digest = code => createHash('sha256').update(code).digest('hex');
function createEnrollmentStore(now = Date.now) {
  const entries = new Map();
  function prune() { for (const [key, value] of entries) if (value.expires <= now()) entries.delete(key); }
  return {
    issue(alias) {
      if (!customerAliases.includes(alias)) throw new Error('Enrollment refused.');
      prune();
      // Reissuing an alias invalidates its previous code. Credentials exist only in memory.
      for (const [key, value] of entries) if (value.alias === alias) entries.delete(key);
      const code = randomBytes(32).toString('base64url');
      entries.set(digest(code), { alias, expires: now() + 120000 });
      return code;
    },
    consume(input) {
      requireNativeEnrollment(input);
      if (typeof input.code !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(input.code)) throw new Error('Enrollment refused.');
      prune();
      const key = digest(input.code), entry = entries.get(key);
      if (!entry || entry.alias !== input.alias) throw new Error('Enrollment refused.');
      // Consume before asynchronous Auth work: concurrent redemption and replay fail closed.
      entries.delete(key);
      return entry.alias;
    },
  };
}
module.exports = { createEnrollmentStore };
