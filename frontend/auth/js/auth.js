/* ==========================================================================
   CAPACITY CONNECT — Authentication
   Supabase Auth + Profiles + Role Based Access
   ========================================================================== */

const Auth = {

  /* ------------------------------------------------------------------------
     DASHBOARDS
     ------------------------------------------------------------------------ */

  DASHBOARDS: {
    trainee: "../trainee-dashboard/index.html",
    trainer: "../trainer-dashboard/index.html",
    admin: "../admin-dashboard/index.html"
  },

  LOGIN_PAGE: "../auth/index.html",

  /*
   * IMPORTANT:
   * This must match the location of reset-password.html.
   *
   * If your file is:
   * frontend/reset-password.html
   * keep this as it is.
   */
  RESET_PASSWORD_PAGE:
    `${window.location.origin}/auth/reset-password.html`,

  ROLES: ["trainee", "trainer", "admin"],


  /* ------------------------------------------------------------------------
     REGISTER USER
     ------------------------------------------------------------------------ */
  async registerUser({
    fullName,
    email,
    employeeId,
    password,
    role = "trainee"
  }) {
    const requestedRole =
      role === "trainer" ? "trainer" : "trainee";

    const initialStatus =
      requestedRole === "trainer" ? "pending" : "approved";

    if (!supabaseClient) {
      throw new Error("Supabase is not configured.");
    }

    const { data, error } =
      await supabaseClient.auth.signUp({
        email: email.trim(),
        password: password,
        options: {
          data: {
            full_name: fullName.trim(),
            employee_id: employeeId.trim(),
            role: requestedRole
          }
        }
      });

    if (error) {
      throw new Error(error.message);
    }

    if (!data || !data.user) {
      throw new Error("Unable to create your account.");
    }

    return {
      ...data,
      requestedRole,
      initialStatus
    };
  },
  /* ------------------------------------------------------------------------
     LOGIN
     ------------------------------------------------------------------------ */

  async login({
    role,
    identifier,
    password
  }) {

    if (!supabaseClient) {
      throw new Error("Supabase is not configured.");
    }

    if (!this.ROLES.includes(role)) {
      throw new Error("Invalid user role.");
    }

    let email = identifier.trim();


    /*
     * Employee ID → Email
     */

    if (!email.includes("@")) {

      const {
        data: profile,
        error
      } = await supabaseClient
        .from("profiles")
        .select("email")
        .eq("employee_id", email)
        .maybeSingle();

      if (error) {
        console.error(
          "Employee ID lookup failed:",
          error
        );

        throw new Error(
          "Unable to find an account with this Employee ID."
        );
      }

      if (!profile || !profile.email) {
        throw new Error(
          "No account found with this Employee ID."
        );
      }

      email = profile.email;
    }


    /*
     * Supabase login
     */

    const {
      data,
      error
    } = await supabaseClient.auth.signInWithPassword({
      email: email,
      password: password
    });

    if (error) {
      throw new Error(error.message);
    }

    if (
      !data ||
      !data.user ||
      !data.session
    ) {
      throw new Error(
        "Login failed. No valid Supabase session was created."
      );
    }


    /*
     * Get Capacity Connect profile
     */

    const {
      data: profile,
      error: profileError
    } = await supabaseClient
      .from("profiles")
      .select("*")
      .eq("id", data.user.id)
      .maybeSingle();


    if (profileError) {

      await supabaseClient.auth.signOut();

      console.error(
        "Profile lookup failed:",
        profileError
      );

      throw new Error(
        "Unable to load your account profile."
      );
    }


    if (!profile) {

      await supabaseClient.auth.signOut();

      throw new Error(
        "Your Supabase account exists, but no Capacity Connect profile was found."
      );
    }


    /*
     * Check status
     */

    if (
      profile.status &&
      profile.status !== "active" &&
      profile.status !== "approved"
    ) {

      await supabaseClient.auth.signOut();

      throw new Error(
        "Your account is pending approval or inactive."
      );
    }


    /*
     * Check role
     */

    if (!profile.role) {

      await supabaseClient.auth.signOut();

      throw new Error(
        "Your account does not have a role assigned."
      );
    }


    if (!this.ROLES.includes(profile.role)) {

      await supabaseClient.auth.signOut();

      throw new Error(
        "Your account has an invalid role."
      );
    }


    /*
     * Prevent wrong-role login
     */

    if (profile.role !== role) {

      await supabaseClient.auth.signOut();

      throw new Error(
        `You are not authorized for the ${role} role.`
      );
    }


    /*
     * Save access token for API compatibility
     */

    localStorage.setItem(
      "cc_auth_token",
      data.session.access_token
    );


    return {
      user: data.user,
      profile: profile,
      session: data.session,
      requires2fa: false,
      redirect:
        this.DASHBOARDS[profile.role]
    };
  },


  /* ------------------------------------------------------------------------
     SESSION
     ------------------------------------------------------------------------ */

  async getSession() {

    if (!supabaseClient) {
      return null;
    }

    try {

      const {
        data,
        error
      } = await supabaseClient.auth.getSession();

      if (error) {

        console.error(
          "Supabase session error:",
          error
        );

        return null;
      }

      return data
        ? data.session
        : null;

    } catch (error) {

      console.error(
        "Unable to get Supabase session:",
        error
      );

      return null;
    }
  },


  /* ------------------------------------------------------------------------
     PROFILE
     ------------------------------------------------------------------------ */

  async getProfile(userId) {

    if (
      !supabaseClient ||
      !userId
    ) {
      return null;
    }

    try {

      const {
        data,
        error
      } = await supabaseClient
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .maybeSingle();

      if (error) {

        console.error(
          "Unable to load profile:",
          error
        );

        return null;
      }

      return data;

    } catch (error) {

      console.error(
        "Profile error:",
        error
      );

      return null;
    }
  },


  /* ------------------------------------------------------------------------
     PROTECTED DASHBOARD
     ------------------------------------------------------------------------ */

  async requireSession() {

    const session =
      await this.getSession();


    if (
      !session ||
      !session.user
    ) {

      window.location.href =
        this.LOGIN_PAGE;

      return null;
    }


    const profile =
      await this.getProfile(
        session.user.id
      );


    if (!profile) {

      await this.logout();

      throw this._fail(
        "no-profile",
        "We verified your sign-in but could not find your Capacity Connect profile."
      );
    }


    if (
      profile.status &&
      profile.status !== "active" &&
      profile.status !== "approved"
    ) {

      await this.logout();

      throw this._fail(
        "inactive",
        "Your account is pending approval or inactive."
      );
    }


    if (!profile.role) {

      await this.logout();

      throw this._fail(
        "no-role",
        "Your account does not have a role assigned."
      );
    }


    if (
      !this.ROLES.includes(
        profile.role
      )
    ) {

      await this.logout();

      throw this._fail(
        "bad-role",
        "Your account has an unrecognised role."
      );
    }


    return {
      session: session,
      user: session.user,
      profile: profile
    };
  },


  /* ------------------------------------------------------------------------
     PASSWORD RECOVERY
     ------------------------------------------------------------------------

     FLOW:

     1. User enters Email / Employee ID
     2. Supabase sends RESET EMAIL
     3. User clicks "Reset password"
     4. Supabase creates recovery session
     5. User reaches reset-password.html
     6. User enters new password
     7. updateUser() changes password

     NO OTP is required.
     ------------------------------------------------------------------------ */

  async forgotPassword(identifier) {
    if (!supabaseClient) {
      throw new Error("Supabase is not configured.");
    }

    let email = identifier.trim();

    // If user entered Employee ID, find the email
    if (!email.includes("@")) {
      const { data, error } = await supabaseClient
        .from("profiles")
        .select("email")
        .eq("employee_id", email)
        .maybeSingle();

      if (error) {
        console.error("Employee ID lookup failed:", error);
        throw new Error("Unable to find your account.");
      }

      if (!data || !data.email) {
        throw new Error("No account found with this Employee ID.");
      }

      email = data.email;
    }

    /*
     * IMPORTANT:
     * After clicking the reset email,
     * Supabase will return the user to this page.
     */
    const redirectUrl =
      `${window.location.origin}/auth/reset-password.html`;

    const { error } =
      await supabaseClient.auth.resetPasswordForEmail(
        email,
        {
          redirectTo: redirectUrl
        }
      );

    if (error) {
      throw new Error(error.message);
    }

    return {
      email: email
    };
  },
  /* ------------------------------------------------------------------------
     CHECK PASSWORD RECOVERY SESSION
     ------------------------------------------------------------------------ */

  async hasRecoverySession() {

    if (!supabaseClient) {
      return false;
    }

    try {

      const {
        data,
        error
      } = await supabaseClient.auth
        .getSession();

      if (error) {
        console.error(
          "Recovery session error:",
          error
        );

        return false;
      }

      return Boolean(
        data &&
        data.session &&
        data.session.user
      );

    } catch (error) {

      console.error(
        "Unable to check recovery session:",
        error
      );

      return false;
    }
  },


  /* ------------------------------------------------------------------------
     RESET PASSWORD
     ------------------------------------------------------------------------ */

  async resetPassword(
    password,
    confirmation
  ) {

    if (!supabaseClient) {
      throw new Error(
        "Supabase is not configured."
      );
    }


    if (!password) {
      throw new Error(
        "Please enter a new password."
      );
    }


    if (password.length < 6) {
      throw new Error(
        "Password must be at least 6 characters long."
      );
    }


    if (
      password !== confirmation
    ) {
      throw new Error(
        "Passwords do not match."
      );
    }


    /*
     * IMPORTANT:
     * A valid recovery session must exist.
     */

    const session =
      await this.getSession();


    if (
      !session ||
      !session.user
    ) {

      throw new Error(
        "Auth session missing. Please open the password reset link from your email again."
      );
    }


    /*
     * Change password
     */

    const {
      data,
      error
    } = await supabaseClient.auth
      .updateUser({
        password: password
      });


    if (error) {
      throw new Error(
        error.message
      );
    }


    /*
     * Clean old API token
     */

    localStorage.removeItem(
      "cc_auth_token"
    );


    return data;
  },


  /* ------------------------------------------------------------------------
     LOGOUT
     ------------------------------------------------------------------------ */

  async logout() {

    if (supabaseClient) {

      const {
        error
      } = await supabaseClient.auth
        .signOut();

      if (error) {

        console.error(
          "Supabase logout error:",
          error
        );
      }
    }


    localStorage.removeItem(
      "cc_auth_token"
    );

    localStorage.removeItem(
      "cc_dev_session"
    );

    sessionStorage.removeItem(
      "pendingAdmin"
    );


    window.location.href =
      this.LOGIN_PAGE;
  },


  /* ------------------------------------------------------------------------
     ROLE → DASHBOARD
     ------------------------------------------------------------------------ */

  dashboardFor(role) {

    return (
      this.DASHBOARDS[role] ||
      null
    );
  },


  /* ------------------------------------------------------------------------
     DISPLAY NAME
     ------------------------------------------------------------------------ */

  displayName(
    profile,
    user
  ) {

    const candidates = [

      profile &&
      profile.full_name,

      profile &&
      profile.name,

      profile &&
      profile.username,

      profile &&
      profile.employee_id
    ];


    for (
      let i = 0;
      i < candidates.length;
      i++
    ) {

      const value =
        candidates[i];

      if (
        typeof value === "string" &&
        value.trim()
      ) {

        return value.trim();
      }
    }


    const email =
      (profile && profile.email) ||
      (user && user.email) ||
      "";


    if (
      email.includes("@")
    ) {

      return email.split("@")[0];
    }


    return "there";
  },


  /* ------------------------------------------------------------------------
     ERROR HELPER
     ------------------------------------------------------------------------ */

  _fail(
    code,
    message
  ) {

    const error =
      new Error(message);

    error.code = code;

    return error;
  },


  /* ------------------------------------------------------------------------
     ADMIN OTP COMPATIBILITY
     ------------------------------------------------------------------------

     Your current login page still expects these functions.
     Admin authentication itself is handled by Supabase.
     ------------------------------------------------------------------------ */

  async verifyOtp() {
    return true;
  },


  completeAdmin() {

    return {
      redirect:
        this.DASHBOARDS.admin
    };
  }

};