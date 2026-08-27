document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('login-form');
  if (!form) return;

  let role = 'trainee';
  const tabs = document.querySelectorAll('.role-tab');
  const title = document.getElementById('form-title');
  const identifierLabel = document.getElementById('identifier-label');
  const remember = document.getElementById('remember-wrap');
  const roleNote = document.getElementById('role-note');
  const password = document.getElementById('password');
  const passwordToggle = document.getElementById('toggle-password');

  const roleDetails = {
    trainee: {
      title: 'Trainee Login',
      identifier: 'Email / Employee ID',
      note: 'New trainee? <a href="create-account.html">Create an account</a>'
    },
    trainer: {
      title: 'Trainer Login',
      identifier: 'Email / Employee ID',
      note: 'Trainer accounts are created or invited by the administrator.'
    },
    admin: {
      title: 'Administrator Login',
      identifier: 'Admin Email / Admin ID',
      note: 'Authorized personnel only.'
    }
  };

  function setLoading(button, label, isLoading) {
    if (!button) return;
    button.disabled = isLoading;
    if (!button.dataset.label) button.dataset.label = button.textContent;
    button.textContent = isLoading ? label : button.dataset.label;
  }

  function setRole(nextRole) {
    role = nextRole;
    const details = roleDetails[role];
    tabs.forEach((tab) => {
      const selected = tab.dataset.role === role;
      tab.classList.toggle('is-selected', selected);
      tab.setAttribute('aria-selected', String(selected));
    });
    title.textContent = details.title;
    identifierLabel.textContent = details.identifier;
    remember.hidden = role === 'admin';
    roleNote.innerHTML = details.note;
  }

  function setupOtpInputs() {
    const inputs = document.querySelectorAll('.otp-input');
    inputs.forEach((input, index) => {
      input.inputMode = 'numeric';
      input.addEventListener('input', () => {
        input.value = input.value.replace(/\D/g, '').slice(0, 1);
        if (input.value && inputs[index + 1]) inputs[index + 1].focus();
      });
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Backspace' && !input.value && inputs[index - 1]) inputs[index - 1].focus();
      });
    });
  }

  tabs.forEach((tab) => tab.addEventListener('click', () => setRole(tab.dataset.role)));

  passwordToggle.addEventListener('click', () => {
    const isVisible = password.type === 'text';
    password.type = isVisible ? 'password' : 'text';
    passwordToggle.querySelector('span').textContent = isVisible ? 'Show' : 'Hide';
    passwordToggle.setAttribute('aria-label', isVisible ? 'Show password' : 'Hide password');
    passwordToggle.setAttribute('aria-pressed', String(!isVisible));
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const identifier = document.getElementById('identifier');
    const loginButton = document.getElementById('login-btn');
    if (!Validation.required(identifier) | !Validation.required(password)) return;

    try {
      setLoading(loginButton, 'Signing in...', true);
      const result = await Auth.login({ role, identifier: identifier.value, password: password.value });
      if (result.requires2fa) {
        document.getElementById('login-panel').hidden = true;
        document.getElementById('admin-2fa').hidden = false;
        sessionStorage.setItem('pendingAdmin', identifier.value);
      } else {
        location.href = result.redirect;
      }
    } catch (error) {
      Validation.toast(error.message);
    } finally {
      setLoading(loginButton, '', false);
    }
  });

  document.getElementById('verify-admin').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const error = document.getElementById('otp-error');
    try {
      setLoading(button, 'Verifying...', true);
      await Auth.verifyOtp(Validation.otpValue(document.getElementById('admin-2fa')));
      location.href = Auth.completeAdmin(sessionStorage.getItem('pendingAdmin')).redirect;
    } catch (exception) {
      error.textContent = exception.message;
    } finally {
      setLoading(button, '', false);
    }
  });

  setupOtpInputs();
});