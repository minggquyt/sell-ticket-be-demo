const authService = require('../services/auth.service');
const logger = require('../utils/logger');
const {
  RegisterRequestDTO,
  LoginRequestDTO,
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
    const user = await authService.register(email, password, fullName, phone); 
    
    // Response DTO: Format output
    const responseDto = new RegisterResponseDTO(user);
    return res.json(responseDto.toJSON());
  } catch (err) {
    logger.error('AUTH_REGISTER', err.message, err);
    const errorDto = new ErrorResponseDTO(err.message);
    return res.status(400).json(errorDto.toJSON());
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
    const responseDto = new LoginResponseDTO(result.token, result.user);
    return res.json(responseDto.toJSON());
  } catch (err) {
    logger.error('AUTH_LOGIN', err.message, err);
    const errorDto = new ErrorResponseDTO(err.message);
    return res.status(400).json(errorDto.toJSON());
  }
};
