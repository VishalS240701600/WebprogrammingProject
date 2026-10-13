// Rating dialog shared by the dashboard and ride-details pages.
// Needs a <dialog id="rating-dialog"> on the page (use ratingDialogHtml()).

function ratingDialogHtml() {
  return `
  <dialog id="rating-dialog" aria-labelledby="rating-title">
    <form method="dialog" id="rating-form">
      <h2 id="rating-title">Rate</h2>
      <div class="field">
        <label id="rating-stars-label">Your rating</label>
        <div class="star-input" role="radiogroup" aria-labelledby="rating-stars-label">
          ${[5, 4, 3, 2, 1].map((n) => `<input type="radio" name="score" id="star${n}" value="${n}"><label for="star${n}" title="${n} star${n > 1 ? 's' : ''}">★</label>`).join('')}
        </div>
      </div>
      <div class="field">
        <label for="rating-comment">Comment (optional)</label>
        <textarea id="rating-comment" maxlength="500"></textarea>
      </div>
      <div class="btn-row">
        <button class="btn" type="submit">Submit rating</button>
        <button class="btn secondary" type="button" id="rating-cancel">Cancel</button>
      </div>
    </form>
  </dialog>`;
}

// Open the dialog for rating `person` ({ user_id, name }) on a ride; onDone() runs after saving.
function openRatingDialog(rideId, person, onDone) {
  const dialog = document.getElementById('rating-dialog');
  const form = document.getElementById('rating-form');
  document.getElementById('rating-title').textContent = `Rate ${person.name}`;
  form.reset();
  showError(form, '');

  form.onsubmit = async (e) => {
    e.preventDefault();
    const score = form.querySelector('input[name=score]:checked');
    if (!score) return showError(form, 'Please choose 1 to 5 stars.');
    const button = form.querySelector('button[type=submit]');
    button.disabled = true;
    try {
      await api('/ratings', {
        method: 'POST',
        body: { ride_id: rideId, ratee_id: person.user_id, score: Number(score.value), comment: document.getElementById('rating-comment').value },
      });
      dialog.close();
      toast('Thanks! Your rating was saved.');
      onDone();
    } catch (err) {
      showError(form, err.message);
    } finally {
      button.disabled = false;
    }
  };
  document.getElementById('rating-cancel').onclick = () => dialog.close();
  dialog.showModal();
}
