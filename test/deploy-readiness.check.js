// Self-check: node test/deploy-readiness.check.js (không cần DB / .env)
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { PaymentEventHub } = require('../src/utils/payment-events');
const {
  createOtpRateLimit,
  _getBucketCount,
  _clearBuckets,
} = require('../src/middlewares/otp-rate-limit.middleware');

const constantsPath = path.resolve(__dirname, '../src/config/constants.js');
const payosPath = path.resolve(__dirname, '../src/config/payos.js');
const authRepoPath = path.resolve(__dirname, '../src/repositories/auth.repository.js');

function runInCleanEnv(extraEnv, script) {
  return execFileSync(process.execPath, ['-e', script], {
    cwd: os.tmpdir(),
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      DOTENV_CONFIG_PATH: path.join(os.tmpdir(), '.nonexistent-dotenv-file'),
      DOTENV_CONFIG_QUIET: 'true',
      ...extraEnv,
    },
  });
}

function parseJsonLine(output) {
  const line = String(output || '')
    .split(/\r?\n/)
    .find((l) => l.startsWith('JSON_OUT:'));
  assert.ok(line, `Thiếu dòng JSON_OUT trong output: ${output}`);
  return JSON.parse(line.slice('JSON_OUT:'.length));
}

(async () => {
  // 1. Default constants (EMAIL_PROVIDER='gmail', DB_POOL_MAX=15, ENABLE_LIVE_LOGS theo NODE_ENV)
  const devConstantsOut = runInCleanEnv(
    { JWT_SECRET: 'test-jwt', OTP_HMAC_SECRET: 'test-otp' },
    `const c = require(${JSON.stringify(constantsPath)}); console.log('JSON_OUT:' + JSON.stringify({ EMAIL_PROVIDER: c.EMAIL_PROVIDER, DB_POOL_MAX: c.DB_POOL_MAX, ENABLE_LIVE_LOGS: c.ENABLE_LIVE_LOGS }));`,
  );
  const devConstants = parseJsonLine(devConstantsOut);
  assert.strictEqual(devConstants.EMAIL_PROVIDER, 'gmail');
  assert.strictEqual(devConstants.DB_POOL_MAX, 15);
  assert.strictEqual(devConstants.ENABLE_LIVE_LOGS, true);

  const prodConstantsOut = runInCleanEnv(
    { NODE_ENV: 'production', JWT_SECRET: 'test-jwt', OTP_HMAC_SECRET: 'test-otp' },
    `const c = require(${JSON.stringify(constantsPath)}); console.log('JSON_OUT:' + JSON.stringify({ EMAIL_PROVIDER: c.EMAIL_PROVIDER, ENABLE_LIVE_LOGS: c.ENABLE_LIVE_LOGS }));`,
  );
  const prodConstants = parseJsonLine(prodConstantsOut);
  assert.strictEqual(prodConstants.EMAIL_PROVIDER, 'gmail');
  assert.strictEqual(prodConstants.ENABLE_LIVE_LOGS, false);

  // 2. PaymentEventHub.closeAll() đóng toàn bộ subscriber đang mở
  const createMockRes = () => ({
    chunks: [],
    writableEnded: false,
    destroyed: false,
    write(chunk) {
      this.chunks.push(chunk);
    },
    end() {
      this.writableEnded = true;
    },
  });

  const hub = new PaymentEventHub({ heartbeatIntervalMs: 60000, maxDurationMs: 60000 });
  const r1 = createMockRes();
  const r2 = createMockRes();
  hub.subscribe(200001, r1, { type: 'INIT', orderCode: 200001, status: 'PAYMENT_PROCESSING', phase: 'WAITING' });
  hub.subscribe(200002, r2, { type: 'INIT', orderCode: 200002, status: 'PAYMENT_PROCESSING', phase: 'WAITING' });
  assert.strictEqual(hub.getSubscriberCount(200001), 1);
  assert.strictEqual(hub.getSubscriberCount(200002), 1);

  hub.closeAll();
  assert.strictEqual(r1.writableEnded, true);
  assert.strictEqual(r2.writableEnded, true);
  assert.strictEqual(hub.getSubscriberCount(200001), 0);
  assert.strictEqual(hub.getSubscriberCount(200002), 0);

  // 3. otp-rate-limit dọn dẹp bucket hết hạn khi vượt ngưỡng >= 1000
  _clearBuckets();
  const shortMw = createOtpRateLimit({ windowMs: 10, max: 5, keyPrefix: 'prune-test' });
  for (let i = 0; i < 505; i += 1) {
    const req = { ip: `10.0.${Math.floor(i / 250)}.${i % 250}`, body: { registrationId: `reg-${i}` } };
    const res = { status: () => res, set: () => {}, json: () => res };
    shortMw(req, res, () => {});
  }
  assert.ok(_getBucketCount() >= 1000, 'Phải nạp đủ >= 1000 buckets trước khi kiểm tra prune');

  await new Promise((resolve) => setTimeout(resolve, 25));

  const freshMw = createOtpRateLimit({ windowMs: 60000, max: 2, keyPrefix: 'fresh-test' });
  let freshNext = 0;
  const freshReq = { ip: '192.0.2.50', body: { registrationId: 'fresh-reg' } };
  const freshRes = {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) { this.statusCode = code; return this; },
    set(k, v) { this.headers[k] = v; },
    json(b) { this.body = b; return this; },
  };
  freshMw(freshReq, freshRes, () => { freshNext += 1; });
  assert.ok(_getBucketCount() < 100, 'Buckets hết hạn phải được dọn dẹp khi vượt ngưỡng');
  freshMw(freshReq, freshRes, () => { freshNext += 1; });
  freshMw(freshReq, freshRes, () => { freshNext += 1; });
  assert.strictEqual(freshNext, 2);
  assert.strictEqual(freshRes.statusCode, 429);
  assert.strictEqual(freshRes.body.data.code, 'RATE_LIMITED');
  assert.ok(freshRes.headers['Retry-After']);
  _clearBuckets();

  // 4. PayOS fail-closed guard khi NODE_ENV=production và thiếu credentials
  const payosCheckOut = runInCleanEnv(
    { NODE_ENV: 'production' },
    `
    const assert = require('assert');
    const payos = require(${JSON.stringify(payosPath)});
    (async () => {
      await assert.rejects(() => payos.webhooks.verify({}), /PayOS webhook verification unavailable/);
      await assert.rejects(() => payos.paymentRequests.get(1), /PayOS not configured/);
      await assert.rejects(() => payos.paymentRequests.cancel(1, 'expired'), /PayOS not configured/);
      console.log('PAYOS_GUARD_OK');
    })().catch((e) => { console.error(e); process.exit(1); });
    `,
  );
  assert.ok(payosCheckOut.includes('PAYOS_GUARD_OK'));

  // 5. auth.repository.js markRegistrationExpired là 1 câu lệnh CTE duy nhất
  const authRepoSrc = fs.readFileSync(authRepoPath, 'utf8');
  const matchMethod = authRepoSrc.match(/async markRegistrationExpired\([^)]*\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(matchMethod, 'Không tìm thấy markRegistrationExpired trong auth.repository.js');
  const sqlMatch = matchMethod[1].match(/`([\s\S]*?)`/);
  assert.ok(sqlMatch, 'Không tìm thấy câu SQL trong markRegistrationExpired');
  const sql = sqlMatch[1];
  assert.ok(sql.includes('WITH expired AS ('), 'markRegistrationExpired phải dùng CTE WITH expired');
  assert.ok((sql.match(/;/g) || []).length <= 1, 'markRegistrationExpired không được chứa nhiều câu lệnh SQL');

  console.log('deploy-readiness.check OK');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
