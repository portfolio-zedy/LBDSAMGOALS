// APPS_SCRIPT_URL now lives in common.js, loaded before this file

// 1. Check if the user is legally logged in
const sessionStr = sessionStorage.getItem('jurySession');
if (!sessionStr) {
  window.location.href = 'jury-login.html';
}

const userSession = JSON.parse(sessionStr);

// 2. Personalize the dashboard
document.getElementById('user-greeting').innerHTML =
  `Logged in as: <strong>${userSession.username}</strong> (${userSession.assignedOrgan})`;

// 3. Handle Logout
document.getElementById('logout-btn').addEventListener('click', () => {
  sessionStorage.removeItem('jurySession');
  window.location.href = 'index.html';
});

// View elements (three levels: organs -> submissions -> Q&A detail)
const organsView = document.getElementById('organs-view');
const organGrid = document.getElementById('organ-grid');
const submissionsView = document.getElementById('submissions-view');
const submissionsList = document.getElementById('submissions-list');
const submissionsOrganTitle = document.getElementById('submissions-organ-title');
const detailView = document.getElementById('detail-view');
const detailHeader = document.getElementById('detail-header');
const qaList = document.getElementById('qa-list');

function showView(view) {
  [organsView, submissionsView, detailView].forEach(v => v.classList.add('is-hidden'));
  view.classList.remove('is-hidden');
}

async function callBackend(action, payload) {
  const res = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    body: JSON.stringify({ action, payload })
  });
  const json = await res.json();
  if (json.code !== 200) throw new Error(json.message);
  return json.data;
}

// -----------------------------------------------------------
// LEVEL 1: organ cards
// -----------------------------------------------------------
async function loadOrganCards() {
  try {
    const organs = await callBackend('getOrgans', {});

    // A juror assigned to one specific organ only sees that organ's
    // card; a juror assigned "All" sees every active organ.
    const visibleOrgans = userSession.assignedOrgan === 'All'
      ? organs
      : organs.filter(o => o.Organ_Name === userSession.assignedOrgan);

    if (!visibleOrgans.length) {
      organGrid.innerHTML = `<div class="empty-state">No organs available.</div>`;
      return;
    }

    organGrid.innerHTML = visibleOrgans.map(o => `
      <button type="button" class="organ-card" data-organ="${o.Organ_Name}">
        <span class="organ-card-name">${o.Organ_Name}</span>
        <span class="organ-card-arrow">→</span>
      </button>
    `).join('');

    organGrid.querySelectorAll('.organ-card').forEach(card => {
      card.addEventListener('click', () => loadSubmissions(card.dataset.organ));
    });

  } catch (err) {
    organGrid.innerHTML = `<div class="empty-state" style="color: var(--danger)">Error loading organs: ${err.message}</div>`;
  }
}

// -----------------------------------------------------------
// LEVEL 2: an organ's submissions, identified by Organ_Option
// -----------------------------------------------------------
async function loadSubmissions(organName) {
  submissionsOrganTitle.textContent = organName;
  submissionsList.innerHTML = `<div class="empty-state">Loading submissions…</div>`;
  showView(submissionsView);

  try {
    const submissions = await callBackend('getOrganSubmissions', { organName });

    if (!submissions.length) {
      submissionsList.innerHTML = `<div class="empty-state">No submissions found for ${organName} yet.</div>`;
      return;
    }

    submissionsList.innerHTML = submissions.map(s => `
      <button type="button" class="submission-item" data-row="${s.rowIndex}">
        <span class="submission-identifier">${s.organOption || organName}</span>
        <span class="submission-meta">${s.submitterName ? s.submitterName + ' · ' : ''}${s.timestampDisplay}</span>
      </button>
    `).join('');

    submissionsList.querySelectorAll('.submission-item').forEach(item => {
      item.addEventListener('click', () => loadDetail(organName, item.dataset.row));
    });

  } catch (err) {
    submissionsList.innerHTML = `<div class="empty-state" style="color: var(--danger)">Error loading submissions: ${err.message}</div>`;
  }
}

// -----------------------------------------------------------
// LEVEL 3: full Question/Answer list for one submission
// -----------------------------------------------------------
async function loadDetail(organName, rowIndex) {
  qaList.innerHTML = `<div class="empty-state">Loading answers…</div>`;
  detailHeader.innerHTML = '';
  showView(detailView);

  try {
    // dataset attributes are always strings - coerce back to a number,
    // since the backend's getRange() call expects a real integer here
    const detail = await callBackend('getSubmissionDetail', { organName, rowIndex: Number(rowIndex) });

    detailHeader.innerHTML = `
      <div class="detail-organ">${detail.organName}${detail.organOption ? ' · ' + detail.organOption : ''}</div>
      <div class="detail-meta">${detail.submitterName ? 'Submitted by ' + detail.submitterName + ' · ' : ''}${detail.timestampDisplay}</div>
    `;

    qaList.innerHTML = detail.answers.map(a => `
      <div class="qa-row">
        <div class="qa-num">${a.number}</div>
        <div class="qa-body">
          <div class="qa-question">${a.question}</div>
          <div class="qa-answer">Ans: ${a.answer}</div>
        </div>
      </div>
    `).join('');

  } catch (err) {
    // Show the error in BOTH slots, so a failed fetch never leaves the
    // header silently blank while only the body says what went wrong
    detailHeader.innerHTML = `<div class="detail-organ" style="color: var(--danger)">Couldn't load this submission</div>`;
    qaList.innerHTML = `<div class="empty-state" style="color: var(--danger)">Error loading answers: ${err.message}</div>`;
  }
}

// -----------------------------------------------------------
// Back navigation
// -----------------------------------------------------------
document.getElementById('back-to-organs').addEventListener('click', () => showView(organsView));
document.getElementById('back-to-submissions').addEventListener('click', () => showView(submissionsView));

loadOrganCards();