document.addEventListener("DOMContentLoaded", () => {

  const request = document.getElementById("reset-request");
  const passwordReset = document.getElementById("reset-password");
  const complete = document.getElementById("reset-complete");


  function show(panel) {

    [request, passwordReset, complete]
      .forEach((item) => {

        if (item) {
          item.hidden = item !== panel;
        }

      });
  }


  /* ------------------------------------------------------------------------
     REQUEST PASSWORD RESET
     ------------------------------------------------------------------------ */

  const forgotForm =
    document.getElementById("forgot-form");


  if (forgotForm) {

    forgotForm.addEventListener(
      "submit",
      async (event) => {

        event.preventDefault();


        const identifier =
          document.getElementById("recovery-id");


        if (
          typeof Validation !== "undefined" &&
          !Validation.required(identifier)
        ) {
          return;
        }


        try {

          await Auth.forgotPassword(
            identifier.value
          );


          /*
           * Do NOT show OTP.
           *
           * Supabase has sent an email.
           */

          alert(
            "Password reset email sent. Please check your email and click the Reset password link."
          );


        } catch (error) {

          if (
            typeof Validation !== "undefined"
          ) {

            Validation.toast(
              error.message
            );

          } else {

            alert(
              error.message
            );
          }
        }

      }
    );
  }


  /* ------------------------------------------------------------------------
     NEW PASSWORD
     ------------------------------------------------------------------------ */

  const newPasswordForm =
    document.getElementById(
      "new-password-form"
    );


  if (newPasswordForm) {

    newPasswordForm.addEventListener(
      "submit",
      async (event) => {

        event.preventDefault();


        const password =
          document.getElementById(
            "new-password"
          ).value;


        const confirmation =
          document.getElementById(
            "confirm-password"
          ).value;


        const errorElement =
          document.getElementById(
            "password-error"
          );


        try {

          await Auth.resetPassword(
            password,
            confirmation
          );


          show(complete);


        } catch (error) {

          if (errorElement) {
            errorElement.textContent =
              error.message;
          } else {
            alert(error.message);
          }

        }

      }
    );
  }


  /* ------------------------------------------------------------------------
     CHECK WHETHER THIS PAGE WAS OPENED FROM SUPABASE RESET LINK
     ------------------------------------------------------------------------ */

  async function initializeResetPage() {

    /*
     * Supabase processes the recovery URL
     * and creates the session automatically.
     */

    if (
      window.location.pathname.includes(
        "reset-password"
      )
    ) {

      /*
       * Give Supabase a moment to process
       * the recovery URL.
       */

      setTimeout(
        async () => {

          const hasSession =
            await Auth.hasRecoverySession();


          if (hasSession) {

            show(passwordReset);

          } else {

            const errorElement =
              document.getElementById(
                "password-error"
              );

            if (errorElement) {

              errorElement.textContent =
                "Auth session missing. Please open the password reset link from your email again.";
            }
          }

        },
        500
      );
    }
  }


  initializeResetPage();

});