// Ride details page: route map, ride facts, request form, ratings.
(async () => {
  const user = await initPage();
  const content = document.getElementById('content');
  document.getElementById('dialog-holder').innerHTML = ratingDialogHtml();

  const id = Number(new URLSearchParams(location.search).get('id'));
  let map = null;
  let routeLayer = null;

  async function load() {
    let ride;
    try {
      ride = (await api('/rides/' + id)).ride;
    } catch (err) {
      content.innerHTML = `<div class="card empty"><h2>Ride not found</h2><p>${esc(err.message)}</p><a class="btn" href="index.html">Back to search</a></div>`;
      return;
    }
    render(ride);
    if (user && ride.is_past) loadRatings(ride);
  }

  function render(r) {
    document.title = `${r.origin_label.split(',')[0]} → ${r.dest_label.split(',')[0]} · RideBuddy`;
    content.innerHTML = `
      <div class="detail-grid">
        <div>
          <div class="card">
            <h1>${esc(r.origin_label.split(',')[0])} <span class="muted">→</span> ${esc(r.dest_label.split(',')[0])}</h1>
            <p class="muted small">From ${esc(r.origin_label)}<br>To ${esc(r.dest_label)}</p>
            <div id="ride-map" class="map" role="application" aria-label="Map showing the route"></div>
            <div class="facts">
              <div class="fact"><b>${formatDate(r.ride_date)}</b><span>${r.recurring_days ? 'First ride' : 'Date'}</span></div>
              <div class="fact"><b>${formatTime(r.depart_time)}</b><span>Departure</span></div>
              <div class="fact"><b>${r.seats_available} / ${r.total_seats}</b><span>Seats left</span></div>
              <div class="fact"><b>${formatMoney(r.cost_per_seat)}</b><span>Per seat</span></div>
            </div>
            ${r.recurring_days ? `<p><span class="badge recurring">Repeats ${esc(r.recurring_days.replaceAll(',', ', '))}</span></p>` : ''}
            ${r.notes ? `<h3>Driver's notes</h3><p>${esc(r.notes)}</p>` : ''}
          </div>
        </div>
        <div>
          <div class="card">
            <h2>Driver</h2>
            <p><a href="profile.html?id=${r.driver_id}"><b>${esc(r.driver_name)}</b></a>${r.driver_org ? `<br><span class="muted small">${esc(r.driver_org)}</span>` : ''}<br>${starsHtml(r.driver_rating, r.driver_rating_count)}</p>
            ${r.driver_phone ? `<p class="small">📞 <a href="tel:${esc(r.driver_phone)}">${esc(r.driver_phone)}</a></p>` : ''}
          </div>
          <div class="card" id="request-panel"></div>
          <div class="card hidden" id="rating-panel"></div>
        </div>
      </div>`;

    // Map: start marker, destination marker and a line between them
    if (map) map.remove();
    map = createMap('ride-map');
    const from = { lat: r.origin_lat, lng: r.origin_lng, label: r.origin_label };
    const to = { lat: r.dest_lat, lng: r.dest_lng, label: r.dest_label };
    routeLayer = drawRoute(map, from, to, null);
    map.fitBounds([[from.lat, from.lng], [to.lat, to.lng]], { padding: [40, 40] });

    renderRequestPanel(r);
  }

  // The request box changes depending on who is looking and the ride's state
  function renderRequestPanel(r) {
    const panel = document.getElementById('request-panel');
    const mine = r.my_request;
    const active = mine && ['pending', 'accepted'].includes(mine.status);

    // Reason the button must be disabled (null = the rider can request)
    let blocked = null;
    if (r.is_mine) blocked = 'This is your own ride.';
    else if (active) blocked = null; // handled below
    else if (r.is_expired) blocked = 'This ride has already happened.';
    else if (r.seats_available < 1) blocked = 'No seats left on this ride.';

    if (active) {
      panel.innerHTML = `
        <h2>Your request</h2>
        <p><span class="badge ${mine.status}">${mine.status}</span> for ${mine.seats_requested} seat${mine.seats_requested > 1 ? 's' : ''}</p>
        <p class="muted small">${mine.status === 'pending' ? 'Waiting for the driver to respond.' : 'The driver accepted! Contact details are shown above.'}</p>
        <button class="btn danger block" id="cancel-btn">Cancel request</button>`;
      document.getElementById('cancel-btn').addEventListener('click', (e) =>
        withButton(e.target, async () => {
          await api('/requests/' + mine.id, { method: 'PATCH', body: { action: 'cancel' } });
          toast('Your request was cancelled.');
          load();
        })
      );
      return;
    }

    if (r.is_mine) {
      panel.innerHTML = `
        <h2>Request a seat</h2>
        <button class="btn block" disabled>Request seats</button>
        <p class="hint">${blocked} Manage incoming requests on your <a href="dashboard.html">dashboard</a>.</p>`;
      return;
    }

    if (!user) {
      panel.innerHTML = `
        <h2>Request a seat</h2>
        <a class="btn block" href="login.html?next=${encodeURIComponent(location.pathname + location.search)}">Log in to request</a>
        <p class="hint">New? <a href="register.html">Create an account</a>.</p>`;
      return;
    }

    const maxSeats = Math.max(1, Math.min(r.seats_available, 6));
    panel.innerHTML = `
      <h2>Request a seat</h2>
      ${mine ? `<p class="muted small">Your previous request was ${esc(mine.status)}. You can send a new one.</p>` : ''}
      <form id="request-form" novalidate>
        <div class="field"><label for="seats">Seats</label>
          <select id="seats" ${blocked ? 'disabled' : ''}>${Array.from({ length: maxSeats }, (_, i) => `<option>${i + 1}</option>`).join('')}</select></div>
        <div class="field"><label for="message">Message to driver (optional)</label>
          <textarea id="message" maxlength="300" ${blocked ? 'disabled' : ''}></textarea></div>
        <button class="btn block" type="submit" ${blocked ? 'disabled' : ''}>Request seats</button>
        ${blocked ? `<p class="hint">${blocked}</p>` : `<p class="hint">Total: <span id="total"></span></p>`}
      </form>`;

    if (blocked) return;
    const seatsEl = document.getElementById('seats');
    const updateTotal = () => (document.getElementById('total').textContent = formatMoney(r.cost_per_seat * Number(seatsEl.value)));
    seatsEl.addEventListener('change', updateTotal);
    updateTotal();

    document.getElementById('request-form').addEventListener('submit', (e) => {
      e.preventDefault();
      withButton(e.target.querySelector('button'), async () => {
        await api(`/rides/${r.id}/requests`, {
          method: 'POST',
          body: { seats: Number(seatsEl.value), message: document.getElementById('message').value },
        });
        toast('Request sent! The driver will respond soon.');
        load();
      });
    });
  }

  // After the ride date: show who I can rate
  async function loadRatings(ride) {
    const { people } = await api(`/rides/${ride.id}/ratable`).catch(() => ({ people: [] }));
    if (!people.length) return;
    const panel = document.getElementById('rating-panel');
    panel.classList.remove('hidden');
    panel.innerHTML = `<h2>Rate this ride</h2>` + people.map((p, i) => `
      <div class="req">
        <span>${esc(p.name)}</span>
        ${p.already_rated ? '<span class="badge accepted">Rated ✓</span>' : `<button class="btn sm" data-i="${i}">Rate</button>`}
      </div>`).join('');
    panel.querySelectorAll('button[data-i]').forEach((b) =>
      b.addEventListener('click', () => openRatingDialog(ride.id, people[b.dataset.i], () => loadRatings(ride)))
    );
  }

  if (!Number.isInteger(id) || id < 1) {
    content.innerHTML = '<div class="card empty"><h2>No ride selected</h2><a class="btn" href="index.html">Back to search</a></div>';
  } else {
    load();
  }
})();
