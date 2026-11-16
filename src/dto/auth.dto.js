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

// Chuẩn hoá tên chủ TK: CHỮ IN HOA KHÔNG DẤU, chỉ A-Z và khoảng trắng (giống tên trên App Ngân hàng)
const toBankAccountName = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'D')
    .toUpperCase()
    .replace(/[^A-Z ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

class UpdateBankRequestDTO {
  constructor(body = {}) {
    this.bankBin = String(body.bankBin ?? '').trim();
    this.bankShortName = String(body.bankShortName ?? '').trim();
    this.bankName = String(body.bankName ?? '').trim();
    this.bankLogo = String(body.bankLogo ?? '').trim();
    this.bankAccountNo = String(body.bankAccountNo ?? '').replace(/\s+/g, '');
    this.bankAccountName = toBankAccountName(body.bankAccountName);
  }

  validate() {
    const errors = [];
    // ponytail: không gọi lại VietQR để xác minh BIN ở server; nâng cấp = cache danh sách /v2/banks rồi đối chiếu.
    if (!/^\d{6}$/.test(this.bankBin) || !this.bankShortName) {
      errors.push('Vui lòng chọn ngân hàng từ danh sách.');
    }
    if (this.bankShortName.length > 100 || this.bankName.length > 255) {
      errors.push('Tên ngân hàng quá dài.');
    }
    if (this.bankLogo && (!/^https:\/\//.test(this.bankLogo) || this.bankLogo.length > 500)) {
      errors.push('Logo ngân hàng không hợp lệ.');
    }
    if (!/^[A-Za-z0-9]{6,25}$/.test(this.bankAccountNo)) {
      errors.push('Số tài khoản chỉ gồm chữ và số, dài 6–25 ký tự.');
    }
    if (this.bankAccountName.length < 2 || this.bankAccountName.length > 100) {
      errors.push('Tên chủ tài khoản phải dài 2–100 ký tự (in hoa không dấu).');
    }
    return { isValid: errors.length === 0, errors };
  }

  toServiceInput() {
    return {
      bankBin: this.bankBin,
      bankShortName: this.bankShortName,
      bankName: this.bankName,
      bankLogo: this.bankLogo || null,
      bankAccountNo: this.bankAccountNo,
      bankAccountName: this.bankAccountName,
    };
  }
}

// ============ RESPONSE DTOs ============

class BankProfileDTO {
  constructor(row) {
    this.fullName = row.full_name;
    this.email = row.email;
    this.bank = row.bank_account_no
      ? {
          bankBin: row.bank_bin,
          bankShortName: row.bank_short_name,
          bankName: row.bank_name,
          bankLogo: row.bank_logo,
          bankAccountNo: row.bank_account_no,
          bankAccountName: row.bank_account_name,
        }
      : null;
    this.bankError = row.bank_error || null;
  }

  toJSON() {
    return { fullName: this.fullName, email: this.email, bank: this.bank, bankError: this.bankError };
  }
}

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
    this.data = {
      token,
      user: new UserResponseDTO(user).toJSON()
    };
  }

  toJSON() {
    return {
      success: this.success,
      message: this.message,
      data: this.data
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
  UpdateBankRequestDTO,
  toBankAccountName,
  // Response DTOs
  BankProfileDTO,
  RegisterResponseDTO,
  LoginResponseDTO,
  UserResponseDTO,
  ErrorResponseDTO
};
