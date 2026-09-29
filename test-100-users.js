const BASE_URL = 'http://localhost:3000/api';
const TOTAL_USERS = 100;

// Helper: Tính toán thống kê hiệu năng (Min, Max, Avg) từ mảng độ trễ (ms)
function computeLatencyStats(durations) {
  if (!durations || durations.length === 0) return { avg: 0, min: 0, max: 0 };
  const sum = durations.reduce((acc, d) => acc + d, 0);
  const avg = Math.round(sum / durations.length);
  const min = Math.min(...durations);
  const max = Math.max(...durations);
  return { avg, min, max };
}

// Helper: Đăng ký & Đăng nhập tạo User có kiểm tra lỗi và batching
async function prepareUsers(count) {
  console.log(`⏳ Đang khởi tạo và đăng nhập ${count} tài khoản test...`);
  const users = [];
  const BATCH_SIZE = 10;

  for (let i = 1; i <= count; i += BATCH_SIZE) {
    const batchPromises = [];

    for (let j = i; j < i + BATCH_SIZE && j <= count; j++) {
      const email = `loadtest_user_${Date.now()}_${j}_${Math.random().toString(36).substring(7)}@test.com`;
      const password = 'password123';
      const fullName = `Load Tester ${j}`;

      const task = (async () => {
        // 1. Đăng ký
        const regRes = await fetch(`${BASE_URL}/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, fullName })
        });
        const regData = await regRes.json();
        if (!regRes.ok || !regData.success) {
          throw new Error(`Đăng ký thất bại cho ${email}: ${regData.message || regRes.statusText}`);
        }

        // 2. Đăng nhập lấy Token
        const loginRes = await fetch(`${BASE_URL}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });
        const loginData = await loginRes.json();
        if (!loginRes.ok || !loginData.success || !loginData.user) {
          throw new Error(`Đăng nhập thất bại cho ${email}: ${loginData.message || loginRes.statusText}`);
        }

        return { id: loginData.user.id, token: loginData.token, name: fullName, email };
      })();

      batchPromises.push(task);
    }

    const batchResults = await Promise.all(batchPromises);
    users.push(...batchResults);
    process.stdout.write(`\r-> Đã chuẩn bị: ${users.length}/${count} users`);
  }

  console.log(`\n✅ Đã chuẩn bị xong ${users.length} Users thành công.\n`);
  return users;
}

// Helper: Luồng thanh toán trọn gói có đo thời gian thực thi (start-checkout -> webhook)
async function processFullPayment(user, seatIds) {
  const payStart = Date.now();
  try {
    // Bước 1: Khởi tạo thanh toán (PAYMENT_PROCESSING)
    const checkoutRes = await fetch(`${BASE_URL}/seats/start-checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${user.token}`
      },
      body: JSON.stringify({ seatIds })
    });
    const checkoutData = await checkoutRes.json();

    if (!checkoutData.success) {
      return { 
        success: false, 
        step: 'start-checkout', 
        message: checkoutData.message,
        duration: Date.now() - payStart 
      };
    }

    const orderId = checkoutData.data.orderId;
    const totalAmount = checkoutData.data.totalAmount;

    // Bước 2: Giả lập Ngân hàng / Cổng thanh toán bắn Webhook xác nhận (SOLD)
    const webhookRes = await fetch(`${BASE_URL}/payment/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId, success: true })
    });
    const webhookData = await webhookRes.json();

    if (!webhookData.success) {
      return { 
        success: false, 
        step: 'webhook', 
        message: webhookData.message,
        duration: Date.now() - payStart 
      };
    }

    return {
      success: true,
      orderId,
      totalAmount,
      seatIds,
      duration: Date.now() - payStart // Thời gian từ lúc ấn thanh toán tới khi nhận vé thành công
    };
  } catch (err) {
    return { 
      success: false, 
      step: 'network', 
      message: err.message,
      duration: Date.now() - payStart 
    };
  }
}

async function runFullE2ETest() {
  console.log('🚀 ===============================================================');
  console.log('   BẮT ĐẦU TEST E2E 100 USERS: TRANH GIỮ GHẾ -> THANH TOÁN (SOLD)   ');
  console.log('=================================================================\n');

  // 1. Lấy thông tin các sự kiện từ server
  const evRes = await fetch(`${BASE_URL}/events`);
  const evData = await evRes.json();
  const seatEvent = evData.data.find(e => e.event_type === 'SEAT_BASED');
  const zoneEvent = evData.data.find(e => e.event_type === 'ZONE_BASED');

  if (!seatEvent || !zoneEvent) {
    console.error('❌ Thiếu dữ liệu sự kiện! Vui lòng chạy seed: node src/seeds/seed-mvp.js');
    process.exit(1);
  }

  // 2. Chuẩn bị 100 users
  const users = await prepareUsers(TOTAL_USERS);

  // =========================================================================
  // GIAI ĐOẠN 1: SEAT-BASED EVENT (GIỮ GHẾ -> THANH TOÁN MUA HẲN VÉ)
  // =========================================================================
  console.log('-----------------------------------------------------------------');
  console.log(`[TEST 1] SEAT-BASED: 100 Users tranh chấp ghế tại "${seatEvent.title}"`);
  console.log('-----------------------------------------------------------------');

  const seatDetailsRes = await fetch(`${BASE_URL}/events/${seatEvent.id}/details?type=SEAT_BASED`);
  const seatDetails = await seatDetailsRes.json();
  const availableSeats = seatDetails.data;
  console.log(`-> Tổng số ghế trên sơ đồ: ${availableSeats.length} ghế.`);

  // Mỗi user chọn ngẫu nhiên 2 - 4 ghế
  const seatRequests = users.map((user) => {
    const numToPick = Math.floor(Math.random() * 3) + 2;
    const shuffled = [...availableSeats].sort(() => 0.5 - Math.random());
    const pickedSeats = shuffled.slice(0, numToPick);

    return {
      user,
      seatIds: pickedSeats.map(s => s.id),
      seatNames: pickedSeats.map(s => s.seat_number)
    };
  });

  const startT1 = Date.now();
  // 100 Users đồng thời gửi request giữ ghế
  const seatReserveResults = await Promise.all(
    seatRequests.map(req =>
      fetch(`${BASE_URL}/seats/reserve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${req.user.token}`
        },
        body: JSON.stringify({ seatIds: req.seatIds })
      })
      .then(async res => ({ status: res.status, data: await res.json(), req }))
      .catch(err => ({ status: 500, data: { message: err.message }, req }))
    )
  );

  const winnersCase1 = seatReserveResults.filter(r => r.data.success);
  console.log(`⏱️ Giữ ghế xong trong: ${Date.now() - startT1}ms | Có ${winnersCase1.length} Users giành được ghế.`);
  console.log(`💳 Bắt đầu tiến hành thanh toán đồng thời cho ${winnersCase1.length} Users...`);

  // Bắt đầu đo thời gian tổng đợt thanh toán Case 1
  const startPayT1 = Date.now();
  const paymentResultsCase1 = await Promise.all(
    winnersCase1.map(async w => {
      const payRes = await processFullPayment(w.req.user, w.req.seatIds);
      return {
        user: w.req.user,
        seats: w.req.seatNames.join(', '),
        payRes
      };
    })
  );
  const totalPayT1 = Date.now() - startPayT1;

  const successfulOrdersCase1 = paymentResultsCase1.filter(p => p.payRes.success);
  const failedOrdersCase1 = paymentResultsCase1.filter(p => !p.payRes.success);
  const statsCase1 = computeLatencyStats(successfulOrdersCase1.map(p => p.payRes.duration));

  console.log('\n📊 KẾT QUẢ TEST 1 (SEAT-BASED - SOLD):');
  console.log(`- Số User thanh toán thành công (SOLD): ${successfulOrdersCase1.length}`);
  console.log(`- Số giao dịch thanh toán thất bại: ${failedOrdersCase1.length}`);
  console.log(`⏱️ Tổng thời gian hoàn tất cả đợt thanh toán: ${totalPayT1}ms`);
  console.log(`⏱️ Thời gian trung bình mỗi đơn: ${statsCase1.avg}ms (Nhanh nhất: ${statsCase1.min}ms | Lâu nhất: ${statsCase1.max}ms)`);

  console.log('\n📋 [LOG ĐỐI CHIẾU DB] DANH SÁCH ĐƠN HÀNG ĐÃ THANH TOÁN (SEAT-BASED):');
  console.table(successfulOrdersCase1.map(o => ({
    'User ID': o.user.id,
    'Tên User': o.user.name,
    'Order ID': o.payRes.orderId,
    'Ghế đã mua (SOLD)': o.seats,
    'Tổng tiền': Number(o.payRes.totalAmount).toLocaleString() + ' đ',
    'Thời gian TT': `${o.payRes.duration}ms`
  })));

  console.log('👉 Câu lệnh SQL kiểm tra trên Supabase:');
  console.log(`SELECT id, seat_number, status, current_order_id FROM seats WHERE event_id = '${seatEvent.id}' AND status = 'SOLD';`);
  console.log(`SELECT id, user_id, total_amount, status FROM orders WHERE status = 'SUCCESS';\n`);

  // =========================================================================
  // GIAI ĐOẠN 2: ZONE-BASED EVENT (GIỮ VÉ -> THANH TOÁN MUA HẲN VÉ)
  // =========================================================================
  console.log('-----------------------------------------------------------------');
  console.log(`[TEST 2] ZONE-BASED: 100 Users tranh chấp và thanh toán tại "${zoneEvent.title}"`);
  console.log('-----------------------------------------------------------------');

  const zoneDetailsRes = await fetch(`${BASE_URL}/events/${zoneEvent.id}/details?type=ZONE_BASED`);
  const zoneDetails = await zoneDetailsRes.json();
  console.log('-> Kho vé ban đầu:');
  zoneDetails.data.forEach(z => {
    console.log(`   * ${z.zone_name}: còn ${z.available_count} vé`);
  });

  // 100 Users đồng loạt mua 1 VIP + 2 REGULAR
  const zoneRequests = users.map(user => ({
    user,
    payload: {
      eventId: zoneEvent.id,
      zones: [
        { zoneName: 'VIP', quantity: 1 },
        { zoneName: 'REGULAR', quantity: 2 }
      ]
    }
  }));

  const startT2 = Date.now();
  const zoneReserveResults = await Promise.all(
    zoneRequests.map(req =>
      fetch(`${BASE_URL}/seats/reserve-zone`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${req.user.token}`
        },
        body: JSON.stringify(req.payload)
      })
      .then(async res => ({ status: res.status, data: await res.json(), req }))
      .catch(err => ({ status: 500, data: { message: err.message }, req }))
    )
  );

  const winnersCase2 = zoneReserveResults.filter(r => r.data.success);
  console.log(`⏱️ Giữ vé xong trong: ${Date.now() - startT2}ms | Có ${winnersCase2.length} Users giữ được vé.`);
  console.log(`💳 Bắt đầu thanh toán đồng thời cho ${winnersCase2.length} Users...`);

  // Bắt đầu đo thời gian tổng đợt thanh toán Case 2
  const startPayT2 = Date.now();
  const paymentResultsCase2 = await Promise.all(
    winnersCase2.map(async w => {
      const seatIds = w.data.data.seatIds;
      const payRes = await processFullPayment(w.req.user, seatIds);
      return {
        user: w.req.user,
        ticketCount: seatIds.length,
        payRes
      };
    })
  );
  const totalPayT2 = Date.now() - startPayT2;

  const successfulOrdersCase2 = paymentResultsCase2.filter(p => p.payRes.success);
  const failedOrdersCase2 = paymentResultsCase2.filter(p => !p.payRes.success);
  const statsCase2 = computeLatencyStats(successfulOrdersCase2.map(p => p.payRes.duration));

  console.log('\n📊 KẾT QUẢ TEST 2 (ZONE-BASED - SOLD):');
  console.log(`- Số User thanh toán thành công (SOLD): ${successfulOrdersCase2.length}`);
  console.log(`- Số giao dịch thanh toán thất bại: ${failedOrdersCase2.length}`);
  console.log(`⏱️ Tổng thời gian hoàn tất cả đợt thanh toán: ${totalPayT2}ms`);
  console.log(`⏱️ Thời gian trung bình mỗi đơn: ${statsCase2.avg}ms (Nhanh nhất: ${statsCase2.min}ms | Lâu nhất: ${statsCase2.max}ms)`);

  console.log('🏁 ================= TEST HOÀN TẤT: TOÀN BỘ VÉ ĐÃ ĐƯỢC BÁN XONG =================');
}

runFullE2ETest().catch(console.error);