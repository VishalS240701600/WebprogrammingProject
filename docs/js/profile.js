// Profile page. profile.html = my profile (editable); profile.html?id=3 = someone else's (read-only).
(async () => {
  const me = await initPage();
  const content = document.getElementById('content');
  const idParam = new URLSearchParams(location.search).get('id');

  // No id in the URL -> show my own profile (login required)
  if (!idParam && !me) return (location.href = 'login.html?next=profile.html');
  const userId = idParam ? Number(idParam) : me.id;
  const isMine = !!me && userId === me.id;

  let profile, ratings;
  try {
    [{ user: profile }, { ratings }] = await Promise.all([api('/users/' + userId), api(`/users/${userId}/ratings`)]);
  } catch (err) {
    content.innerHTML = `<div class="card empty"><h2>Profile not found</h2><p>${esc(err.message)}</p></div>`;
    return;
  }

  const joined = new Date(profile.created_at.replace(' ', 'T') + 'Z').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  content.innerHTML = `
    <div class="grid-2">
      <div>
        <div class="card">
          <h1>${esc(profile.name)}</h1>
          <p class="muted">${profile.organization ? esc(profile.organization) + ' · ' : ''}Member since ${joined}</p>
          <p style="font-size:1.1rem">${starsHtml(profile.avg_rating, profile.rating_count)}</p>
          <p class="small muted">${profile.rides_posted} ride${profile.rides_posted === 1 ? '' : 's'} posted</p>
          ${profile.phone ? `<p>📞 ${esc(profile.phone)}</p>` : ''}
        </div>
        <div class="card">
          <h2>Ratings received</h2>
          ${ratings.length ? ratings.map((r) => `
            <div class="review">
              <span class="stars">${'★'.repeat(r.score)}<span class="off">${'★'.repeat(5 - r.score)}</span></span>
              <b class="small"> ${esc(r.rater_name)}</b>
              ${r.comment ? `<p class="small" style="margin:4px 0 0">${esc(r.comment)}</p>` : ''}
            </div>`).join('') : '<p class="muted">No ratings yet.</p>'}
        </div>
      </div>
      ${isMine ? `
      <form class="card" id="edit-form" novalidate>
        <h2>Edit profile</h2>
        <div class="field"><label for="name">Name</label><input id="name" type="text" maxlength="80" value="${esc(me.name)}" required></div>
        <div class="field"><label>Email</label><input type="email" value="${esc(me.email)}" disabled></div>
        <div class="row">
          <div class="field"><label for="phone">Phone</label><input id="phone" type="tel" maxlength="20" value="${esc(me.phone || '')}"></div>
          <div class="field"><label for="organization">College / company</label><input id="organization" type="text" maxlength="120" value="${esc(me.organization || '')}"></div>
        </div>
        <details style="margin-bottom:14px">
          <summary><b>Change password</b></summary>
          <div class="field" style="margin-top:10px"><label for="current_password">Current password</label><input id="current_password" type="password" autocomplete="current-password"></div>
          <div class="field"><label for="new_password">New password</label><input id="new_password" type="password" minlength="8" maxlength="72" autocomplete="new-password"></div>
        </details>
        <button class="btn block" type="submit">Save changes</button>
      </form>` : ''}
    </div>`;

  if (isMine) {
    const form = document.getElementById('edit-form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      showError(form, '');
      const button = form.querySelector('button[type=submit]');
      button.disabled = true;
      try {
        await api('/users/me', {
          method: 'PUT',
          body: {
            name: document.getElementById('name').value,
            phone: document.getElementById('phone').value,
            organization: document.getElementById('organization').value,
            current_password: document.getElementById('current_password').value,
            new_password: document.getElementById('new_password').value,
          },
        });
        toast('Profile saved.');
        setTimeout(() => location.reload(), 600);
      } catch (err) {
        showError(form, err.message);
        button.disabled = false;
      }
    });
  }
})();
