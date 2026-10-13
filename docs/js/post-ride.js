// Post-a-ride page: choose start/destination by address search or map click.
(async () => {
  await initPage({ login: true });

  const form = document.getElementById('form');
  form.date.min = todayISO();
  form.date.value = todayISO();

  const map = createMap('map');
  let routeLayer = null;
  const redraw = () => {
    routeLayer = drawRoute(map, origin.value, dest.value, routeLayer);
    const pts = [origin.value, dest.value].filter(Boolean).map((p) => [p.lat, p.lng]);
    if (pts.length) map.fitBounds(pts, { padding: [50, 50], maxZoom: 14 });
  };
  const origin = new LocationPicker(form.origin, redraw);
  const dest = new LocationPicker(form.dest, redraw);

  // Which point does the next map click set?
  let target = 'origin';
  const buttons = { origin: document.getElementById('pick-origin'), dest: document.getElementById('pick-dest') };
  const setTarget = (t) => {
    target = t;
    for (const k in buttons) buttons[k].classList.toggle('active', k === t);
  };
  buttons.origin.addEventListener('click', () => setTarget('origin'));
  buttons.dest.addEventListener('click', () => setTarget('dest'));
  map.getContainer().style.cursor = 'crosshair';

  map.on('click', async (e) => {
    const picker = target === 'origin' ? origin : dest;
    const { lat, lng } = e.latlng;
    picker.setPoint(lat, lng, 'Looking up address…');
    picker.setPoint(lat, lng, await reverseLabel(lat, lng));
    if (target === 'origin') setTarget('dest'); // convenient: next click sets the destination
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError(form, '');
    if (!origin.value) return showError(form, 'Please choose a starting point from the suggestions or the map.');
    if (!dest.value) return showError(form, 'Please choose a destination from the suggestions or the map.');
    if (!form.date.value || !form.time.value) return showError(form, 'Please pick a date and departure time.');

    const days = [...form.querySelectorAll('input[name=days]:checked')].map((c) => c.value);
    const button = document.getElementById('submit-btn');
    button.disabled = true;
    try {
      const { id } = await api('/rides', {
        method: 'POST',
        body: {
          origin_label: origin.value.label, origin_lat: origin.value.lat, origin_lng: origin.value.lng,
          dest_label: dest.value.label, dest_lat: dest.value.lat, dest_lng: dest.value.lng,
          ride_date: form.date.value, depart_time: form.time.value, recurring_days: days,
          total_seats: form.seats.value, cost_per_seat: form.cost.value, notes: form.notes.value,
        },
      });
      location.href = 'ride.html?id=' + id;
    } catch (err) {
      showError(form, err.message);
      form.scrollIntoView({ behavior: 'smooth' });
      button.disabled = false;
    }
  });
})();
