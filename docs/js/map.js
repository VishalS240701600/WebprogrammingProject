// Leaflet + OpenStreetMap helpers shared by the search, post-ride and ride-details pages.
// No API key needed. Address search goes through our own server (/api/geocode),
// which talks to Nominatim politely (User-Agent, 1 request/second, caching).

const CHENNAI = [13.0475, 80.2090]; // default map centre
const MARKER_COLORS = { start: '#16a34a', end: '#dc2626' };

// Create a map inside the element with the given id
function createMap(elementId, center = CHENNAI, zoom = 11) {
  const map = L.map(elementId).setView(center, zoom);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
  return map;
}

// A coloured circle marker with a letter/number inside (no image files needed)
function pinIcon(color, text) {
  return L.divIcon({
    className: '',
    html: `<div class="num-pin" style="background:${color}">${esc(text)}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    popupAnchor: [0, -14],
  });
}

// Wait until the user stops typing before calling fn (saves Nominatim requests)
function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// Turn a map click into a readable address
async function reverseLabel(lat, lng) {
  try {
    return (await api(`/geocode/reverse?lat=${lat}&lng=${lng}`)).label;
  } catch (e) {
    return `${lat.toFixed(4)}, ${lng.toFixed(4)}`; // fall back to plain coordinates
  }
}

// Draw a route: start marker (S), end marker (E) and a line between them.
// Returns the layer group so the caller can remove/redraw it.
function drawRoute(map, from, to, group) {
  if (group) group.clearLayers();
  else group = L.layerGroup().addTo(map);
  if (from) L.marker([from.lat, from.lng], { icon: pinIcon(MARKER_COLORS.start, 'A'), title: from.label }).bindPopup(`<b>Start</b><br>${esc(from.label)}`).addTo(group);
  if (to) L.marker([to.lat, to.lng], { icon: pinIcon(MARKER_COLORS.end, 'B'), title: to.label }).bindPopup(`<b>Destination</b><br>${esc(to.label)}`).addTo(group);
  if (from && to) {
    L.polyline([[from.lat, from.lng], [to.lat, to.lng]], { color: '#0d9488', weight: 4, dashArray: '8 8' }).addTo(group);
  }
  return group;
}

/**
 * LocationPicker: a text box with address suggestions.
 *   - Typing searches addresses (debounced 700 ms, minimum 3 letters).
 *   - Choosing a suggestion, or calling setPoint() (e.g. from a map click), fills in
 *     { label, lat, lng } which you read through picker.value.
 *   - Editing the text afterwards clears the chosen point, so it can never go stale.
 *
 * @param {HTMLInputElement} input
 * @param {(point|null) => void} onChange called whenever the chosen point changes
 */
class LocationPicker {
  constructor(input, onChange = () => {}) {
    this.input = input;
    this.onChange = onChange;
    this.value = null;
    this.requestId = 0; // used to ignore out-of-date search responses

    this.list = document.createElement('div');
    this.list.className = 'suggestions hidden';
    input.parentElement.appendChild(this.list);
    input.setAttribute('autocomplete', 'off');

    input.addEventListener('input', () => {
      if (this.value) {
        this.value = null;
        this.onChange(null);
      }
      this.search();
    });
    document.addEventListener('click', (e) => {
      if (!this.list.contains(e.target) && e.target !== input) this.hide();
    });
    input.addEventListener('keydown', (e) => e.key === 'Escape' && this.hide());
  }

  search = debounce(async () => {
    const q = this.input.value.trim();
    if (q.length < 3) return this.hide();
    const id = ++this.requestId;
    this.show('<div class="none">Searching…</div>');
    try {
      const { results } = await api('/geocode?q=' + encodeURIComponent(q));
      if (id !== this.requestId) return; // a newer search has started
      if (!results.length) return this.show('<div class="none">No places found. Try a nearby landmark or click the map.</div>');
      this.show(results.map((r, i) => `<button type="button" data-i="${i}">${esc(r.label)}</button>`).join(''));
      this.list.querySelectorAll('button').forEach((b) =>
        b.addEventListener('click', () => this.setPoint(results[b.dataset.i].lat, results[b.dataset.i].lng, results[b.dataset.i].label))
      );
    } catch (e) {
      if (id === this.requestId) this.show(`<div class="none">${esc(e.message)}</div>`);
    }
  }, 700);

  show(html) {
    this.list.innerHTML = html;
    this.list.classList.remove('hidden');
  }

  hide() {
    this.list.classList.add('hidden');
  }

  setPoint(lat, lng, label) {
    this.requestId++; // cancel any search in flight
    this.value = { lat, lng, label };
    this.input.value = label;
    this.hide();
    this.onChange(this.value);
  }

  clear() {
    this.requestId++;
    this.value = null;
    this.input.value = '';
    this.hide();
    this.onChange(null);
  }
}
