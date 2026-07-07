const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwSSOUccNOeSRtoEwhvTqZL8ODG6w8J1sCL7Sej0_yAQdocrq6jXknLwyY2fqH9Wk_d/exec"; // PASTE YOUR URL AGAIN

// 1. Get Organ Name from URL (e.g., ?organ=Rogans) and build the header
const urlParams = new URLSearchParams(window.location.search);
const organName = urlParams.get('organ');
document.getElementById('organ-label').textContent =
  organName ? `${organName.toUpperCase()} SAM GOALS` : 'SAM GOALS';

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
          <input type="text" name="${q.Question_ID}_Value" placeholder="Enter value..." class="is-hidden">
        </div>
      `;

    } else if (q.Input_Type === 'double-dropdown-text') {
      // Two dropdown+textbox pairs stacked — each dropdown reveals its own
      // adjacent text field independently. Options split by "|" for the two lists.
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
            <input type="text" name="${q.Question_ID}_A_Value" placeholder="Enter value..." class="is-hidden">
          </div>
          <div class="dropdown-text-wrap">
            <select name="${q.Question_ID}_B_Selection" required><option value="">Select...</option>${select2}</select>
            <input type="text" name="${q.Question_ID}_B_Value" placeholder="Enter value..." class="is-hidden">
          </div>
        </div>
      `;

    } else {
      inputHtml = `<textarea name="${q.Question_ID}" required rows="2" placeholder="Type your answer here…"></textarea>`;
    }

    div.innerHTML = `<label>${q.Question_Text}</label>${inputHtml}`;
    container.appendChild(div);

    const textarea = div.querySelector('textarea');
    if (textarea) {
      textarea.addEventListener('input', () => autoGrow(textarea));
    }

    // For dropdown-text / double-dropdown-text fields: reveal each pair's
    // text input only once that pair's dropdown has a selection
    div.querySelectorAll('.dropdown-text-wrap').forEach(wrap => {
      const dtSelect = wrap.querySelector('select');
      const dtInput = wrap.querySelector('input[type="text"]');
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

// 4. Handle Submission
document.getElementById('questionnaire-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(e.target);
  const answers = Object.fromEntries(formData.entries());

  // The submitter's name now arrives as one of the dynamic DB-driven
  // questions inside `answers`, so it's no longer pulled out separately here.
  const payload = {
    action: 'saveResponse',
    payload: {
      organName: organName,
      submissionMonth: new Date().toISOString().slice(0, 7),
      answers: answers
    }
  };

  const btn = document.getElementById('submit-btn');
  btn.textContent = "Submitting...";
  
  const res = await fetch(APPS_SCRIPT_URL, { method: 'POST', body: JSON.stringify(payload) });
  alert("Submission successful!");
  window.location.href = 'index.html';
});

loadQuestions();