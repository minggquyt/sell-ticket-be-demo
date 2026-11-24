const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const authRepository = require('../repositories/auth.repository');
const { JWT_SECRET, JWT_EXPIRES_IN, BCRYPT_SALT_ROUNDS } = require('../config/constants');
const logger = require('../utils/logger');
const otpService = require('./otp.service');
const emailService = require('./email.service');
const { randomUUID } = require('crypto');
const {
  OTP_TTL_SECONDS,
  REGISTRATION_TTL_SECONDS,
  OTP_RESEND_COOLDOWN_SECONDS,
  OTP_MAX_ATTEMPTS,
  OTP_MAX_RESENDS,
} = require('../config/constants');

const authError = (statusCode, code, message) => {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  return err;
};

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();
const remainingSeconds = (date) => Math.max(0, Math.ceil((new Date(date).getTime() - Date.now()) / 1000));

class AuthService {
  constructor(dependencies = {}) {
    this.authRepository = dependencies.authRepository || authRepository;
    this.otpService = dependencies.otpService || otpService;
    this.emailService = dependencies.emailService || emailService;
  }

  async register(email, password, fullName, phone) {
    const normalizedEmail = normalizeEmail(email);
    // Kiểm tra email đã tồn tại
    const emailExists = await this.authRepository.checkEmailExists(normalizedEmail);
    if (emailExists) {
      throw authError(409, 'EMAIL_ALREADY_EXISTS', 'Email này đã được sử dụng.');
    }

    const hashedPassword = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
    const defaultFullName = fullName || normalizedEmail.split('@')[0];
    const now = Date.now();
    const registrationExpiresAt = new Date(now + REGISTRATION_TTL_SECONDS * 1000);
    const otpExpiresAt = new Date(now + OTP_TTL_SECONDS * 1000);
    const nextResendAt = new Date(now + OTP_RESEND_COOLDOWN_SECONDS * 1000);
    const challengeId = randomUUID();
    const otp = this.otpService.generateCode();
    let registration;
    const client = await this.authRepository.beginTransaction();
    let closed = false;

    try {
      await this.authRepository.expirePendingRegistrationByEmail(normalizedEmail, client);
      const existing = await this.authRepository.findPendingRegistrationByEmailForUpdate(normalizedEmail, client);
      if (existing) {
        const challenge = await this.authRepository.findActiveOtpForUpdate(existing.id, client);
        const err = authError(409, 'REGISTRATION_PENDING', 'Email này đang có yêu cầu đăng ký chờ xác minh.');
        err.details = {
          registrationId: existing.id,
          expiresIn: remainingSeconds(existing.expires_at),
          resendAfter: challenge ? remainingSeconds(challenge.next_resend_at) : 0,
        };
        throw err;
      }

      registration = await this.authRepository.createPendingRegistration({
        email: normalizedEmail,
        fullName: defaultFullName,
        passwordHash: hashedPassword,
        phone,
        expiresAt: registrationExpiresAt,
      }, client);
      await this.authRepository.createRegistrationOtp({
        id: challengeId,
        registrationId: registration.id,
        otpHash: this.otpService.hash(challengeId, otp),
        maxAttempts: OTP_MAX_ATTEMPTS,
        expiresAt: otpExpiresAt,
        nextResendAt,
      }, client);
      await this.authRepository.commitTransaction(client);
      closed = true;
    } catch (err) {
      if (!closed) await this.authRepository.rollbackTransaction(client);
      if (err.code === '23505') {
        const retryClient = await this.authRepository.beginTransaction();
        try {
          const concurrent = await this.authRepository.findPendingRegistrationByEmailForUpdate(normalizedEmail, retryClient);
          const challenge = concurrent
            ? await this.authRepository.findActiveOtpForUpdate(concurrent.id, retryClient)
            : null;
          await this.authRepository.commitTransaction(retryClient);
          if (concurrent) {
            const conflict = authError(409, 'REGISTRATION_PENDING', 'Email này đang có yêu cầu đăng ký chờ xác minh.');
            conflict.details = {
              registrationId: concurrent.id,
              expiresIn: remainingSeconds(concurrent.expires_at),
              resendAfter: challenge ? remainingSeconds(challenge.next_resend_at) : 0,
            };
            throw conflict;
          }
        } catch (retryErr) {
          if (!retryErr.statusCode) await this.authRepository.rollbackTransaction(retryClient);
          throw retryErr;
        }
      }
      throw err;
    }

    try {
      await this.emailService.sendRegistrationOtp(normalizedEmail, otp);
    } catch (err) {
      logger.error('EMAIL_OTP_SEND', 'Không thể gửi email OTP đăng ký.');
      const deliveryError = authError(503, 'EMAIL_DELIVERY_UNAVAILABLE', 'Chưa thể gửi email OTP. Vui lòng thử gửi lại sau.');
      deliveryError.details = {
        registrationId: registration.id,
        expiresIn: remainingSeconds(registration.expires_at),
        resendAfter: OTP_RESEND_COOLDOWN_SECONDS,
      };
      throw deliveryError;
    }

    return {
      registrationId: registration.id,
      expiresIn: OTP_TTL_SECONDS,
      resendAfter: OTP_RESEND_COOLDOWN_SECONDS,
    };
  }

  async verifyRegistration(registrationId, otp) {
    const client = await this.authRepository.beginTransaction();
    let closed = false;
    let failure = null;
    try {
      const registration = await this.authRepository.findRegistrationByIdForUpdate(registrationId, client);
      if (!registration) {
        throw authError(400, 'REGISTRATION_INVALID', 'Yêu cầu đăng ký không hợp lệ.');
      }
      if (registration.status === 'COMPLETED') {
        throw authError(409, 'REGISTRATION_COMPLETED', 'Yêu cầu đăng ký đã được hoàn tất.');
      }
      if (registration.status !== 'PENDING' || new Date(registration.expires_at).getTime() <= Date.now()) {
        if (registration.status === 'PENDING') {
          await this.authRepository.markRegistrationExpired(registration.id, client);
          await this.authRepository.commitTransaction(client);
          closed = true;
        }
        throw authError(410, 'REGISTRATION_EXPIRED', 'Yêu cầu đăng ký đã hết hạn.');
      }

      const challenge = await this.authRepository.findActiveOtpForUpdate(registration.id, client);
      if (!challenge) {
        throw authError(400, 'OTP_UNAVAILABLE', 'Mã OTP không còn khả dụng. Vui lòng yêu cầu mã mới.');
      }
      if (new Date(challenge.expires_at).getTime() <= Date.now()) {
        await this.authRepository.revokeActiveOtp(registration.id, client);
        await this.authRepository.commitTransaction(client);
        closed = true;
        throw authError(410, 'OTP_EXPIRED', 'Mã OTP đã hết hạn.');
      }

      if (!this.otpService.matches(challenge.id, otp, challenge.otp_hash)) {
        const updated = await this.authRepository.incrementOtpAttempts(challenge.id, challenge.max_attempts, client);
        failure = updated.status === 'LOCKED'
          ? authError(429, 'OTP_LOCKED', 'Bạn đã nhập sai OTP quá số lần cho phép.')
          : authError(400, 'INVALID_OTP', 'Mã OTP không chính xác.');
        await this.authRepository.commitTransaction(client);
        closed = true;
      } else {
        let user;
        try {
          user = await this.authRepository.createUser(
            registration.email,
            registration.password_hash,
            registration.full_name,
            registration.phone,
            client
          );
        } catch (err) {
          if (err.code === '23505') {
            throw authError(409, 'EMAIL_ALREADY_EXISTS', 'Email này đã được sử dụng.');
          }
          throw err;
        }
        await this.authRepository.completeRegistration(registration.id, challenge.id, user.id, client);
        await this.authRepository.commitTransaction(client);
        closed = true;
        return user;
      }
    } catch (err) {
      if (!closed) await this.authRepository.rollbackTransaction(client);
      throw err;
    }
    throw failure;
  }

  async resendRegistrationOtp(registrationId) {
    const now = Date.now();
    const challengeId = randomUUID();
    const otp = this.otpService.generateCode();
    let registration;
    const client = await this.authRepository.beginTransaction();
    let closed = false;
    try {
      registration = await this.authRepository.findRegistrationByIdForUpdate(registrationId, client);
      if (!registration || registration.status !== 'PENDING') {
        throw authError(400, 'REGISTRATION_INVALID', 'Yêu cầu đăng ký không còn khả dụng.');
      }
      if (new Date(registration.expires_at).getTime() <= now) {
        await this.authRepository.markRegistrationExpired(registration.id, client);
        await this.authRepository.commitTransaction(client);
        closed = true;
        throw authError(410, 'REGISTRATION_EXPIRED', 'Yêu cầu đăng ký đã hết hạn.');
      }

      const active = await this.authRepository.findActiveOtpForUpdate(registration.id, client);
      if (active && new Date(active.next_resend_at).getTime() > now) {
        const retryAfter = Math.ceil((new Date(active.next_resend_at).getTime() - now) / 1000);
        const err = authError(429, 'RESEND_COOLDOWN', `Vui lòng chờ ${retryAfter} giây trước khi gửi lại OTP.`);
        err.retryAfter = retryAfter;
        throw err;
      }

      const issuedCount = await this.authRepository.countRegistrationOtps(registration.id, client);
      if (issuedCount >= OTP_MAX_RESENDS + 1) {
        throw authError(429, 'RESEND_LIMIT_REACHED', 'Bạn đã đạt giới hạn gửi lại OTP.');
      }

      await this.authRepository.revokeActiveOtp(registration.id, client);
      await this.authRepository.createRegistrationOtp({
        id: challengeId,
        registrationId: registration.id,
        otpHash: this.otpService.hash(challengeId, otp),
        maxAttempts: OTP_MAX_ATTEMPTS,
        expiresAt: new Date(now + OTP_TTL_SECONDS * 1000),
        nextResendAt: new Date(now + OTP_RESEND_COOLDOWN_SECONDS * 1000),
      }, client);
      await this.authRepository.commitTransaction(client);
      closed = true;
    } catch (err) {
      if (!closed) await this.authRepository.rollbackTransaction(client);
      throw err;
    }

    try {
      await this.emailService.sendRegistrationOtp(registration.email, otp);
    } catch (err) {
      logger.error('EMAIL_OTP_RESEND', 'Không thể gửi lại email OTP đăng ký.');
      const deliveryError = authError(503, 'EMAIL_DELIVERY_UNAVAILABLE', 'Chưa thể gửi email OTP. Vui lòng thử lại sau.');
      deliveryError.details = {
        registrationId: registration.id,
        expiresIn: remainingSeconds(registration.expires_at),
        resendAfter: OTP_RESEND_COOLDOWN_SECONDS,
      };
      throw deliveryError;
    }

    return { expiresIn: OTP_TTL_SECONDS, resendAfter: OTP_RESEND_COOLDOWN_SECONDS };
  }

  async cancelRegistration(registrationId) {
    const client = await this.authRepository.beginTransaction();
    let closed = false;
    try {
      const registration = await this.authRepository.findRegistrationByIdForUpdate(registrationId, client);
      if (registration?.status === 'PENDING') {
        await this.authRepository.cancelRegistration(registrationId, client);
      }
      await this.authRepository.commitTransaction(client);
      closed = true;
      return { cancelled: true };
    } catch (err) {
      if (!closed) await this.authRepository.rollbackTransaction(client);
      throw err;
    }
  }

  async login(email, password) {
    // Tìm user theo email
    const normalizedEmail = normalizeEmail(email);
    const user = await authRepository.findUserByEmail(normalizedEmail);
    
    if (!user) {
      logger.auth('LOGIN', normalizedEmail, false, 'Email không tồn tại');
      throw new Error('Email hoặc mật khẩu không đúng.');
    }

    // So sánh password
    const isPasswordMatch = await bcrypt.compare(password, user.password);
    
    if (!isPasswordMatch) {
      logger.auth('LOGIN', normalizedEmail, false, 'Sai mật khẩu');
      throw new Error('Email hoặc mật khẩu không đúng.');
    }

    // Tạo JWT token
    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        fullName: user.full_name,
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    logger.auth('LOGIN', normalizedEmail, true, `Role: ${user.role} | Name: ${user.full_name}`);

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        fullName: user.full_name,
        phone: user.phone,
      },
      serverTime: new Date().toISOString(),
    };
  }

  async getProfile(userId) {
    const user = await authRepository.findUserById(userId);
    if (!user) {
      throw new Error('Không tìm thấy tài khoản.');
    }
    return user;
  }

  async updateProfile(userId, input) {
    const phone = String(input.phone ?? '').replace(/\s+/g, '');
    if (!phone) {
      throw new Error('Số điện thoại không được để trống.');
    }
    const user = await authRepository.updateUserPhone(userId, phone);
    if (!user) {
      throw new Error('Không tìm thấy tài khoản để cập nhật.');
    }
    return user;
  }

  async getBankProfile(userId) {
    const profile = await authRepository.getBankProfile(userId);
    if (!profile) throw new Error('Không tìm thấy tài khoản.');
    return profile;
  }

  async updateBank(userId, input) {
    const current = await this.getBankProfile(userId);
    const unchanged =
      current.bank_bin === input.bankBin &&
      current.bank_account_no === input.bankAccountNo &&
      current.bank_account_name === input.bankAccountName;

    if (current.bank_error && unchanged) {
      throw new Error(
        'Thông tin ngân hàng đang bị Admin báo sai. Vui lòng chỉnh sửa Ngân hàng, Số tài khoản hoặc Tên chủ tài khoản trước khi lưu.'
      );
    }

    await authRepository.updateBankAndClearErrors(userId, input);
    const rawAccNo = String(input.bankAccountNo || '');
    const maskedAccNo = rawAccNo.length > 4 ? `***${rawAccNo.slice(-4)}` : '****';
    logger.auth('UPDATE_BANK', current.email, true, `${input.bankShortName} - ${maskedAccNo}`);
    return this.getBankProfile(userId);
  }
}

module.exports = new AuthService();
module.exports.AuthService = AuthService;
module.exports.normalizeEmail = normalizeEmail;
