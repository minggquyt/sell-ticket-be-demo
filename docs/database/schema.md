# Mô tả cơ sở dữ liệu hệ thống đặt vé sự kiện

Cơ sở dữ liệu gồm 7 bảng: `users`, `categories`, `cities`, `events`, `seats`, `orders` và `order_items`.

> Tài liệu dựa trên sơ đồ được cung cấp. Giá trị enum, giá trị mặc định và các quy tắc ON DELETE/ON UPDATE cần đối chiếu với SQL thực tế. Theo ký hiệu trong ảnh: hình thoi đặc là NOT NULL, hình thoi rỗng là cho phép NULL; biểu tượng khóa là khóa chính, biểu tượng dấu vân tay là ràng buộc duy nhất.

## 1. Bảng categories — Danh mục sự kiện

Lưu danh sách danh mục để phân loại sự kiện.

| Cột | Kiểu dữ liệu | Mô tả |
|---|---|---|
| id | uuid | Khóa chính, định danh danh mục. |
| name | varchar | Tên danh mục. |
| created_at | timestamptz | Thời điểm tạo danh mục. |

Sơ đồ chưa thể hiện khóa ngoại giữa categories và events. Bảng events hiện có cột category kiểu varchar.

## 2. Bảng cities — Thành phố

Lưu danh sách thành phố, có thể phục vụ lựa chọn địa điểm hoặc lọc sự kiện.

| Cột | Kiểu dữ liệu | Mô tả |
|---|---|---|
| id | uuid | Khóa chính, định danh thành phố. |
| name | varchar | Tên thành phố. |
| created_at | timestamptz | Thời điểm tạo bản ghi. |

Sơ đồ chưa thể hiện liên kết giữa cities và các bảng khác.

## 3. Bảng events — Sự kiện

Lưu thông tin giới thiệu, địa điểm, thời gian và nội dung hiển thị của sự kiện.

| Cột | Kiểu dữ liệu | Mô tả |
|---|---|---|
| id | uuid | Khóa chính, định danh sự kiện. |
| title | varchar | Tiêu đề sự kiện. |
| description | text | Nội dung mô tả sự kiện. |
| location | varchar | Địa điểm tổ chức. |
| start_time | timestamptz | Thời điểm bắt đầu sự kiện. |
| created_at | timestamptz | Thời điểm tạo sự kiện. |
| event_type | event_type_enum | Loại sự kiện, sử dụng kiểu enum tùy chỉnh. |
| thumbnails | text[] | Danh sách ảnh thu nhỏ; ký hiệu _text trong sơ đồ là mảng text của PostgreSQL. |
| category | varchar | Thông tin danh mục của sự kiện. |
| time | varchar | Thông tin thời gian dạng chuỗi; cần đối chiếu code để xác định cách sử dụng. |
| min_price | numeric | Giá vé thấp nhất được lưu cho sự kiện. |
| max_price | numeric | Giá vé cao nhất được lưu cho sự kiện. |
| image | text | Đường dẫn hoặc thông tin ảnh đại diện. |
| banner | text | Đường dẫn hoặc thông tin ảnh banner. |
| organizer | varchar | Đơn vị tổ chức sự kiện. |
| highlights | jsonb | Nội dung nổi bật của sự kiện dưới dạng JSON. |
| rules | jsonb | Quy định của sự kiện dưới dạng JSON. |

**Quan hệ:** Một sự kiện có thể có nhiều ghế trong bảng seats.

## 4. Bảng seats — Ghế/Vé theo ghế

Lưu ghế thuộc từng sự kiện, giá bán và thông tin giữ chỗ.

| Cột | Kiểu dữ liệu | Mô tả |
|---|---|---|
| id | uuid | Khóa chính, định danh ghế. |
| event_id | uuid | Tham chiếu events.id, xác định sự kiện của ghế. |
| seat_number | varchar | Số ghế hoặc mã ghế. |
| price | numeric | Giá bán của ghế. |
| status | seat_status | Trạng thái ghế, sử dụng kiểu enum tùy chỉnh. |
| reserved_by | uuid | Tham chiếu users.id, xác định người đang giữ ghế. |
| reserved_until | timestamptz | Thời điểm hết hạn giữ ghế. |
| created_at | timestamptz | Thời điểm tạo ghế. |
| current_order_id | uuid | Tham chiếu orders.id, xác định đơn hàng hiện đang liên kết với ghế. |
| zone_name | varchar | Tên khu vực của ghế. |

**Quan hệ:**

- Mỗi ghế thuộc một sự kiện.
- Một đơn hàng có thể liên kết với nhiều ghế qua current_order_id.
- Ghế được tham chiếu trong chi tiết đơn hàng qua order_items.seat_id.

## 5. Bảng orders — Đơn hàng

Lưu đơn đặt vé, người đặt, tổng tiền, trạng thái và thời hạn xử lý.

| Cột | Kiểu dữ liệu | Mô tả |
|---|---|---|
| id | uuid | Khóa chính, định danh nội bộ của đơn hàng. |
| user_id | uuid | Tham chiếu users.id, xác định người đặt đơn. |
| total_amount | numeric | Tổng số tiền của đơn hàng. |
| status | order_status | Trạng thái đơn hàng, sử dụng kiểu enum tùy chỉnh. |
| expires_at | timestamptz | Thời điểm hết hạn của đơn hàng. |
| created_at | timestamptz | Thời điểm tạo đơn hàng. |
| order_code | int8 | Mã đơn hàng dạng số nguyên 64 bit (bigint), có ràng buộc duy nhất. |

**Quan hệ:**

- Một đơn hàng có nhiều dòng chi tiết trong order_items.
- Một đơn hàng có thể được nhiều ghế tham chiếu qua seats.current_order_id.

> id và order_code là hai trường khác nhau. Cần đối chiếu code để xác định order_code có được dùng làm mã giao dịch với cổng thanh toán hay không.

## 6. Bảng order_items — Chi tiết đơn hàng

Lưu từng ghế được đặt trong một đơn hàng và giá tại thời điểm đặt.

| Cột | Kiểu dữ liệu | Mô tả |
|---|---|---|
| id | uuid | Khóa chính, định danh dòng chi tiết. |
| order_id | uuid | Tham chiếu orders.id. |
| seat_id | uuid | Tham chiếu seats.id. |
| price | numeric | Giá của ghế được ghi nhận trong đơn hàng. |

**Ý nghĩa:** order_items.price lưu giá của giao dịch, giúp giữ lại giá đã đặt khi seats.price được thay đổi sau đó.

**Quan hệ:**

- Mỗi dòng chi tiết thuộc một đơn hàng.
- Mỗi dòng chi tiết tham chiếu một ghế.
- Sơ đồ chưa thể hiện ràng buộc UNIQUE trên seat_id, nên chưa thể kết luận mỗi ghế chỉ xuất hiện trong một dòng chi tiết trên toàn hệ thống.

## 7. Tổng hợp quan hệ

| Bảng cha | Bảng con | Cột liên kết | Quan hệ |
|---|---|---|---|
| users | orders | orders.user_id → users.id | Một người dùng có nhiều đơn hàng. |
| users | seats | seats.reserved_by → users.id | Một người dùng có thể giữ nhiều ghế. |
| events | seats | seats.event_id → events.id | Một sự kiện có nhiều ghế. |
| orders | order_items | order_items.order_id → orders.id | Một đơn hàng có nhiều dòng chi tiết. |
| seats | order_items | order_items.seat_id → seats.id | Một ghế có thể được nhiều dòng chi tiết tham chiếu nếu không có ràng buộc duy nhất. |
| orders | seats | seats.current_order_id → orders.id | Một đơn hàng có thể liên kết với nhiều ghế hiện tại. |

Các liên kết người dùng trong sơ đồ: orders.user_id → users.id và seats.reserved_by → users.id.

## 8. Cách liên kết dữ liệu để hiển thị vé

Từ đơn hàng của người dùng, hệ thống truy xuất dữ liệu theo chuỗi:

`orders → order_items → seats → events`

| Thông tin cần hiển thị | Nguồn dữ liệu |
|---|---|
| Người đặt | orders.user_id → users.id; tên từ users.full_name |
| Email người đặt | users.email |
| Mã đơn hàng | orders.order_code |
| Trạng thái đơn hàng | orders.status |
| Tổng tiền | orders.total_amount |
| Giá từng ghế lúc đặt | order_items.price |
| Số ghế | seats.seat_number |
| Khu vực ghế | seats.zone_name |
| Tên sự kiện | events.title |
| Địa điểm | events.location |
| Thời gian bắt đầu | events.start_time |

**Lưu ý:** Phần sơ đồ được cung cấp chưa có bảng riêng cho vé phát hành, hóa đơn hoặc giao dịch thanh toán. orders là bảng đơn hàng; việc sử dụng dữ liệu này để hiển thị hóa đơn cần được xác định theo nghiệp vụ.

## 9. Ghi chú về kiểu dữ liệu

| Kiểu | Ý nghĩa |
|---|---|
| uuid | Mã định danh UUID. |
| varchar | Chuỗi ký tự có độ dài thay đổi. |
| text | Chuỗi văn bản. |
| text[] | Mảng các chuỗi văn bản. |
| numeric | Số thập phân chính xác, phù hợp lưu giá tiền. |
| int8 / bigint | Số nguyên có dấu 64 bit. |
| timestamptz | Thời điểm được PostgreSQL xử lý theo múi giờ; không lưu tên múi giờ gốc. |
| jsonb | Dữ liệu JSON dạng nhị phân. |
| event_type_enum, seat_status, order_status | Kiểu enum tùy chỉnh; ảnh không cung cấp danh sách giá trị. |

## 10. Bảng users — Người dùng

Lưu thông tin tài khoản, hồ sơ và vai trò của người dùng.

| Cột | Kiểu dữ liệu | Cho phép NULL | Ràng buộc | Mô tả |
|---|---|---|---|---|
| id | uuid | Không | PRIMARY KEY | Định danh người dùng. |
| email | varchar | Không | UNIQUE | Email của tài khoản. |
| full_name | varchar | Không | — | Họ và tên người dùng. |
| password | varchar | Không | — | Mật khẩu của tài khoản; ứng dụng cần lưu giá trị băm thay vì mật khẩu thuần. |
| created_at | timestamptz | Có | — | Thời điểm tạo tài khoản. |
| role | user_role | Có | — | Vai trò người dùng, sử dụng enum tùy chỉnh. |
| avatar | text | Có | — | Đường dẫn hoặc thông tin ảnh đại diện. |

**Quan hệ:** Một người dùng có nhiều đơn hàng qua orders.user_id và có thể giữ nhiều ghế qua seats.reserved_by.

## 11. Ràng buộc thể hiện trong sơ đồ mới

### 11.1. Các cột NOT NULL

Các cột còn lại trong từng bảng được hiển thị bằng hình thoi rỗng, tức cho phép NULL theo sơ đồ.

| Bảng | Các cột NOT NULL |
|---|---|
| users | id, email, full_name, password |
| categories | id, name, created_at |
| cities | id, name, created_at |
| events | id, title, start_time |
| seats | id, event_id, seat_number, price |
| orders | id, user_id, total_amount, expires_at |
| order_items | id, order_id, seat_id, price |

### 11.2. Các cột có ràng buộc duy nhất

| Bảng | Cột | Ghi chú |
|---|---|---|
| users | email | Email duy nhất. |
| categories | name | Tên danh mục duy nhất. |
| cities | name | Tên thành phố duy nhất. |
| orders | order_code | Mã đơn hàng duy nhất; cột vẫn cho phép NULL theo sơ đồ. |

Khóa chính id của mỗi bảng cũng có tính duy nhất và không cho phép NULL. Sơ đồ không thể hiện ràng buộc duy nhất trên order_items.seat_id hoặc cặp seats.event_id, seats.seat_number.

### 11.3. Danh sách enum cần đối chiếu

- events.event_type: event_type_enum.
- seats.status: seat_status.
- orders.status: order_status.
- users.role: user_role.

Ảnh không hiển thị các giá trị cụ thể của các enum này.
