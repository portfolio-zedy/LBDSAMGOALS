// APPS_SCRIPT_URL now lives in common.js, loaded before this file
// 1. Get Organ Name from URL (e.g., ?organ=Rogans) and build the header
const urlParams = new URLSearchParams(window.location.search);
const organName = urlParams.get('organ');
const submitterName = urlParams.get('name');
const organOption = urlParams.get('option') || '';
document.getElementById('organ-label').textContent =
  organName ? `${organName.toUpperCase()} SAM GOALS` : 'SAM GOALS';

const submitterNameEl = document.getElementById('submitter-name');
if (submitterNameEl) {
  submitterNameEl.textContent = submitterName ? `WELCOME, LEADER ${submitterName.toUpperCase()}` : '';
}

// Keep the raw question definitions around so we can build a readable
// summary later (the submitted FormData only has raw field names like
// Q3_A_Selection, not the original question text)
let loadedQuestions = [];

// 2. Fetch Questions
async function loadQuestions() {
  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ 
        action: 'getQuestionnaire', 
        payload: { organName: organName } 
      })
    });
    
    const json = await res.json();
    if (json.code !== 200) throw new Error(json.message);
    renderForm(json.data);
  } catch (err) {
    document.getElementById('dynamic-form-fields').innerHTML = `<p class="error">Error: ${err.message}</p>`;
  }
}

// Auto-grow a textarea to fit its content as the user types
function autoGrow(el){
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

// Progress bar: reflects how far the user has scrolled through
// the question list (the .fields-grid is the scrollable region)
function updateProgressBar(){
  const grid = document.getElementById('dynamic-form-fields');
  const bar = document.getElementById('progress-bar');
  if (!grid || !bar) return;

  const scrollable = grid.scrollHeight - grid.clientHeight;
  // If there's nothing to scroll (short questionnaire), show the bar as full
  const pct = scrollable <= 0 ? 100 : Math.min(100, (grid.scrollTop / scrollable) * 100);
  bar.style.width = pct + '%';
}

// 3. Render Fields Dynamically
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
      const options = q.Options.split(',').map(o => `<option value="${o.trim()}">${o.trim()}</option>`).join('');
      inputHtml = `<select name="${q.Question_ID}" required><option value="">Select...</option>${options}</select>`;

    } else if (q.Input_Type === 'double-dropdown') {
      // Options are split by "|" into two lists, e.g. "Red,Blue|Small,Large"
      const optionSets = q.Options.split('|');

      const list1 = optionSets[0] ? optionSets[0].split(',') : [];
      const list2 = optionSets[1] ? optionSets[1].split(',') : [];

      const select1 = list1.map(o => `<option value="${o.trim()}">${o.trim()}</option>`).join('');
      const select2 = list2.map(o => `<option value="${o.trim()}">${o.trim()}</option>`).join('');

      // "_A" / "_B" suffixes so the database saves both halves separately
      inputHtml = `
        <div class="double-select-wrap">
          <select name="${q.Question_ID}_A" required><option value="">Select...</option>${select1}</select>
          <select name="${q.Question_ID}_B" required><option value="">Select...</option>${select2}</select>
        </div>
      `;

    } else if (q.Input_Type === 'dropdown-text') {
      // A dropdown that reveals a free-text field once a selection is made
      const options = q.Options.split(',').map(o => `<option value="${o.trim()}">${o.trim()}</option>`).join('');

      // "_Selection" / "_Value" suffixes so the database splits them into two columns
      inputHtml = `
        <div class="dropdown-text-wrap">
          <select name="${q.Question_ID}_Selection" required><option value="">Select...</option>${options}</select>
          <input type="text" name="${q.Question_ID}_Value" placeholder="Enter value..." class="is-hidden" size="16">
        </div>
      `;

    } else if (q.Input_Type === 'double-dropdown-number') {
      // Two dropdown+number pairs stacked — each dropdown reveals its own
      // adjacent NUMBER field independently. Options split by "|" for the two lists.
      const optionSets = q.Options.split('|');

      const list1 = optionSets[0] ? optionSets[0].split(',') : [];
      const list2 = optionSets[1] ? optionSets[1].split(',') : [];

      const select1 = list1.map(o => `<option value="${o.trim()}">${o.trim()}</option>`).join('');
      const select2 = list2.map(o => `<option value="${o.trim()}">${o.trim()}</option>`).join('');

      // "_A_Selection"/"_A_Value" and "_B_Selection"/"_B_Value" so the database
      // gets four separate columns for this one question
      inputHtml = `
        <div class="double-dropdown-text-wrap">
          <div class="dropdown-text-wrap">
            <select name="${q.Question_ID}_A_Selection" required><option value="">Select...</option>${select1}</select>
            <input type="number" name="${q.Question_ID}_A_Value" placeholder="Enter number..." class="is-hidden" size="14">
          </div>
          <div class="dropdown-text-wrap">
            <select name="${q.Question_ID}_B_Selection" required><option value="">Select...</option>${select2}</select>
            <input type="number" name="${q.Question_ID}_B_Value" placeholder="Enter number..." class="is-hidden" size="14">
          </div>
        </div>
      `;

    } else if (q.Input_Type === 'double-dropdown-text') {
      // Two dropdown+textarea pairs stacked — each dropdown reveals its own
      // adjacent LONG-ANSWER field independently. Options split by "|" for the two lists.
      // Textareas (not single-line inputs) since these answers tend to run long.
      const optionSets = q.Options.split('|');

      const list1 = optionSets[0] ? optionSets[0].split(',') : [];
      const list2 = optionSets[1] ? optionSets[1].split(',') : [];

      const select1 = list1.map(o => `<option value="${o.trim()}">${o.trim()}</option>`).join('');
      const select2 = list2.map(o => `<option value="${o.trim()}">${o.trim()}</option>`).join('');

      // "_A_Selection"/"_A_Value" and "_B_Selection"/"_B_Value" so the database
      // gets four separate columns for this one question
      inputHtml = `
        <div class="double-dropdown-text-wrap">
          <div class="dropdown-textarea-wrap">
            <select name="${q.Question_ID}_A_Selection" required><option value="">Select...</option>${select1}</select>
            <textarea name="${q.Question_ID}_A_Value" rows="1" placeholder="Enter your detailed answer…" class="is-hidden"></textarea>
          </div>
          <div class="dropdown-textarea-wrap">
            <select name="${q.Question_ID}_B_Selection" required><option value="">Select...</option>${select2}</select>
            <textarea name="${q.Question_ID}_B_Value" rows="1" placeholder="Enter your detailed answer…" class="is-hidden"></textarea>
          </div>
        </div>
      `;

    } else {
      inputHtml = `<textarea name="${q.Question_ID}" required rows="2" placeholder="Type your answer here…"></textarea>`;
    }

    div.innerHTML = `<label>${q.Question_Text}</label>${inputHtml}`;
    container.appendChild(div);

    const textareas = div.querySelectorAll('textarea');
    textareas.forEach(ta => {
      ta.addEventListener('input', () => autoGrow(ta));
    });

    // For dropdown-text / double-dropdown-text fields: reveal each pair's
    // text field only once that pair's dropdown has a selection
    div.querySelectorAll('.dropdown-text-wrap, .dropdown-textarea-wrap').forEach(wrap => {
      const dtSelect = wrap.querySelector('select');
      const dtInput = wrap.querySelector('input[type="text"], input[type="number"], textarea');
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
        });
      }
    });
  });
  
  document.getElementById('submit-btn').disabled = false;

  // Now that the questions are in the DOM, start tracking scroll progress
  container.addEventListener('scroll', updateProgressBar);
  window.addEventListener('resize', updateProgressBar);
  updateProgressBar();
}

// Reconstructs a readable answer for one question from the raw
// FormData, since paired question types split into multiple field names
function getAnswerDisplay(q, answers) {
  const id = q.Question_ID;

  if (q.Input_Type === 'double-dropdown') {
    const a = answers[`${id}_A`] || '';
    const b = answers[`${id}_B`] || '';
    return [a, b].filter(Boolean).join(' / ') || '—';
  }

  if (q.Input_Type === 'dropdown-text') {
    const sel = answers[`${id}_Selection`] || '';
    const val = answers[`${id}_Value`] || '';
    return val ? `${sel}: ${val}` : (sel || '—');
  }

  if (q.Input_Type === 'double-dropdown-number' || q.Input_Type === 'double-dropdown-text') {
    const aSel = answers[`${id}_A_Selection`] || '';
    const aVal = answers[`${id}_A_Value`] || '';
    const bSel = answers[`${id}_B_Selection`] || '';
    const bVal = answers[`${id}_B_Value`] || '';
    const partA = aVal ? `${aSel}: ${aVal}` : aSel;
    const partB = bVal ? `${bSel}: ${bVal}` : bSel;
    return [partA, partB].filter(Boolean).join('  |  ') || '—';
  }

  return answers[id] || '—';
}

// Builds the printable/downloadable summary markup shown in the results modal
function buildSummaryHtml(answers) {
  const rows = loadedQuestions.map(q => `
    <div class="summary-row">
      <div class="summary-q">${q.Question_Text}</div>
      <div class="summary-a">${getAnswerDisplay(q, answers)}</div>
    </div>
  `).join('');

  const dateStr = new Date().toLocaleDateString(undefined, {
    weekday: 'long', year: 'numeric', month: 'long', day: '2-digit'
  });

  return `
    <div id="summary-capture" class="summary-capture">
      <div class="summary-header">
        <div class="summary-eyebrow">Living by Design Nation</div>
        <div class="summary-title">${organName ? organName.toUpperCase() : ''} SAM GOALS</div>
        <div class="summary-sub">${submitterName ? 'Submitted by ' + submitterName.toUpperCase() : ''}${organOption ? ' · ' + organOption.toUpperCase() : ''}</div>
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

// Renders the summary at its full natural height (not clipped by the
// modal's scrollable viewport) before handing it to html2canvas, so the
// exported PDF/JPEG always includes every row — not just whatever
// happens to be scrolled into view on screen.
async function captureSummaryCanvas() {
  const scrollEl = document.querySelector('.modal-scroll');
  const target = document.getElementById('summary-capture');

  const prevOverflow = scrollEl.style.overflow;
  const prevMaxHeight = scrollEl.style.maxHeight;
  scrollEl.style.overflow = 'visible';
  scrollEl.style.maxHeight = 'none';

  // Force the browser to apply the style change above before capturing
  void scrollEl.offsetHeight;

  // Wait for web fonts to finish loading so the capture matches what's
  // on screen instead of grabbing a mid-swap fallback-font layout
  if (document.fonts && document.fonts.ready) {
    try { await document.fonts.ready; } catch (err) { /* ignore */ }
  }

  const canvas = await html2canvas(target, {
    scale: 2,
    backgroundColor: '#FBF8F2',
    onclone: (clonedDoc) => {
      // html2canvas doesn't reliably resolve CSS custom properties
      // (var(--ink), var(--gold), etc.) — text colored via a variable can
      // render invisible even though it's there. Bake every element's
      // already-computed color/background/border onto the clone so the
      // capture never depends on variable resolution at all.
      const clonedTarget = clonedDoc.getElementById('summary-capture');
      if (!clonedTarget) return;

      const bakeComputedColors = (originalEl, cloneEl) => {
        const cs = window.getComputedStyle(originalEl);
        cloneEl.style.color = cs.color;
        cloneEl.style.backgroundColor = cs.backgroundColor;
        cloneEl.style.borderColor = cs.borderColor;
      };

      bakeComputedColors(target, clonedTarget);
      const originalEls = target.querySelectorAll('*');
      const clonedEls = clonedTarget.querySelectorAll('*');
      originalEls.forEach((originalEl, i) => {
        if (clonedEls[i]) bakeComputedColors(originalEl, clonedEls[i]);
      });
    }
  });

  scrollEl.style.overflow = prevOverflow;
  scrollEl.style.maxHeight = prevMaxHeight;

  return canvas;
}

// Slices a (potentially very tall) canvas across as many standard A4
// pages as needed, so long questionnaires export in full instead of
// being squeezed onto one oversized page or having content cut off
function buildPdfFromCanvas(canvas) {
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'px', format: 'a4' });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();

  const scaleRatio = pageWidth / canvas.width;
  const sliceHeightPx = pageHeight / scaleRatio; // source pixels that fit one page

  let renderedHeight = 0;
  let firstPage = true;

  while (renderedHeight < canvas.height) {
    const thisSliceHeight = Math.min(sliceHeightPx, canvas.height - renderedHeight);

    const sliceCanvas = document.createElement('canvas');
    sliceCanvas.width = canvas.width;
    sliceCanvas.height = thisSliceHeight;
    sliceCanvas.getContext('2d').drawImage(
      canvas,
      0, renderedHeight, canvas.width, thisSliceHeight,
      0, 0, canvas.width, thisSliceHeight
    );

    const imgData = sliceCanvas.toDataURL('image/jpeg', 0.95);
    if (!firstPage) pdf.addPage();
    pdf.addImage(imgData, 'JPEG', 0, 0, pageWidth, thisSliceHeight * scaleRatio);

    renderedHeight += thisSliceHeight;
    firstPage = false;
  }

  return pdf;
}

function downloadFileName(extension) {
  const organPart = organName ? organName.replace(/\s+/g, '-') : 'SAM-Goals';
  const namePart = submitterName ? '-' + submitterName.replace(/\s+/g, '-') : '';
  return `${organPart}${namePart}-${new Date().toISOString().slice(0, 10)}.${extension}`;
}

document.getElementById('download-pdf-btn').addEventListener('click', async () => {
  const canvas = await captureSummaryCanvas();
  const pdf = buildPdfFromCanvas(canvas);
  pdf.save(downloadFileName('pdf'));
});

document.getElementById('download-jpeg-btn').addEventListener('click', async () => {
  const canvas = await captureSummaryCanvas();
  const link = document.createElement('a');
  link.download = downloadFileName('jpg');
  link.href = canvas.toDataURL('image/jpeg', 0.95);
  link.click();
});

document.getElementById('modal-close-btn').addEventListener('click', () => {
  window.location.href = 'index.html';
});

// 4. Handle Submission
document.getElementById('questionnaire-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(e.target);
  const answers = Object.fromEntries(formData.entries());

  // This submission flow has no login/username tied to it — that's the
  // separate jury-login feature — so organ, section option, month, and
  // answers are what's sent to the backend.
  const payload = {
    action: 'saveResponse',
    payload: {
      organName: organName,
      organOption: organOption,
      submissionMonth: new Date().toISOString().slice(0, 7),
      submitterName: submitterName,
      answers: answers
    }
  };

  const btn = document.getElementById('submit-btn');
  btn.textContent = "Submitting...";
  btn.disabled = true;

  try {
    const res = await fetch(APPS_SCRIPT_URL, { method: 'POST', body: JSON.stringify(payload) });
    const json = await res.json();
    if (json.code !== 200) throw new Error(json.message);

    showResultsModal(answers);
  } catch (err) {
    alert('Submission failed: ' + err.message);
    btn.textContent = "Submit Report";
    btn.disabled = false;
  }
});

loadQuestions();