// Self-check: node test/payment-checkout.check.js (không cần DB / .env)
const assert = require('assert');
const {
  parsePayOSTransactionTime,
  extractLatestPaidAt,
  isPaidWithinDeadline,
  computeOrderTiming,
} = require('../src/utils/payos-time');
const { PaymentEventHub } = require('../src/utils/payment-events');
const {
  CheckoutResponseDTO,
  OrderPaymentResponseDTO,
  OrderStatusResponseDTO,
  OrderHistoryItemDTO,
} = require('../src/dto/order.dto');
const { apiResponseMiddleware } = require('../src/middlewares/api-response.middleware');

const sendThroughMiddleware = (dto, statusCode = 200) => {
  let sent;
  const res = { statusCode, json: (body) => { sent = body; } };
  apiResponseMiddleware({}, res, () => {});
  res.json(dto.toJSON());
  return sent;
};

// 1. parsePayOSTransactionTime với múi giờ Việt Nam (+07:00) & ISO
const vn119 = parsePayOSTransactionTime('2026-11-22 19:01:59');
assert.strictEqual(vn119.toISOString(), '2026-11-22T12:01:59.000Z');

const vnMs = parsePayOSTransactionTime('2026-11-22T19:02:00.500');
assert.strictEqual(vnMs.toISOString(), '2026-11-22T12:02:00.500Z');

const utcIso = parsePayOSTransactionTime('2026-11-22T12:01:59.000Z');
assert.strictEqual(utcIso.toISOString(), '2026-11-22T12:01:59.000Z');

const offsetIso = parsePayOSTransactionTime('2026-11-22T19:01:59+07:00');
assert.strictEqual(offsetIso.toISOString(), '2026-11-22T12:01:59.000Z');

const beforeNow = Date.now();
const fallbackNow = parsePayOSTransactionTime('not-a-date');
assert.ok(fallbackNow instanceof Date && fallbackNow.getTime() >= beforeNow - 100);

// 2. Quy tắc cắt cứng 120s: 119s & 120.000s hợp lệ; 120.001s & 121s bị chặn tuyệt đối
const expiresAt = '2026-11-22T12:02:00.000Z'; // 19:02:00 +07:00
assert.strictEqual(isPaidWithinDeadline('2026-11-22 19:01:59', expiresAt), true, 'Giây 119 phải hợp lệ');
assert.strictEqual(isPaidWithinDeadline('2026-11-22 19:02:00', expiresAt), true, 'Đúng 120.000s hợp lệ');
assert.strictEqual(isPaidWithinDeadline('2026-11-22T12:02:00.001Z', expiresAt), false, 'Quá 1ms phải bị chặn');
assert.strictEqual(isPaidWithinDeadline('2026-11-22 19:02:01', expiresAt), false, 'Giây 121 phải bị chặn');

// 3. extractLatestPaidAt lấy giao dịch muộn nhất hợp lệ
assert.strictEqual(extractLatestPaidAt([]), null);
assert.strictEqual(extractLatestPaidAt(null), null);
const latestPaid = extractLatestPaidAt([
  { transactionDateTime: '2026-11-22 19:01:10' },
  { transactionDateTime: 'invalid-ts' },
  { transactionDateTime: '2026-11-22 19:01:59' },
]);
assert.strictEqual(latestPaid.toISOString(), '2026-11-22T12:01:59.000Z');

// 4. computeOrderTiming: WAITING (0..120s), CONFIRMING (120..150s), FINAL
const tWait119 = computeOrderTiming(expiresAt, 'PAYMENT_PROCESSING', new Date('2026-11-22T12:01:59.999Z'));
assert.strictEqual(tWait119.phase, 'WAITING');
assert.strictEqual(tWait119.confirmUntil, '2026-11-22T12:02:30.000Z');
assert.strictEqual(tWait119.isPastExpiresAt, false);
assert.strictEqual(tWait119.isPastConfirmUntil, false);

const tConfirm120 = computeOrderTiming(expiresAt, 'PAYMENT_PROCESSING', new Date('2026-11-22T12:02:00.000Z'));
assert.strictEqual(tConfirm120.phase, 'CONFIRMING');
assert.strictEqual(tConfirm120.isPastExpiresAt, true);
assert.strictEqual(tConfirm120.isPastConfirmUntil, false);

const tConfirm149 = computeOrderTiming(expiresAt, 'PAYMENT_PROCESSING', new Date('2026-11-22T12:02:29.999Z'));
assert.strictEqual(tConfirm149.phase, 'CONFIRMING');
assert.strictEqual(tConfirm149.isPastConfirmUntil, false);

const tPast150 = computeOrderTiming(expiresAt, 'PAYMENT_PROCESSING', new Date('2026-11-22T12:02:30.000Z'));
assert.strictEqual(tPast150.isPastConfirmUntil, true);

for (const terminal of ['SUCCESS', 'EXPIRED', 'CANCELLED', 'REFUND_PENDING', 'REFUNDED']) {
  assert.strictEqual(
    computeOrderTiming(expiresAt, terminal, new Date('2026-11-22T12:01:00.000Z')).phase,
    'FINAL',
  );
}

// 5. PaymentEventHub SSE lifecycle & giới hạn kết nối/đơn
const createMockRes = () => {
  const chunks = [];
  const res = {
    chunks,
    writableEnded: false,
    destroyed: false,
    write(chunk) {
      chunks.push(chunk);
    },
    end() {
      res.writableEnded = true;
    },
  };
  return res;
};

const hub = new PaymentEventHub({ heartbeatIntervalMs: 60000, maxDurationMs: 60000, maxConnectionsPerOrder: 5 });

// 5a. Đơn đã kết thúc -> gửi INIT xong đóng stream ngay
const terminalRes = createMockRes();
hub.subscribe(100000001, terminalRes, { type: 'INIT', orderCode: 100000001, status: 'SUCCESS', phase: 'FINAL' });
assert.strictEqual(terminalRes.writableEnded, true);
assert.strictEqual(hub.getSubscriberCount(100000001), 0);
assert.ok(terminalRes.chunks[0].startsWith('event: init\ndata: '));

// 5b. Đơn đang PAYMENT_PROCESSING -> nhận order_status và tự đóng khi kết thúc
const liveRes = createMockRes();
hub.subscribe(100000002, liveRes, { type: 'INIT', orderCode: 100000002, status: 'PAYMENT_PROCESSING', phase: 'WAITING' });
assert.strictEqual(liveRes.writableEnded, false);
assert.strictEqual(hub.getSubscriberCount(100000002), 1);

const delivered = hub.emitOrderUpdate(100000002, {
  type: 'STATUS_CHANGED',
  orderCode: 100000002,
  status: 'SUCCESS',
  phase: 'FINAL',
});
assert.strictEqual(delivered, 1);
assert.strictEqual(liveRes.writableEnded, true);
assert.strictEqual(hub.getSubscriberCount(100000002), 0);
assert.ok(liveRes.chunks[1].startsWith('event: order_status\ndata: '));

// 5c. Tối đa 5 kết nối/đơn -> kết nối thứ 6 đẩy kết nối cũ nhất ra
const poolRes = [];
for (let i = 0; i < 6; i += 1) {
  const r = createMockRes();
  poolRes.push(r);
  hub.subscribe(100000003, r, { type: 'INIT', orderCode: 100000003, status: 'PAYMENT_PROCESSING', phase: 'WAITING' });
}
assert.strictEqual(poolRes[0].writableEnded, true, 'Kết nối cũ nhất phải bị đóng');
assert.strictEqual(poolRes[5].writableEnded, false, 'Kết nối mới nhất vẫn mở');
assert.strictEqual(hub.getSubscriberCount(100000003), 5);
hub.emitOrderUpdate(100000003, { type: 'STATUS_CHANGED', orderCode: 100000003, status: 'CANCELLED', phase: 'FINAL' });

// 6. Kiểm tra DTO & Envelope
const samplePaymentInfo = {
  paymentLinkId: 'pl_123',
  bin: '970422',
  accountNumber: 'VQRQ12345',
  accountName: 'NGUYEN VAN A',
  amount: 500000,
  description: 'VE SU KIEN 100000042',
  qrCode: '000201010212...',
  currency: 'VND',
};

const checkoutWire = sendThroughMiddleware(new CheckoutResponseDTO({
  orderCode: 100000042,
  totalAmount: 500000,
  expiresAt,
  confirmUntil: '2026-11-22T12:02:30.000Z',
  paymentTimeout: expiresAt,
  expiredAt: 1795348920,
  serverTime: '2026-11-22T12:00:00.000Z',
  paymentInfo: samplePaymentInfo,
}));
assert.strictEqual(checkoutWire.success, true);
assert.strictEqual(checkoutWire.data.orderCode, 100000042);
assert.strictEqual(checkoutWire.data.paymentInfo.qrCode, '000201010212...');
assert.strictEqual(checkoutWire.data.confirmUntil, '2026-11-22T12:02:30.000Z');

const baseOrderRow = {
  order_code: '100000042',
  total_amount: '500000',
  order_status: 'PAYMENT_PROCESSING',
  expires_at: expiresAt,
  created_at: '2026-11-22T12:00:00.000Z',
  payment_info: samplePaymentInfo,
  event_id: 'ev-1',
  event_title: 'Concert 2026',
  event_type: 'SEAT_BASED',
  event_start_time: '2026-12-01T12:30:00.000Z',
  location: 'TP.HCM',
  items: [{ seat_id: 's1', seat_number: 'A1', zone_name: 'VIP', price: '500000' }],
};

const payWaitWire = sendThroughMiddleware(
  new OrderPaymentResponseDTO(baseOrderRow, new Date('2026-11-22T12:01:00.000Z')),
);
assert.strictEqual(payWaitWire.data.phase, 'WAITING');
assert.strictEqual(payWaitWire.data.paymentInfo.qrCode, '000201010212...');
assert.strictEqual(payWaitWire.data.eventStartTime, '2026-12-01T12:30:00.000Z');

const payConfirmWire = sendThroughMiddleware(
  new OrderPaymentResponseDTO(baseOrderRow, new Date('2026-11-22T12:02:10.000Z')),
);
assert.strictEqual(payConfirmWire.data.phase, 'CONFIRMING');

const paySuccessWire = sendThroughMiddleware(
  new OrderPaymentResponseDTO(
    { ...baseOrderRow, order_status: 'SUCCESS' },
    new Date('2026-11-22T12:02:10.000Z'),
  ),
);
assert.strictEqual(paySuccessWire.data.phase, 'FINAL');
assert.strictEqual(paySuccessWire.data.paymentInfo, null, 'Đơn kết thúc không được trả paymentInfo');

const statusWire = sendThroughMiddleware(
  new OrderStatusResponseDTO(baseOrderRow, new Date('2026-11-22T12:02:05.000Z')),
);
assert.strictEqual(statusWire.data.phase, 'CONFIRMING');
assert.strictEqual(statusWire.data.confirmUntil, '2026-11-22T12:02:30.000Z');

const historyItem = new OrderHistoryItemDTO(baseOrderRow, new Date('2026-11-22T12:02:05.000Z')).toJSON();
assert.strictEqual(historyItem.phase, 'CONFIRMING');
assert.strictEqual(historyItem.confirmUntil, '2026-11-22T12:02:30.000Z');
assert.strictEqual(historyItem.eventStartTime, '2026-12-01T12:30:00.000Z');

console.log('payment-checkout.check OK');
