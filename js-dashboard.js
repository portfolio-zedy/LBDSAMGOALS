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
const userRole = (userSession.role || '').toUpperCase();
if (welcomeEl) {
  const fullName = (userSession.fullName || userSession.username || '').toUpperCase();
  welcomeEl.textContent = `WELCOME ${userRole}, ${fullName}`;
}

// Authenticate Users card is only ever shown to these three roles - the
// backend enforces the same gate on getUsers/updateUserStatus, this is
// just about not showing a card that would immediately 400 for anyone
// else.
const canManageUsers = ['CHIEF JUROR', 'VICE JUROR', 'MAP'].indexOf(userRole) !== -1;
if (canManageUsers) {
  document.getElementById('menu-authenticate-users').classList.remove('is-hidden');
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
const usersView = document.getElementById('users-view');
const usersList = document.getElementById('users-list');
const userSessionsView = document.getElementById('user-sessions-view');
const userSessionsTitle = document.getElementById('user-sessions-title');
const userSessionsList = document.getElementById('user-sessions-list');
const userSessionDetailView = document.getElementById('user-session-detail-view');
const userSessionDetailHeader = document.getElementById('user-session-detail-header');
const userSessionDetailBlocks = document.getElementById('user-session-detail-blocks');

const allViews = [menuView, organsView, submissionsView, detailView, usersView, userSessionsView, userSessionDetailView];

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
// AUTHENTICATE USERS
// -----------------------------------------------------------

// The organ list for the "assign on approve" dropdown - fetched once
// per dashboard visit and reused across every render, since it changes
// about as rarely as the organ cards themselves do.
let organNamesForAssignment = null;

async function loadOrganNamesForAssignment() {
  if (organNamesForAssignment) return organNamesForAssignment;
  const organs = await callBackend('getOrgans', {});
  organNamesForAssignment = organs.map(o => o.Organ_Name);
  return organNamesForAssignment;
}

// getUsers() returns raw SYS_USER sheet headers (Full_Name, Username,
// Role, Assigned_Organ, Status, _rowIndex) - normalize once here so the
// rest of this file can use one consistent camelCase shape.
function normalizeUser(u) {
  return {
    username: u.Username,
    fullName: u.Full_Name,
    role: u.Role,
    assignedOrgan: u.Assigned_Organ,
    status: u.Status,
    rowIndex: u._rowIndex
  };
}

async function loadUsers() {
  usersList.innerHTML = `<div class="empty-state">Loading users…</div>`;
  showView(usersView);

  try {
    const [users] = await Promise.all([
      callBackend('getUsers', {}),
      loadOrganNamesForAssignment()
    ]);
    renderUsersList(users.map(normalizeUser));
  } catch (err) {
    usersList.innerHTML = `<div class="empty-state" style="color: var(--danger)">Error loading users: ${escapeHtml(err.message)}</div>`;
  }
}

function renderUsersList(users) {
  if (!users.length) {
    usersList.innerHTML = `<div class="empty-state">No users found.</div>`;
    return;
  }

  // Anyone who isn't Active needs a decision from this screen - a fresh
  // signup or a previously-revoked user alike - so both sort above the
  // already-active rows instead of just brand-new signups.
  const sorted = users.slice().sort((a, b) => {
    const aNeedsAction = a.status === 'Active' ? 1 : 0;
    const bNeedsAction = b.status === 'Active' ? 1 : 0;
    return aNeedsAction - bNeedsAction;
  });

  usersList.innerHTML = sorted.map(u => renderUserRow(u)).join('');

  usersList.querySelectorAll('.user-approve-btn').forEach(btn => {
    btn.addEventListener('click', () => handleUserDecision(btn, 'approve'));
  });
  usersList.querySelectorAll('.user-reject-btn').forEach(btn => {
    btn.addEventListener('click', () => handleUserDecision(btn, 'reject'));
  });
  usersList.querySelectorAll('.user-revoke-btn').forEach(btn => {
    btn.addEventListener('click', () => handleUserDecision(btn, 'reject'));
  });
  usersList.querySelectorAll('.user-view-ratings-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const row = btn.closest('.user-row');
      loadUserSessions(row.dataset.username, row.dataset.fullname);
    });
  });
}

function renderUserRow(u) {
  // 'Not Approved' (a fresh signup) and 'Rejected' (a declined signup OR
  // a previously-Active user whose access was revoked - both share this
  // one status by design) get the same organ-picker "approve" control,
  // since re-activating either one is the same call to the backend.
  const needsDecision = u.status !== 'Active';

  let statusHtml;
  if (needsDecision) {
    const organOptionsHtml = (organNamesForAssignment || [])
      .map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`)
      .join('');

    // A brand-new signup can still be turned away with Reject; a
    // Rejected row is already at that end state, so there's nothing
    // left to reject and the button is skipped for it.
    const rejectBtnHtml = u.status === 'Not Approved'
      ? `<button type="button" class="btn-user-reject user-reject-btn">Reject</button>`
      : '';

    // Rejected carries its own small badge here (Not Approved doesn't
    // need one - the decision row already makes its state obvious) so
    // it's visible at a glance even while the reinstate control sits
    // right next to it.
    const rejectedBadgeHtml = u.status === 'Rejected'
      ? `<span class="status-badge status-badge--rejected">Rejected</span>`
      : '';

    statusHtml = `
      <div class="user-decision-row">
        ${rejectedBadgeHtml}
        <select class="user-organ-select">
          <option value="" selected disabled>Assign organ…</option>
          <option value="All">All</option>
          ${organOptionsHtml}
        </select>
        <button type="button" class="btn-user-approve user-approve-btn">${u.status === 'Rejected' ? 'Reinstate' : 'Approve'}</button>
        ${rejectBtnHtml}
      </div>
    `;
  } else {
    const organSuffix = u.assignedOrgan ? ` · ${escapeHtml(u.assignedOrgan)}` : '';
    statusHtml = `
      <div class="user-status-row">
        <span class="status-badge status-badge--active">Active${organSuffix}</span>
        <button type="button" class="btn-view-ratings user-view-ratings-btn">View Ratings</button>
        <button type="button" class="btn-user-reject user-revoke-btn">Revoke</button>
      </div>
    `;
  }

  return `
    <div class="submission-item user-row" data-username="${escapeHtml(u.username)}" data-fullname="${escapeHtml(u.fullName)}" data-status="${escapeHtml(u.status)}" data-rowindex="${escapeHtml(u.rowIndex)}" style="cursor:default;">
      <div class="user-row-info">
        <span class="submission-identifier">${escapeHtml(u.fullName)}</span>
        <span class="submission-meta">@${escapeHtml(u.username)} · ${escapeHtml(u.role)}</span>
      </div>
      ${statusHtml}
    </div>
  `;
}

async function handleUserDecision(btn, decision) {
  const row = btn.closest('.user-row');
  const username = row.dataset.username;
  const fullName = row.dataset.fullname;
  const rowIndex = Number(row.dataset.rowindex);
  const wasActive = row.dataset.status === 'Active';

  // Backend's updateUserStatus speaks Status values, not decision verbs
  const status = decision === 'approve' ? 'Active' : 'Rejected';

  let assignedOrgan = '';
  if (decision === 'approve') {
    const select = row.querySelector('.user-organ-select');
    assignedOrgan = select ? select.value : '';
    if (!assignedOrgan) {
      select.classList.add('field-error');
      return;
    }
  }

  if (decision === 'reject') {
    // Same backend call either way, but the confirmation should say what
    // it will actually feel like to the person clicking it - revoking an
    // active user's access reads very differently than declining a
    // pending signup, even though both just set Status to 'Rejected'.
    const confirmMsg = wasActive
      ? `Revoke access for ${fullName || username}? They will not be able to log in until reinstated.`
      : `Reject ${fullName || username}? They will not be able to log in.`;
    if (!confirm(confirmMsg)) return;
  }

  const originalLabel = btn.textContent;
  row.querySelectorAll('button').forEach(b => b.disabled = true);
  btn.textContent = 'Working…';

  try {
    await callBackend('updateUserStatus', { rowIndex, status, assignedOrgan });
    loadUsers();
  } catch (err) {
    alert(`Failed to update this user: ${err.message}`);
    row.querySelectorAll('button').forEach(b => b.disabled = false);
    btn.textContent = originalLabel;
  }
}

// -----------------------------------------------------------
// "VIEW RATINGS" — an authorized user (CHIEF JUROR / VICE JUROR / MAP)
// browsing an active user's own rating sessions, from inside the
// Authenticate Users list. Same two-level drill-down and read-only
// rendering as previous-ratings.html's own sessions -> session-detail
// view, just pointed at getUserRatingSessions instead of
// getMyRatingSessions, and at a chosen username instead of "me".
// -----------------------------------------------------------

async function loadUserSessions(username, fullName) {
  userSessionsTitle.textContent = `${fullName || username}'s Ratings`;
  userSessionsList.innerHTML = `<div class="empty-state">Loading ratings…</div>`;
  showView(userSessionsView);

  try {
    const sessions = await callBackend('getUserRatingSessions', { username });

    if (!sessions.length) {
      userSessionsList.innerHTML = `<div class="empty-state">${escapeHtml(fullName || username)} hasn't submitted any ratings yet.</div>`;
      return;
    }

    userSessionsList.innerHTML = sessions.map(s => `
      <button type="button" class="submission-item" data-session="${escapeHtml(s.sessionId)}">
        <span class="submission-identifier">${escapeHtml(s.ratingDate)}</span>
        <span class="submission-meta">${escapeHtml(s.reportTitle)} · ${escapeHtml(s.organOptionsSummary)} · ${escapeHtml(s.timestampDisplay)}</span>
      </button>
    `).join('');

    userSessionsList.querySelectorAll('.submission-item').forEach(item => {
      item.addEventListener('click', () => loadUserSessionDetail(item.dataset.session));
    });

  } catch (err) {
    userSessionsList.innerHTML = `<div class="empty-state" style="color: var(--danger)">Error loading ratings: ${escapeHtml(err.message)}</div>`;
  }
}

async function loadUserSessionDetail(sessionId) {
  userSessionDetailBlocks.innerHTML = `<div class="empty-state">Loading ratings…</div>`;
  userSessionDetailHeader.innerHTML = '';
  showView(userSessionDetailView);

  try {
    const detail = await callBackend('getRatingSessionDetail', { sessionId });

    userSessionDetailHeader.innerHTML = `
      <div class="detail-organ">${escapeHtml(detail.reportTitle)}</div>
      <div class="detail-meta">${escapeHtml(detail.ratingDate)} · Submitted by ${escapeHtml(detail.jurorFullName)} · ${escapeHtml(detail.timestampDisplay)}</div>
    `;

    userSessionDetailBlocks.innerHTML = detail.blocks.map(b => `
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

    userSessionDetailBlocks.querySelectorAll('.rb-view-ref-link').forEach(btn => {
      btn.addEventListener('click', () => openRefViewModal(btn.dataset.organ, Number(btn.dataset.row)));
    });

  } catch (err) {
    userSessionDetailHeader.innerHTML = `<div class="detail-organ" style="color: var(--danger)">Couldn't load this session</div>`;
    userSessionDetailBlocks.innerHTML = `<div class="empty-state" style="color: var(--danger)">Error: ${escapeHtml(err.message)}</div>`;
  }
}

// Mirrors previous-ratings.html's read-only Prayer Belt block.
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

// Mirrors previous-ratings.html's read-only Hosting Bethel block.
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

// "View submission" from inside a rating block — reuses
// getSubmissionDetail, same modal shape as previous-ratings.html's own.
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

// -----------------------------------------------------------
// Back navigation
// -----------------------------------------------------------
document.getElementById('back-to-menu').addEventListener('click', () => showView(menuView));
document.getElementById('back-to-organs').addEventListener('click', () => showView(organsView));
document.getElementById('back-to-submissions').addEventListener('click', () => showView(submissionsView));
document.getElementById('back-to-menu-from-users').addEventListener('click', () => showView(menuView));
document.getElementById('back-to-users').addEventListener('click', () => showView(usersView));
document.getElementById('back-to-user-sessions').addEventListener('click', () => showView(userSessionsView));

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

document.getElementById('menu-authenticate-users').addEventListener('click', () => {
  loadUsers();
});

showView(menuView);
