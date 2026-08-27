const Validation = {
  required(field) {
    if (!field.value.trim()) {
      this.show(field, "This field is required.");
      return false;
    }

    this.show(field, "");
    return true;
  },

  email(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
  },

  strong(value) {
    return (
      value.length >= 8 &&
      /[A-Z]/.test(value) &&
      /[a-z]/.test(value) &&
      /\d/.test(value) &&
      /[^A-Za-z0-9]/.test(value)
    );
  },

  show(field, message) {
    let error = field.parentElement.querySelector(".field-error");

    if (!error) {
      error = document.createElement("p");
      error.className = "field-error";
      field.parentElement.appendChild(error);
    }

    error.textContent = message;
  },

  toast(message) {
    alert(message);
  },

  otpValue(container) {
    return Array.from(
      container.querySelectorAll(".otp-input")
    )
      .map(input => input.value)
      .join("");
  }
};
