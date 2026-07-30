/* ---------------------------------------------------------
   SHARED CONFIG
   Single source of truth for the Apps Script deployment URL.
   Update it here ONCE and every page picks it up - index.html,
   questionnaire.html, jury-login.html, and dashboard.html all
   load common.js before their own page script.
--------------------------------------------------------- */
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwSSOUccNOeSRtoEwhvTqZL8ODG6w8J1sCL7Sej0_yAQdocrq6jXknLwyY2fqH9Wk_d/exec";

/* ---------------------------------------------------------
   SHARED HTML ESCAPING
   Every page that injects sheet data (organ names, submitter
   names, questionnaire answers, etc.) into innerHTML MUST run
   it through this first - anything from a Google Sheet is
   attacker-controlled, since index.html lets anyone submit a
   name and free-text answers with no login required.
   Single copy here instead of one per page script, so no page
   can accidentally skip it.
--------------------------------------------------------- */
function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

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

/* ---------------------------------------------------------
   FORCED PRINT COLORS (JPG/PDF downloads)
   A downloaded summary is a document someone may print, forward, or
   file away - it should always read as plain black text on white,
   regardless of whatever theme the person happened to be in when they
   generated it. Shared here since both the Questionnaire's results
   modal and the Rating form's success modal need identical behavior.
--------------------------------------------------------- */
(function injectForcedPrintColorStyle() {
  const style = document.createElement('style');
  style.textContent = `
    .force-print-colors, .force-print-colors * {
      color: #000000 !important;
      background-color: #ffffff !important;
      border-color: #B8933E !important;
      box-shadow: none !important;
    }
    .force-print-colors img, .force-print-colors svg, .force-print-colors image {
      background-color: transparent !important;
    }
    .force-print-colors .no-export {
      display: none !important;
    }

    /* Download buttons should hug their own text ("Download JPG" /
       "Download PDF"), not stretch to match their sibling primary/
       secondary action buttons in a shared flex row. */
    .btn-download {
      flex: 0 0 auto !important;
      width: auto !important;
      display: inline-flex !important;
      align-items: center;
      justify-content: center;
      white-space: nowrap;
    }

    /* The standalone download-actions row on the Organ SAM Goal
       Responses and All Organ Ratings detail views (not a modal, so it
       has no existing layout rules of its own). */
    .detail-download-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-bottom: 16px;
    }
  `;
  document.head.appendChild(style);
})();

// Waits for every <img> inside a container to finish loading (or fail)
// before it's safe to hand that container to html2canvas - otherwise a
// logo dropped into the DOM moments earlier can get captured blank.
function waitForImagesToLoad(container) {
  const imgs = Array.from(container.querySelectorAll('img'));
  return Promise.all(imgs.map(img => {
    if (img.complete && img.naturalWidth !== 0) return Promise.resolve();
    return new Promise(resolve => {
      img.addEventListener('load', resolve, { once: true });
      img.addEventListener('error', resolve, { once: true }); // don't hang forever on a failed load
    });
  }));
}

// Temporarily forces black-on-white styling on a capture target, waits
// for its images to be ready, runs the given capture function, then
// always restores the element's normal theme-aware appearance
// afterward - even if the capture itself throws.
async function captureWithForcedPrintColors(el, captureFn) {
  el.classList.add('force-print-colors');
  try {
    await waitForImagesToLoad(el);
    return await captureFn();
  } finally {
    el.classList.remove('force-print-colors');
  }
}
