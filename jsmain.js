/* ---------------------------------------------------------
   ORGAN DROPDOWN — populated dynamically from Google Sheets
   (Live clock + auto theme logic now live in common.js)
--------------------------------------------------------- */
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwSSOUccNOeSRtoEwhvTqZL8ODG6w8J1sCL7Sej0_yAQdocrq6jXknLwyY2fqH9Wk_d/exec";
const organSelect = document.getElementById('organ-select');
const organHint = document.getElementById('organ-hint');
const startBtn = document.getElementById('start-btn');

function revealOrganField(){
  const loader = document.getElementById('organ-loader');
  const field = document.getElementById('organ-field');
  if (loader) loader.classList.add('is-hidden');
  if (field) field.classList.remove('is-hidden');
}

function populateOrgans(list){
  revealOrganField();

  organSelect.innerHTML = '';

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Please select your organ';
  placeholder.disabled = true;
  placeholder.selected = true;
  organSelect.appendChild(placeholder);

  list.forEach(name => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    organSelect.appendChild(opt);
  });

  organSelect.disabled = false;
  organHint.textContent = `${list.length} organ${list.length === 1 ? '' : 's'} loaded.`;
  organHint.className = 'field-hint ok';
}

function loadOrgansFallback(){
  const fallback = [];
  populateOrgans(fallback);
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

    const list = responseJson.data.map(org => org.Organ_Name);

    if (!list.length) throw new Error('Empty organ list');

    populateOrgans(list);
  } catch (err) {
    console.error('Failed to load organs from Apps Script:', err);
    loadOrgansFallback();
  }
}

loadOrgans();

/* ---------------------------------------------------------
   ACTIONS
--------------------------------------------------------- */
document.getElementById('jury-form').addEventListener('submit', function(e){
  e.preventDefault();
  const organ = organSelect.value;
  if (!organ) return;
  window.location.href = `questionnaire.html?organ=${encodeURIComponent(organ)}`;
});

document.getElementById('jury-login-btn').addEventListener('click', function(){
  window.location.href = 'jury-login.html';
});

organSelect.addEventListener('change', function(){
  startBtn.disabled = !this.value;
});