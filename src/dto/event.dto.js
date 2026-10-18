// ============ RESPONSE DTOs ============

class EventResponseDTO {
  constructor(event) {
    this.id = event.id;
    this.title = event.title;
    this.description = event.description;
    this.location = event.location;
    this.startTime = event.start_time;
    this.eventType = event.event_type;
    this.createdAt = event.created_at;
  }

  toJSON() {
    return {
      id: this.id,
      title: this.title,
      description: this.description,
      location: this.location,
      startTime: this.startTime,
      eventType: this.eventType,
      createdAt: this.createdAt
    };
  }
}

class EventListResponseDTO {
  constructor(events) {
    this.success = true;
    this.data = events.map(event => new EventResponseDTO(event).toJSON());
  }

  toJSON() {
    return {
      success: this.success,
      data: this.data
    };
  }
}

class SeatDetailDTO {
  constructor(seat) {
    this.id = seat.id;
    this.eventId = seat.event_id;
    this.seatNumber = seat.seat_number;
    this.zoneName = seat.zone_name;
    this.price = seat.price;
    this.status = seat.status;
    this.reservedBy = seat.reserved_by;
    this.reservedUntil = seat.reserved_until;
    this.currentOrderId = seat.current_order_id;
  }

  toJSON() {
    return {
      id: this.id,
      eventId: this.eventId,
      seatNumber: this.seatNumber,
      zoneName: this.zoneName,
      price: this.price,
      status: this.status,
      reservedBy: this.reservedBy,
      reservedUntil: this.reservedUntil,
      currentOrderId: this.currentOrderId
    };
  }
}

class ZoneDetailDTO {
  constructor(zone) {
    this.zoneName = zone.zone_name;
    this.price = zone.price;
    this.availableCount = zone.available_count;
    this.totalCount = zone.total_count;
  }

  toJSON() {
    return {
      zoneName: this.zoneName,
      price: this.price,
      availableCount: this.availableCount,
      totalCount: this.totalCount
    };
  }
}

class EventSeatsResponseDTO {
  constructor(seats) {
    this.success = true;
    this.data = seats.map(seat => new SeatDetailDTO(seat).toJSON());
  }

  toJSON() {
    return {
      success: this.success,
      data: this.data
    };
  }
}

class EventZonesResponseDTO {
  constructor(zones) {
    this.success = true;
    this.data = zones.map(zone => new ZoneDetailDTO(zone).toJSON());
  }

  toJSON() {
    return {
      success: this.success,
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
  // Response DTOs
  EventResponseDTO,
  EventListResponseDTO,
  SeatDetailDTO,
  ZoneDetailDTO,
  EventSeatsResponseDTO,
  EventZonesResponseDTO,
  ErrorResponseDTO
};
