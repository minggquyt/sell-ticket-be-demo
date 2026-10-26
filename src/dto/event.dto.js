// ============ RESPONSE DTOs ============

class EventResponseDTO {
  constructor(event) {
    this.id = event.id;
    this.title = event.title;
    this.description = event.description;
    this.location = event.location;
    this.start_time = event.start_time;
    this.event_type = event.event_type;
    this.created_at = event.created_at;
    this.thumbnails = event.thumbnails;
    this.category = event.category;
    this.time = event.time;
    this.min_price = event.min_price;
    this.max_price = event.max_price;
    this.image = event.image;
    this.banner = event.banner;
    this.organizer = event.organizer;
    this.highlights = event.highlights;
    this.rules = event.rules;
  }

  toJSON() {
    return {
      id: this.id,
      title: this.title,
      description: this.description,
      location: this.location,
      start_time: this.start_time,
      event_type: this.event_type,
      created_at: this.created_at,
      thumbnails: this.thumbnails,
      category: this.category,
      time: this.time,
      min_price: this.min_price,
      max_price: this.max_price,
      image: this.image,
      banner: this.banner,
      organizer: this.organizer,
      highlights: this.highlights,
      rules: this.rules
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
    this.event_id = seat.event_id;
    this.seat_number = seat.seat_number;
    this.zone_name = seat.zone_name;
    this.price = seat.price;
    this.status = seat.status;
    this.reserved_by = seat.reserved_by;
    this.reserved_until = seat.reserved_until;
    this.current_order_code = seat.current_order_code ? Number(seat.current_order_code) : null;
  }

  toJSON() {
    return {
      id: this.id,
      event_id: this.event_id,
      seat_number: this.seat_number,
      zone_name: this.zone_name,
      price: this.price,
      status: this.status,
      reserved_by: this.reserved_by,
      reserved_until: this.reserved_until,
      current_order_code: this.current_order_code
    };
  }
}

class ZoneDetailDTO {
  constructor(zone) {
    this.zone_name = zone.zone_name;
    this.price = zone.price;
    this.available_count = zone.available_count;
    this.total_count = zone.total_count;
  }

  toJSON() {
    return {
      zone_name: this.zone_name,
      price: this.price,
      available_count: this.available_count,
      total_count: this.total_count
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
