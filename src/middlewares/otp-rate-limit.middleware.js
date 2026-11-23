const buckets = new Map();

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

module.exports = { createOtpRateLimit };