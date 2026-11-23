const assert = require('assert');
const { buildRegistrationOtpEmail } = require('../src/templates/register-otp.email');
const { EmailService } = require('../src/services/email.service');
const message = buildRegistrationOtpEmail({ otp: '048291', expiresInMinutes: 5 });
assert.ok(message.subject);
assert.ok(message.text.includes('048291'));
assert.ok(message.html.includes('048291'));
assert.ok(message.text.includes('5'));

(async () => {
  const sent = [];
  const fakeTransport = {
    async sendMail(payload) {
      sent.push(payload);
      return { messageId: 'gmail-message-1' };
    },
  };
  const service = new EmailService({
    config: {
      EMAIL_PROVIDER: 'gmail',
      EMAIL_FROM: 'Ticket App <sender@gmail.com>',
      GMAIL_USER: 'sender@gmail.com',
      GMAIL_APP_PASSWORD: 'abcd efgh ijkl mnop',
      OTP_TTL_SECONDS: 300,
    },
    transport: fakeTransport,
  });

  const result = await service.sendRegistrationOtp('receiver@example.com', '048291');
  assert.strictEqual(result.accepted, true);
  assert.strictEqual(result.provider, 'gmail');
  assert.strictEqual(result.messageId, 'gmail-message-1');
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].from, 'Ticket App <sender@gmail.com>');
  assert.strictEqual(sent[0].to, 'receiver@example.com');
  assert.ok(sent[0].text.includes('048291'));
  assert.ok(sent[0].html.includes('048291'));

  const missingCredentials = new EmailService({
    config: {
      EMAIL_PROVIDER: 'gmail', EMAIL_FROM: '', GMAIL_USER: '', GMAIL_APP_PASSWORD: '',
      OTP_TTL_SECONDS: 300,
    },
  });
  await assert.rejects(
    () => missingCredentials.sendRegistrationOtp('receiver@example.com', '048291'),
    /Gmail chưa được cấu hình/
  );

  console.log('email-service.check OK');
})().catch((err) => { console.error(err); process.exit(1); });
