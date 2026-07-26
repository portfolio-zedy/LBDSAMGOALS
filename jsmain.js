/* ---------------------------------------------------------
   ORGAN DROPDOWN — populated dynamically from Google Sheets
   (Live clock + auto theme logic now live in common.js)
--------------------------------------------------------- */
// APPS_SCRIPT_URL now lives in common.js, loaded before this file
const organSelect = document.getElementById('organ-select');
const organHint = document.getElementById('organ-hint');
const startBtn = document.getElementById('start-btn');
const organOptionField = document.getElementById('organ-option-field');
const organOptionSelect = document.getElementById('organ-option-select');
const organOptionLabel = document.getElementById('organ-option-label');
const nameField = document.getElementById('name-field');
const nameInput = document.getElementById('user-name');
const availabilityHint = document.getElementById('availability-hint');

// True whenever the currently selected organ+option already has a
// submission this month - blocks the Start button regardless of what
// else is filled in
let formBlockedThisMonth = false;

// Keep the full organ records (not just names) so that once an organ is
// picked we can look up its own Options column and build the second
// dropdown from it
let organsData = [];

function revealOrganField(){
  const loader = document.getElementById('organ-loader');
  const field = document.getElementById('organ-field');
  if (loader) loader.classList.add('is-hidden');
  if (field) field.classList.remove('is-hidden');
}

function populateOrgans(organs){
  revealOrganField();
  organsData = organs;

  organSelect.innerHTML = '';

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Please select your organ';
  placeholder.disabled = true;
  placeholder.selected = true;
  organSelect.appendChild(placeholder);

  organs.forEach(org => {
    const opt = document.createElement('option');
    opt.value = org.Organ_Name;
    opt.textContent = org.Organ_Name;
    organSelect.appendChild(opt);
  });

  organSelect.disabled = false;
  organHint.textContent = `${organs.length} organ${organs.length === 1 ? '' : 's'} loaded.`;
  organHint.className = 'field-hint ok';
}

function loadOrgansFallback(){
  populateOrgans([]);
  organHint.textContent = 'Please connect to the internet to view forms.';
  organHint.className = 'field-hint error';
}

async function loadOrgans(){
  if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL.includes('YOUR_DEPLOYMENT_ID')) {
    loadOrgansFallback();
    return;
  }

  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      redirect: 'follow', 
      headers: {
        'Content-Type': 'text/plain;charset=utf-8',
      },
      body: JSON.stringify({ action: 'getOrgans' }) 
    });

    if (!res.ok) throw new Error('Network response was not ok');

    const responseJson = await res.json();

    if (responseJson.code !== 200) {
        throw new Error(responseJson.message);
    }

    const organs = responseJson.data;

    if (!organs.length) throw new Error('Empty organ list');

    populateOrgans(organs);
  } catch (err) {
    console.error('Failed to load organs from Apps Script:', err);
    loadOrgansFallback();
  }
}

loadOrgans();

/* ---------------------------------------------------------
   ORGAN-SPECIFIC SECTION DROPDOWN
   Populated from that organ's own "Options" column in the
   ORGANS sheet (e.g. "Team A,Team B,Team C"). Only shown when
   the selected organ actually has an Options value.
--------------------------------------------------------- */
function populateOrganOptions(organName){
  const org = organsData.find(o => o.Organ_Name === organName);
  const rawOptions = org && org.Options ? String(org.Options).trim() : '';

  organOptionSelect.innerHTML = '';

  if (!rawOptions) {
    // This organ has no Options configured — skip the field entirely
    organOptionField.classList.add('is-hidden');
    organOptionSelect.removeAttribute('required');
    if (organOptionLabel) organOptionLabel.textContent = 'Section';
    return;
  }

  // Show the organ's own name on the label instead of the generic
  // "Section" placeholder, e.g. "Hubs" instead of "Section"
  if (organOptionLabel) organOptionLabel.textContent = organName;

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Please select an option';
  placeholder.disabled = true;
  placeholder.selected = true;
  organOptionSelect.appendChild(placeholder);

  rawOptions.split(',').forEach(raw => {
    const value = raw.trim();
    if (!value) return;
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = value;
    organOptionSelect.appendChild(opt);
  });

  organOptionField.classList.remove('is-hidden');
  // Always compulsory whenever this field is actually shown
  organOptionSelect.setAttribute('required', 'true');
}

/* ---------------------------------------------------------
   MONTHLY AVAILABILITY CHECK
   As soon as an organ (and its section, if it has one) is fully
   selected, ask the backend whether this organ+option has already
   been submitted this month - so the user finds out BEFORE filling
   out the whole questionnaire, not after.
--------------------------------------------------------- */
async function checkAvailability(organName, organOption){
  if (!availabilityHint) return;

  availabilityHint.textContent = 'Checking availability…';
  availabilityHint.className = 'field-hint';
  formBlockedThisMonth = false;
  checkStartReady();

  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify({
        action: 'checkExistingSubmission',
        payload: { organName: organName, organOption: organOption }
      })
    });

    const json = await res.json();
    if (json.code !== 200) throw new Error(json.message);

    if (json.data && json.data.exists) {
      formBlockedThisMonth = true;
      availabilityHint.textContent =
        `DEAR LEADER, THE FORM HAS BEEN FILLED FOR THIS MONTH, THE FORM WILL BE OPEN BY ${json.data.reopensOn}, THANK YOU`;
      availabilityHint.className = 'field-hint error';
    } else {
      formBlockedThisMonth = false;
      availabilityHint.textContent = '';
      availabilityHint.className = 'field-hint';
    }
  } catch (err) {
    // Fail open here - if the availability check itself can't be
    // reached, don't block the user; saveResponse still enforces the
    // same rule server-side as a backstop.
    formBlockedThisMonth = false;
    availabilityHint.textContent = '';
    availabilityHint.className = 'field-hint';
  }

  checkStartReady();
}

function clearAvailabilityHint(){
  formBlockedThisMonth = false;
  if (availabilityHint) {
    availabilityHint.textContent = '';
    availabilityHint.className = 'field-hint';
  }
}

/* ---------------------------------------------------------
   ACTIONS
--------------------------------------------------------- */
document.getElementById('jury-form').addEventListener('submit', function(e){
  e.preventDefault();
  const organ = organSelect.value;
  const name = nameInput.value.trim();
  const optionNeeded = !organOptionField.classList.contains('is-hidden');
  const option = optionNeeded ? organOptionSelect.value : '';

  if (!organ || !name || (optionNeeded && !option) || formBlockedThisMonth) return;

  let url = `questionnaire.html?organ=${encodeURIComponent(organ)}&name=${encodeURIComponent(name)}`;
  if (option) url += `&option=${encodeURIComponent(option)}`;
  window.location.href = url;
});

document.getElementById('jury-login-btn').addEventListener('click', function(){
  window.location.href = 'jury-login.html';
});

// Start button only lights up once an organ is chosen, its section
// dropdown (if it has one) is answered, a name is typed, and this
// organ+option combo hasn't already been submitted this month
function checkStartReady(){
  const optionNeeded = !organOptionField.classList.contains('is-hidden');
  const optionReady = !optionNeeded || organOptionSelect.value;
  startBtn.disabled = !(organSelect.value && optionReady && nameInput.value.trim()) || formBlockedThisMonth;
}

organSelect.addEventListener('change', function(){
  clearAvailabilityHint();
  if (this.value) {
    populateOrganOptions(this.value);
    // If this organ has no Options, the section field stays hidden and
    // the name field can be revealed straight away
    if (organOptionField.classList.contains('is-hidden')) {
      nameField.classList.remove('is-hidden');
      checkAvailability(this.value, '');
    } else {
      nameField.classList.add('is-hidden');
    }
  } else {
    organOptionField.classList.add('is-hidden');
    nameField.classList.add('is-hidden');
  }
  checkStartReady();
});

organOptionSelect.addEventListener('change', function(){
  clearAvailabilityHint();
  // Reveal the name field once the section dropdown has a selection
  if (this.value) {
    nameField.classList.remove('is-hidden');
    checkAvailability(organSelect.value, this.value);
  } else {
    nameField.classList.add('is-hidden');
  }
  checkStartReady();
});

nameInput.addEventListener('input', checkStartReady);