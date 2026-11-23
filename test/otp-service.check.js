const assert = require('assert');
const { OtpService } = require('../src/services/otp.service');
const {
  VerifyRegistrationRequestDTO,
  ResendRegistrationOtpRequestDTO,
  RegisterResponseDTO,
} = require('../src/dto/auth.dto');

const service = new OtpService();
const id = '550e8400-e29b-41d4-a716-446655440000';
const hash = service.hash(id, '048291');
assert.match(hash, /^[a-f0-9]{64}$/);
assert.strictEqual(service.matches(id, '048291', hash), true);
assert.strictEqual(service.matches(id, '48291', hash), false);
assert.strictEqual(service.matches(id, '048292', hash), false);
assert.strictEqual(service.matches('660e8400-e29b-41d4-a716-446655440001', '048291', hash), false);

const verify = new VerifyRegistrationRequestDTO({ registrationId: id, otp: '048291' });
assert.strictEqual(verify.validate().isValid, true);
assert.strictEqual(verify.toServiceInput().otp, '048291');
assert.strictEqual(new VerifyRegistrationRequestDTO({ registrationId: id, otp: 48291 }).validate().isValid, false);
assert.strictEqual(new ResendRegistrationOtpRequestDTO({ registrationId: id }).validate().isValid, true);
assert.strictEqual(new ResendRegistrationOtpRequestDTO({ registrationId: 'bad' }).validate().isValid, false);

const response = new RegisterResponseDTO({ registrationId: id, expiresIn: 300, resendAfter: 60 }).toJSON();
assert.strictEqual(response.data.registrationId, id);
assert.strictEqual(response.data.expiresIn, 300);
console.log('otp-service.check OK');
