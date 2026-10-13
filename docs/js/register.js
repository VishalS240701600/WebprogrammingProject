// Register page
(async () => {
  const user = await initPage();
  if (user) return (location.href = 'dashboard.html');

  const form = document.getElementById('form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError(form, '');
    // Quick checks in the browser (the server validates again - never trust the browser alone)
    if (form.password.value.length < 8) return showError(form, 'Password must be at least 8 characters.');
    const button = form.querySelector('button[type=submit]');
    button.disabled = true;
    try {
      await api('/auth/register', {
        method: 'POST',
        body: {
          name: document.getElementById('name').value,
          email: form.email.value,
          password: form.password.value,
          phone: form.phone.value,
          organization: form.organization.value,
        },
      });
      location.href = 'dashboard.html';
    } catch (err) {
      showError(form, err.message);
      button.disabled = false;
    }
  });
})();
