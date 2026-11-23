const authService = require('../services/auth.service');
const logger = require('../utils/logger');
const {
  RegisterRequestDTO,
  VerifyRegistrationRequestDTO,
  ResendRegistrationOtpRequestDTO,
  CancelRegistrationRequestDTO,
  LoginRequestDTO,
  UpdateProfileRequestDTO,
  UpdateBankRequestDTO,
  BankProfileDTO,
  UserResponseDTO,
  RegisterResponseDTO,
  LoginResponseDTO,
  ErrorResponseDTO
} = require('../dto/auth.dto');

exports.register = async (req, res) => {
  try {
    // Request DTO: Validate input
    const requestDto = new RegisterRequestDTO(req.body);
    const validation = requestDto.validate();

    if (!validation.isValid) {
      const errorDto = new ErrorResponseDTO(validation.errors.join(' '));
      return res.status(400).json(errorDto.toJSON());
    }

    // Call service
    const { email, password, fullName, phone } = requestDto.toServiceInput();
    const result = await authService.register(email, password, fullName, phone);

    // Response DTO: Format output
    const responseDto = new RegisterResponseDTO(result);
    return res.status(202).json(responseDto.toJSON());
  } catch (err) {
    logger.error('AUTH_REGISTER', err.message, err);
    const errorDto = new ErrorResponseDTO(err.message, err.code, err.details);
    return res.status(err.statusCode || 400).json(errorDto.toJSON());
  }
};

exports.verifyRegistration = async (req, res) => {
  try {
    const requestDto = new VerifyRegistrationRequestDTO(req.body);
    const validation = requestDto.validate();
    if (!validation.isValid) {
      return res.status(400).json(new ErrorResponseDTO(validation.errors.join(' '), 'VALIDATION_ERROR').toJSON());
    }
    const { registrationId, otp } = requestDto.toServiceInput();
    const user = await authService.verifyRegistration(registrationId, otp);
    return res.status(201).json({
      success: true,
      message: 'Đăng ký tài khoản thành công!',
      data: new UserResponseDTO(user).toJSON(),
    });
  } catch (err) {
    logger.error('AUTH_REGISTER_VERIFY', err.message, err);
    return res.status(err.statusCode || 400).json(new ErrorResponseDTO(err.message, err.code, err.details).toJSON());
  }
};

exports.resendRegistrationOtp = async (req, res) => {
  try {
    const requestDto = new ResendRegistrationOtpRequestDTO(req.body);
    const validation = requestDto.validate();
    if (!validation.isValid) {
      return res.status(400).json(new ErrorResponseDTO(validation.errors.join(' '), 'VALIDATION_ERROR').toJSON());
    }
    const result = await authService.resendRegistrationOtp(requestDto.toServiceInput().registrationId);
    return res.status(202).json({ success: true, message: 'Mã OTP mới đã được gửi.', data: result });
  } catch (err) {
    if (err.retryAfter) res.set('Retry-After', String(err.retryAfter));
    logger.error('AUTH_REGISTER_RESEND', err.message, err);
    return res.status(err.statusCode || 400).json(new ErrorResponseDTO(err.message, err.code, err.details).toJSON());
  }
};

exports.cancelRegistration = async (req, res) => {
  try {
    const requestDto = new CancelRegistrationRequestDTO(req.body);
    const validation = requestDto.validate();
    if (!validation.isValid) {
      return res.status(400).json(new ErrorResponseDTO(validation.errors.join(' '), 'VALIDATION_ERROR').toJSON());
    }
    const result = await authService.cancelRegistration(requestDto.toServiceInput().registrationId);
    return res.json({ success: true, message: 'Đã hủy yêu cầu đăng ký.', data: result });
  } catch (err) {
    logger.error('AUTH_REGISTER_CANCEL', err.message, err);
    return res.status(err.statusCode || 400).json(new ErrorResponseDTO(err.message, err.code).toJSON());
  }
};

exports.login = async (req, res) => {
  try {
    // Request DTO: Validate input
    const requestDto = new LoginRequestDTO(req.body);
    const validation = requestDto.validate();

    if (!validation.isValid) {
      const errorDto = new ErrorResponseDTO(validation.errors.join(' '));
      return res.status(400).json(errorDto.toJSON());
    }

    // Call service
    const { email, password } = requestDto.toServiceInput();
    const result = await authService.login(email, password);

    // Response DTO: Format output
    const responseDto = new LoginResponseDTO(result.token, result.user, result.serverTime);
    return res.json(responseDto.toJSON());
  } catch (err) {
    logger.error('AUTH_LOGIN', err.message, err);
    const errorDto = new ErrorResponseDTO(err.message);
    return res.status(400).json(errorDto.toJSON());
  }
};

exports.getMyProfile = async (req, res) => {
  try {
    const user = await authService.getProfile(req.user.id);
    return res.json({ success: true, data: new UserResponseDTO(user).toJSON() });
  } catch (err) {
    logger.error('AUTH_GET_PROFILE', err.message, err);
    return res.status(400).json(new ErrorResponseDTO(err.message).toJSON());
  }
};

exports.updateMyProfile = async (req, res) => {
  try {
    const requestDto = new UpdateProfileRequestDTO(req.body);
    const validation = requestDto.validate();
    if (!validation.isValid) {
      return res.status(400).json(new ErrorResponseDTO(validation.errors.join(' ')).toJSON());
    }

    const updatedUser = await authService.updateProfile(req.user.id, requestDto.toServiceInput());
    return res.json({
      success: true,
      message: 'Đã cập nhật số điện thoại.',
      data: new UserResponseDTO(updatedUser).toJSON(),
    });
  } catch (err) {
    logger.error('AUTH_UPDATE_PROFILE', err.message, err);
    return res.status(400).json(new ErrorResponseDTO(err.message).toJSON());
  }
};

exports.getMyBank = async (req, res) => {
  try {
    const profile = await authService.getBankProfile(req.user.id);
    return res.json({ success: true, data: new BankProfileDTO(profile).toJSON() });
  } catch (err) {
    logger.error('AUTH_GET_BANK', err.message, err);
    return res.status(400).json(new ErrorResponseDTO(err.message).toJSON());
  }
};

exports.updateMyBank = async (req, res) => {
  try {
    const requestDto = new UpdateBankRequestDTO(req.body);
    const validation = requestDto.validate();
    if (!validation.isValid) {
      return res.status(400).json(new ErrorResponseDTO(validation.errors.join(' ')).toJSON());
    }
    const profile = await authService.updateBank(req.user.id, requestDto.toServiceInput());
    return res.json({
      success: true,
      message: 'Đã lưu thông tin ngân hàng.',
      data: new BankProfileDTO(profile).toJSON(),
    });
  } catch (err) {
    logger.error('AUTH_UPDATE_BANK', err.message, err);
    return res.status(400).json(new ErrorResponseDTO(err.message).toJSON());
  }
};
