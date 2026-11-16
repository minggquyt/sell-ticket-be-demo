function normalizeApiResponse(body, statusCode) {
  const isObject = body !== null && typeof body === 'object' && !Array.isArray(body);
  const payload = isObject ? body : {};
  const {
    success,
    statusCode: _bodyStatusCode,
    message,
    data: originalData,
    ...extraData
  } = payload;
  const hasData = isObject && Object.prototype.hasOwnProperty.call(payload, 'data');
  const extraDataKeys = Object.keys(extraData);

  let data = hasData ? originalData : null;
  if (extraDataKeys.length > 0) {
    if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
      data = { ...data, ...extraData };
    } else if (data === null || data === undefined) {
      data = extraData;
    } else {
      data = { result: data, ...extraData };
    }
  }

  return {
    success: typeof success === 'boolean' ? success : statusCode < 400,
    statusCode,
    message: typeof message === 'string' && message.trim()
      ? message
      : statusCode < 400 ? 'Thành công.' : 'Yêu cầu thất bại.',
    data: data === undefined ? null : data
  };
}

function apiResponseMiddleware(req, res, next) {
  const sendJson = res.json.bind(res);
  res.json = (body) => sendJson(normalizeApiResponse(body, res.statusCode));
  next();
}

function apiNotFoundMiddleware(req, res) {
  return res.status(404).json({
    success: false,
    message: 'Không tìm thấy API.',
    data: null
  });
}

function apiErrorMiddleware(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }

  const reportedStatus = Number.isInteger(err.statusCode)
    ? err.statusCode
    : Number.isInteger(err.status)
      ? err.status
      : 500;
  const statusCode = reportedStatus >= 400 && reportedStatus <= 599 ? reportedStatus : 500;

  if (req.path === '/api' || req.path.startsWith('/api/')) {
    return res.status(statusCode).json({
      success: false,
      message: err.message || 'Lỗi hệ thống.',
      data: null
    });
  }

  return next(err);
}

module.exports = {
  apiResponseMiddleware,
  apiNotFoundMiddleware,
  apiErrorMiddleware
};
