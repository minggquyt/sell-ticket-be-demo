const assert = require('assert');
const { createOtpRateLimit } = require('../src/middlewares/otp-rate-limit.middleware');
const middleware = createOtpRateLimit({ windowMs: 60000, max: 2, keyPrefix: 'test' });
const req = { ip: '127.0.0.1', body: { registrationId: 'r1' } };
let nextCount = 0;
const res = { statusCode: 200, headers: {}, status(code) { this.statusCode = code; return this; }, set(k, v) { this.headers[k] = v; }, json(body) { this.body = body; return this; } };
middleware(req, res, () => nextCount++);
middleware(req, res, () => nextCount++);
middleware(req, res, () => nextCount++);
assert.strictEqual(nextCount, 2);
assert.strictEqual(res.statusCode, 429);
assert.strictEqual(res.body.data.code, 'RATE_LIMITED');
assert.ok(res.headers['Retry-After']);

// IP bucket is independent from registration/email and prevents rotating identifiers.
const otherSubject = { ip: '127.0.0.1', body: { registrationId: 'r2' } };
middleware(otherSubject, res, () => nextCount++);
assert.strictEqual(nextCount, 2);
console.log('otp-rate-limit.check OK');
