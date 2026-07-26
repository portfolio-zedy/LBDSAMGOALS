// APPS_SCRIPT_URL now lives in common.js, loaded before this file
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const userField = document.getElementById('login-username').value.trim();
  const passField = document.getElementById('login-password').value.trim();
  const hint = document.getElementById('login-hint');
  const btn = document.getElementById('login-btn');

  if (!userField || !passField) {
    hint.textContent = "Both fields are required.";
    hint.className = "field-hint error";
    return;
  }

  btn.textContent = "Verifying...";
  btn.disabled = true;
  hint.textContent = "Checking credentials...";
  hint.className = "field-hint";

  const payload = {
    action: 'verifyLogin',
    payload: {
      username: userField,
      password: passField
    }
  };

  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    
    const json = await res.json();
    
    if (json.code === 200) {
      hint.textContent = "Success! Redirecting...";
      hint.className = "field-hint ok";
      
      // Store the session data in the browser
      sessionStorage.setItem('jurySession', JSON.stringify(json.data));
      
      // Redirect to the dashboard
      window.location.href = 'dashboard.html';
    } else {
      throw new Error(json.message);
    }
  } catch (err) {
    hint.textContent = err.message;
    hint.className = "field-hint error";
    btn.textContent = "Authenticate";
    btn.disabled = false;
  }
});

/* ---------------------------------------------------------
   TOGGLE BETWEEN LOGIN AND SIGNUP
--------------------------------------------------------- */
const loginForm = document.getElementById('login-form');
const signupForm = document.getElementById('signup-form');

document.getElementById('show-signup-btn').addEventListener('click', () => {
  loginForm.classList.add('is-hidden');
  signupForm.classList.remove('is-hidden');
});

document.getElementById('show-login-btn').addEventListener('click', () => {
  signupForm.classList.add('is-hidden');
  loginForm.classList.remove('is-hidden');
});

/* ---------------------------------------------------------
   SIGNUP
--------------------------------------------------------- */
/* ---------------------------------------------------------
   SHOW / HIDE PASSWORD
   Works for any input wrapped in .password-wrap with a
   .toggle-password-btn sibling - covers both the login and
   signup password fields from one shared listener.
--------------------------------------------------------- */
document.querySelectorAll('.toggle-password-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const input = document.getElementById(btn.dataset.target);
    if (!input) return;

    const revealing = input.type === 'password';
    input.type = revealing ? 'text' : 'password';
    btn.textContent = revealing ? '🙈' : '👁';
    btn.setAttribute('aria-label', revealing ? 'Hide password' : 'Show password');
  });
});

signupForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const fullName = document.getElementById('signup-fullname').value.trim();
  const username = document.getElementById('signup-username').value.trim();
  const password = document.getElementById('signup-password').value.trim();
  const role = document.getElementById('signup-role').value;
  const hint = document.getElementById('signup-hint');
  const btn = document.getElementById('signup-btn');

  if (!fullName || !username || !password || !role) {
    hint.textContent = "All fields are required.";
    hint.className = "field-hint error";
    return;
  }

  btn.textContent = "Creating account...";
  btn.disabled = true;
  hint.textContent = "Submitting...";
  hint.className = "field-hint";

  const payload = {
    action: 'signup',
    payload: { fullName, username, password, role }
  };

  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    const json = await res.json();
    if (json.code !== 200) throw new Error(json.message);

    hint.textContent = "Account created! It's pending admin approval - you'll be able to log in once approved.";
    hint.className = "field-hint ok";
    signupForm.reset();
    btn.textContent = "Create Account";
    btn.disabled = false;

  } catch (err) {
    hint.textContent = err.message;
    hint.className = "field-hint error";
    btn.textContent = "Create Account";
    btn.disabled = false;
  }
});
