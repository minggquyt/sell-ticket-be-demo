// ============ REQUEST DTOs ============

class RegisterRequestDTO {
  constructor(body) {
    this.email = body.email;
    this.password = body.password;
    this.fullName = body.fullName;
  }

  validate() {
    const errors = [];

    // Validate email
    if (!this.email) {
      errors.push('Email là bắt buộc.');
    } else {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(this.email)) {
        errors.push('Email không đúng định dạng.');
      }
    }

    // Validate password
    if (!this.password) {
      errors.push('Mật khẩu là bắt buộc.');
    } else if (this.password.length < 6) {
      errors.push('Mật khẩu phải có ít nhất 6 ký tự.');
    }

    // fullName is optional, set default if not provided
    if (!this.fullName && this.email) {
      this.fullName = this.email.split('@')[0];
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  toServiceInput() {
    return {
      email: this.email,
      password: this.password,
      fullName: this.fullName
    };
  }
}

class LoginRequestDTO {
  constructor(body) {
    this.email = body.email;
    this.password = body.password;
  }

  validate() {
    const errors = [];

    if (!this.email) {
      errors.push('Email là bắt buộc.');
    }

    if (!this.password) {
      errors.push('Mật khẩu là bắt buộc.');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  toServiceInput() {
    return {
      email: this.email,
      password: this.password
    };
  }
}

// ============ RESPONSE DTOs ============

class UserResponseDTO {
  constructor(user) {
    this.id = user.id;
    this.email = user.email;
    this.fullName = user.full_name || user.fullName;
    this.role = user.role;
  }

  toJSON() {
    return {
      id: this.id,
      email: this.email,
      fullName: this.fullName,
      role: this.role
    };
  }
}

class RegisterResponseDTO {
  constructor(user) {
    this.success = true;
    this.message = 'Đăng ký tài khoản thành công!';
    this.data = new UserResponseDTO(user).toJSON();
  }

  toJSON() {
    return {
      success: this.success,
      message: this.message,
      data: this.data
    };
  }
}

class LoginResponseDTO {
  constructor(token, user) {
    this.success = true;
    this.message = 'Đăng nhập thành công!';
    this.token = token;
    this.user = new UserResponseDTO(user).toJSON();
  }

  toJSON() {
    return {
      success: this.success,
      message: this.message,
      token: this.token,
      user: this.user
    };
  }
}

class ErrorResponseDTO {
  constructor(message) {
    this.success = false;
    this.message = message;
  }

  toJSON() {
    return {
      success: this.success,
      message: this.message
    };
  }
}

module.exports = {
  // Request DTOs
  RegisterRequestDTO,
  LoginRequestDTO,
  // Response DTOs
  RegisterResponseDTO,
  LoginResponseDTO,
  UserResponseDTO,
  ErrorResponseDTO
};
