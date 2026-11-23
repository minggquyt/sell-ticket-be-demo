const assert = require('assert');
const { AuthService } = require('../src/services/auth.service');
const { OtpService } = require('../src/services/otp.service');

const registrationId = '550e8400-e29b-41d4-a716-446655440000';
const now = Date.now();
const state = {
  registration: {
    id: registrationId,
    email: 'user@example.com',
    status: 'PENDING',
    expires_at: new Date(now + 10 * 60 * 1000),
  },
  challenge: {
    id: '650e8400-e29b-41d4-a716-446655440001',
    status: 'PENDING',
    next_resend_at: new Date(now + 30 * 1000),
  },
  commits: 0,
  rollbacks: 0,
};

const repo = {
  async checkEmailExists() { return false; },
  async beginTransaction() { return {}; },
  async commitTransaction() { state.commits += 1; },
  async rollbackTransaction() { state.rollbacks += 1; },
  async expirePendingRegistrationByEmail() {},
  async findPendingRegistrationByEmailForUpdate() {
    return state.registration?.status === 'PENDING' ? state.registration : null;
  },
  async findRegistrationByIdForUpdate() { return state.registration; },
  async findActiveOtpForUpdate() {
    return state.challenge?.status === 'PENDING' ? state.challenge : null;
  },
  async cancelRegistration() {
    if (state.registration?.status !== 'PENDING') return false;
    state.registration.status = 'CANCELLED';
    if (state.challenge?.status === 'PENDING') state.challenge.status = 'REVOKED';
    return true;
  },
};

const service = new AuthService({
  authRepository: repo,
  otpService: new OtpService(),
  emailService: { async sendRegistrationOtp() {} },
});

(async () => {
  await assert.rejects(
    () => service.register('user@example.com', 'password123', 'User', '0901234567'),
    (err) => {
      assert.strictEqual(err.code, 'REGISTRATION_PENDING');
      assert.strictEqual(err.statusCode, 409);
      assert.strictEqual(err.details.registrationId, registrationId);
      assert.ok(err.details.expiresIn > 0);
      assert.ok(err.details.resendAfter > 0);
      return true;
    }
  );

  const cancelled = await service.cancelRegistration(registrationId);
  assert.deepStrictEqual(cancelled, { cancelled: true });
  assert.strictEqual(state.registration.status, 'CANCELLED');
  assert.strictEqual(state.challenge.status, 'REVOKED');

  const cancelledAgain = await service.cancelRegistration(registrationId);
  assert.deepStrictEqual(cancelledAgain, { cancelled: true }, 'cancel must be idempotent');
  assert.strictEqual(state.rollbacks, 1, 'pending register conflict rolls back its transaction');

  console.log('registration-cancel-resume.check OK');
})().catch((err) => { console.error(err); process.exit(1); });