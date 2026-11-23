// Self-check: node test/auth-middleware.check.js (không cần DB / .env)
const assert = require('assert');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_check';

const { JWT_SECRET } = require('../src/config/constants');
const { verifyToken, requireAdmin, authorizeRoles } = require('../src/middlewares/auth.middleware');
const { apiResponseMiddleware } = require('../src/middlewares/api-response.middleware');

function createMockRes() {
  let captured = null;
  const res = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      captured = body;
      return body;
    },
  };
  apiResponseMiddleware({}, res, () => {});
  return {
    res,
    getBody: () => captured,
  };
}

function runMiddleware(middleware, req) {
  const { res, getBody } = createMockRes();
  let nextCalled = false;
  middleware(req, res, () => {
    nextCalled = true;
  });
  return { nextCalled, statusCode: res.statusCode, body: getBody() };
}

// 1. Không có Authorization header -> 401 AUTH_REQUIRED
const missingHeaderRes = runMiddleware(verifyToken, { headers: {} });
assert.strictEqual(missingHeaderRes.nextCalled, false);
assert.strictEqual(missingHeaderRes.statusCode, 401);
assert.strictEqual(missingHeaderRes.body.success, false);
assert.strictEqual(missingHeaderRes.body.statusCode, 401);
assert.strictEqual(missingHeaderRes.body.data.code, 'AUTH_REQUIRED');

// 2. Bearer rỗng hoặc sai prefix -> 401 AUTH_REQUIRED
const emptyBearerRes = runMiddleware(verifyToken, { headers: { authorization: 'Bearer   ' } });
assert.strictEqual(emptyBearerRes.nextCalled, false);
assert.strictEqual(emptyBearerRes.statusCode, 401);
assert.strictEqual(emptyBearerRes.body.data.code, 'AUTH_REQUIRED');

const basicAuthRes = runMiddleware(verifyToken, { headers: { authorization: 'Basic abc123' } });
assert.strictEqual(basicAuthRes.nextCalled, false);
assert.strictEqual(basicAuthRes.statusCode, 401);
assert.strictEqual(basicAuthRes.body.data.code, 'AUTH_REQUIRED');

// 3. Token hết hạn -> 401 TOKEN_EXPIRED
const expiredToken = jwt.sign({ id: 'u-1', role: 'CUSTOMER' }, JWT_SECRET, { expiresIn: -10 });
const expiredRes = runMiddleware(verifyToken, { headers: { authorization: `Bearer ${expiredToken}` } });
assert.strictEqual(expiredRes.nextCalled, false);
assert.strictEqual(expiredRes.statusCode, 401);
assert.strictEqual(expiredRes.body.success, false);
assert.strictEqual(expiredRes.body.message, 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
assert.strictEqual(expiredRes.body.data.code, 'TOKEN_EXPIRED');

// 4. Token sai chữ ký / cấu trúc lỗi -> 401 TOKEN_INVALID
const wrongSecretToken = jwt.sign({ id: 'u-1', role: 'CUSTOMER' }, `${JWT_SECRET}_wrong`, { expiresIn: 60 });
const wrongSecretRes = runMiddleware(verifyToken, { headers: { authorization: `Bearer ${wrongSecretToken}` } });
assert.strictEqual(wrongSecretRes.nextCalled, false);
assert.strictEqual(wrongSecretRes.statusCode, 401);
assert.strictEqual(wrongSecretRes.body.message, 'Phiên đăng nhập không hợp lệ. Vui lòng đăng nhập lại.');
assert.strictEqual(wrongSecretRes.body.data.code, 'TOKEN_INVALID');

const malformedRes = runMiddleware(verifyToken, { headers: { authorization: 'Bearer not.a.jwt' } });
assert.strictEqual(malformedRes.nextCalled, false);
assert.strictEqual(malformedRes.statusCode, 401);
assert.strictEqual(malformedRes.body.data.code, 'TOKEN_INVALID');

// 5. Token hợp lệ -> next(), req.user.id khớp
const validToken = jwt.sign({ id: 'u-1', email: 'u@test.com', role: 'CUSTOMER' }, JWT_SECRET, { expiresIn: 60 });
const validReq = { headers: { authorization: `Bearer ${validToken}` } };
const validRes = runMiddleware(verifyToken, validReq);
assert.strictEqual(validRes.nextCalled, true);
assert.strictEqual(validReq.user.id, 'u-1');
assert.strictEqual(validReq.user.role, 'CUSTOMER');

// 6. CUSTOMER gọi requireAdmin -> 403 FORBIDDEN
const customerAdminRes = runMiddleware(requireAdmin, { user: { id: 'u-1', role: 'CUSTOMER' } });
assert.strictEqual(customerAdminRes.nextCalled, false);
assert.strictEqual(customerAdminRes.statusCode, 403);
assert.strictEqual(customerAdminRes.body.data.code, 'FORBIDDEN');

// 7. ADMIN gọi requireAdmin -> next()
const adminAllowedRes = runMiddleware(requireAdmin, { user: { id: 'a-1', role: 'ADMIN' } });
assert.strictEqual(adminAllowedRes.nextCalled, true);

// 8. ADMIN gọi authorizeRoles('CUSTOMER') -> 403 FORBIDDEN
const adminCustomerRes = runMiddleware(authorizeRoles('CUSTOMER'), { user: { id: 'a-1', role: 'ADMIN' } });
assert.strictEqual(adminCustomerRes.nextCalled, false);
assert.strictEqual(adminCustomerRes.statusCode, 403);
assert.strictEqual(adminCustomerRes.body.data.code, 'FORBIDDEN');

// 9. CUSTOMER gọi authorizeRoles('CUSTOMER') -> next()
const customerAllowedRes = runMiddleware(authorizeRoles('CUSTOMER'), { user: { id: 'u-1', role: 'CUSTOMER' } });
assert.strictEqual(customerAllowedRes.nextCalled, true);

console.log('auth-middleware.check OK');
