// Small server-side validation helpers. Every function throws an HttpError(400)
// with a friendly message when the value is bad, otherwise returns the clean value.

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const bad = (msg) => new HttpError(400, msg);

function text(value, label, { min = 1, max = 200, optional = false } = {}) {
  if (value === undefined || value === null || String(value).trim() === '') {
    if (optional) return null;
    throw bad(`${label} is required.`);
  }
  const s = String(value).trim();
  if (s.length < min) throw bad(`${label} must be at least ${min} characters.`);
  if (s.length > max) throw bad(`${label} must be at most ${max} characters.`);
  return s;
}

function email(value) {
  const s = text(value, 'Email', { max: 120 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw bad('Please enter a valid email address.');
  return s;
}

function password(value) {
  if (typeof value !== 'string' || value.length < 8) throw bad('Password must be at least 8 characters.');
  if (value.length > 72) throw bad('Password must be at most 72 characters.'); // bcrypt limit
  return value;
}

function phone(value) {
  const s = text(value, 'Phone', { optional: true, max: 20 });
  if (s && !/^[0-9+()\-\s]{7,20}$/.test(s)) throw bad('Please enter a valid phone number.');
  return s;
}

function int(value, label, { min = -Infinity, max = Infinity } = {}) {
  const n = Number(value);
  if (value === '' || value === null || value === undefined || !Number.isInteger(n))
    throw bad(`${label} must be a whole number.`);
  if (n < min || n > max) throw bad(`${label} must be between ${min} and ${max}.`);
  return n;
}

function number(value, label, { min = -Infinity, max = Infinity } = {}) {
  const n = Number(value);
  if (value === '' || value === null || value === undefined || !Number.isFinite(n))
    throw bad(`${label} must be a number.`);
  if (n < min || n > max) throw bad(`${label} must be between ${min} and ${max}.`);
  return n;
}

const lat = (value, label) => number(value, label, { min: -90, max: 90 });
const lng = (value, label) => number(value, label, { min: -180, max: 180 });

function date(value, label = 'Date') {
  const s = String(value || '');
  const d = new Date(s + 'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s)
    throw bad(`${label} must be a valid date (YYYY-MM-DD).`);
  return s;
}

function time(value, label = 'Time') {
  const s = String(value || '');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s)) throw bad(`${label} must be a valid time (HH:MM).`);
  return s;
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Accepts an array or comma string; returns e.g. "Mon,Wed,Fri" (or null if empty)
function days(value) {
  if (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)) return null;
  const list = Array.isArray(value) ? value : String(value).split(',');
  const clean = [...new Set(list.map((d) => String(d).trim()))];
  if (clean.some((d) => !DAYS.includes(d))) throw bad('Recurring days must be Mon, Tue, Wed, Thu, Fri, Sat or Sun.');
  return DAYS.filter((d) => clean.includes(d)).join(',');
}

// Today's date on the server, as YYYY-MM-DD (local time)
function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Weekday abbreviation (Mon..Sun) for a YYYY-MM-DD string
function weekdayOf(dateStr) {
  const idx = new Date(dateStr + 'T00:00:00Z').getUTCDay(); // 0 = Sunday
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][idx];
}

module.exports = { HttpError, text, email, password, phone, int, number, lat, lng, date, time, days, today, weekdayOf, DAYS };
