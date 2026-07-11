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