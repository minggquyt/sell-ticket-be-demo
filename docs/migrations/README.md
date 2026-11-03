# Database Migrations

SQL migrations cho các cải tiến từ code review.

## 📁 Available Migrations

### 1. Performance Indexes
**File**: `add_performance_indexes.sql`  
**Purpose**: Tối ưu performance cho các query thường xuyên

**Indexes được tạo**:
- `idx_seats_status_reserved_until` - Cho auto-release job (chạy mỗi 15s)
- `idx_seats_event_id_status` - Cho getSeatsByEvent()
- `idx_orders_user_id_status` - Cho user order lookups
- `idx_order_items_order_code` - Cho join operations
- `idx_seats_reserved_by` - Cho reserved seats queries

**Apply**:
```bash
psql $DATABASE_URL -f docs/migrations/add_performance_indexes.sql
```

**Rollback** (nếu cần):
```sql
DROP INDEX IF EXISTS idx_seats_status_reserved_until;
DROP INDEX IF EXISTS idx_seats_event_id_status;
DROP INDEX IF EXISTS idx_orders_user_id_status;
DROP INDEX IF EXISTS idx_order_items_order_code;
DROP INDEX IF EXISTS idx_seats_reserved_by;
```

---

### 2. Data Constraints
**File**: `add_data_constraints.sql`  
**Purpose**: Thêm NOT NULL và format validation cho phone/citizen_id

**Constraints được tạo**:
- `phone NOT NULL` + format check `^(0|\+84)\d{9,10}$`
- `citizen_id NOT NULL` + format check `^\d{12}$`

**⚠️ IMPORTANT**: Kiểm tra dữ liệu trước khi apply!

```bash
# 1. Check for NULL values
psql $DATABASE_URL -c "SELECT COUNT(*) FROM orders WHERE phone IS NULL OR citizen_id IS NULL;"

# 2. If result > 0, fix data first
psql $DATABASE_URL -c "UPDATE orders SET phone = '0000000000' WHERE phone IS NULL;"
psql $DATABASE_URL -c "UPDATE orders SET citizen_id = '000000000000' WHERE citizen_id IS NULL;"

# 3. Apply migration
psql $DATABASE_URL -f docs/migrations/add_data_constraints.sql
```

**Rollback** (nếu cần):
```sql
ALTER TABLE orders ALTER COLUMN phone DROP NOT NULL;
ALTER TABLE orders ALTER COLUMN citizen_id DROP NOT NULL;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_phone_format;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_citizen_id_format;
```

---

## 📊 Migration History

| Date | Migration | Status | Notes |
|------|-----------|--------|-------|
| 2026-11-03 | add_performance_indexes.sql | ⏳ Pending | Safe to apply anytime |
| 2026-11-03 | add_data_constraints.sql | ⏳ Pending | Check data first! |

---

## 🚀 Best Practices

1. **Always backup database before migrations**
```bash
pg_dump $DATABASE_URL > backup_$(date +%Y%m%d_%H%M%S).sql
```

2. **Test in staging environment first**

3. **Apply during low-traffic period**

4. **Monitor performance after applying indexes**

---

## 🔗 Related Documentation

- [Code Review Fixes](../fixes/CODE_REVIEW_FIXES.md)
- [Fixes Summary](../fixes/FIXES_SUMMARY.md)
