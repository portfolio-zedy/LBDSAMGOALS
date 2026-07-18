// APPS_SCRIPT_URL now lives in common.js, loaded before this file

// 1. Check if the user is legally logged in — same guard as js-dashboard.js
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

// 2. Report type comes in via the URL for now. Phase 1 only has one
// report ("PREHOSTING BETHEL REPORT") wired up on the dashboard menu -
// once the backend grows a REPORT_TYPES sheet + getReportTypes action,
// the dashboard will pass whichever type the juror picked here instead.
const urlParams = new URLSearchParams(window.location.search);
const reportType = urlParams.get('reportType') || 'PREHOSTING_BETHEL';
const reportTitle = urlParams.get('reportTitle') || 'PREHOSTING BETHEL REPORT';

document.getElementById('report-title').textContent = reportTitle;
document.getElementById('part1-title').textContent = reportTitle;

const welcomeEl = document.getElementById('dashboard-welcome');
if (welcomeEl && userSession) {
  const fullName = (userSession.fullName || userSession.username || '').toUpperCase();
  welcomeEl.textContent = `WELCOME JUROR, ${fullName}`;
}

document.getElementById('back-to-menu').addEventListener('click', () => {
  window.location.href = 'dashboard.html';
});

// Authenticated backend call, same shape as js-dashboard.js's
// callBackend — EXCEPT it does not log the juror out on a
// "not authorized" message. In this form that message is an expected,
// legitimate outcome (a juror browsing another organ's SAM Goal
// submissions to attach a reference, when their own login is only
// assigned to one organ) rather than a sign the session itself is bad.
// Logging them out here would silently wipe an in-progress rating.
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
// 3. Organ registry — same getOrgans action index.html/jsmain.js uses.
//    The date picker stays disabled until this resolves, so a row can
//    never be added before there's anything to put in its dropdowns.
// -----------------------------------------------------------
let organsData = [];

const dateInput = document.getElementById('rating-date');
const dateHint = document.getElementById('date-hint');

async function loadOrgans() {
  dateHint.textContent = 'Loading organ registry…';
  dateHint.className = 'field-hint';

  // Nothing here previously guarded against the request itself just
  // hanging (slow connection, a cold-starting Apps Script deployment,
  // etc.) - the hint would sit on "Loading organ registry…" forever
  // with zero feedback. A hard 15s timeout means it always resolves
  // into either success or a clear, actionable error.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify({ action: 'getOrgans' }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!res.ok) throw new Error(`Server responded with ${res.status}`);

    const json = await res.json();
    if (json.code !== 200) throw new Error(json.message);
    if (!json.data.length) throw new Error('No active organs found.');

    organsData = json.data;
    dateInput.disabled = false;
    dateHint.textContent = 'Select the date this report covers.';
    dateHint.className = 'field-hint';
  } catch (err) {
    clearTimeout(timeoutId);
    const reason = err.name === 'AbortError' ? 'Request timed out.' : err.message;
    dateHint.innerHTML = `Could not load the organ registry: ${escapeHtml(reason)} <button type="button" id="retry-organs-btn" class="link-btn">Retry</button>`;
    dateHint.className = 'field-hint error';
    document.getElementById('retry-organs-btn').addEventListener('click', loadOrgans);
  }
}

// -----------------------------------------------------------
// 4. Organ / Section row repeater
// -----------------------------------------------------------
const organRowsField = document.getElementById('organ-rows-field');
const organRowsContainer = document.getElementById('organ-rows');
const organRowsHint = document.getElementById('organ-rows-hint');
const addOrganBtn = document.getElementById('add-organ-btn');
const submitBtn = document.getElementById('submit-rating-btn');
const submitHint = document.getElementById('submit-hint');
const ratingBlocksSection = document.getElementById('rating-blocks');

let rowSeq = 0;
const rows = []; // { id, organSelect, optionSelect, organName, organOption, blockEl, data }

function organOptionsHtml() {
  return organsData.map(o => `<option value="${escapeHtml(o.Organ_Name)}">${escapeHtml(o.Organ_Name)}</option>`).join('');
}

function addOrganRow() {
  const id = 'row' + (++rowSeq);
  const wrap = document.createElement('div');
  wrap.className = 'organ-row';
  wrap.dataset.rowId = id;
  wrap.innerHTML = `
    <div class="select-wrap">
      <select class="organ-row-organ" required>
        <option value="" selected disabled>Select organ</option>
        ${organOptionsHtml()}
      </select>
    </div>
    <div class="select-wrap">
      <select class="organ-row-option" required disabled>
        <option value="" selected>Select organ first</option>
      </select>
    </div>
    <button type="button" class="btn-remove-row" aria-label="Remove this organ">×</button>
  `;
  organRowsContainer.appendChild(wrap);

  const organSelect = wrap.querySelector('.organ-row-organ');
  const optionSelect = wrap.querySelector('.organ-row-option');
  const removeBtn = wrap.querySelector('.btn-remove-row');

  const rowState = { id, organSelect, optionSelect, organName: '', organOption: '', blockEl: null, data: null };
  rows.push(rowState);

  organSelect.addEventListener('change', () => {
    rowState.organName = organSelect.value;
    rowState.organOption = '';
    populateRowOptions(rowState);
    validateRows();
  });

  optionSelect.addEventListener('change', () => {
    rowState.organOption = optionSelect.value;
    validateRows();
  });

  removeBtn.addEventListener('click', () => {
    if (rows.length <= 1) return; // at least one organ must always remain
    wrap.remove();
    if (rowState.blockEl) rowState.blockEl.remove();
    const idx = rows.findIndex(r => r.id === id);
    if (idx !== -1) rows.splice(idx, 1);
    validateRows();
  });

  validateRows();
}

// Mirrors populateOrganOptions() in jsmain.js: an organ with no Options
// configured counts as its own single section, keyed off its own name.
function populateRowOptions(rowState) {
  const org = organsData.find(o => o.Organ_Name === rowState.organName);
  const rawOptions = org && org.Options ? String(org.Options).trim() : '';
  const select = rowState.optionSelect;

  select.innerHTML = '';

  if (!rawOptions) {
    const opt = document.createElement('option');
    opt.value = rowState.organName;
    opt.textContent = rowState.organName;
    select.appendChild(opt);
    select.disabled = false;
    rowState.organOption = rowState.organName;
    return;
  }

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Select a section';
  placeholder.disabled = true;
  placeholder.selected = true;
  select.appendChild(placeholder);

  rawOptions.split(',').forEach(raw => {
    const value = raw.trim();
    if (!value) return;
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = value;
    select.appendChild(opt);
  });

  select.disabled = false;
}

// -----------------------------------------------------------
// 5. Rating blocks — one independent block per valid organ/option row
// -----------------------------------------------------------
function ensureBlock(row) {
  if (!row.data) {
    row.data = {
      attendance: '', attendanceNote: '',
      prehostingReview: '',
      samGoalSubmitted: '', samGoalRef: null, samGoalRating: '',
      remark: ''
    };
  }
  if (!row.blockEl) {
    row.blockEl = createRatingBlock(row);
    ratingBlocksSection.appendChild(row.blockEl);
  }
}

function updateBlockLabel(row) {
  if (!row.blockEl) return;
  row.blockEl.querySelector('.rating-block-title').textContent = `RATING: '${row.organOption}'`;
  const optLabel = row.blockEl.querySelector('.rb-option-label');
  if (optLabel) optLabel.textContent = row.organOption;
}

function createRatingBlock(row) {
  const block = document.createElement('div');
  block.className = 'rating-block';
  block.dataset.rowId = row.id;
  block.innerHTML = `
    <h3 class="rating-block-title">RATING: '${escapeHtml(row.organOption)}'</h3>

    <div class="rating-inline-row">
      <div class="field">
        <label>Attendance (<span class="rb-option-label">${escapeHtml(row.organOption)}</span>)</label>
        <input type="number" min="0" class="rb-attendance" placeholder="Number in attendance" required>
      </div>
      <div class="field">
        <label>Attendance Note <span style="text-transform:none;font-weight:400;">(optional)</span></label>
        <input type="text" class="rb-attendance-note" placeholder="Any note on attendance…">
      </div>
    </div>

    <div class="field">
      <label>Prehosting Review</label>
      <div class="rating-scale-wrap">
        <input type="number" min="0" max="10" class="rb-prehosting" placeholder="0" required>
        <span class="rating-scale-suffix">/ 10</span>
      </div>
    </div>

    <div class="field">
      <label>SAM Goal Form Submission</label>
      <div class="select-wrap">
        <select class="rb-samgoal-submitted" required>
          <option value="" selected disabled>Select...</option>
          <option value="Yes">Yes</option>
          <option value="No">No</option>
        </select>
      </div>
      <div class="rb-samgoal-area"></div>
    </div>

    <div class="field">
      <label>Remark <span style="text-transform:none;font-weight:400;">(optional)</span></label>
      <textarea class="rb-remark" rows="2" placeholder="Any remarks for this section…"></textarea>
    </div>
  `;

  const attendanceInput = block.querySelector('.rb-attendance');
  const attendanceNoteInput = block.querySelector('.rb-attendance-note');
  const prehostingInput = block.querySelector('.rb-prehosting');
  const samGoalSelect = block.querySelector('.rb-samgoal-submitted');
  const remarkInput = block.querySelector('.rb-remark');

  attendanceInput.addEventListener('input', () => {
    row.data.attendance = attendanceInput.value;
    checkFormReady();
  });

  attendanceNoteInput.addEventListener('input', () => {
    row.data.attendanceNote = attendanceNoteInput.value;
  });

  prehostingInput.addEventListener('input', () => {
    row.data.prehostingReview = prehostingInput.value;
    checkFormReady();
  });

  samGoalSelect.addEventListener('change', () => {
    row.data.samGoalSubmitted = samGoalSelect.value;
    if (samGoalSelect.value !== 'Yes') {
      // Leaving "Yes" drops any attached reference so the form never
      // silently submits a stale ref that isn't visible anywhere.
      row.data.samGoalRef = null;
      row.data.samGoalRating = samGoalSelect.value === 'No' ? 0 : '';
    }
    renderSamGoalArea(row);

    // Auto-open the picker only on the actual "Yes" selection itself -
    // renderSamGoalArea() must NEVER trigger this on its own, or
    // cancelling the modal (which re-renders this area afterward) would
    // just reopen it in an endless loop.
    if (samGoalSelect.value === 'Yes' && !row.data.samGoalRef) {
      openRefPickerModal(row);
    }
  });

  remarkInput.addEventListener('input', () => {
    row.data.remark = remarkInput.value;
  });

  return block;
}

// Renders whatever belongs under the SAM Goal Submission dropdown for
// the current state: nothing selected yet, "No" (locked 0/10), or
// "Yes" (attached-ref preview + its own 0-10 rating input).
function renderSamGoalArea(row) {
  const area = row.blockEl.querySelector('.rb-samgoal-area');

  if (row.data.samGoalSubmitted === 'Yes') {
    if (!row.data.samGoalRef) {
      area.innerHTML = `
        <div class="field-hint">No SAM Goal submission attached yet.</div>
        <button type="button" class="rb-attach-ref-btn">Attach SAM Goal Ref</button>
      `;
      area.querySelector('.rb-attach-ref-btn').addEventListener('click', () => openRefPickerModal(row));
      checkFormReady();
      return;
    }

    area.innerHTML = `
      <div class="samgoal-ref-preview">
        <span>Attached: ${escapeHtml(row.data.samGoalRef.submitterName || 'Unknown submitter')} · ${escapeHtml(row.data.samGoalRef.timestampDisplay || '')}</span>
        <span class="ref-actions">
          <button type="button" class="rb-view-ref">View</button>
          <button type="button" class="rb-change-ref">Change</button>
        </span>
      </div>
      <div class="field" style="margin-top:12px;">
        <label>SAM Goal Rating</label>
        <div class="rating-scale-wrap">
          <input type="number" min="0" max="10" class="rb-samgoal-rating" placeholder="0" value="${escapeHtml(row.data.samGoalRating)}" required>
          <span class="rating-scale-suffix">/ 10</span>
        </div>
      </div>
    `;

    area.querySelector('.rb-samgoal-rating').addEventListener('input', (e) => {
      row.data.samGoalRating = e.target.value;
      checkFormReady();
    });
    area.querySelector('.rb-view-ref').addEventListener('click', () => openRefDetailModal(row));
    area.querySelector('.rb-change-ref').addEventListener('click', () => openRefPickerModal(row));

  } else if (row.data.samGoalSubmitted === 'No') {
    area.innerHTML = `<div class="samgoal-auto-zero">No SAM Goal form submitted this month — rating locked at <strong>0 / 10</strong>.</div>`;
  } else {
    area.innerHTML = '';
  }

  checkFormReady();
}

// -----------------------------------------------------------
// 6. "Attach SAM Goal Ref" picker — reuses getOrganSubmissions, filtered
//    client-side to this row's exact organ+option, and getSubmissionDetail
//    for the "View" preview.
// -----------------------------------------------------------
let activeRefRow = null;
const samrefModal = document.getElementById('samref-modal');
const samrefList = document.getElementById('samref-list');
const samrefModalTitle = document.getElementById('samref-modal-title');

async function openRefPickerModal(row) {
  activeRefRow = row;
  samrefModalTitle.textContent = `Attach SAM Goal Ref — ${row.organOption}`;
  samrefList.innerHTML = `<div class="empty-state">Loading submissions…</div>`;
  samrefModal.classList.remove('is-hidden');

  try {
    const submissions = await callBackend('getOrganSubmissions', { organName: row.organName });
    const matched = submissions.filter(s => String(s.organOption).trim() === String(row.organOption).trim());

    if (!matched.length) {
      samrefList.innerHTML = `<div class="empty-state">No SAM Goal submissions found for ${escapeHtml(row.organOption)} yet.</div>`;
      return;
    }

    samrefList.innerHTML = matched.map(s => `
      <button type="button" class="submission-item" data-row="${s.rowIndex}">
        <span class="submission-identifier">${escapeHtml(s.organOption || row.organOption)}</span>
        <span class="submission-meta">${s.submitterName ? escapeHtml(s.submitterName) + ' · ' : ''}${escapeHtml(s.timestampDisplay)}</span>
      </button>
    `).join('');

    samrefList.querySelectorAll('.submission-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const match = matched.find(s => String(s.rowIndex) === btn.dataset.row);
        row.data.samGoalRef = match
          ? { rowIndex: match.rowIndex, submitterName: match.submitterName, timestampDisplay: match.timestampDisplay }
          : null;
        closeSamrefModal();
        renderSamGoalArea(row);
      });
    });

  } catch (err) {
    samrefList.innerHTML = `<div class="empty-state" style="color: var(--danger)">Couldn't load submissions: ${escapeHtml(err.message)}</div>`;
  }
}

function closeSamrefModal() {
  samrefModal.classList.add('is-hidden');
  activeRefRow = null;
}

document.getElementById('samref-cancel-btn').addEventListener('click', () => {
  const row = activeRefRow;
  closeSamrefModal();
  // Re-render so the "not attached yet" hint shows if they backed out
  // without picking anything.
  if (row) renderSamGoalArea(row);
});

// "View" — read-only preview of the attached submission's full Q&A,
// reusing the same getSubmissionDetail action and qa-list markup the
// dashboard's own drill-down uses.
const refDetailModal = document.getElementById('samref-detail-modal');
const refDetailHeader = document.getElementById('samref-detail-header');
const refDetailQaList = document.getElementById('samref-detail-qa-list');

async function openRefDetailModal(row) {
  if (!row.data.samGoalRef) return;
  refDetailHeader.innerHTML = '';
  refDetailQaList.innerHTML = `<div class="empty-state">Loading answers…</div>`;
  refDetailModal.classList.remove('is-hidden');

  try {
    const detail = await callBackend('getSubmissionDetail', {
      organName: row.organName,
      rowIndex: Number(row.data.samGoalRef.rowIndex)
    });

    refDetailHeader.innerHTML = `
      <div class="detail-organ">${escapeHtml(detail.organName)}${detail.organOption ? ' · ' + escapeHtml(detail.organOption) : ''}</div>
      <div class="detail-meta">${detail.submitterName ? 'Submitted by ' + escapeHtml(detail.submitterName) + ' · ' : ''}${escapeHtml(detail.timestampDisplay)}</div>
    `;

    refDetailQaList.innerHTML = detail.answers.map(a => `
      <div class="qa-row">
        <div class="qa-num">${escapeHtml(a.number)}</div>
        <div class="qa-body">
          <div class="qa-question">${escapeHtml(a.question)}</div>
          <div class="qa-answer">Ans: ${escapeHtml(a.answer)}</div>
        </div>
      </div>
    `).join('');

  } catch (err) {
    refDetailQaList.innerHTML = `<div class="empty-state" style="color: var(--danger)">Couldn't load this submission: ${escapeHtml(err.message)}</div>`;
  }
}

document.getElementById('samref-detail-close-btn').addEventListener('click', () => {
  refDetailModal.classList.add('is-hidden');
});

// -----------------------------------------------------------
// 7. Validation — organ/section picker + every visible rating block
// -----------------------------------------------------------
function validateRows() {
  organRowsContainer.querySelectorAll('.btn-remove-row').forEach(btn => {
    btn.disabled = rows.length <= 1;
  });

  const complete = rows.filter(r => r.organName && r.organOption);
  const pairKeys = complete.map(r => r.organName + '|' + r.organOption);
  const duplicatePairKeys = pairKeys.filter((k, i) => pairKeys.indexOf(k) !== i);

  if (duplicatePairKeys.length) {
    organRowsHint.textContent = 'That organ/section is already selected — please choose a different one.';
    organRowsHint.className = 'field-hint error';
  } else if (!complete.length) {
    organRowsHint.textContent = 'Select at least one organ and its section to continue.';
    organRowsHint.className = 'field-hint';
  } else {
    organRowsHint.textContent = `${complete.length} section${complete.length === 1 ? '' : 's'} selected.`;
    organRowsHint.className = 'field-hint ok';
  }

  // Keep each row's rating block in sync: show it once the row is a
  // complete, non-duplicate organ+option pair; hide (never destroy) it
  // otherwise, so entered values survive a brief invalid state while
  // someone is mid-edit, and only actually disappear if the row itself
  // is removed.
  rows.forEach(row => {
    const pairKey = row.organName + '|' + row.organOption;
    const isDuplicate = row.organName && row.organOption && duplicatePairKeys.indexOf(pairKey) !== -1;
    const isValid = row.organName && row.organOption && !isDuplicate;

    if (isValid) {
      ensureBlock(row);
      updateBlockLabel(row);
      row.blockEl.classList.remove('is-hidden');
    } else if (row.blockEl) {
      row.blockEl.classList.add('is-hidden');
    }
  });

  const anyBlockVisible = !!ratingBlocksSection.querySelector('.rating-block:not(.is-hidden)');
  ratingBlocksSection.classList.toggle('is-hidden', !anyBlockVisible);

  checkFormReady();
}

function checkFormReady() {
  const visibleRows = rows.filter(r => r.blockEl && !r.blockEl.classList.contains('is-hidden'));

  if (!dateInput.value || !visibleRows.length) {
    submitBtn.disabled = true;
    submitHint.textContent = '';
    submitHint.className = 'field-hint';
    return;
  }

  const allGood = visibleRows.every(r => {
    const d = r.data;
    if (d.attendance === '' || d.attendance === null || isNaN(Number(d.attendance)) || Number(d.attendance) < 0) return false;
    if (d.prehostingReview === '' || isNaN(Number(d.prehostingReview))) return false;
    const pr = Number(d.prehostingReview);
    if (pr < 0 || pr > 10) return false;
    if (d.samGoalSubmitted !== 'Yes' && d.samGoalSubmitted !== 'No') return false;
    if (d.samGoalSubmitted === 'Yes') {
      if (!d.samGoalRef) return false;
      if (d.samGoalRating === '' || isNaN(Number(d.samGoalRating))) return false;
      const sr = Number(d.samGoalRating);
      if (sr < 0 || sr > 10) return false;
    }
    return true;
  });

  submitBtn.disabled = !allGood;
  submitHint.textContent = allGood
    ? 'All ratings look complete.'
    : 'Fill in every required field in each rating block to continue.';
  submitHint.className = 'field-hint ' + (allGood ? 'ok' : '');
}

addOrganBtn.addEventListener('click', addOrganRow);

// -----------------------------------------------------------
// 8. Date picker gates the organ/section builder
// -----------------------------------------------------------
dateInput.addEventListener('change', () => {
  if (dateInput.value) {
    organRowsField.classList.remove('is-hidden');
    if (!rows.length) addOrganRow();
  } else {
    organRowsField.classList.add('is-hidden');
  }
  checkFormReady();
});

// -----------------------------------------------------------
// 9. Success modal — shown once saveRating comes back OK
// -----------------------------------------------------------
const ratingSuccessModal = document.getElementById('rating-success-modal');
const ratingSuccessBody = document.getElementById('rating-success-body');

function showRatingSuccessModal() {
  ratingSuccessBody.textContent = `Your ratings for ${reportTitle} on ${dateInput.value} have been recorded.`;
  ratingSuccessModal.classList.remove('is-hidden');
}

document.getElementById('rating-success-done-btn').addEventListener('click', () => {
  window.location.href = 'dashboard.html';
});

// Reads Part 2 straight from the DOM at submit time (no separate state
// array was kept for it, since Phase 1/2 only needed local UI behavior).
// A time frame is only included if it was actually touched - checked
// Present, given a Total, or given at least one tribe - so leaving
// Part 2 untouched entirely just omits it, since it's optional.
function collectPrayerBeltPayload() {
  const remarkEl = document.querySelector('.prayer-remark');
  const prayerRemark = remarkEl ? remarkEl.value.trim() : '';

  const timeframes = Array.from(document.querySelectorAll('.timeframe-block')).map(block => {
    const timeFrame = block.dataset.timeframe;
    const present = block.querySelector('.tf-present-checkbox').checked;
    const totalRaw = block.querySelector('.tf-total').value;
    const total = totalRaw === '' ? '' : totalRaw;

    const tribes = Array.from(block.querySelectorAll('.tribe-row')).map(row => {
      const select = row.querySelector('.tribe-row-select');
      const attendanceInput = row.querySelector('.tribe-attendance-input');
      return {
        tribeName: select ? select.value : '',
        attendance: attendanceInput ? attendanceInput.value : ''
      };
    }).filter(t => t.tribeName);

    return {
      timeFrame,
      present,
      total,
      tribes,
      touched: present || total !== '' || tribes.length > 0
    };
  }).filter(tf => tf.touched);

  return { prayerRemark, timeframes };
}

// Part 3 — Hosting Bethel Report. Static fields, one set per session
// (not per organ or time frame), so this is a plain read of three
// number inputs plus a remark, no repeater or dynamic sheet lookup.
function collectHostingBethelPayload() {
  const ft = document.getElementById('hb-ft-input').value;
  const st = document.getElementById('hb-st-input').value;
  const ld = document.getElementById('hb-ld-input').value;
  const remark = document.getElementById('hb-remark-input').value.trim();

  const touched = ft !== '' || st !== '' || ld !== '' || remark !== '';
  if (!touched) return null; // optional, same as Part 2 — skip entirely if untouched

  return { ft, st, ld, remark };
}

// Builds the backend payload from every currently visible (valid,
// non-duplicate) row and saves it via the saveRating action.
document.getElementById('rating-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (submitBtn.disabled) return;

  const visibleRows = rows.filter(r => r.blockEl && !r.blockEl.classList.contains('is-hidden'));
  const ratingsPayload = visibleRows.map(r => ({
    organName: r.organName,
    organOption: r.organOption,
    attendance: r.data.attendance,
    attendanceNote: r.data.attendanceNote,
    prehostingReview: r.data.prehostingReview,
    samGoalSubmitted: r.data.samGoalSubmitted,
    samGoalRefRowIndex: r.data.samGoalRef ? r.data.samGoalRef.rowIndex : '',
    samGoalRating: r.data.samGoalRating,
    remark: r.data.remark
  }));

  const prayerBeltData = collectPrayerBeltPayload();
  const hostingBethel = collectHostingBethelPayload();

  const originalBtnText = submitBtn.textContent;
  submitBtn.textContent = 'Submitting...';
  submitBtn.disabled = true;
  submitHint.textContent = 'Saving your ratings…';
  submitHint.className = 'field-hint';

  try {
    await callBackend('saveRating', {
      reportType: reportType,
      reportTitle: reportTitle,
      ratingDate: dateInput.value,
      ratings: ratingsPayload,
      prayerRemark: prayerBeltData.prayerRemark,
      prayerBelts: prayerBeltData.timeframes,
      hostingBethel: hostingBethel
    });

    submitHint.textContent = 'Ratings saved successfully.';
    submitHint.className = 'field-hint ok';
    submitBtn.textContent = originalBtnText;
    showRatingSuccessModal();

  } catch (err) {
    submitHint.textContent = 'Could not save: ' + err.message;
    submitHint.className = 'field-hint error';
    submitBtn.textContent = originalBtnText;
    submitBtn.disabled = false;
  }
});

loadOrgans();

// -----------------------------------------------------------
// PART 2 — Prayer Belt Report (Phase 1: static shell + toggle only).
// The time frames themselves are fixed, not sheet-driven. The
// "+ Add Tribe" dropdown gets wired to the Tribe organ's real Options
// in Phase 2, and none of this affects Submit until Phase 3 wires it
// into saveRating alongside Part 1.
// -----------------------------------------------------------
const PRAYER_TIMEFRAMES = ['12 NOON', '3PM', '6PM', '9PM'];
const prayerTimeframesContainer = document.getElementById('prayer-timeframes');
let tribeRowSeq = 0;

function buildTimeframeBlock(label) {
  const block = document.createElement('div');
  block.className = 'timeframe-block';
  block.dataset.timeframe = label;
  block.innerHTML = `
    <div class="timeframe-header">
      <label class="timeframe-checkbox">
        <input type="checkbox" class="tf-present-checkbox">
        <span class="timeframe-label">${escapeHtml(label)}</span>
      </label>
    </div>

    <div class="timeframe-body is-hidden">
      <div class="tribe-rows"></div>
      <div class="field-hint tribe-hint"></div>
      <button type="button" class="btn-add-organ btn-add-tribe">+ Add Tribe for Prayer Belts</button>

      <div class="field timeframe-total-field">
        <label>Total</label>
        <input type="number" min="0" class="tf-total" placeholder="0">
      </div>
    </div>
  `;

  const checkbox = block.querySelector('.tf-present-checkbox');
  const body = block.querySelector('.timeframe-body');
  const tribeRows = block.querySelector('.tribe-rows');
  const tribeHint = block.querySelector('.tribe-hint');
  const addTribeBtn = block.querySelector('.btn-add-tribe');

  // Present/Absent gates everything below it — unchecked (Absent) hides
  // the tribe picker and Total for this time frame entirely.
  checkbox.addEventListener('change', () => {
    body.classList.toggle('is-hidden', !checkbox.checked);
  });

  // Pulled from the Tribe organ's own Options column (the one at C8 in
  // ORGANS) — already available via the getOrgans call above, so no new
  // backend call is needed for this dropdown.
  function tribeOptionsList() {
    const tribeOrgan = organsData.find(o => o.Organ_Name === 'Tribe');
    const raw = tribeOrgan && tribeOrgan.Options ? String(tribeOrgan.Options).trim() : '';
    return raw ? raw.split(',').map(v => v.trim()).filter(Boolean) : [];
  }

  // Flags (but doesn't block) picking the same tribe twice within this
  // one time frame — mirrors the organ/option duplicate hint in Part 1.
  function validateTribeRows() {
    const selects = Array.from(tribeRows.querySelectorAll('.tribe-row-select'));
    const values = selects.map(s => s.value).filter(Boolean);
    const duplicates = values.filter((v, i) => values.indexOf(v) !== i);

    if (duplicates.length) {
      tribeHint.textContent = `"${duplicates[0]}" is already added for this time frame — please choose a different tribe.`;
      tribeHint.className = 'field-hint tribe-hint error';
    } else {
      tribeHint.textContent = '';
      tribeHint.className = 'field-hint tribe-hint';
    }
  }

  // Reveals a number field the first time a row's tribe is picked, and
  // leaves it alone (value intact) if the tribe is later changed to a
  // different one in the same row.
  function renderAttendanceField(row) {
    if (!row.querySelector('.tribe-attendance-field')) {
      const field = document.createElement('div');
      field.className = 'field tribe-attendance-field';
      field.innerHTML = `
        <label>Attendance</label>
        <input type="number" min="0" class="tribe-attendance-input" placeholder="Number in attendance">
      `;
      row.appendChild(field);
    }
  }

  function addTribeRow(tribeOptions) {
    const rowId = 'tfrow' + (++tribeRowSeq);
    const row = document.createElement('div');
    row.className = 'tribe-row';
    row.dataset.rowId = rowId;
    row.innerHTML = `
      <div class="tribe-row-main">
        <div class="select-wrap">
          <select class="tribe-row-select">
            <option value="" selected disabled>Select tribe</option>
            ${tribeOptions.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('')}
          </select>
        </div>
        <button type="button" class="btn-remove-row" aria-label="Remove this tribe">×</button>
      </div>
    `;
    tribeRows.appendChild(row);

    row.querySelector('.tribe-row-select').addEventListener('change', () => {
      renderAttendanceField(row);
      validateTribeRows();
    });

    row.querySelector('.btn-remove-row').addEventListener('click', () => {
      row.remove();
      validateTribeRows();
    });
  }

  addTribeBtn.addEventListener('click', () => {
    if (!organsData.length) {
      tribeHint.textContent = 'Still loading the organ registry — try again in a moment.';
      tribeHint.className = 'field-hint tribe-hint error';
      return;
    }

    const tribeOptions = tribeOptionsList();
    if (!tribeOptions.length) {
      tribeHint.textContent = 'No Options configured for the Tribe organ in the ORGANS sheet.';
      tribeHint.className = 'field-hint tribe-hint error';
      return;
    }

    addTribeRow(tribeOptions);
  });

  return block;
}

if (prayerTimeframesContainer) {
  PRAYER_TIMEFRAMES.forEach(label => {
    prayerTimeframesContainer.appendChild(buildTimeframeBlock(label));
  });
}