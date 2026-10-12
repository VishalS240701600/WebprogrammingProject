// Home / search page: search form, ranked results list and results map.
(async () => {
  await initPage();

  const form = document.getElementById('search-form');
  const resultsEl = document.getElementById('results');
  const titleEl = document.getElementById('results-title');
  const countEl = document.getElementById('results-count');
  const dateInput = document.getElementById('date');
  dateInput.min = todayISO();

  // ----- Map -----
  const map = createMap('map');
  let pointLayer = L.layerGroup().addTo(map); // rider's pickup (A) and drop-off (B)
  let resultLayer = L.layerGroup().addTo(map); // numbered markers for each result
  let routeLayer = L.layerGroup().addTo(map); // route of the selected result
  let markers = {}; // ride id -> marker

  // ----- Pickup / drop-off pickers -----
  const drawPoints = () => {
    pointLayer.clearLayers();
    if (pickup.value) L.marker([pickup.value.lat, pickup.value.lng], { icon: pinIcon(MARKER_COLORS.start, 'A') }).bindPopup('Your pickup').addTo(pointLayer);
    if (dropoff.value) L.marker([dropoff.value.lat, dropoff.value.lng], { icon: pinIcon(MARKER_COLORS.end, 'B') }).bindPopup('Your drop-off').addTo(pointLayer);
  };
  const pickup = new LocationPicker(document.getElementById('from'), drawPoints);
  const dropoff = new LocationPicker(document.getElementById('to'), drawPoints);

  // "Pick on map" buttons: the next map click sets that point
  let pickMode = null; // 'from' | 'to' | null
  const pickButtons = { from: document.getElementById('pick-from'), to: document.getElementById('pick-to') };
  function setPickMode(mode) {
    pickMode = pickMode === mode ? null : mode;
    for (const k in pickButtons) pickButtons[k].classList.toggle('active', k === pickMode);
    map.getContainer().style.cursor = pickMode ? 'crosshair' : '';
  }
  pickButtons.from.addEventListener('click', () => setPickMode('from'));
  pickButtons.to.addEventListener('click', () => setPickMode('to'));

  map.on('click', async (e) => {
    if (!pickMode) return;
    const picker = pickMode === 'from' ? pickup : dropoff;
    const { lat, lng } = e.latlng;
    setPickMode(pickMode); // turn the mode off
    picker.setPoint(lat, lng, 'Looking up address…');
    picker.setPoint(lat, lng, await reverseLabel(lat, lng));
  });

  // ----- Search -----
  async function search(event) {
    if (event) event.preventDefault();
    const params = new URLSearchParams();
    if (pickup.value) { params.set('fromLat', pickup.value.lat); params.set('fromLng', pickup.value.lng); }
    if (dropoff.value) { params.set('toLat', dropoff.value.lat); params.set('toLng', dropoff.value.lng); }
    if (dateInput.value) params.set('date', dateInput.value);
    if (document.getElementById('time').value) { params.set('time', document.getElementById('time').value); params.set('window', document.getElementById('window').value); }

    // If the user typed text but never chose a suggestion, tell them
    if ((form.from.value.trim() && !pickup.value) || (form.to.value.trim() && !dropoff.value)) {
      return toast('Please choose an address from the suggestions, or click the map.', 'error');
    }

    const button = document.getElementById('search-btn');
    button.disabled = true;
    resultsEl.innerHTML = '<div class="empty">Searching…</div>';
    try {
      const { results, count } = await api('/rides/search?' + params);
      renderResults(results, count, params.has('fromLat') || params.has('toLat') || params.has('time'));
    } catch (err) {
      resultsEl.innerHTML = '';
      showError(resultsEl, err.message);
    } finally {
      button.disabled = false;
    }
  }

  function scoreClass(score) {
    return score >= 70 ? '' : score >= 40 ? 'mid' : 'low';
  }

  function renderResults(results, count, ranked) {
    titleEl.textContent = ranked ? 'Best matches' : 'Upcoming rides';
    countEl.textContent = count ? `${count} ride${count > 1 ? 's' : ''} found` : '';
    resultLayer.clearLayers();
    routeLayer.clearLayers();
    markers = {};

    if (!results.length) {
      resultsEl.innerHTML = '<div class="card empty">No rides match your search. Try a wider time window, another date, or <a href="post-ride.html">post your own ride</a>.</div>';
      return;
    }

    resultsEl.innerHTML = results.map((r, i) => {
      const m = r.match;
      const dist = [
        m.pickupKm != null ? `${m.pickupKm.toFixed(1)} km from your pickup` : '',
        m.dropKm != null ? `${m.dropKm.toFixed(1)} km from your drop-off` : '',
        m.timeDiffMins != null ? `${m.timeDiffMins} min from your time` : '',
      ].filter(Boolean).map((t) => `<span>${t}</span>`).join('');
      return `
      <article class="ride-card" data-id="${r.id}">
        ${ranked ? `<div class="score ${scoreClass(m.score)}">${m.score}%<small>match</small></div>` : ''}
        <div class="body">
          <div class="route">${i + 1}. ${esc(r.origin_label.split(',')[0])} <span class="arrow">→</span> ${esc(r.dest_label.split(',')[0])}</div>
          <div class="meta">
            <span>📅 ${formatDate(r.ride_date)}</span><span>🕗 ${formatTime(r.depart_time)}</span>
            <span>💺 ${r.seats_available} left</span><span>${formatMoney(r.cost_per_seat)} / seat</span>
            ${r.recurring_days ? `<span class="badge recurring">Repeats ${esc(r.recurring_days.replaceAll(',', ', '))}</span>` : ''}
          </div>
          <div class="meta">${dist}</div>
          <div class="meta"><span>Driver: <a href="profile.html?id=${r.driver_id}">${esc(r.driver_name)}</a></span>${starsHtml(r.driver_rating, r.driver_rating_count)}</div>
          <div style="margin-top:10px"><a class="btn sm" href="ride.html?id=${r.id}">View ride</a></div>
        </div>
      </article>`;
    }).join('');

    // Numbered markers on the map, linked to the cards
    results.forEach((r, i) => {
      const marker = L.marker([r.origin_lat, r.origin_lng], { icon: pinIcon('#0d9488', i + 1) })
        .bindPopup(`<b>${i + 1}. ${esc(r.origin_label.split(',')[0])} → ${esc(r.dest_label.split(',')[0])}</b><br>${formatTime(r.depart_time)} · ${formatMoney(r.cost_per_seat)}<br><a href="ride.html?id=${r.id}">View ride</a>`)
        .addTo(resultLayer);
      marker.on('click', () => selectRide(r, false));
      markers[r.id] = marker;
    });
    resultsEl.querySelectorAll('.ride-card').forEach((card) => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('a')) return;
        selectRide(results.find((r) => r.id === Number(card.dataset.id)), true);
      });
    });

    fitMap(results);
  }

  // Highlight a ride: draw its route and mark its card
  function selectRide(ride, openPopup) {
    routeLayer = drawRoute(map,
      { lat: ride.origin_lat, lng: ride.origin_lng, label: ride.origin_label },
      { lat: ride.dest_lat, lng: ride.dest_lng, label: ride.dest_label }, routeLayer);
    resultsEl.querySelectorAll('.ride-card').forEach((c) => c.classList.toggle('highlight', Number(c.dataset.id) === ride.id));
    const card = resultsEl.querySelector(`.ride-card[data-id="${ride.id}"]`);
    if (card && !openPopup) card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    if (openPopup) markers[ride.id].openPopup();
  }

  function fitMap(results) {
    const pts = results.map((r) => [r.origin_lat, r.origin_lng]);
    if (pickup.value) pts.push([pickup.value.lat, pickup.value.lng]);
    if (dropoff.value) pts.push([dropoff.value.lat, dropoff.value.lng]);
    if (pts.length) map.fitBounds(pts, { padding: [40, 40], maxZoom: 14 });
  }

  form.addEventListener('submit', search);
  document.getElementById('reset-btn').addEventListener('click', () => {
    pickup.clear();
    dropoff.clear();
    form.reset();
    search();
  });

  search(); // show upcoming rides straight away
})();
