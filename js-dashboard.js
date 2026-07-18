// APPS_SCRIPT_URL now lives in common.js, loaded before this file

// 1. Check if the user is legally logged in
const sessionStr = sessionStorage.getItem('jurySession');
if (!sessionStr) {
  window.location.href = 'jury-login.html';
}

const userSession = JSON.parse(sessionStr);

// A session with no token is either from before this token-based login
// existed, or was hand-edited in devtools - either way it can't be
// verified server-side, so treat it the same as not being logged in.
if (!userSession.token) {
  sessionStorage.removeItem('jurySession');
  window.location.href = 'jury-login.html';
}

// 2. Personalize the dashboard
document.getElementById('user-greeting').innerHTML =
  `Logged in as: <strong>${escapeHtml(userSession.username)}</strong> (${escapeHtml(userSession.assignedOrgan)})`;

const welcomeEl = document.getElementById('dashboard-welcome');
if (welcomeEl) {
  const role = (userSession.role || '').toUpperCase();
  const fullName = (userSession.fullName || userSession.username || '').toUpperCase();
  welcomeEl.textContent = `WELCOME ${role}, ${fullName}`;
}

// 3. Handle Logout
document.getElementById('logout-btn').addEventListener('click', () => {
  sessionStorage.removeItem('jurySession');
  window.location.href = 'index.html';
});

// View elements — the dashboard landing menu, plus the existing three
// drill-down levels (organs -> submissions -> Q&A detail), which now
// live one level deeper, behind the "Organ SAM Goal Responses" card.
const menuView = document.getElementById('menu-view');
const organsView = document.getElementById('organs-view');
const organGrid = document.getElementById('organ-grid');
const submissionsView = document.getElementById('submissions-view');
const submissionsList = document.getElementById('submissions-list');
const submissionsOrganTitle = document.getElementById('submissions-organ-title');
const detailView = document.getElementById('detail-view');
const detailHeader = document.getElementById('detail-header');
const qaList = document.getElementById('qa-list');

const allViews = [menuView, organsView, submissionsView, detailView];

function showView(view) {
  allViews.forEach(v => v.classList.add('is-hidden'));
  view.classList.remove('is-hidden');
}

// Organ cards are only fetched the first time "Organ SAM Goal Responses"
// is opened, not on every visit back to that card from the menu.
let organCardsLoaded = false;

async function callBackend(action, payload) {
  const res = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    body: JSON.stringify({ action, payload: { ...payload, token: userSession.token } })
  });
  const json = await res.json();

  if (json.code !== 200) {
    // The server rejects an invalid/expired/unauthorized token with the
    // same 400 shape as any other error - if that's what happened here,
    // the session is no longer good for anything, so clear it and send
    // the person back to log in again rather than leaving them stuck on
    // a dashboard that will fail every subsequent click too.
    const msg = json.message || '';
    if (msg.indexOf('session') !== -1 || msg.indexOf('not authorized') !== -1) {
      sessionStorage.removeItem('jurySession');
      window.location.href = 'jury-login.html';
    }
    throw new Error(json.message);
  }

  return json.data;
}

// -----------------------------------------------------------
// LEVEL 1: organ cards
// -----------------------------------------------------------
async function loadOrganCards() {
  organCardsLoaded = true;
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
      <button type="button" class="organ-card" data-organ="${escapeHtml(o.Organ_Name)}">
        <span class="organ-card-name">${escapeHtml(o.Organ_Name)}</span>
        <span class="organ-card-arrow">→</span>
      </button>
    `).join('');

    organGrid.querySelectorAll('.organ-card').forEach(card => {
      card.addEventListener('click', () => loadSubmissions(card.dataset.organ));
    });

  } catch (err) {
    organCardsLoaded = false; // let the next click retry instead of getting stuck
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
        <span class="submission-identifier">${escapeHtml(s.organOption || organName)}</span>
        <span class="submission-meta">${s.submitterName ? escapeHtml(s.submitterName) + ' · ' : ''}${escapeHtml(s.timestampDisplay)}</span>
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
      <div class="detail-organ">${escapeHtml(detail.organName)}${detail.organOption ? ' · ' + escapeHtml(detail.organOption) : ''}</div>
      <div class="detail-meta">${detail.submitterName ? 'Submitted by ' + escapeHtml(detail.submitterName) + ' · ' : ''}${escapeHtml(detail.timestampDisplay)}</div>
    `;

    qaList.innerHTML = detail.answers.map(a => `
      <div class="qa-row">
        <div class="qa-num">${escapeHtml(a.number)}</div>
        <div class="qa-body">
          <div class="qa-question">${escapeHtml(a.question)}</div>
          <div class="qa-answer">Ans: ${escapeHtml(a.answer)}</div>
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
document.getElementById('back-to-menu').addEventListener('click', () => showView(menuView));
document.getElementById('back-to-organs').addEventListener('click', () => showView(organsView));
document.getElementById('back-to-submissions').addEventListener('click', () => showView(submissionsView));

// -----------------------------------------------------------
// DASHBOARD LANDING MENU
// -----------------------------------------------------------
document.getElementById('menu-create-rating').addEventListener('click', () => {
  // Phase 1: this links straight to the one report type that exists so
  // far. Once the backend grows a REPORT_TYPES sheet + getReportTypes
  // action, this will offer a picker instead whenever more than one
  // report type is active.
  const reportType = 'PREHOSTING_BETHEL';
  const reportTitle = 'PREHOSTING BETHEL REPORT';
  window.location.href =
    `rating-form.html?reportType=${encodeURIComponent(reportType)}&reportTitle=${encodeURIComponent(reportTitle)}`;
});

document.getElementById('menu-previous-ratings').addEventListener('click', () => {
  window.location.href = 'previous-ratings.html';
});

document.getElementById('menu-organ-responses').addEventListener('click', () => {
  showView(organsView);
  if (!organCardsLoaded) loadOrganCards();
});

showView(menuView);