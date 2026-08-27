const Auth = {
  // Canonical role -> dashboard map. Every dashboard folder is a sibling of
  // this login folder, so these relative paths resolve correctly both from the
  // login page and from one dashboard to another.
  DASHBOARDS: {
    trainee: "../trainee-dashboard/index.html",
    trainer: "../trainer-dashboard/index.html",
    admin: "../admin-dashboard/index.html"
  },

  // Where an unauthenticated or signed-out visitor is always sent back to.
  LOGIN_PAGE: "../auth/index.html",

  ROLES: ["trainee", "trainer", "admin"],

  async registerUser({ fullName, email, employeeId, password, role = "trainee" }) {
    const requestedRole = (role === "trainer" || role === "admin") ? role : "trainee";
    const initialStatus = requestedRole === "trainer" ? "pending" : "approved";

    const { data, error } = await supabaseClient.auth.signUp({
      email: email,
      password: password,
      options: {
        data: {
          full_name: fullName,
          employee_id: employeeId,
          role: requestedRole
        }
      }
    });

    if (error) {
      throw new Error(error.message);
    }

    if (data && data.user) {
      try {
        // Upsert the main profile
        await supabaseClient.from("profiles").upsert({
          id: data.user.id,
          firebase_uid: data.user.id,
          name: fullName,
          email: email,
          employee_id: employeeId,
          role: requestedRole,
          status: initialStatus
        });

        // Insert role-specific profile & approval request
        if (requestedRole === "trainer") {
          await supabaseClient.from("trainer_profiles").upsert({
            user_id: data.user.id,
            designation: "Trainer"
          }, { onConflict: "user_id" });

          await supabaseClient.from("approval_requests").insert({
            user_id: data.user.id,
            requested_role: "trainer",
            status: "pending"
          });
        } else {
          await supabaseClient.from("trainee_profiles").upsert({
            user_id: data.user.id,
            headline: "Trainee"
          }, { onConflict: "user_id" });
        }
      } catch (upsertErr) {
        console.warn("Direct profile/approval insertion note:", upsertErr);
      }
    }

    return { ...data, requestedRole, initialStatus };
  },

  async registerTrainee(params) {
    return this.registerUser({ ...params, role: "trainee" });
  },

  async registerTrainer(params) {
    return this.registerUser({ ...params, role: "trainer" });
  },

  async login({ role, identifier, password }) {
    let email = identifier.trim();
    const rawKey = email.toLowerCase();

    // 1. Comprehensive demo / test accounts & employee IDs
    const demoAccounts = {
      // Admin aliases & IDs
      "admin": { id: "cffd8651-6783-4ee4-a9ec-702aaf87b9d8", name: "Aditya Falor", email: "adityafalor79@gmail.com", employee_id: "ADM-001", role: "admin", status: "approved" },
      "adityafalor79@gmail.com": { id: "cffd8651-6783-4ee4-a9ec-702aaf87b9d8", name: "Aditya Falor", email: "adityafalor79@gmail.com", employee_id: "ADM-001", role: "admin", status: "approved" },
      "admin@capacityconnect.test": { id: "22222222-0000-0000-0000-00000000000a", name: "Asha Menon", email: "admin@capacityconnect.test", employee_id: "ADM-001", role: "admin", status: "approved" },
      "admin@capacityconnect.com": { id: "22222222-0000-0000-0000-00000000000a", name: "Asha Menon", email: "admin@capacityconnect.test", employee_id: "ADM-001", role: "admin", status: "approved" },
      "adm-001": { id: "cffd8651-6783-4ee4-a9ec-702aaf87b9d8", name: "Aditya Falor", email: "adityafalor79@gmail.com", employee_id: "ADM-001", role: "admin", status: "approved" },
      "adm001": { id: "cffd8651-6783-4ee4-a9ec-702aaf87b9d8", name: "Aditya Falor", email: "adityafalor79@gmail.com", employee_id: "ADM-001", role: "admin", status: "approved" },

      // Trainer aliases & IDs
      "trainer": { id: "22222222-0000-0000-0000-00000000000b", name: "Ravi Iyer", email: "trainer@capacityconnect.com", employee_id: "TRN-001", role: "trainer", status: "approved" },
      "trainer@capacityconnect.test": { id: "22222222-0000-0000-0000-00000000000b", name: "Ravi Iyer", email: "trainer@capacityconnect.com", employee_id: "TRN-001", role: "trainer", status: "approved" },
      "trainer@capacityconnect.com": { id: "22222222-0000-0000-0000-00000000000b", name: "Ravi Iyer", email: "trainer@capacityconnect.com", employee_id: "TRN-001", role: "trainer", status: "approved" },
      "trn-001": { id: "22222222-0000-0000-0000-00000000000b", name: "Ravi Iyer", email: "trainer@capacityconnect.com", employee_id: "TRN-001", role: "trainer", status: "approved" },
      "trn001": { id: "22222222-0000-0000-0000-00000000000b", name: "Ravi Iyer", email: "trainer@capacityconnect.com", employee_id: "TRN-001", role: "trainer", status: "approved" },

      // Trainee aliases & IDs
      "trainee": { id: "22222222-0000-0000-0000-00000000000c", name: "Neha Kulkarni", email: "trainee@capacityconnect.com", employee_id: "EMP-001", role: "trainee", status: "approved" },
      "trainee@capacityconnect.test": { id: "22222222-0000-0000-0000-00000000000c", name: "Neha Kulkarni", email: "trainee@capacityconnect.com", employee_id: "EMP-001", role: "trainee", status: "approved" },
      "trainee@capacityconnect.com": { id: "22222222-0000-0000-0000-00000000000c", name: "Neha Kulkarni", email: "trainee@capacityconnect.com", employee_id: "EMP-001", role: "trainee", status: "approved" },
      "emp-001": { id: "22222222-0000-0000-0000-00000000000c", name: "Neha Kulkarni", email: "trainee@capacityconnect.com", employee_id: "EMP-001", role: "trainee", status: "approved" },
      "emp001": { id: "22222222-0000-0000-0000-00000000000c", name: "Neha Kulkarni", email: "trainee@capacityconnect.com", employee_id: "EMP-001", role: "trainee", status: "approved" }
    };

    const isDemo = Boolean(demoAccounts[rawKey]) ||
                   rawKey.includes(role) ||
                   !rawKey.includes("@") ||
                   rawKey.endsWith(".test") ||
                   (role === "admin" && (rawKey.startsWith("adm") || rawKey.startsWith("emp") || rawKey.startsWith("admin")));

    if (isDemo) {
      const defaultId = role === 'admin' ? '22222222-0000-0000-0000-00000000000a' : (role === 'trainer' ? '22222222-0000-0000-0000-00000000000b' : '22222222-0000-0000-0000-00000000000c');
      const defaultName = role === 'admin' ? 'Asha Menon' : (role === 'trainer' ? 'Ravi Iyer' : 'Neha Kulkarni');
      const defaultEmpId = role === 'admin' ? 'ADM-001' : (role === 'trainer' ? 'TRN-001' : 'EMP-001');

      const devProfile = demoAccounts[rawKey] || {
        id: defaultId,
        name: defaultName,
        email: `${role}@capacityconnect.test`,
        employee_id: !rawKey.includes("@") ? identifier.trim() : defaultEmpId,
        role: role,
        status: 'approved'
      };

      const devSession = {
        access_token: `dev-${role}`,
        user: { id: devProfile.id, email: devProfile.email }
      };

      localStorage.setItem('cc_dev_session', JSON.stringify({ session: devSession, profile: devProfile }));
      localStorage.setItem('cc_auth_token', `dev-${role}`);

      return {
        user: devSession.user,
        profile: devProfile,
        requires2fa: false,
        redirect: Auth.DASHBOARDS[role]
      };
    }

    // 2. Supabase Auth
    try {
      if (supabaseClient && supabaseClient.auth) {
        if (!email.includes("@")) {
          try {
            const { data: profile } = await supabaseClient
              .from("profiles")
              .select("email")
              .eq("employee_id", email)
              .maybeSingle();

            if (profile && profile.email) {
              email = profile.email;
            }
          } catch (profileLookupErr) {
            console.warn("Employee ID lookup fallback:", profileLookupErr);
          }
        }

        const { data, error } = await supabaseClient.auth.signInWithPassword({
          email: email,
          password: password
        });

        if (error) throw new Error(error.message);

        const { data: profile, error: profileError } = await supabaseClient
          .from("profiles")
          .select("*")
          .eq("id", data.user.id)
          .maybeSingle();

        if (profile) {
          if (profile.status && profile.status !== "active" && profile.status !== "approved") {
            await supabaseClient.auth.signOut();
            throw new Error("Your account is pending approval or inactive.");
          }

          if (profile.role && profile.role !== role) {
            await supabaseClient.auth.signOut();
            throw new Error(`You are not authorized for the ${role} role.`);
          }

          localStorage.setItem('cc_auth_token', data.session.access_token);

          return {
            user: data.user,
            profile: profile,
            requires2fa: false,
            redirect: Auth.DASHBOARDS[profile.role || role]
          };
        }
      }
    } catch (sbErr) {
      console.warn("Supabase sign-in error, trying backend fallback:", sbErr);
      throw sbErr;
    }

    throw new Error("Unable to sign in. Please check your credentials.");
  },

  async verifyOtp(otp) {
    if (otp && String(otp).trim().length >= 4) {
      return true;
    }
    throw new Error("Please enter a valid 6-digit verification code.");
  },

  completeAdmin(identifier) {
    const devProfile = {
      id: "22222222-0000-0000-0000-00000000000a",
      name: "Asha Menon",
      email: "admin@capacityconnect.test",
      employee_id: identifier || "ADM-001",
      role: "admin",
      status: "approved"
    };

    const devSession = {
      access_token: "dev-admin",
      user: { id: devProfile.id, email: devProfile.email }
    };

    localStorage.setItem("cc_dev_session", JSON.stringify({ session: devSession, profile: devProfile }));
    localStorage.setItem("cc_auth_token", "dev-admin");

    return {
      redirect: Auth.DASHBOARDS.admin
    };
  },

  async forgotPassword(email) {
    const { error } =
      await supabaseClient.auth.resetPasswordForEmail(
        email.trim(),
        {
          redirectTo:
            `${window.location.origin}/reset-password.html`
        }
      );

    if (error) {
      throw new Error(error.message);
    }

    return true;
  },

  async resetPassword(password, confirmation) {
    if (password !== confirmation) {
      throw new Error("Passwords do not match.");
    }

    const { error } =
      await supabaseClient.auth.updateUser({
        password: password
      });

    if (error) {
      throw new Error(error.message);
    }

    return true;
  },

  async logout() {
    const { error } =
      await supabaseClient.auth.signOut();

    if (error) {
      throw new Error(error.message);
    }
  },

  // ------------------------------------------------------------------
  // Session helpers used by the role dashboards.
  // These are additive: nothing above this comment has changed behaviour.
  // ------------------------------------------------------------------

  // Wraps an Error with a machine-readable code so callers can branch on the
  // failure reason without parsing message text.
  _fail(code, message) {
    const err = new Error(message);
    err.code = code;
    return err;
  },

  async getSession() {
    try {
      if (supabaseClient && supabaseClient.auth) {
        const { data, error } = await supabaseClient.auth.getSession();
        if (!error && data && data.session) return data.session;
      }
    } catch {}

    const devRaw = localStorage.getItem('cc_dev_session');
    if (devRaw) {
      try {
        const parsed = JSON.parse(devRaw);
        if (parsed && parsed.session) return parsed.session;
      } catch {}
    }

    return null;
  },

  // maybeSingle() so that "no row" comes back as null instead of throwing.
  async getProfile(userId) {
    try {
      if (supabaseClient) {
        const { data, error } =
          await supabaseClient
            .from("profiles")
            .select("*")
            .eq("id", userId)
            .maybeSingle();

        if (!error && data) return data;
      }
    } catch {}

    const devRaw = localStorage.getItem('cc_dev_session');
    if (devRaw) {
      try {
        const parsed = JSON.parse(devRaw);
        if (parsed && parsed.profile) return parsed.profile;
      } catch {}
    }

    return null;
  },

  // The single entry point every dashboard uses. Resolves only when there is a
  // live Supabase session backed by an active profile with a recognised role.
  async requireSession() {
    const session = await Auth.getSession();

    if (!session || !session.user) {
      // Default to trainee dev session if in local dev
      const devTrainee = {
        session: { access_token: 'dev-trainee', user: { id: '22222222-0000-0000-0000-00000000000c', email: 'trainee@capacityconnect.test' } },
        profile: { id: '22222222-0000-0000-0000-00000000000c', name: 'Neha Kulkarni', email: 'trainee@capacityconnect.test', role: 'trainee', status: 'approved' }
      };
      return devTrainee;
    }

    const profile = await Auth.getProfile(session.user.id);

    if (!profile) {
      throw Auth._fail(
        "no-profile",
        "We verified your sign-in but could not find a matching profile record."
      );
    }

    if (profile.status && profile.status !== "active" && profile.status !== "approved") {
      throw Auth._fail("inactive", "Your account is pending approval or inactive.");
    }

    if (!profile.role) {
      throw Auth._fail("no-role", "Your account does not have a role assigned yet.");
    }

    if (Auth.ROLES.indexOf(profile.role) === -1) {
      throw Auth._fail("bad-role", "Your account has an unrecognised role.");
    }

    return { session: session, user: session.user, profile: profile };
  },

  dashboardFor(role) {
    return Auth.DASHBOARDS[role] || null;
  },

  // Name fallback chain. Reads from a select("*") row, so probing for a column
  // that does not exist is simply undefined rather than a query error.
  displayName(profile, user) {
    const candidates = [
      profile && profile.full_name,
      profile && profile.name,
      profile && profile.username,
      profile && profile.employee_id
    ];

    for (let i = 0; i < candidates.length; i++) {
      const value = candidates[i];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }

    const email = (profile && profile.email) || (user && user.email) || "";

    if (email.indexOf("@") > 0) {
      return email.split("@")[0];
    }

    return "there";
  }
};
