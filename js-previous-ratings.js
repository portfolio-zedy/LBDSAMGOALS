// APPS_SCRIPT_URL now lives in common.js, loaded before this file

// 1. Check if the user is legally logged in — same guard as the rest of
// the dashboard pages
const sessionStr = sessionStorage.getItem('jurySession');
if (!sessionStr) {
  window.location.href = 'jury-login.html';
}

const userSession = sessionStr ? JSON.parse(sessionStr) : null;

if (userSession && !userSession.token) {
  sessionStorage.removeItem('jurySession');
  window.location.href = 'jury-login.html';
}

// escapeHtml() now lives in common.js, loaded before this file

const welcomeEl = document.getElementById('dashboard-welcome');
if (welcomeEl && userSession) {
  const fullName = (userSession.fullName || userSession.username || '').toUpperCase();
  welcomeEl.textContent = `WELCOME JUROR, ${fullName}`;
}

// Same shape as js-dashboard.js's callBackend, but — like the rating
// form — doesn't log the juror out on a "not authorized" message, since
// that can legitimately mean "this session belongs to someone else,"
// not "your login is bad."
async function callBackend(action, payload) {
  const res = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    body: JSON.stringify({ action, payload: { ...payload, token: userSession.token } })
  });
  const json = await res.json();

  if (json.code !== 200) {
    const msg = json.message || '';
    if (msg.indexOf('session') !== -1) {
      sessionStorage.removeItem('jurySession');
      window.location.href = 'jury-login.html';
    }
    throw new Error(json.message);
  }

  return json.data;
}

// -----------------------------------------------------------
// View elements — sibling of the organs -> submissions -> Q&A drill-
// down, pointed at ratings instead: sessions -> blocks (no separate
// report-type picker layer - see loadAllSessions below)
// -----------------------------------------------------------
const sessionsView = document.getElementById('sessions-view');
const sessionsList = document.getElementById('sessions-list');
const sessionDetailView = document.getElementById('session-detail-view');
const sessionDetailHeader = document.getElementById('session-detail-header');
const sessionDetailBlocks = document.getElementById('session-detail-blocks');

const allViews = [sessionsView, sessionDetailView];
function showView(view) {
  allViews.forEach(v => v.classList.add('is-hidden'));
  view.classList.remove('is-hidden');
}

document.getElementById('back-to-menu').addEventListener('click', () => {
  window.location.href = 'dashboard.html';
});
document.getElementById('back-to-sessions').addEventListener('click', () => showView(sessionsView));

// Every session this juror has ever submitted, fetched once and
// rendered directly - no report-type grouping layer, so browsing here
// never needs a second round trip.
let allSessions = [];

// -----------------------------------------------------------
// LEVEL 1: every session, organ/section breakdown shown right on
// each row via organOptionsSummary (e.g. "Team A, Team B + Prayer
// Belt") - so the organs a session covered are visible immediately,
// with no extra click through a report-type card first.
// -----------------------------------------------------------
async function loadAllSessions() {
  sessionsList.innerHTML = `<div class="empty-state">Loading your ratings…</div>`;
  try {
    allSessions = await callBackend('getMyRatingSessions', {});

    if (!allSessions.length) {
      sessionsList.innerHTML = `<div class="empty-state">You haven't submitted any ratings yet.</div>`;
      return;
    }

    renderSessionsList(allSessions);

  } catch (err) {
    sessionsList.innerHTML = `<div class="empty-state" style="color: var(--danger)">Error loading your ratings: ${escapeHtml(err.message)}</div>`;
  }
}

// -----------------------------------------------------------
// Renders every session as its own row - most recent first (already
// sorted server-side) - with the organs/sections it covered shown
// right on the row instead of behind a report-type card.
// -----------------------------------------------------------
function renderSessionsList(sessions) {
  sessionsList.innerHTML = sessions.map(s => `
    <button type="button" class="submission-item" data-session="${escapeHtml(s.sessionId)}">
      <span class="submission-identifier">${escapeHtml(s.ratingDate)}</span>
      <span class="submission-meta">${escapeHtml(s.reportTitle)} · ${escapeHtml(s.organOptionsSummary)} · ${escapeHtml(s.timestampDisplay)}</span>
    </button>
  `).join('');

  sessionsList.querySelectorAll('.submission-item').forEach(item => {
    item.addEventListener('click', () => loadSessionDetail(item.dataset.session));
  });
}

// -----------------------------------------------------------
// LEVEL 2: one session's full set of rating blocks, read-only
// -----------------------------------------------------------
async function loadSessionDetail(sessionId) {
  sessionDetailBlocks.innerHTML = `<div class="empty-state">Loading ratings…</div>`;
  sessionDetailHeader.innerHTML = '';
  showView(sessionDetailView);

  try {
    const detail = await callBackend('getRatingSessionDetail', { sessionId });

    sessionDetailHeader.innerHTML = `
      <div class="detail-organ">${escapeHtml(detail.reportTitle)}</div>
      <div class="detail-meta">${escapeHtml(detail.ratingDate)} · Submitted by ${escapeHtml(detail.jurorFullName)} · ${escapeHtml(detail.timestampDisplay)}</div>
    `;

    sessionDetailBlocks.innerHTML = detail.blocks.map(b => `
      <div class="rating-block">
        <h3 class="rating-block-title">RATING: '${escapeHtml(b.organOption)}'</h3>

        <div class="qa-row">
          <div class="qa-body">
            <div class="qa-question">Attendance</div>
            <div class="qa-answer">${escapeHtml(b.attendance)}${b.attendanceNote ? ' — ' + escapeHtml(b.attendanceNote) : ''}</div>
          </div>
        </div>

        <div class="qa-row">
          <div class="qa-body">
            <div class="qa-question">Prehosting Review</div>
            <div class="qa-answer">${escapeHtml(b.prehostingReview)} / 10</div>
          </div>
        </div>

        <div class="qa-row">
          <div class="qa-body">
            <div class="qa-question">SAM Goal Form Submission</div>
            <div class="qa-answer">
              ${b.samGoalSubmitted === 'Yes'
                ? `Yes · ${escapeHtml(b.samGoalRating)} / 10 <button type="button" class="rb-view-ref-link" data-organ="${escapeHtml(b.organName)}" data-row="${escapeHtml(b.samGoalRefRowIndex)}">View submission</button>`
                : `No · 0 / 10 (auto)`}
            </div>
          </div>
        </div>

        ${b.remark ? `
        <div class="qa-row">
          <div class="qa-body">
            <div class="qa-question">Remark</div>
            <div class="qa-answer">${escapeHtml(b.remark)}</div>
          </div>
        </div>` : ''}
      </div>
    `).join('') + renderPrayerBeltsReadOnly(detail.prayerBelts) + renderHostingBethelReadOnly(detail.hostingBethel);

    sessionDetailBlocks.querySelectorAll('.rb-view-ref-link').forEach(btn => {
      btn.addEventListener('click', () => openRefViewModal(btn.dataset.organ, Number(btn.dataset.row)));
    });

  } catch (err) {
    sessionDetailHeader.innerHTML = `<div class="detail-organ" style="color: var(--danger)">Couldn't load this session</div>`;
    sessionDetailBlocks.innerHTML = `<div class="empty-state" style="color: var(--danger)">Error: ${escapeHtml(err.message)}</div>`;
  }
}

// Part 2 — read-only Prayer Belt time frames, if this session has any.
// The closing remark is duplicated onto every Prayer Belt row server-
// side, so just take it from whichever entry has it.
function renderPrayerBeltsReadOnly(prayerBelts) {
  if (!prayerBelts || !prayerBelts.length) return '';

  const sharedRemark = (prayerBelts.find(tf => tf.remark) || {}).remark || '';

  const blocksHtml = prayerBelts.map(tf => `
    <div class="rating-block">
      <h3 class="rating-block-title">${escapeHtml(tf.timeFrame)} — ${tf.present ? 'Present' : 'Absent'}</h3>

      ${tf.tribes.length ? tf.tribes.map(t => `
        <div class="qa-row">
          <div class="qa-body">
            <div class="qa-question">${escapeHtml(t.tribeName)}</div>
            <div class="qa-answer">${escapeHtml(t.attendance)} in attendance</div>
          </div>
        </div>
      `).join('') : `
        <div class="qa-row">
          <div class="qa-body">
            <div class="qa-answer">No tribes recorded for this time frame.</div>
          </div>
        </div>
      `}

      <div class="qa-row">
        <div class="qa-body">
          <div class="qa-question">Total</div>
          <div class="qa-answer">${escapeHtml(tf.total)}</div>
        </div>
      </div>
    </div>
  `).join('');

  return `
    <h2 class="dash-view-title" style="margin-top:24px;">Prayer Belt Report</h2>
    ${blocksHtml}
    ${sharedRemark ? `<div class="field-hint" style="margin-top:4px;">Remark: ${escapeHtml(sharedRemark)}</div>` : ''}
  `;
}

// Part 3 — read-only Hosting Bethel Report, one set of ratings for the
// whole session, if it was filled in.
function renderHostingBethelReadOnly(hostingBethel) {
  if (!hostingBethel) return '';

  return `
    <h2 class="dash-view-title" style="margin-top:24px;">Hosting Bethel Report</h2>
    <div class="rating-block">
      <div class="qa-row">
        <div class="qa-body">
          <div class="qa-question">First Timers (FT)</div>
          <div class="qa-answer">${escapeHtml(hostingBethel.ft)} / 10</div>
        </div>
      </div>
      <div class="qa-row">
        <div class="qa-body">
          <div class="qa-question">Smooth Transition (ST)</div>
          <div class="qa-answer">${escapeHtml(hostingBethel.st)} / 10</div>
        </div>
      </div>
      <div class="qa-row">
        <div class="qa-body">
          <div class="qa-question">Leaders Defence (LD)</div>
          <div class="qa-answer">${escapeHtml(hostingBethel.ld)} / 10</div>
        </div>
      </div>
      ${hostingBethel.remark ? `
      <div class="qa-row">
        <div class="qa-body">
          <div class="qa-question">Overall Remark</div>
          <div class="qa-answer">${escapeHtml(hostingBethel.remark)}</div>
        </div>
      </div>` : ''}
    </div>
  `;
}

// -----------------------------------------------------------
// "View submission" — reuses getSubmissionDetail, same as the rating
// form's own SAM Goal ref preview
// -----------------------------------------------------------
const refViewModal = document.getElementById('ref-view-modal');
const refViewHeader = document.getElementById('ref-view-header');
const refViewQaList = document.getElementById('ref-view-qa-list');

async function openRefViewModal(organName, rowIndex) {
  refViewHeader.innerHTML = '';
  refViewQaList.innerHTML = `<div class="empty-state">Loading answers…</div>`;
  refViewModal.classList.remove('is-hidden');

  try {
    const detail = await callBackend('getSubmissionDetail', { organName, rowIndex });

    refViewHeader.innerHTML = `
      <div class="detail-organ">${escapeHtml(detail.organName)}${detail.organOption ? ' · ' + escapeHtml(detail.organOption) : ''}</div>
      <div class="detail-meta">${detail.submitterName ? 'Submitted by ' + escapeHtml(detail.submitterName) + ' · ' : ''}${escapeHtml(detail.timestampDisplay)}</div>
    `;

    refViewQaList.innerHTML = detail.answers.map(a => `
      <div class="qa-row">
        <div class="qa-num">${escapeHtml(a.number)}</div>
        <div class="qa-body">
          <div class="qa-question">${escapeHtml(a.question)}</div>
          <div class="qa-answer">Ans: ${escapeHtml(a.answer)}</div>
        </div>
      </div>
    `).join('');

  } catch (err) {
    refViewQaList.innerHTML = `<div class="empty-state" style="color: var(--danger)">Couldn't load this submission: ${escapeHtml(err.message)}</div>`;
  }
}

document.getElementById('ref-view-close-btn').addEventListener('click', () => {
  refViewModal.classList.add('is-hidden');
});

loadAllSessions();
