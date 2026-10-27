// ============ REQUEST DTOs ============

class RequestSeatHoldDTO {
  constructor(body) {
    this.seatIds = body.seatIds;
  }

  validate() {
    const errors = [];

    if (!this.seatIds) {
      errors.push('seatIds là bắt buộc.');
    } else if (!Array.isArray(this.seatIds)) {
      errors.push('seatIds phải là mảng.');
    } else if (this.seatIds.length === 0) {
      errors.push('seatIds không được rỗng.');
    } else if (this.seatIds.length > 4) {
      errors.push('Bạn chỉ được chọn tối đa 4 ghế.');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  toServiceInput() {
    return {
      seatIds: this.seatIds
    };
  }
}

class ConfirmPartialHoldDTO {
  constructor(body) {
    this.confirmSeatIds = body.confirmSeatIds;
  }

  validate() {
    const errors = [];

    if (!this.confirmSeatIds) {
      errors.push('confirmSeatIds là bắt buộc.');
    } else if (!Array.isArray(this.confirmSeatIds)) {
      errors.push('confirmSeatIds phải là mảng.');
    } else if (this.confirmSeatIds.length === 0) {
      errors.push('confirmSeatIds không được rỗng.');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  toServiceInput() {
    return {
      confirmSeatIds: this.confirmSeatIds
    };
  }
}

class ReserveZoneDTO {
  constructor(body) {
    this.eventId = body.eventId;
    this.zones = Array.isArray(body.zones)
      ? body.zones.map(z => ({
          ...z,
          zone_name: z.zone_name || z.zoneName
        }))
      : body.zones;
  }

  validate() {
    const errors = [];

    if (!this.eventId) {
      errors.push('eventId là bắt buộc.');
    }

    if (!this.zones) {
      errors.push('zones là bắt buộc.');
    } else if (!Array.isArray(this.zones)) {
      errors.push('zones phải là mảng.');
    } else if (this.zones.length === 0) {
      errors.push('zones không được rỗng.');
    } else {
      // Validate each zone
      this.zones.forEach((zone, index) => {
        if (!zone.zone_name) {
          errors.push(`zones[${index}].zone_name là bắt buộc.`);
        }
        if (!zone.quantity || zone.quantity <= 0) {
          errors.push(`zones[${index}].quantity phải lớn hơn 0.`);
        }
      });

      // Check total quantity
      const totalQuantity = this.zones.reduce((sum, z) => sum + (Number(z.quantity) || 0), 0);
      if (totalQuantity > 4) {
        errors.push('Tổng số vé không được vượt quá 4.');
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  toServiceInput() {
    return {
      eventId: this.eventId,
      zones: this.zones
    };
  }
}

class ReleaseSeatDTO {
  constructor(body) {
    this.seatIds = body.seatIds;
    this.orderCode = body.orderCode;
  }

  validate() {
    const errors = [];

    if (!this.seatIds && !this.orderCode) {
      errors.push('Cần cung cấp seatIds hoặc orderCode để hủy giữ chỗ.');
    } else if (this.seatIds && !Array.isArray(this.seatIds)) {
      errors.push('seatIds phải là mảng.');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  toServiceInput() {
    return {
      seatIds: Array.isArray(this.seatIds) ? this.seatIds : [],
      orderCode: this.orderCode || null
    };
  }
}

// ============ RESPONSE DTOs ============

class SeatResponseDTO {
  constructor(seat) {
    this.id = seat.id;
    this.seat_number = seat.seat_number;
    this.status = seat.status;
    this.reserved_until = seat.reserved_until;
    this.zone_name = seat.zone_name;
    this.price = seat.price;
  }

  toJSON() {
    return {
      id: this.id,
      seat_number: this.seat_number,
      status: this.status,
      reserved_until: this.reserved_until,
      zone_name: this.zone_name,
      price: this.price
    };
  }
}

class SeatHoldSuccessResponseDTO {
  constructor(result) {
    this.success = true;
    this.code = result.code || 'FULLY_RESERVED';
    this.message = 'Đã giữ chỗ thành công.';
    this.data = {
      seatIds: result.reservedSeats.map(s => s.id),
      reserved_until: result.reservedUntil,
      seats: result.reservedSeats.map(s => new SeatResponseDTO(s).toJSON())
    };
  }

  toJSON() {
    return {
      success: this.success,
      code: this.code,
      message: this.message,
      data: this.data
    };
  }
}

class PartialAvailabilityResponseDTO {
  constructor(result) {
    this.success = false;
    this.code = 'PARTIAL_AVAILABILITY';
    this.message = result.message || 'Một số ghế bạn chọn vừa có người khác giữ.';
    this.unavailableSeats = result.unavailableSeats;
    this.availableSeats = result.availableSeats;
    this.availableSeatIds = result.availableSeatIds;
  }

  toJSON() {
    return {
      success: this.success,
      code: this.code,
      message: this.message,
      unavailableSeats: this.unavailableSeats,
      availableSeats: this.availableSeats,
      availableSeatIds: this.availableSeatIds
    };
  }
}

class SeatHoldErrorResponseDTO {
  constructor(code, message) {
    this.success = false;
    this.code = code;
    this.message = message;
  }

  toJSON() {
    return {
      success: this.success,
      code: this.code,
      message: this.message
    };
  }
}

class ZoneReserveSuccessResponseDTO {
  constructor(result, totalRequested) {
    this.success = true;
    this.message = `Đã giữ thành công tổng cộng ${totalRequested} vé!`;
    this.data = {
      seats: result.seats.map(s => new SeatResponseDTO(s).toJSON()),
      seatIds: result.seatIds,
      reserved_until: result.reserved_until,
      totalTickets: result.totalTickets
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

class ReleaseSeatsResponseDTO {
  constructor(released) {
    this.success = true;
    this.message = 'Đã hủy giữ chỗ thành công.';
    this.data = released.map(seat => ({
      id: seat.id,
      seat_number: seat.seat_number,
      current_order_code: seat.current_order_code ? Number(seat.current_order_code) : null
    }));
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
  RequestSeatHoldDTO,
  ConfirmPartialHoldDTO,
  ReserveZoneDTO,
  ReleaseSeatDTO,
  // Response DTOs
  SeatHoldSuccessResponseDTO,
  PartialAvailabilityResponseDTO,
  SeatHoldErrorResponseDTO,
  ZoneReserveSuccessResponseDTO,
  ReleaseSeatsResponseDTO,
  SeatResponseDTO,
  ErrorResponseDTO
};
