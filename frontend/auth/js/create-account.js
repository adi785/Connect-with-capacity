document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("create-account-form");
  const roleInput = document.getElementById("selected-role");
  const roleBtnTrainee = document.getElementById("role-btn-trainee");
  const roleBtnTrainer = document.getElementById("role-btn-trainer");
  const roleLabel = document.getElementById("portal-role-label");
  const createIntro = document.getElementById("create-intro");

  function setRole(role) {
    const isTrainer = role === "trainer";
    if (roleInput) roleInput.value = isTrainer ? "trainer" : "trainee";

    if (roleBtnTrainee && roleBtnTrainer) {
      roleBtnTrainee.classList.toggle("is-selected", !isTrainer);
      roleBtnTrainer.classList.toggle("is-selected", isTrainer);
    }

    if (roleLabel) {
      roleLabel.textContent = isTrainer ? "TRAINER REGISTRATION & APPLICATION" : "TRAINEE REGISTRATION";
    }

    if (createIntro) {
      createIntro.textContent = isTrainer
        ? "Submit your details to apply as a mentor / trainer. Accounts are reviewed by the administrator."
        : "Provide your details to begin your learning and capacity-building journey.";
    }
  }

  // Check URL param ?role=trainer
  const urlParams = new URLSearchParams(window.location.search);
  const initialRole = (urlParams.get("role") || "").toLowerCase();
  if (initialRole === "trainer") {
    setRole("trainer");
  }

  if (roleBtnTrainee) {
    roleBtnTrainee.addEventListener("click", () => setRole("trainee"));
  }
  if (roleBtnTrainer) {
    roleBtnTrainer.addEventListener("click", () => setRole("trainer"));
  }

  if (!form) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const fullName = document.getElementById("full-name");
    const email = document.getElementById("account-email");
    const employeeId = document.getElementById("employee-id");
    const password = document.getElementById("account-password");
    const confirmation = document.getElementById("account-confirm-password");
    const button = document.getElementById("create-account-button");
    const role = (roleInput ? roleInput.value : "trainee").toLowerCase();

    if (
      !Validation.required(fullName) ||
      !Validation.required(email) ||
      !Validation.required(employeeId) ||
      !Validation.required(password) ||
      !Validation.required(confirmation)
    ) {
      return;
    }

    if (!Validation.email(email.value)) {
      Validation.show(email, "Enter a valid email address.");
      return;
    }

    if (!Validation.strong(password.value)) {
      Validation.show(
        password,
        "Use 8+ characters with upper, lower, number and special character."
      );
      return;
    }

    if (password.value !== confirmation.value) {
      Validation.show(
        confirmation,
        "Passwords do not match."
      );
      return;
    }

    button.disabled = true;
    button.textContent = role === "trainer" ? "Submitting application..." : "Creating account...";

    try {
      const result = await Auth.registerUser({
        fullName: fullName.value.trim(),
        email: email.value.trim(),
        employeeId: employeeId.value.trim(),
        password: password.value,
        role: role
      });

      form.hidden = true;

      const completion = document.getElementById("account-created");
      const titleEl = document.getElementById("created-title");
      const descEl = document.getElementById("created-desc");

      if (role === "trainer") {
        if (titleEl) titleEl.textContent = "Trainer Application Submitted";
        if (descEl) descEl.textContent = "Your account request has been sent to the administrator for review and approval. You will be able to log in once approved.";
      } else {
        if (titleEl) titleEl.textContent = "Account Created Successfully";
        if (descEl) descEl.textContent = "Your trainee account is ready. You can now sign in to start learning.";
      }

      if (completion) completion.hidden = false;

    } catch (error) {
      Validation.toast(error.message);

      button.disabled = false;
      button.textContent = "Create account";
    }
  });
});
