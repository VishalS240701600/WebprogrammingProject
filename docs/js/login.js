// Login page
(async () => {
  const user = await initPage();
  if (user) return (location.href = safeNext()); // already logged in

  const form = document.getElementById('form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError(form, '');
    const button = form.querySelector('button[type=submit]');
    button.disabled = true;
    try {
      await api('/auth/login', {
        method: 'POST',
        body: { email: form.email.value, password: form.password.value },
      });
      location.href = safeNext();
    } catch (err) {
      showError(form, err.message);
      button.disabled = false;
    }
  });
})();
