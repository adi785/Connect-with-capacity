document.addEventListener('DOMContentLoaded', () => {
  const request = document.getElementById('reset-request');
  const verification = document.getElementById('reset-verify');
  const passwordReset = document.getElementById('reset-password');
  const complete = document.getElementById('reset-complete');

  function show(panel) {
    [request, verification, passwordReset, complete].forEach((item) => { item.hidden = item !== panel; });
  }

  document.querySelectorAll('.otp-input').forEach((input, index, inputs) => {
    input.inputMode = 'numeric';
    input.addEventListener('input', () => { input.value = input.value.replace(/\D/g, '').slice(0, 1); if (input.value && inputs[index + 1]) inputs[index + 1].focus(); });
    input.addEventListener('keydown', (event) => { if (event.key === 'Backspace' && !input.value && inputs[index - 1]) inputs[index - 1].focus(); });
  });

  document.getElementById('forgot-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const identifier = document.getElementById('recovery-id');
    if (!Validation.required(identifier)) return;
    try { await Auth.forgotPassword(identifier.value); show(verification); } catch (error) { Validation.toast(error.message); }
  });

  document.getElementById('verify-code').addEventListener('click', async () => {
    const error = document.getElementById('verification-error');
    try { await Auth.verifyOtp(Validation.otpValue(verification)); show(passwordReset); } catch (exception) { error.textContent = exception.message; }
  });

  document.getElementById('new-password-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const password = document.getElementById('new-password').value;
    const confirmation = document.getElementById('confirm-password').value;
    const error = document.getElementById('password-error');
    try { await Auth.resetPassword(password, confirmation); show(complete); } catch (exception) { error.textContent = exception.message; }
  });
});