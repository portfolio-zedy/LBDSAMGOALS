// APPS_SCRIPT_URL now lives in common.js, loaded before this file

// 1. Get params from URL
const urlParams     = new URLSearchParams(window.location.search);
const organName     = urlParams.get('organ');
const submitterName = urlParams.get('name');
const organOption   = urlParams.get('option') || '';

document.getElementById('organ-label').textContent =
  organName ? `${organName.toUpperCase()} SAM GOALS` : 'SAM GOALS';

const submitterNameEl = document.getElementById('submitter-name');
if (submitterNameEl) {
  submitterNameEl.textContent = submitterName
    ? `WELCOME, LEADER ${submitterName.toUpperCase()}` : '';
}

let loadedQuestions = [];

// ---------------------------------------------------------
// SESSION PERSISTENCE
// Every answer is saved to sessionStorage as the user types.
// On reload the form restores everything automatically once
// the questions finish rendering. Key is scoped to this
// exact organ+option+submitter so a different form is always
// a clean slate.
// ---------------------------------------------------------
const DRAFT_KEY = `lbd_draft__${organName}__${organOption}__${submitterName}`;

function saveDraft(answers) {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(answers));
  } catch (_) { /* storage full — silent fail */ }
}

function loadDraft() {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (_) { return {}; }
}

function clearDraft() {
  try { sessionStorage.removeItem(DRAFT_KEY); } catch (_) {}
}

// Reads every named input/select/textarea in the form into a flat object
function snapshotForm() {
  const form    = document.getElementById('questionnaire-form');
  const data    = new FormData(form);
  return Object.fromEntries(data.entries());
}

// Restores a saved draft into the rendered DOM. Handles all six input
// types including reveal-on-select fields (dropdown-text etc.)
function restoreDraft(draft) {
  if (!draft || !Object.keys(draft).length) return;

  const form = document.getElementById('questionnaire-form');

  Object.entries(draft).forEach(([name, value]) => {
    // querySelector with name selector works for input, select, textarea
    const el = form.querySelector(`[name="${CSS.escape(name)}"]`);
    if (!el) return;

    if (el.tagName === 'SELECT') {
      el.value = value;
      // Fire change so reveal-on-select wrappers show their paired input
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      el.value = value;
      // Re-trigger autoGrow for textareas
      if (el.tagName === 'TEXTAREA') autoGrow(el);
    }
  });
}

// ---------------------------------------------------------
// 2. Fetch Questions (uses localStorage cache to avoid
//    refetching the same question bank on reload)
// ---------------------------------------------------------
const Q_CACHE_KEY = `lbd_questions__${organName}`;
const Q_CACHE_TTL = 60 * 60 * 1000; // 1 hour

function saveQuestionsToCache(questions) {
  try {
    localStorage.setItem(Q_CACHE_KEY, JSON.stringify({ questions, ts: Date.now() }));
  } catch (_) {}
}

function getQuestionsFromCache() {
  try {
    const raw = localStorage.getItem(Q_CACHE_KEY);
    if (!raw) return null;
    const { questions, ts } = JSON.parse(raw);
    if (Date.now() - ts > Q_CACHE_TTL) return null;
    return questions;
  } catch (_) { return null; }
}

async function loadQuestions() {
  // Try cache first for instant render on reload
  const cached = getQuestionsFromCache();
  if (cached && cached.length) {
    renderForm(cached);
    // Refresh in background
    fetchQuestionsFromNetwork(true);
    return;
  }
  await fetchQuestionsFromNetwork(false);
}

async function fetchQuestionsFromNetwork(silent) {
  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'getQuestionnaire',
        payload: { organName }
      })
    });

    const json = await res.json();
    if (json.code !== 200) throw new Error(json.message);

    saveQuestionsToCache(json.data);
    if (!silent) renderForm(json.data);
  } catch (err) {
    if (!silent) {
      document.getElementById('dynamic-form-fields').innerHTML =
        `<p class="error">Error: ${escapeHtml(err.message)}</p>`;
    }
  }
}

// Auto-grow textarea
function autoGrow(el) {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

// Progress bar
function updateProgressBar() {
  const grid = document.getElementById('dynamic-form-fields');
  const bar  = document.getElementById('progress-bar');
  if (!grid || !bar) return;
  const scrollable = grid.scrollHeight - grid.clientHeight;
  const pct = scrollable <= 0
    ? 100
    : Math.min(100, (grid.scrollTop / scrollable) * 100);
  bar.style.width = pct + '%';
}

// ---------------------------------------------------------
// 3. Render Fields + wire persistence on every input change
// ---------------------------------------------------------
function renderForm(questions) {
  loadedQuestions = questions;
  const container = document.getElementById('dynamic-form-fields');
  container.innerHTML = '';

  questions.forEach(q => {
    const div = document.createElement('div');
    div.className = 'field';

    let inputHtml = '';

    if (q.Input_Type === 'number') {
      inputHtml = `<input type="number" name="${q.Question_ID}" required>`;

    } else if (q.Input_Type === 'dropdown') {
      const options = q.Options.split(',')
        .map(o => `<option value="${o.trim()}">${o.trim()}</option>`).join('');
      inputHtml = `<select name="${q.Question_ID}" required>
        <option value="">Select...</option>${options}</select>`;

    } else if (q.Input_Type === 'double-dropdown') {
      const [set1, set2] = q.Options.split('|');
      const s1 = (set1 || '').split(',').map(o => `<option value="${o.trim()}">${o.trim()}</option>`).join('');
      const s2 = (set2 || '').split(',').map(o => `<option value="${o.trim()}">${o.trim()}</option>`).join('');
      inputHtml = `
        <div class="double-select-wrap">
          <select name="${q.Question_ID}_A" required><option value="">Select...</option>${s1}</select>
          <select name="${q.Question_ID}_B" required><option value="">Select...</option>${s2}</select>
        </div>`;

    } else if (q.Input_Type === 'dropdown-text') {
      const options = q.Options.split(',')
        .map(o => `<option value="${o.trim()}">${o.trim()}</option>`).join('');
      inputHtml = `
        <div class="dropdown-text-wrap">
          <select name="${q.Question_ID}_Selection" required>
            <option value="">Select...</option>${options}
          </select>
          <input type="text" name="${q.Question_ID}_Value"
            placeholder="Enter value..." class="is-hidden" size="16">
        </div>`;

    } else if (q.Input_Type === 'double-dropdown-number') {
      const [set1, set2] = q.Options.split('|');
      const s1 = (set1 || '').split(',').map(o => `<option value="${o.trim()}">${o.trim()}</option>`).join('');
      const s2 = (set2 || '').split(',').map(o => `<option value="${o.trim()}">${o.trim()}</option>`).join('');
      inputHtml = `
        <div class="double-dropdown-text-wrap">
          <div class="dropdown-text-wrap">
            <select name="${q.Question_ID}_A_Selection" required>
              <option value="">Select...</option>${s1}</select>
            <input type="number" name="${q.Question_ID}_A_Value"
              placeholder="Enter number..." class="is-hidden" size="14">
          </div>
          <div class="dropdown-text-wrap">
            <select name="${q.Question_ID}_B_Selection" required>
              <option value="">Select...</option>${s2}</select>
            <input type="number" name="${q.Question_ID}_B_Value"
              placeholder="Enter number..." class="is-hidden" size="14">
          </div>
        </div>`;

    } else if (q.Input_Type === 'double-dropdown-text') {
      const [set1, set2] = q.Options.split('|');
      const s1 = (set1 || '').split(',').map(o => `<option value="${o.trim()}">${o.trim()}</option>`).join('');
      const s2 = (set2 || '').split(',').map(o => `<option value="${o.trim()}">${o.trim()}</option>`).join('');
      inputHtml = `
        <div class="double-dropdown-text-wrap">
          <div class="dropdown-textarea-wrap">
            <select name="${q.Question_ID}_A_Selection" required>
              <option value="">Select...</option>${s1}</select>
            <textarea name="${q.Question_ID}_A_Value" rows="1"
              placeholder="Enter your detailed answer…" class="is-hidden"></textarea>
          </div>
          <div class="dropdown-textarea-wrap">
            <select name="${q.Question_ID}_B_Selection" required>
              <option value="">Select...</option>${s2}</select>
            <textarea name="${q.Question_ID}_B_Value" rows="1"
              placeholder="Enter your detailed answer…" class="is-hidden"></textarea>
          </div>
        </div>`;

    } else {
      inputHtml = `<textarea name="${q.Question_ID}" required rows="2"
        placeholder="Type your answer here…"></textarea>`;
    }

    div.innerHTML = `<label>${q.Question_Text}</label>${inputHtml}`;
    container.appendChild(div);

    // Auto-grow textareas
    div.querySelectorAll('textarea').forEach(ta => {
      ta.addEventListener('input', () => autoGrow(ta));
    });

    // Reveal paired inputs + save draft on every change within this field
    div.querySelectorAll('.dropdown-text-wrap, .dropdown-textarea-wrap').forEach(wrap => {
      const dtSelect = wrap.querySelector('select');
      const dtInput  = wrap.querySelector('input[type="text"], input[type="number"], textarea');
      if (dtSelect && dtInput) {
        dtSelect.addEventListener('change', () => {
          if (dtSelect.value) {
            dtInput.classList.remove('is-hidden');
            dtInput.setAttribute('required', 'true');
          } else {
            dtInput.classList.add('is-hidden');
            dtInput.removeAttribute('required');
            dtInput.value = '';
          }
          saveDraft(snapshotForm());
        });
      }
    });
  });

  // Thank-you line at the end
  const thanksEl = document.createElement('div');
  thanksEl.className   = 'summary-thanks';
  thanksEl.textContent = `THANK YOU, FOR YOUR TIME LEADER ${submitterName ? submitterName.toUpperCase() : ''}`;
  container.appendChild(thanksEl);

  document.getElementById('submit-btn').disabled = false;

  // Wire a single delegated listener on the container to catch ALL
  // input/change events and snapshot the whole form into sessionStorage
  container.addEventListener('input',  () => saveDraft(snapshotForm()));
  container.addEventListener('change', () => saveDraft(snapshotForm()));

  // Restore any previously saved draft AFTER the form is fully in the DOM
  restoreDraft(loadDraft());

  // Progress bar
  container.addEventListener('scroll', updateProgressBar);
  window.addEventListener('resize', updateProgressBar);
  updateProgressBar();
}

// ---------------------------------------------------------
// 4. Answer display helpers (unchanged)
// ---------------------------------------------------------
function getAnswerDisplay(q, answers) {
  const id = q.Question_ID;

  if (q.Input_Type === 'double-dropdown') {
    const a = answers[`${id}_A`] || '';
    const b = answers[`${id}_B`] || '';
    return [a, b].filter(Boolean).join(' / ') || '—';
  }
  if (q.Input_Type === 'dropdown-text') {
    const sel = answers[`${id}_Selection`] || '';
    const val = answers[`${id}_Value`]     || '';
    return val ? `${sel}: ${val}` : (sel || '—');
  }
  if (q.Input_Type === 'double-dropdown-number' || q.Input_Type === 'double-dropdown-text') {
    const aSel = answers[`${id}_A_Selection`] || '';
    const aVal = answers[`${id}_A_Value`]     || '';
    const bSel = answers[`${id}_B_Selection`] || '';
    const bVal = answers[`${id}_B_Value`]     || '';
    const partA = aVal ? `${aSel}: ${aVal}` : aSel;
    const partB = bVal ? `${bSel}: ${bVal}` : bSel;
    return [partA, partB].filter(Boolean).join('  |  ') || '—';
  }
  return answers[id] || '—';
}

function buildSummaryHtml(answers) {
  const rows = loadedQuestions.map(q => `
    <div class="summary-row">
      <div class="summary-q">${escapeHtml(q.Question_Text)}</div>
      <div class="summary-a">${escapeHtml(getAnswerDisplay(q, answers))}</div>
    </div>
  `).join('');

  const dateStr = new Date().toLocaleDateString(undefined, {
    weekday: 'long', year: 'numeric', month: 'long', day: '2-digit'
  });

  return `
    <div id="summary-capture" class="summary-capture">
      <div class="summary-header">
        <div class="summary-eyebrow">Living by Design Nation</div>
        <div class="summary-title">${organName ? escapeHtml(organName.toUpperCase()) : ''} SAM GOALS</div>
        <div class="summary-sub">${submitterName ? 'Submitted by ' + escapeHtml(submitterName.toUpperCase()) : ''}${organOption ? ' · ' + escapeHtml(organOption.toUpperCase()) : ''}</div>
        <div class="summary-date">${dateStr}</div>
      </div>
      <div class="summary-body">${rows}</div>
    </div>
  `;
}

function showResultsModal(answers) {
  document.getElementById('summary-container').innerHTML = buildSummaryHtml(answers);
  document.getElementById('results-modal').classList.remove('is-hidden');
}

document.getElementById('modal-close-btn').addEventListener('click', () => {
  window.location.href = 'index.html';
});

// ---------------------------------------------------------
// 5. Submit — clear draft on success
// ---------------------------------------------------------
document.getElementById('questionnaire-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(e.target);
  const answers  = Object.fromEntries(formData.entries());

  const payload = {
    action: 'saveResponse',
    payload: {
      organName,
      organOption,
      submissionMonth: new Date().toISOString().slice(0, 7),
      submitterName,
      answers
    }
  };

  const btn = document.getElementById('submit-btn');
  btn.textContent = 'Submitting...';
  btn.disabled    = true;

  try {
    const res  = await fetch(APPS_SCRIPT_URL, { method: 'POST', body: JSON.stringify(payload) });
    const json = await res.json();
    if (json.code !== 200) throw new Error(json.message);

    // Draft is no longer needed once submitted successfully
    clearDraft();
    showResultsModal(answers);
  } catch (err) {
    alert('Submission failed: ' + err.message);
    btn.textContent = 'Submit Report';
    btn.disabled    = false;
  }
});

loadQuestions();
