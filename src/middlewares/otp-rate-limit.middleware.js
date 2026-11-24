const buckets = new Map();
const PRUNE_THRESHOLD = 1000;

function pruneExpiredBuckets(now) {
  for (const [key, bucket] of buckets.entries()) {
    if (!bucket || bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }
}

function createOtpRateLimit({ windowMs, max, keyPrefix }) {
  return (req, res, next) => {
    const now = Date.now();
    const identifier = req.body?.registrationId || req.body?.email || 'unknown';
    const keys = [
      `${keyPrefix}:ip:${req.ip || 'unknown'}`,
      `${keyPrefix}:subject:${String(identifier).trim().toLowerCase()}`,
    ];
    const blocked = keys
      .map((key) => buckets.get(key))
      .filter((bucket) => bucket && bucket.resetAt > now && bucket.count >= max)
      .sort((a, b) => b.resetAt - a.resetAt)[0];
    if (blocked) {
      const retryAfter = Math.max(1, Math.ceil((blocked.resetAt - now) / 1000));
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({
        success: false,
        message: 'Bạn thao tác quá nhanh. Vui lòng thử lại sau.',
        data: { code: 'RATE_LIMITED' },
      });
    }
    if (buckets.size >= PRUNE_THRESHOLD) {
      pruneExpiredBuckets(now);
    }
    for (const key of keys) {
      const current = buckets.get(key);
      if (!current || current.resetAt <= now) {
        buckets.set(key, { count: 1, resetAt: now + windowMs });
      } else {
        current.count += 1;
      }
    }
    next();
  };
}

module.exports = {
  createOtpRateLimit,
  _getBucketCount: () => buckets.size,
  _clearBuckets: () => buckets.clear(),
};
