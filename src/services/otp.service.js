const { randomInt, createHmac, timingSafeEqual } = require('crypto');
const { OTP_HMAC_SECRET } = require('../config/constants');

class OtpService {
  generateCode() {
    return randomInt(0, 1_000_000).toString().padStart(6, '0');
  }

  hash(challengeId, otp) {
    return createHmac('sha256', OTP_HMAC_SECRET)
      .update(`v1:${challengeId}:${otp}`)
      .digest('hex');
  }

  matches(challengeId, otp, storedHash) {
    if (!/^\d{6}$/.test(String(otp || '')) || !/^[a-f0-9]{64}$/i.test(String(storedHash || ''))) {
      return false;
    }
    const actual = Buffer.from(this.hash(challengeId, otp), 'hex');
    const expected = Buffer.from(storedHash, 'hex');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }
}

module.exports = new OtpService();
module.exports.OtpService = OtpService;
