const nodemailer = require('nodemailer');
const defaultConfig = require('../config/constants');
const { buildRegistrationOtpEmail } = require('../templates/register-otp.email');

class EmailService {
  constructor({ config = defaultConfig, transport = null } = {}) {
    this.config = config;
    this.transport = transport;
  }

  getGmailTransport() {
    const { GMAIL_USER, GMAIL_APP_PASSWORD } = this.config;
    if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
      throw new Error('Gmail chưa được cấu hình GMAIL_USER và GMAIL_APP_PASSWORD.');
    }

    if (!this.transport) {
      this.transport = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: GMAIL_USER,
          // Google hiển thị App Password theo nhóm 4 ký tự; chấp nhận cả giá trị có khoảng trắng.
          pass: String(GMAIL_APP_PASSWORD).replace(/\s+/g, ''),
        },
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 15_000,
      });
    }
    return this.transport;
  }

  async sendRegistrationOtp(email, otp) {
    const {
      EMAIL_PROVIDER,
      EMAIL_FROM,
      GMAIL_USER,
      OTP_TTL_SECONDS,
    } = this.config;
    const template = buildRegistrationOtpEmail({
      otp,
      expiresInMinutes: Math.ceil(OTP_TTL_SECONDS / 60),
    });

    if (EMAIL_PROVIDER === 'console') {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('Console email provider không được phép trong production.');
      }
      // Không ghi OTP ra application log. Test/local nên inject fake adapter nếu cần đọc mã.
      return { accepted: true, provider: 'console' };
    }

    if (EMAIL_PROVIDER !== 'gmail') {
      throw new Error(`Email provider không được hỗ trợ: ${EMAIL_PROVIDER || 'chưa cấu hình'}.`);
    }

    const from = EMAIL_FROM || GMAIL_USER;
    if (!from) {
      throw new Error('Gmail chưa được cấu hình địa chỉ người gửi.');
    }
    const info = await this.getGmailTransport().sendMail({
      from,
      to: email,
      subject: template.subject,
      text: template.text,
      html: template.html,
    });
    return { accepted: true, provider: 'gmail', messageId: info.messageId };
  }
}

module.exports = new EmailService();
module.exports.EmailService = EmailService;
