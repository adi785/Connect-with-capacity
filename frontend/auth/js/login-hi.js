document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('login-form');
  let role = 'trainee';
  const tabs = document.querySelectorAll('.role-tab');
  const password = document.getElementById('password');
  const toggle = document.getElementById('toggle-password');
  const roles = {
    trainee: { title: 'प्रशिक्षार्थी लॉगिन', identifier: 'ईमेल / कर्मचारी आईडी', note: 'नए प्रशिक्षार्थी? <a href="create-account.html">खाता बनाएँ</a>' },
    trainer: { title: 'प्रशिक्षक लॉगिन', identifier: 'ईमेल / कर्मचारी आईडी', note: 'प्रशिक्षक खाते प्रशासक द्वारा बनाए या आमंत्रित किए जाते हैं।' },
    admin: { title: 'प्रशासक लॉगिन', identifier: 'प्रशासक ईमेल / आईडी', note: 'केवल अधिकृत कर्मियों के लिए।' }
  };

  function setLoading(button, text, loading) {
    button.disabled = loading;
    button.dataset.label ||= button.textContent;
    button.textContent = loading ? text : button.dataset.label;
  }

  function setupOtp() {
    document.querySelectorAll('.otp-input').forEach((input, index, inputs) => {
      input.inputMode = 'numeric';
      input.addEventListener('input', () => { input.value = input.value.replace(/\D/g, '').slice(0, 1); if (input.value && inputs[index + 1]) inputs[index + 1].focus(); });
      input.addEventListener('keydown', (event) => { if (event.key === 'Backspace' && !input.value && inputs[index - 1]) inputs[index - 1].focus(); });
    });
  }

  tabs.forEach((tab) => tab.addEventListener('click', () => {
    role = tab.dataset.role;
    const detail = roles[role];
    tabs.forEach((item) => { const selected = item === tab; item.classList.toggle('is-selected', selected); item.setAttribute('aria-selected', String(selected)); });
    document.getElementById('form-title').textContent = detail.title;
    document.getElementById('identifier-label').textContent = detail.identifier;
    document.getElementById('remember-wrap').hidden = role === 'admin';
    document.getElementById('role-note').innerHTML = detail.note;
  }));

  toggle.addEventListener('click', () => {
    const visible = password.type === 'text';
    password.type = visible ? 'password' : 'text';
    toggle.querySelector('span').textContent = visible ? 'दिखाएँ' : 'छिपाएँ';
    toggle.setAttribute('aria-label', visible ? 'पासवर्ड दिखाएँ' : 'पासवर्ड छिपाएँ');
    toggle.setAttribute('aria-pressed', String(!visible));
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const identifier = document.getElementById('identifier');
    const button = document.getElementById('login-btn');
    if (!Validation.required(identifier) | !Validation.required(password)) return;
    try {
      setLoading(button, 'साइन इन हो रहा है...', true);
      const result = await Auth.login({ role, identifier: identifier.value, password: password.value });
      if (result.requires2fa) { document.getElementById('login-panel').hidden = true; document.getElementById('admin-2fa').hidden = false; sessionStorage.setItem('pendingAdmin', identifier.value); } else location.href = result.redirect;
    } catch (error) { Validation.toast(error.message); } finally { setLoading(button, '', false); }
  });

  document.getElementById('verify-admin').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    try {
      setLoading(button, 'सत्यापन हो रहा है...', true);
      await Auth.verifyOtp(Validation.otpValue(document.getElementById('admin-2fa')));
      location.href = Auth.completeAdmin(sessionStorage.getItem('pendingAdmin')).redirect;
    } catch (error) { document.getElementById('otp-error').textContent = error.message; } finally { setLoading(button, '', false); }
  });

  setupOtp();
});
