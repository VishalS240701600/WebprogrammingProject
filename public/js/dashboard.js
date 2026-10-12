// Dashboard: "My posted rides" (with incoming requests) and "My requested rides".
(async () => {
  await initPage({ login: true });
  document.getElementById('dialog-holder').innerHTML = ratingDialogHtml();

  const panels = { posted: document.getElementById('panel-posted'), requested: document.getElementById('panel-requested') };
  const tabs = { posted: document.getElementById('tab-posted'), requested: document.getElementById('tab-requested') };

  // ----- Tabs -----
  function showTab(name) {
    for (const k in tabs) {
      tabs[k].setAttribute('aria-selected', k === name);
      panels[k].classList.toggle('hidden', k !== name);
    }
    try { sessionStorage.setItem('dashTab', name); } catch (e) { /* storage may be blocked */ }
  }
  for (const k in tabs) tabs[k].addEventListener('click', () => showTab(k));
  let saved = null;
  try { saved = sessionStorage.getItem('dashTab'); } catch (e) { /* ignore */ }
  showTab(saved === 'requested' ? 'requested' : 'posted');

  const routeText = (a, b) => `${esc(a.split(',')[0])} <span class="arrow">→</span> ${esc(b.split(',')[0])}`;

  // Fill in the "Rate" buttons for a finished ride. `holder` is the element to put them in.
  async function addRateButtons(holder, rideId) {
    const { people } = await api(`/rides/${rideId}/ratable`).catch(() => ({ people: [] }));
    holder.innerHTML = people.map((p, i) => p.already_rated
      ? `<span class="badge accepted">You rated ${esc(p.name)} ✓</span>`
      : `<button class="btn sm secondary" data-i="${i}">★ Rate ${esc(p.name)}</button>`).join(' ');
    holder.querySelectorAll('button[data-i]').forEach((b) =>
      b.addEventListener('click', () => openRatingDialog(rideId, people[b.dataset.i], () => addRateButtons(holder, rideId)))
    );
  }

  // Send accept / decline / cancel to the server, then reload both lists
  async function changeRequest(button, requestId, action, message) {
    if (action === 'cancel' && !confirm('Cancel this request?')) return;
    await withButton(button, async () => {
      await api('/requests/' + requestId, { method: 'PATCH', body: { action } });
      toast(message);
      await Promise.all([loadPosted(), loadRequested()]);
    });
  }

  // ----- My posted rides -----
  async function loadPosted() {
    const { rides } = await api('/rides/mine');
    const el = panels.posted;
    if (!rides.length) {
      el.innerHTML = '<div class="card empty">You have not posted any rides yet.<br><br><a class="btn" href="post-ride.html">Post your first ride</a></div>';
      return;
    }
    el.innerHTML = rides.map((r) => {
      const pending = r.requests.filter((q) => q.status === 'pending').length;
      return `
      <article class="card" data-ride="${r.id}">
        <div class="between">
          <div>
            <div class="route"><a href="ride.html?id=${r.id}">${routeText(r.origin_label, r.dest_label)}</a></div>
            <div class="meta">
              <span>📅 ${formatDate(r.ride_date)}</span><span>🕗 ${formatTime(r.depart_time)}</span>
              <span>💺 ${r.seats_available} / ${r.total_seats} left</span><span>${formatMoney(r.cost_per_seat)} / seat</span>
              ${r.recurring_days ? `<span class="badge recurring">Repeats ${esc(r.recurring_days.replaceAll(',', ', '))}</span>` : ''}
              ${r.is_past ? '<span class="badge cancelled">Date passed</span>' : ''}
            </div>
          </div>
          <div class="btn-row">
            <a class="btn sm secondary" href="ride.html?id=${r.id}">View</a>
            <button class="btn sm danger" data-delete="${r.id}">Delete</button>
          </div>
        </div>
        <div class="req-list">
          <h3>Requests ${pending ? `<span class="badge pending">${pending} new</span>` : ''}</h3>
          ${r.requests.length ? r.requests.map((q) => `
            <div class="req">
              <div>
                <a href="profile.html?id=${q.rider_id}"><b>${esc(q.rider_name)}</b></a>
                ${q.rider_org ? `<span class="muted small">· ${esc(q.rider_org)}</span>` : ''}
                <span class="badge ${q.status}">${q.status}</span>
                <div class="small muted">${q.seats_requested} seat${q.seats_requested > 1 ? 's' : ''}${q.message ? ` · “${esc(q.message)}”` : ''}${q.status === 'accepted' && q.rider_phone ? ` · 📞 ${esc(q.rider_phone)}` : ''}</div>
              </div>
              ${q.status === 'pending' ? `
              <div class="btn-row">
                <button class="btn sm" data-act="accept" data-req="${q.id}" ${q.seats_requested > r.seats_available ? 'disabled title="Not enough seats left"' : ''}>Accept</button>
                <button class="btn sm secondary" data-act="decline" data-req="${q.id}">Decline</button>
              </div>` : ''}
            </div>`).join('') : '<p class="muted small">No requests yet.</p>'}
          ${r.is_past ? '<div class="rate-holder" style="margin-top:8px"></div>' : ''}
        </div>
      </article>`;
    }).join('');

    el.querySelectorAll('button[data-act]').forEach((b) =>
      b.addEventListener('click', () =>
        changeRequest(b, b.dataset.req, b.dataset.act, b.dataset.act === 'accept' ? 'Request accepted.' : 'Request declined.')));

    el.querySelectorAll('button[data-delete]').forEach((b) =>
      b.addEventListener('click', async () => {
        if (!confirm('Delete this ride and all its requests?')) return;
        await withButton(b, async () => {
          await api('/rides/' + b.dataset.delete, { method: 'DELETE' });
          toast('Ride deleted.');
          loadPosted();
        });
      }));

    // Rating buttons for rides whose date has passed
    el.querySelectorAll('article').forEach((card) => {
      const holder = card.querySelector('.rate-holder');
      if (holder) addRateButtons(holder, card.dataset.ride);
    });
  }

  // ----- My requested rides -----
  async function loadRequested() {
    const { requests } = await api('/requests/mine');
    const el = panels.requested;
    if (!requests.length) {
      el.innerHTML = '<div class="card empty">You have not requested any rides yet.<br><br><a class="btn" href="index.html">Find a ride</a></div>';
      return;
    }
    el.innerHTML = requests.map((q) => `
      <article class="card" data-ride="${q.ride_id}">
        <div class="between">
          <div>
            <div class="route"><a href="ride.html?id=${q.ride_id}">${routeText(q.origin_label, q.dest_label)}</a></div>
            <div class="meta">
              <span>📅 ${formatDate(q.ride_date)}</span><span>🕗 ${formatTime(q.depart_time)}</span>
              <span>💺 ${q.seats_requested} seat${q.seats_requested > 1 ? 's' : ''}</span><span>${formatMoney(q.cost_per_seat * q.seats_requested)} total</span>
              <span>Driver: <a href="profile.html?id=${q.driver_id}">${esc(q.driver_name)}</a></span>
              ${q.driver_phone ? `<span>📞 ${esc(q.driver_phone)}</span>` : ''}
            </div>
          </div>
          <div class="btn-row" style="align-items:center">
            <span class="badge ${q.status}">${q.status}</span>
            ${['pending', 'accepted'].includes(q.status) && !q.is_past ? `<button class="btn sm danger" data-cancel="${q.id}">Cancel</button>` : ''}
          </div>
        </div>
        ${q.status === 'accepted' && q.is_past ? '<div class="rate-holder req-list"></div>' : ''}
      </article>`).join('');

    el.querySelectorAll('button[data-cancel]').forEach((b) =>
      b.addEventListener('click', () => changeRequest(b, b.dataset.cancel, 'cancel', 'Request cancelled.')));
    el.querySelectorAll('article').forEach((card) => {
      const holder = card.querySelector('.rate-holder');
      if (holder) addRateButtons(holder, card.dataset.ride);
    });
  }

  try {
    await Promise.all([loadPosted(), loadRequested()]);
  } catch (err) {
    toast(err.message, 'error');
  }
})();
