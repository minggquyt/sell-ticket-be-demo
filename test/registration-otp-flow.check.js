const assert = require('assert');
const { AuthService } = require('../src/services/auth.service');
const { OtpService } = require('../src/services/otp.service');

const registrationId = '550e8400-e29b-41d4-a716-446655440000';
const otpService = new OtpService();
const state = { registration: null, challenge: null, users: [], sent: [], commits: 0, rollbacks: 0, issued: 0 };
const repo = {
  async checkEmailExists(email) { return state.users.some((u) => u.email === email); },
  async beginTransaction() { return {}; },
  async commitTransaction() { state.commits += 1; },
  async rollbackTransaction() { state.rollbacks += 1; },
  async expirePendingRegistrationByEmail() {},
  async findPendingRegistrationByEmailForUpdate() { return state.registration?.status === 'PENDING' ? state.registration : null; },
  async createPendingRegistration(data) {
    state.registration = { id: registrationId, email: data.email, full_name: data.fullName, password_hash: data.passwordHash, phone: data.phone, status: 'PENDING', expires_at: data.expiresAt };
    return state.registration;
  },
  async createRegistrationOtp(data) {
    state.issued += 1;
    state.challenge = { id: data.id, registration_id: data.registrationId, otp_hash: data.otpHash, status: 'PENDING', attempts: 0, max_attempts: data.maxAttempts, expires_at: data.expiresAt, next_resend_at: data.nextResendAt };
    return state.challenge;
  },
  async findRegistrationByIdForUpdate() { return state.registration; },
  async findActiveOtpForUpdate() { return state.challenge?.status === 'PENDING' ? state.challenge : null; },
  async incrementOtpAttempts() { state.challenge.attempts += 1; if (state.challenge.attempts >= state.challenge.max_attempts) state.challenge.status = 'LOCKED'; return state.challenge; },
  async markRegistrationExpired() { state.registration.status = 'EXPIRED'; state.challenge.status = 'EXPIRED'; },
  async revokeActiveOtp() { if (state.challenge?.status === 'PENDING') state.challenge.status = 'REVOKED'; },
  async countRegistrationOtps() { return state.issued; },
  async createUser(email, password, fullName, phone) { const user = { id: 'user-1', email, password, full_name: fullName, phone, role: 'CUSTOMER' }; state.users.push(user); return user; },
  async completeRegistration() { state.challenge.status = 'VERIFIED'; state.registration.status = 'COMPLETED'; },
  async cancelRegistration() { state.registration.status = 'CANCELLED'; if (state.challenge?.status === 'PENDING') state.challenge.status = 'REVOKED'; return true; },
};
const fakeEmail = { async sendRegistrationOtp(email, otp) { state.sent.push({ email, otp }); } };
const service = new AuthService({ authRepository: repo, otpService, emailService: fakeEmail });

(async () => {
  const started = await service.register(' USER@Example.COM ', 'password123', 'User A', '0901234567');
  assert.strictEqual(started.registrationId, registrationId);
  assert.strictEqual(state.users.length, 0, 'register must not create user before OTP');
  assert.strictEqual(state.registration.email, 'user@example.com');
  assert.strictEqual(state.sent.length, 1);
  assert.match(state.sent[0].otp, /^\d{6}$/);

  await assert.rejects(() => service.verifyRegistration(registrationId, '999999'), (err) => err.code === 'INVALID_OTP');
  assert.strictEqual(state.challenge.attempts, 1);
  assert.strictEqual(state.users.length, 0);

  const user = await service.verifyRegistration(registrationId, state.sent[0].otp);
  assert.strictEqual(user.role, 'CUSTOMER');
  assert.strictEqual(user.phone, '0901234567');
  assert.strictEqual(state.users.length, 1);
  assert.strictEqual(state.registration.status, 'COMPLETED');
  assert.strictEqual(state.challenge.status, 'VERIFIED');

  const cancelCompleted = await service.cancelRegistration(registrationId);
  assert.deepStrictEqual(cancelCompleted, { cancelled: true });
  assert.strictEqual(state.registration.status, 'COMPLETED', 'completed registration must not be cancelled');

  console.log('registration-otp-flow.check OK');
})().catch((err) => { console.error(err); process.exit(1); });
