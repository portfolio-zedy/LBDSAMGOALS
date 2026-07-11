/* ---------------------------------------------------------
   SHARED CONFIG
   Single source of truth for the Apps Script deployment URL.
   Update it here ONCE and every page picks it up - index.html,
   questionnaire.html, jury-login.html, and dashboard.html all
   load common.js before their own page script.
--------------------------------------------------------- */
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwSSOUccNOeSRtoEwhvTqZL8ODG6w8J1sCL7Sej0_yAQdocrq6jXknLwyY2fqH9Wk_d/exec";

/* ---------------------------------------------------------
   LIVE DATE & TIME (ticking seconds)
   Shared by index.html and questionnaire.html
--------------------------------------------------------- */
function pad(n){ return n.toString().padStart(2,'0'); }

function renderClock(){
  const dateEl = document.getElementById('liveDate');
  const timeEl = document.getElementById('liveTime');
  if (!dateEl || !timeEl) return;

  const now = new Date();

  const dateStr = now.toLocaleDateString(undefined, {
    weekday:'short', year:'numeric', month:'short', day:'2-digit'
  });

  const h = pad(now.getHours());
  const m = pad(now.getMinutes());
  const s = pad(now.getSeconds());

  dateEl.textContent = dateStr;
  timeEl.innerHTML = `${h}:${m}:<span class="seconds">${s}</span>`;
}

renderClock();
setInterval(renderClock, 1000);

/* ---------------------------------------------------------
   AUTO DARK/LIGHT THEME SWITCH
--------------------------------------------------------- */
const themeToggleBtn = document.getElementById('theme-toggle');
let userManuallyToggled = false;

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

function determineTheme() {
  if (userManuallyToggled) return;

  const hour = new Date().getHours();
  const isNight = hour >= 18 || hour < 6;

  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;

  if (isNight || prefersDark) {
    applyTheme('dark');
    if (themeToggleBtn) themeToggleBtn.textContent = '🌙 Dark';
  } else {
    applyTheme('light');
    if (themeToggleBtn) themeToggleBtn.textContent = '☀️ Light';
  }
}

determineTheme();

if (window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', determineTheme);
}

setInterval(() => {
  if (!userManuallyToggled) determineTheme();
}, 60000);

if (themeToggleBtn) {
  themeToggleBtn.addEventListener('click', () => {
    userManuallyToggled = true;
    const currentTheme = document.documentElement.getAttribute('data-theme');

    if (currentTheme === 'dark') {
      applyTheme('light');
      themeToggleBtn.textContent = '☀️ Light';
    } else {
      applyTheme('dark');
      themeToggleBtn.textContent = '🌙 Dark';
    }
  });
}