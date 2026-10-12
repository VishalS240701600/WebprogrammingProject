// Central error handling: always respond with JSON { error: "message" }.
const { HttpError } = require('../utils/validate');

function notFound(req, res, next) {
  next(new HttpError(404, 'Not found.'));
}

function errorHandler(err, req, res, next) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body.' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
}

module.exports = { notFound, errorHandler };
