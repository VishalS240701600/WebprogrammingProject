// Admin page: list and delete users and rides.
(async () => {
  const me = await initPage({ admin: true });
  const usersEl = document.getElementById('users');
  const ridesEl = document.getElementById('rides');

  async function loadUsers() {
    const { users } = await api('/admin/users');
    usersEl.innerHTML = `<table>
      <thead><tr><th>ID</th><th>Name</th><th>Email</th><th>Organization</th><th>Rides</th><th>Requests</th><th></th></tr></thead>
      <tbody>${users.map((u) => `
        <tr>
          <td>${u.id}</td>
          <td>${esc(u.name)} ${u.is_admin ? '<span class="badge recurring">admin</span>' : ''}</td>
          <td>${esc(u.email)}</td><td>${esc(u.organization || '')}</td>
          <td>${u.rides_posted}</td><td>${u.requests_made}</td>
          <td>${u.id === me.id ? '' : `<button class="btn sm danger" data-user="${u.id}" data-name="${esc(u.name)}">Delete</button>`}</td>
        </tr>`).join('')}</tbody></table>`;
    usersEl.querySelectorAll('button[data-user]').forEach((b) =>
      b.addEventListener('click', async () => {
        if (!confirm(`Delete user "${b.dataset.name}" and all their rides, requests and ratings?`)) return;
        await withButton(b, async () => {
          await api('/admin/users/' + b.dataset.user, { method: 'DELETE' });
          toast('User deleted.');
          await Promise.all([loadUsers(), loadRides()]);
        });
      }));
  }

  async function loadRides() {
    const { rides } = await api('/admin/rides');
    if (!rides.length) return (ridesEl.innerHTML = '<p class="muted">No rides.</p>');
    ridesEl.innerHTML = `<table>
      <thead><tr><th>ID</th><th>Route</th><th>When</th><th>Driver</th><th>Seats</th><th>Cost</th><th></th></tr></thead>
      <tbody>${rides.map((r) => `
        <tr>
          <td>${r.id}</td>
          <td><a href="ride.html?id=${r.id}">${esc(r.origin_label.split(',')[0])} → ${esc(r.dest_label.split(',')[0])}</a></td>
          <td>${esc(r.ride_date)} ${esc(r.depart_time)}</td><td>${esc(r.driver_name)}</td>
          <td>${r.seats_available}/${r.total_seats}</td><td>${formatMoney(r.cost_per_seat)}</td>
          <td><button class="btn sm danger" data-ride="${r.id}">Delete</button></td>
        </tr>`).join('')}</tbody></table>`;
    ridesEl.querySelectorAll('button[data-ride]').forEach((b) =>
      b.addEventListener('click', async () => {
        if (!confirm('Delete this ride and its requests?')) return;
        await withButton(b, async () => {
          await api('/admin/rides/' + b.dataset.ride, { method: 'DELETE' });
          toast('Ride deleted.');
          await Promise.all([loadUsers(), loadRides()]);
        });
      }));
  }

  try {
    await Promise.all([loadUsers(), loadRides()]);
  } catch (err) {
    toast(err.message, 'error');
  }
})();
