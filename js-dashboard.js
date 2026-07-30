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
const questionsView = document.getElementById('questions-view');

const allViews = [menuView, organsView, submissionsView, detailView, usersView, userSessionsView, userSessionDetailView, questionsView];

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
let currentDetailMeta = null; // set on successful load, used for download filenames

async function loadDetail(organName, rowIndex) {
  qaList.innerHTML = `<div class="empty-state">Loading answers…</div>`;
  detailHeader.innerHTML = '';
  currentDetailMeta = null;
  showView(detailView);

  try {
    // dataset attributes are always strings - coerce back to a number,
    // since the backend's getRange() call expects a real integer here
    const detail = await callBackend('getSubmissionDetail', { organName, rowIndex: Number(rowIndex) });
    currentDetailMeta = detail;

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

// ---------------------------------------------------------
// DOWNLOAD THIS SUBMISSION AS JPG / PDF
// Same html2canvas + jsPDF approach as the Questionnaire's and Rating
// form's own downloads, routed through common.js's shared black-on-
// white forcing helper, capturing #submission-capture exactly as shown.
// ---------------------------------------------------------
function buildDetailDownloadFilename(extension) {
  const meta = currentDetailMeta || {};
  const parts = [
    'SAM-Goals',
    meta.organName || 'submission',
    meta.organOption || '',
    meta.submissionMonth || new Date().toISOString().slice(0, 10)
  ].filter(Boolean);
  return parts.join('_').replace(/[^a-zA-Z0-9_-]/g, '') + '.' + extension;
}

function captureDetailCanvas() {
  const el = document.getElementById('submission-capture');
  return captureWithForcedPrintColors(el, () =>
    html2canvas(el, { backgroundColor: '#ffffff', scale: 2, useCORS: true })
  );
}

async function downloadDetailAsJpg(btn) {
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Preparing…';
  try {
    const canvas = await captureDetailCanvas();
    const link = document.createElement('a');
    link.download = buildDetailDownloadFilename('jpg');
    link.href = canvas.toDataURL('image/jpeg', 0.95);
    link.click();
  } catch (err) {
    alert('Could not generate the image: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

async function downloadDetailAsPdf(btn) {
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Preparing…';
  try {
    const canvas  = await captureDetailCanvas();
    const imgData = canvas.toDataURL('image/jpeg', 0.95);

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });

    const pageWidth  = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imgWidth   = pageWidth;
    const imgHeight  = (canvas.height * imgWidth) / canvas.width;

    let heightLeft = imgHeight;
    let position   = 0;

    pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;

    while (heightLeft > 0) {
      position = heightLeft - imgHeight;
      pdf.addPage();
      pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
    }

    pdf.save(buildDetailDownloadFilename('pdf'));
  } catch (err) {
    alert('Could not generate the PDF: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

document.getElementById('detail-download-jpg-btn').addEventListener('click', (e) => downloadDetailAsJpg(e.currentTarget));
document.getElementById('detail-download-pdf-btn').addEventListener('click', (e) => downloadDetailAsPdf(e.currentTarget));

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
// MANAGE QUESTIONS — non-destructive editing of an organ's question
// bank. Any logged-in juror can propose a new question or an edit;
// nothing here goes live until an admin (same ADMIN_ROLES gate as
// Authenticate Users) approves it from the same screen.
// -----------------------------------------------------------
const mqOrganSelect       = document.getElementById('mq-organ-select');
const mqOrganHint         = document.getElementById('mq-organ-hint');
const mqContent           = document.getElementById('mq-content');
const mqApprovalsSection  = document.getElementById('mq-approvals-section');
const mqApprovalsList     = document.getElementById('mq-approvals-list');
const mqMyPendingSection  = document.getElementById('mq-mypending-section');
const mqMyPendingList     = document.getElementById('mq-mypending-list');
const mqActiveList        = document.getElementById('mq-active-list');
const mqAddForm           = document.getElementById('mq-add-form');
const mqAddText           = document.getElementById('mq-add-text');
const mqAddType           = document.getElementById('mq-add-type');
const mqAddOptionsField   = document.getElementById('mq-add-options-field');
const mqAddOptions        = document.getElementById('mq-add-options');
const mqAddGroupedItemsField = document.getElementById('mq-add-groupeditems-field');
const mqAddGroupedItemsList  = document.getElementById('mq-add-groupeditems-list');
const mqAddAddItemBtn        = document.getElementById('mq-add-additem-btn');
const mqAddSubmitBtn      = document.getElementById('mq-add-submit-btn');
const mqAddHint           = document.getElementById('mq-add-hint');

const mqEditModal         = document.getElementById('mq-edit-modal');
const mqEditText          = document.getElementById('mq-edit-text');
const mqEditType          = document.getElementById('mq-edit-type');
const mqEditOptionsField  = document.getElementById('mq-edit-options-field');
const mqEditOptions       = document.getElementById('mq-edit-options');
const mqEditGroupedItemsField = document.getElementById('mq-edit-groupeditems-field');
const mqEditGroupedItemsList  = document.getElementById('mq-edit-groupeditems-list');
const mqEditAddItemBtn        = document.getElementById('mq-edit-additem-btn');
const mqEditHint          = document.getElementById('mq-edit-hint');
const mqEditSubmitBtn     = document.getElementById('mq-edit-submit-btn');

// Mirrors the backend's QUESTION_TYPES_REQUIRING_OPTIONS list - kept in
// sync by hand since the frontend has no way to ask the backend for it.
const MQ_OPTION_INPUT_TYPES = [
  'dropdown', 'double-dropdown', 'dropdown-text',
  'double-dropdown-number', 'double-dropdown-text', 'grouped-text'
];

let mqOrganOptionsLoaded = false;
let mqCurrentOrgan       = '';
let mqEditingQuestionId  = null;

// Organ picker here reuses the same cached organ-name list Authenticate
// Users already fetches for its "assign on approve" dropdown, filtered
// the same way the SAM Goal Responses organ cards are: a juror assigned
// to one specific organ only manages that organ's questions.
async function ensureMqOrganOptions() {
  if (mqOrganOptionsLoaded) return;

  const organNames = await loadOrganNamesForAssignment();
  const visibleOrgans = userSession.assignedOrgan === 'All'
    ? organNames
    : organNames.filter(name => name === userSession.assignedOrgan);

  mqOrganSelect.innerHTML = `<option value="" selected disabled>Please select an organ</option>` +
    visibleOrgans.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');

  mqOrganOptionsLoaded = true;
}

document.getElementById('menu-manage-questions').addEventListener('click', async () => {
  showView(questionsView);
  mqContent.classList.add('is-hidden');
  mqOrganHint.textContent = '';
  mqOrganHint.className = 'field-hint';

  try {
    await ensureMqOrganOptions();
  } catch (err) {
    mqOrganHint.textContent = `Error loading organs: ${err.message}`;
    mqOrganHint.className = 'field-hint error';
  }
});

document.getElementById('back-to-menu-from-questions').addEventListener('click', () => showView(menuView));

mqOrganSelect.addEventListener('change', () => {
  if (mqOrganSelect.value) loadQuestionManagement(mqOrganSelect.value);
});

// --- grouped-text item-list builder (Add New Question) ---
// Every row here is brand new and unsubmitted, so free add/remove is
// completely safe - the append-only restriction only matters once a
// sub-item is actually part of a live, approved question (see the Edit
// modal's builder below).
function mqCreateAddItemRow(value) {
  const row = document.createElement('div');
  row.className = 'grouped-item-row';
  row.style.cssText = 'display:flex; gap:8px; align-items:center; margin-bottom:6px;';
  row.innerHTML = `
    <input type="text" class="mq-add-item-input" placeholder="e.g. i. This is a sample" style="flex:1;" value="${escapeHtml(value || '')}">
    <button type="button" class="btn btn-secondary mq-remove-item-btn" style="flex-shrink:0; padding:6px 10px;">✕</button>
  `;
  row.querySelector('.mq-remove-item-btn').addEventListener('click', () => {
    row.remove();
    if (!mqAddGroupedItemsList.children.length) mqResetAddGroupedItems();
  });
  return row;
}

function mqResetAddGroupedItems() {
  mqAddGroupedItemsList.innerHTML = '';
  mqAddGroupedItemsList.appendChild(mqCreateAddItemRow());
}

function mqCollectAddGroupedItems() {
  return Array.from(mqAddGroupedItemsList.querySelectorAll('.mq-add-item-input'))
    .map(inp => inp.value.trim())
    .filter(Boolean);
}

mqAddAddItemBtn.addEventListener('click', () => {
  mqAddGroupedItemsList.appendChild(mqCreateAddItemRow());
});

// --- grouped-text item-list builder (Edit existing question) ---
// Items already part of the live version render as fixed-position rows
// (wording editable, no remove button, no drag/reorder) - only newly
// appended rows get a remove button, since removing one of those before
// submitting just means "don't append it," which is always safe.
function mqRenderEditGroupedItems(existingItems) {
  mqEditGroupedItemsList.innerHTML = '';
  existingItems.forEach((label, i) => {
    const row = document.createElement('div');
    row.className = 'grouped-item-row';
    row.dataset.existing = 'true';
    row.style.cssText = 'display:flex; gap:8px; align-items:center; margin-bottom:6px;';
    row.innerHTML = `
      <span style="width:28px; text-align:center; opacity:0.6; flex-shrink:0;">#${i + 1}</span>
      <input type="text" class="mq-edit-item-input" style="flex:1;" value="${escapeHtml(label)}">
    `;
    mqEditGroupedItemsList.appendChild(row);
  });
}

function mqAddEditAppendRow() {
  const position = mqEditGroupedItemsList.querySelectorAll('.mq-edit-item-input').length + 1;
  const row = document.createElement('div');
  row.className = 'grouped-item-row';
  row.style.cssText = 'display:flex; gap:8px; align-items:center; margin-bottom:6px;';
  row.innerHTML = `
    <span style="width:28px; text-align:center; opacity:0.6; flex-shrink:0;">#${position}</span>
    <input type="text" class="mq-edit-item-input" placeholder="New sub-item…" style="flex:1;">
    <button type="button" class="btn btn-secondary mq-remove-item-btn" style="flex-shrink:0; padding:6px 10px;">✕</button>
  `;
  row.querySelector('.mq-remove-item-btn').addEventListener('click', () => {
    row.remove();
    mqRenumberEditRows();
  });
  mqEditGroupedItemsList.appendChild(row);
}

// Keeps the "#N" labels honest after a not-yet-submitted new row gets
// removed - existing (already-live) rows never move, only trailing
// unsubmitted rows can shift.
function mqRenumberEditRows() {
  mqEditGroupedItemsList.querySelectorAll('.grouped-item-row').forEach((row, i) => {
    const span = row.querySelector('span');
    if (span) span.textContent = `#${i + 1}`;
  });
}

function mqCollectEditGroupedItems() {
  return Array.from(mqEditGroupedItemsList.querySelectorAll('.mq-edit-item-input'))
    .map(inp => inp.value.trim())
    .filter(Boolean);
}

mqEditAddItemBtn.addEventListener('click', mqAddEditAppendRow);

// --- Options-area mode switching (plain text field vs. item builder) ---
function mqUpdateAddOptionsUI() {
  const type = mqAddType.value;
  if (type === 'grouped-text') {
    mqAddOptionsField.classList.add('is-hidden');
    mqAddGroupedItemsField.classList.remove('is-hidden');
    if (!mqAddGroupedItemsList.children.length) mqResetAddGroupedItems();
  } else if (MQ_OPTION_INPUT_TYPES.indexOf(type) !== -1) {
    mqAddOptionsField.classList.remove('is-hidden');
    mqAddGroupedItemsField.classList.add('is-hidden');
  } else {
    mqAddOptionsField.classList.add('is-hidden');
    mqAddGroupedItemsField.classList.add('is-hidden');
  }
}

mqAddType.addEventListener('change', mqUpdateAddOptionsUI);

async function loadQuestionManagement(organName) {
  mqCurrentOrgan = organName;
  mqContent.classList.remove('is-hidden');

  mqActiveList.innerHTML = `<div class="empty-state">Loading questions…</div>`;
  mqMyPendingList.innerHTML = '';
  mqMyPendingSection.classList.add('is-hidden');
  mqApprovalsList.innerHTML = '';
  mqApprovalsSection.classList.add('is-hidden');
  mqAddHint.textContent = '';
  mqAddForm.reset();
  mqAddOptionsField.classList.add('is-hidden');

  try {
    // Only admins can call getPendingQuestionApprovals - skip it entirely
    // for everyone else rather than firing a call that will just 400.
    const calls = [callBackend('getOrganQuestionsForManagement', { organName })];
    if (canManageUsers) calls.push(callBackend('getPendingQuestionApprovals', { organName }));

    const [mgmt, approvals] = await Promise.all(calls);

    renderActiveQuestions(mgmt.activeQuestions);
    renderMyPending(mgmt.myPending);
    if (canManageUsers) renderPendingApprovals(approvals || []);

  } catch (err) {
    mqActiveList.innerHTML = `<div class="empty-state" style="color: var(--danger)">Error loading questions: ${escapeHtml(err.message)}</div>`;
  }
}

function renderActiveQuestions(questions) {
  if (!questions.length) {
    mqActiveList.innerHTML = `<div class="empty-state">No active questions for this organ yet.</div>`;
    return;
  }

  mqActiveList.innerHTML = questions.map(q => `
    <div class="submission-item" style="cursor:default;">
      <div class="user-row-info">
        <span class="submission-identifier">${escapeHtml(q.questionText)}</span>
        <span class="submission-meta">${escapeHtml(q.inputType)}${q.options ? ' · ' + escapeHtml(q.options) : ''} · v${escapeHtml(q.version)}${q.hasPendingEdit ? ' · Edit pending review' : ''}</span>
      </div>
      <button type="button" class="btn btn-secondary mq-edit-btn"
        data-qid="${escapeHtml(q.questionId)}"
        data-text="${escapeHtml(q.questionText)}"
        data-type="${escapeHtml(q.inputType)}"
        data-options="${escapeHtml(q.options || '')}"
        ${q.hasPendingEdit ? 'disabled title="An edit for this question is already awaiting review"' : ''}>Edit</button>
    </div>
  `).join('');

  mqActiveList.querySelectorAll('.mq-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => openMqEditModal(btn.dataset));
  });
}

// A juror's own pending items (new questions or edits), so they can see
// their proposal is in the queue without needing admin access themselves.
function renderMyPending(myPending) {
  if (!myPending.length) return;
  mqMyPendingSection.classList.remove('is-hidden');

  mqMyPendingList.innerHTML = myPending.map(q => `
    <div class="submission-item" style="cursor:default;">
      <div class="user-row-info">
        <span class="submission-identifier">${escapeHtml(q.questionText)}</span>
        <span class="submission-meta">${q.isEdit ? 'Edit' : 'New question'} · Submitted ${escapeHtml(q.submittedAt)}</span>
      </div>
      <span class="status-badge">Pending</span>
    </div>
  `).join('');
}

// Admin-only review queue - shows the old wording struck through next to
// the proposed wording for edits, so a reviewer can see exactly what
// would change before approving it.
function renderPendingApprovals(pending) {
  if (!pending.length) return;
  mqApprovalsSection.classList.remove('is-hidden');

  mqApprovalsList.innerHTML = pending.map(p => `
    <div class="submission-item" style="cursor:default; flex-direction:column; align-items:flex-start; gap:6px;">
      <div class="user-row-info" style="width:100%;">
        <span class="submission-identifier">${p.isEdit ? 'Edit' : 'New Question'}</span>
        <span class="submission-meta">Submitted by ${escapeHtml(p.submittedByName)} · ${escapeHtml(p.submittedAt)}</span>
      </div>
      ${p.isEdit ? `<div class="qa-answer" style="text-decoration:line-through; opacity:0.6;">${escapeHtml(p.previousText)}</div>` : ''}
      <div class="qa-answer">${escapeHtml(p.newText)}</div>
      <div class="user-decision-row">
        <button type="button" class="btn-user-approve mq-approve-btn" data-row="${p.rowIndex}">Approve</button>
        <button type="button" class="btn-user-reject mq-reject-btn" data-row="${p.rowIndex}">Reject</button>
      </div>
    </div>
  `).join('');

  mqApprovalsList.querySelectorAll('.mq-approve-btn').forEach(btn => {
    btn.addEventListener('click', () => handleQuestionDecision(btn, 'approve'));
  });
  mqApprovalsList.querySelectorAll('.mq-reject-btn').forEach(btn => {
    btn.addEventListener('click', () => handleQuestionDecision(btn, 'reject'));
  });
}

async function handleQuestionDecision(btn, decision) {
  const rowIndex = Number(btn.dataset.row);
  const card = btn.closest('.submission-item');
  card.querySelectorAll('button').forEach(b => b.disabled = true);
  btn.textContent = 'Working…';

  try {
    const action = decision === 'approve' ? 'approveQuestionProposal' : 'rejectQuestionProposal';
    await callBackend(action, { organName: mqCurrentOrgan, rowIndex });
    loadQuestionManagement(mqCurrentOrgan);
  } catch (err) {
    alert(`Failed to ${decision} this question: ${err.message}`);
    card.querySelectorAll('button').forEach(b => b.disabled = false);
    btn.textContent = decision === 'approve' ? 'Approve' : 'Reject';
  }
}

// --- Add a brand new question ---
mqAddForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const questionText = mqAddText.value.trim();
  const inputType    = mqAddType.value;
  const options       = inputType === 'grouped-text'
    ? mqCollectAddGroupedItems().join('|')
    : mqAddOptions.value.trim();

  if (!questionText || !inputType) return;
  if (MQ_OPTION_INPUT_TYPES.indexOf(inputType) !== -1 && !options) {
    mqAddHint.textContent = inputType === 'grouped-text'
      ? 'At least one sub-item is required.'
      : 'Options are required for this input type.';
    mqAddHint.className = 'field-hint error';
    return;
  }

  mqAddSubmitBtn.disabled = true;
  mqAddSubmitBtn.textContent = 'Submitting…';
  mqAddHint.textContent = '';

  try {
    await callBackend('submitQuestion', { organName: mqCurrentOrgan, questionText, inputType, options });
    mqAddForm.reset();
    mqAddOptionsField.classList.add('is-hidden');
    mqAddGroupedItemsField.classList.add('is-hidden');
    mqResetAddGroupedItems();
    mqAddHint.textContent = 'Submitted for approval.';
    mqAddHint.className = 'field-hint ok';
    loadQuestionManagement(mqCurrentOrgan);
  } catch (err) {
    mqAddHint.textContent = err.message;
    mqAddHint.className = 'field-hint error';
  } finally {
    mqAddSubmitBtn.disabled = false;
    mqAddSubmitBtn.textContent = 'Submit for Approval';
  }
});

// --- Propose an edit to an existing active question ---
function openMqEditModal(dataset) {
  mqEditingQuestionId = dataset.qid;
  mqEditText.value = dataset.text;
  mqEditType.value = dataset.type;
  mqEditType.disabled = true; // backend rejects type changes on an edit - see submitQuestionEdit

  if (dataset.type === 'grouped-text') {
    mqEditOptionsField.classList.add('is-hidden');
    mqEditGroupedItemsField.classList.remove('is-hidden');
    const existingItems = String(dataset.options || '').split('|').map(s => s.trim()).filter(Boolean);
    mqRenderEditGroupedItems(existingItems);
  } else {
    mqEditGroupedItemsField.classList.add('is-hidden');
    if (MQ_OPTION_INPUT_TYPES.indexOf(dataset.type) !== -1) {
      mqEditOptionsField.classList.remove('is-hidden');
    } else {
      mqEditOptionsField.classList.add('is-hidden');
    }
    mqEditOptions.value = dataset.options || '';
  }

  mqEditHint.textContent = 'Input type can\'t be changed on an edit — retire this question and add a new one if the type itself needs to change.';
  mqEditHint.className = 'field-hint';
  mqEditModal.classList.remove('is-hidden');
}

document.getElementById('mq-edit-cancel-btn').addEventListener('click', () => {
  mqEditModal.classList.add('is-hidden');
});

mqEditSubmitBtn.addEventListener('click', async () => {
  const questionText = mqEditText.value.trim();
  const inputType    = mqEditType.value;
  const options       = inputType === 'grouped-text'
    ? mqCollectEditGroupedItems().join('|')
    : mqEditOptions.value.trim();

  if (!questionText || !inputType) {
    mqEditHint.textContent = 'Question text and input type are required.';
    mqEditHint.className = 'field-hint error';
    return;
  }
  if (MQ_OPTION_INPUT_TYPES.indexOf(inputType) !== -1 && !options) {
    mqEditHint.textContent = inputType === 'grouped-text'
      ? 'At least one sub-item is required.'
      : 'Options are required for this input type.';
    mqEditHint.className = 'field-hint error';
    return;
  }

  mqEditSubmitBtn.disabled = true;
  mqEditSubmitBtn.textContent = 'Submitting…';

  try {
    await callBackend('submitQuestionEdit', {
      organName: mqCurrentOrgan,
      questionId: mqEditingQuestionId,
      questionText, inputType, options
    });
    mqEditModal.classList.add('is-hidden');
    loadQuestionManagement(mqCurrentOrgan);
  } catch (err) {
    mqEditHint.textContent = err.message;
    mqEditHint.className = 'field-hint error';
  } finally {
    mqEditSubmitBtn.disabled = false;
    mqEditSubmitBtn.textContent = 'Submit for Approval';
  }
});

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
