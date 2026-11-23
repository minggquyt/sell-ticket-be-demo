function buildRegistrationOtpEmail({ otp, expiresInMinutes }) {
  return {
    subject: 'Mã xác minh đăng ký tài khoản',
    text: `Mã OTP đăng ký của bạn là ${otp}. Mã có hiệu lực trong ${expiresInMinutes} phút. Nếu bạn không yêu cầu đăng ký, hãy bỏ qua email này.`,
    html: `<div style="font-family:Arial,sans-serif;line-height:1.6"><h2>Xác minh đăng ký</h2><p>Mã OTP của bạn:</p><p style="font-size:30px;font-weight:700;letter-spacing:8px">${otp}</p><p>Mã có hiệu lực trong ${expiresInMinutes} phút.</p><p>Nếu bạn không yêu cầu đăng ký, hãy bỏ qua email này.</p></div>`,
  };
}

module.exports = { buildRegistrationOtpEmail };
