// ============ REQUEST DTOs ============

class CreateEventRequestDTO {
  constructor(body) {
    this.title = body.title;
    this.description = body.description;
    this.location = body.location;
    this.start_time = body.start_time;
    this.event_type = body.event_type;
    this.seatConfig = body.seatConfig;
    this.zoneConfigs = body.zoneConfigs;
  }

  validate() {
    const errors = [];

    if (!this.title) {
      errors.push('title là bắt buộc.');
    }

    if (!this.location) {
      errors.push('location là bắt buộc.');
    }

    if (!this.event_type) {
      errors.push('event_type là bắt buộc.');
    } else if (!['SEAT_BASED', 'ZONE_BASED'].includes(this.event_type)) {
      errors.push('event_type phải là SEAT_BASED hoặc ZONE_BASED.');
    }

    // Validate based on event type
    if (this.event_type === 'SEAT_BASED') {
      if (!this.seatConfig) {
        errors.push('seatConfig là bắt buộc cho SEAT_BASED event.');
      } else {
        if (!this.seatConfig.totalSeats || this.seatConfig.totalSeats <= 0) {
          errors.push('seatConfig.totalSeats phải lớn hơn 0.');
        }
        if (this.seatConfig.price === undefined || this.seatConfig.price < 0) {
          errors.push('seatConfig.price phải >= 0.');
        }
      }
    }

    if (this.event_type === 'ZONE_BASED') {
      if (!this.zoneConfigs || !Array.isArray(this.zoneConfigs) || this.zoneConfigs.length === 0) {
        errors.push('zoneConfigs là bắt buộc cho ZONE_BASED event.');
      } else {
        this.zoneConfigs.forEach((zone, index) => {
          if (!zone.zoneName) {
            errors.push(`zoneConfigs[${index}].zoneName là bắt buộc.`);
          }
          if (!zone.count || zone.count <= 0) {
            errors.push(`zoneConfigs[${index}].count phải lớn hơn 0.`);
          }
          if (zone.price === undefined || zone.price < 0) {
            errors.push(`zoneConfigs[${index}].price phải >= 0.`);
          }
        });
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  toServiceInput() {
    return {
      title: this.title,
      description: this.description,
      location: this.location,
      start_time: this.start_time,
      event_type: this.event_type,
      seatConfig: this.seatConfig,
      zoneConfigs: this.zoneConfigs
    };
  }
}

// ============ RESPONSE DTOs ============

class CreateEventResponseDTO {
  constructor(event) {
    this.success = true;
    this.message = 'Tạo sự kiện và cấu hình ghế thành công!';
    this.data = {
      id: event.id,
      title: event.title,
      description: event.description,
      location: event.location,
      startTime: event.start_time,
      eventType: event.event_type,
      createdAt: event.created_at
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

class DeleteEventResponseDTO {
  constructor() {
    this.success = true;
    this.message = 'Đã xóa sự kiện thành công.';
  }

  toJSON() {
    return {
      success: this.success,
      message: this.message
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
  CreateEventRequestDTO,
  // Response DTOs
  CreateEventResponseDTO,
  DeleteEventResponseDTO,
  ErrorResponseDTO
};
