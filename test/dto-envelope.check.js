// Self-check: node test/dto-envelope.check.js (không cần DB / .env)
const assert = require('assert');
const { LoginResponseDTO, RegisterResponseDTO } = require('../src/dto/auth.dto');
const {
  SeatHoldSuccessResponseDTO,
  PartialAvailabilityResponseDTO,
  SeatHoldErrorResponseDTO,
} = require('../src/dto/seat.dto');
const { CreateEventResponseDTO } = require('../src/dto/admin.dto');
const { apiResponseMiddleware } = require('../src/middlewares/api-response.middleware');

const sendThroughMiddleware = (dto, statusCode = 200) => {
  let sent;
  const res = { statusCode, json: (body) => { sent = body; } };
  apiResponseMiddleware({}, res, () => {});
  res.json(dto.toJSON());
  return sent;
};

// 1. LoginResponseDTO đặt token & user vào data ngay từ DTO
const loginRaw = new LoginResponseDTO('tok_123', {
  id: 'u-1', email: 'a@b.com', full_name: 'Nguyen A', role: 'ADMIN',
}).toJSON();
assert.strictEqual(loginRaw.token, undefined);
assert.strictEqual(loginRaw.user, undefined);
assert.strictEqual(loginRaw.data.token, 'tok_123');
assert.strictEqual(loginRaw.data.user.role, 'ADMIN');

const loginWire = sendThroughMiddleware(new LoginResponseDTO('tok_123', {
  id: 'u-1', email: 'a@b.com', full_name: 'Nguyen A', role: 'ADMIN',
}));
assert.deepStrictEqual(Object.keys(loginWire), ['success', 'statusCode', 'message', 'data']);
assert.strictEqual(loginWire.data.token, 'tok_123');
assert.strictEqual(loginWire.data.user.email, 'a@b.com');
assert.strictEqual(typeof loginWire.data.serverTime, 'string');
assert.ok(Number.isFinite(Date.parse(loginWire.data.serverTime)));

const explicitTime = '2026-11-23T14:00:00.000Z';
const loginWireWithTime = sendThroughMiddleware(
  new LoginResponseDTO(
    'tok_123',
    { id: 'u-1', email: 'a@b.com', full_name: 'Nguyen A', role: 'ADMIN' },
    explicitTime
  )
);
assert.strictEqual(loginWireWithTime.data.serverTime, explicitTime);

// 2. RegisterResponseDTO
const regWire = sendThroughMiddleware(new RegisterResponseDTO({
  registrationId: '550e8400-e29b-41d4-a716-446655440000', expiresIn: 300, resendAfter: 60,
}), 202);
assert.strictEqual(regWire.statusCode, 202);
assert.strictEqual(regWire.data.expiresIn, 300);

// 3. Seat DTOs đặt code/unavailableSeats vào data ngay từ DTO
const holdWire = sendThroughMiddleware(new SeatHoldSuccessResponseDTO({
  reservedUntil: '2026-11-16T10:00:00Z',
  reservedSeats: [{ id: 's1', seat_number: 'A1', status: 'RESERVED', reserved_until: '2026-11-16T10:00:00Z', zone_name: 'STANDARD', price: 2000 }],
}));
assert.strictEqual(holdWire.data.code, 'FULLY_RESERVED');
assert.deepStrictEqual(holdWire.data.seatIds, ['s1']);

const partialWire = sendThroughMiddleware(new PartialAvailabilityResponseDTO({
  message: 'Partial', unavailableSeats: ['A1'], availableSeats: [{ id: 's2' }], availableSeatIds: ['s2'],
}));
assert.strictEqual(partialWire.success, false);
assert.strictEqual(partialWire.data.code, 'PARTIAL_AVAILABILITY');
assert.deepStrictEqual(partialWire.data.availableSeatIds, ['s2']);

const holdErrWire = sendThroughMiddleware(new SeatHoldErrorResponseDTO('USER_HAS_ACTIVE_HOLD', 'Busy'), 400);
assert.strictEqual(holdErrWire.statusCode, 400);
assert.strictEqual(holdErrWire.data.code, 'USER_HAS_ACTIVE_HOLD');

// 4. CreateEventResponseDTO dùng EventResponseDTO đầy đủ field
const evWire = sendThroughMiddleware(new CreateEventResponseDTO({
  id: 'e1', title: 'Test', location: 'HN', event_type: 'SEAT_BASED',
  category_name: 'Âm nhạc', city_name: 'Hà Nội', min_price: '100000',
}));
assert.strictEqual(evWire.data.category, 'Âm nhạc');
assert.strictEqual(evWire.data.city, 'Hà Nội');
assert.strictEqual(evWire.data.min_price, '100000');

console.log('dto-envelope.check OK');
