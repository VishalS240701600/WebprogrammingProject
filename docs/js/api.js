// Shared helpers loaded on every page: talking to the API, messages, the navbar, formatting.

// ---------- Talking to the server ----------
// API_BASE comes from js/config.js ('' = same server, or the URL of the hosted backend).
const API_BASE = (window.RIDEBUDDY_API_BASE || '').replace(/\/$/, '');

// api('/rides/5')                          -> GET
// api('/rides', { method: 'POST', body })  -> POST with a JSON body
// Throws an Error whose message is the server's friendly error text.
async function api(path, { method = 'GET', body } = {}) {
  // 'include' lets the session cookie travel to a backend hosted on another domain
  const options = { method, headers: {}, credentials: 'include' };
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(API_BASE + '/api' + path, options);
  } catch (e) {
    throw new Error('Cannot reach the server. Check your connection and try again.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'Something went wrong.');
    err.status = res.status;
    throw err;
  }
  return data;
}

// ---------- Safety + formatting ----------
// Escape text before putting it into innerHTML so user input can never inject HTML.
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function formatDate(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function formatTime(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${suffix}`;
}

const formatMoney = (n) => (n > 0 ? `₹${Number(n).toFixed(n % 1 ? 2 : 0)}` : 'Free');

// Today's date as YYYY-MM-DD in the visitor's local time
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ★★★★☆ for a rating (or "No ratings yet")
function starsHtml(avg, count) {
  if (!count) return '<span class="muted small">No ratings yet</span>';
  const full = Math.round(avg);
  return `<span class="stars" aria-label="${avg} out of 5">${'★'.repeat(full)}<span class="off">${'★'.repeat(5 - full)}</span></span> <span class="small">${avg} (${count})</span>`;
}

// ---------- Messages ----------
// toast('Saved!') or toast('Oops', 'error')
function toast(message, type = 'success') {
  let box = document.getElementById('toasts');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toasts';
    box.setAttribute('aria-live', 'polite');
    document.body.appendChild(box);
  }
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = message;
  box.appendChild(el);
  setTimeout(() => el.remove(), type === 'error' ? 6000 : 3500);
}

// Show an inline error box inside a container element (pass '' to clear it)
function showError(container, message) {
  let box = container.querySelector(':scope > .notice.error');
  if (!message) return box && box.remove();
  if (!box) {
    box = document.createElement('div');
    box.className = 'notice error';
    box.setAttribute('role', 'alert');
    container.prepend(box);
  }
  box.textContent = message;
}

// Run an async click/submit handler while disabling the button, and toast any error.
async function withButton(button, fn) {
  button.disabled = true;
  try {
    return await fn();
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    button.disabled = false;
  }
}

// ---------- Navbar + page setup ----------
let currentUser = null;

// Call at the top of every page script.
//   initPage()                  - just draw the navbar
//   initPage({ login: true })   - redirect to the login page if not logged in
//   initPage({ admin: true })   - must be an admin
async function initPage({ login = false, admin = false } = {}) {
  try {
    currentUser = (await api('/auth/me')).user;
  } catch (e) {
    currentUser = null;
  }
  if ((login || admin) && !currentUser) {
    location.href = 'login.html?next=' + encodeURIComponent(currentPage());
    return new Promise(() => {}); // stop the page script while redirecting
  }
  if (admin && !currentUser.is_admin) {
    document.querySelector('main').innerHTML = '<div class="card empty">Admins only.</div>';
    renderNav();
    return new Promise(() => {});
  }
  renderNav();
  return currentUser;
}

function renderNav() {
  const here = location.pathname.split('/').pop() || 'index.html';
  const link = (href, text) => `<a href="${href}" ${here === href ? 'class="active" aria-current="page"' : ''}>${text}</a>`;
  const links = [link('index.html', 'Find a ride'), link('post-ride.html', 'Post a ride')];
  if (currentUser) {
    links.push(link('dashboard.html', 'Dashboard'), link('profile.html', 'Profile'));
    if (currentUser.is_admin) links.push(link('admin.html', 'Admin'));
    links.push('<button class="link" id="logout-btn" type="button">Log out</button>');
  } else {
    links.push(link('login.html', 'Log in'), link('register.html', 'Sign up'));
  }

  const header = document.getElementById('site-header');
  header.className = 'site-header';
  header.innerHTML = `
    <div class="container">
      <a class="brand" href="index.html">Ride<span>Buddy</span></a>
      <button class="nav-toggle" type="button" aria-label="Menu" aria-expanded="false">☰</button>
      <nav class="nav" aria-label="Main">${links.join('')}</nav>
    </div>`;

  const nav = header.querySelector('.nav');
  const toggle = header.querySelector('.nav-toggle');
  toggle.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    toggle.setAttribute('aria-expanded', open);
  });
  const logout = document.getElementById('logout-btn');
  if (logout) {
    logout.addEventListener('click', async () => {
      await api('/auth/logout', { method: 'POST' });
      location.href = 'index.html';
    });
  }
}

// The current page as a relative link, e.g. "ride.html?id=5". Relative links keep working
// when the site lives under a sub-path like https://user.github.io/ridebuddy/
function currentPage() {
  return (location.pathname.split('/').pop() || 'index.html') + location.search;
}

// Only allow same-site relative redirects after login (prevents open-redirect tricks)
function safeNext() {
  const next = new URLSearchParams(location.search).get('next');
  return next && /^[\w-]+\.html(\?[\w=&%.-]*)?$/.test(next) ? next : 'dashboard.html';
}
