// ── Política de senha forte ───────────────────────────────
// Espelha validatePasswordStrength do backend. Retorna null se ok, string de erro se inválida.
function validatePasswordStrength(pw) {
  const s = String(pw || "");
  if (s.length < 8)            return "Senha deve ter pelo menos 8 caracteres";
  if (!/[A-Z]/.test(s))        return "Senha deve conter pelo menos uma letra maiúscula";
  if (!/[a-z]/.test(s))        return "Senha deve conter pelo menos uma letra minúscula";
  if (!/[0-9]/.test(s))        return "Senha deve conter pelo menos um número";
  if (!/[^A-Za-z0-9]/.test(s)) return "Senha deve conter pelo menos um caractere especial (!@#$%...)";
  return null;
}

// ── Barra de força + checklist de critérios ──────────────
function pwStrength(pw) {
  if (!pw || pw.length < 8) return "weak";
  const has = (re) => re.test(pw);
  const meets = [has(/[A-Z]/), has(/[a-z]/), has(/[0-9]/), has(/[^A-Za-z0-9]/)].filter(Boolean).length;
  if (meets === 4 && pw.length >= 12) return "strong";
  if (meets >= 3) return "good";
  if (meets >= 2) return "fair";
  return "weak";
}

const _PW_CHECKS = {
  length:  pw => pw.length >= 8,
  upper:   pw => /[A-Z]/.test(pw),
  lower:   pw => /[a-z]/.test(pw),
  number:  pw => /[0-9]/.test(pw),
  special: pw => /[^A-Za-z0-9]/.test(pw),
};

function attachPwStrengthUI(inputId, barId, criteriaId) {
  const inp  = document.getElementById(inputId);
  const bar  = document.getElementById(barId);
  const crit = document.getElementById(criteriaId);
  if (!inp) return;
  inp.addEventListener("input", () => {
    const pw = inp.value;
    if (bar)  bar.className = `pw-strength-bar ${pw ? pwStrength(pw) : ""}`;
    if (crit) crit.querySelectorAll("[data-crit]").forEach(li => {
      li.classList.toggle("met", _PW_CHECKS[li.dataset.crit]?.(pw) ?? false);
    });
  });
}

// Login: só barra (sem checklist — campo de autenticação, não criação)
attachPwStrengthUI("login-password-input", "login-pw-bar", null);

// Formulários de criação/troca de senha: barra + checklist
attachPwStrengthUI("pw-invite",    "pwbar-invite",    "pwcrit-invite");
attachPwStrengthUI("pw-turma",     "pwbar-turma",     "pwcrit-turma");
attachPwStrengthUI("pw-reset",     "pwbar-reset",     "pwcrit-reset");
attachPwStrengthUI("pw-change",    "pwbar-change",    "pwcrit-change");
attachPwStrengthUI("pw-register",  "pwbar-register",  "pwcrit-register");
attachPwStrengthUI("pw-onboarding","pwbar-onboarding","pwcrit-onboarding");

// ── Tema por papel ────────────────────────────────────────
function applyTheme(user) {
  document.body.classList.remove("theme-professor", "theme-aluno");
  if (user && (user.role === "professor" || user.isAdmin)) {
    document.body.classList.add("theme-professor");
  } else {
    document.body.classList.add("theme-aluno");
  }
}

// ── Session management ────────────────────────────────────
async function setSession(user) {
  state.currentUser = user;
  applyTheme(user);
  state.profilePhotoLoaded = false;
  authScreen.classList.add("hidden");
  appLayout.classList.remove("hidden");
  await refreshAndRender();
  await tryAcceptInviteFromUrl();
  // Navega para a seção correspondente à URL atual
  navigateTo(resolveCurrentPath(), false);
  // Show tutorial for new users
  if (!localStorage.getItem("pilha_tutorial_done")) {
    startTutorial();
  }
}

async function showStudentOnboarding(user) {
  state.currentUser = user;
  applyTheme(user);
  appLayout.classList.add("hidden");
  authScreen.classList.remove("hidden");
  clearAuthFeedback();
  state.pendingPhoto = null;
  setAuthView("onboarding");

  const pendingInvite = sessionStorage.getItem("pendingInvite");
  const modeInput = document.querySelector("#onboarding-mode-input");
  const tokenInput = document.querySelector("#onboarding-invite-token-input");
  const createSection = document.querySelector("#onboarding-create-section");
  const joinSection = document.querySelector("#onboarding-join-section");
  const modeLabel = document.querySelector("#onboarding-mode-label");

  if (pendingInvite) {
    if (modeInput) modeInput.value = "join";
    if (tokenInput) tokenInput.value = pendingInvite;
    createSection?.classList.add("hidden");
    joinSection?.classList.remove("hidden");
    if (modeLabel) modeLabel.textContent = "entre no projeto do colega";
  } else {
    if (modeInput) modeInput.value = "create";
    createSection?.classList.remove("hidden");
    joinSection?.classList.add("hidden");
    if (modeLabel) modeLabel.textContent = "crie seu grupo";
  }

  const initialsEl = document.querySelector("#onboarding-avatar-initials");
  if (initialsEl) initialsEl.textContent = (user.name || "?").charAt(0).toUpperCase();
}

function clearSession() {
  sessionStorage.removeItem(SESSION_TOKEN_KEY);
  state.currentUser = null;
  document.body.classList.remove("theme-professor", "theme-aluno");
  state.profilePhotoLoaded = false;
  state.pendingPhoto = null;
  // Fecha todos os dialogs abertos antes de mostrar a tela de auth
  document.querySelectorAll("dialog[open]").forEach(d => d.close());
  appLayout.classList.add("hidden");
  authScreen.classList.remove("hidden");
  loginForm.reset();
  if (registerForm) registerForm.reset();
  if (recoverForm) recoverForm.reset();
  if (onboardingForm) onboardingForm.reset();
  clearAuthFeedback();
  setAuthView("home");
}

async function bootSession() {
  // 1. Link de turma tem prioridade máxima
  const turmaToken = sessionStorage.getItem("pendingTurmaToken");
  if (turmaToken) {
    try {
      const info = await apiFetch(`/api/turmas/resolve/${turmaToken}`);
      sessionStorage.removeItem("pendingTurmaToken");
      const url = new URL(window.location.href);
      url.searchParams.delete("turma");
      window.history.replaceState({}, "", url.toString());
      const tokenInput = document.getElementById("register-turma-token");
      if (tokenInput) tokenInput.value = turmaToken;
      const infoBox = document.getElementById("register-turma-info");
      if (infoBox) infoBox.innerHTML = `<strong>Turma:</strong> ${escapeHtml(info.turma)} · ${escapeHtml(info.periodo)} · ${escapeHtml(info.curso)}<br><small>Professor: ${escapeHtml(info.professor_name)}</small>`;
      setAuthView("register-turma");
      return;
    } catch (_) {
      sessionStorage.removeItem("pendingTurmaToken");
    }
  }

  // 2. Lê pendingInvite ANTES de qualquer chamada async
  const pendingInvite = sessionStorage.getItem("pendingInvite");

  // 3. Verifica sessão atual
  let currentUser = null;
  try {
    const data = await apiFetch("/api/auth/me");
    currentUser = data.user;
  } catch (_) {}

  // 4. Sem sessão
  if (!currentUser) {
    if (pendingInvite) {
      // Mostra tela de registro via convite
      const tokenInput = document.getElementById("register-invite-token");
      if (tokenInput) tokenInput.value = pendingInvite;
      const infoBox = document.getElementById("register-invite-info");
      if (infoBox) infoBox.innerHTML = `Você foi convidado para participar de um projeto no <strong>PILHA</strong>. Crie sua conta para entrar.`;
      setAuthView("register-invite");
    } else {
      clearSession();
    }
    return;
  }

  // 5. Com sessão — vai para o app (tryAcceptInviteFromUrl cuida do convite se logado)
  if (currentUser.role === "aluno" && !currentUser.onboardingDone) {
    await showStudentOnboarding(currentUser);
  } else {
    await setSession(currentUser);
  }
}

async function tryAcceptInviteFromUrl() {
  const url = new URL(window.location.href);
  const token = url.searchParams.get("invite");
  if (!token) return;
  try {
    await apiFetch("/api/invites/accept", {
      method: "POST",
      body: JSON.stringify({ token })
    });
    await refreshAndRender();
    alert("Convite aceito com sucesso. Voce entrou no projeto.");
  } catch (err) {
    alert(`Nao foi possivel aceitar convite: ${err.message}`);
  } finally {
    url.searchParams.delete("invite");
    window.history.replaceState({}, "", url.toString());
    sessionStorage.removeItem("pendingInvite");
  }
}

// ── Auth form listeners ───────────────────────────────────
let _pending2FAUserId = null;
const LOGIN_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(loginForm);
  const identifier = String(data.get("identifier") || "").trim();
  const password = String(data.get("password") || "").trim();
  const normalizedIdentifier = identifier.toLowerCase();

  clearAuthFeedback();

  try {
    const response = await apiFetch("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ identifier: normalizedIdentifier, password })
    });

    // 2FA required
    if (response.requires2FA) {
      _pending2FAUserId = response.userId;
      const desc = document.getElementById("2fa-desc");
      if (desc) desc.textContent = `Código enviado para ${response.maskedEmail}. Válido por 10 minutos.`;
      setAuthView("2fa");
      return;
    }

    if (response.mustChangePassword) {
      setAuthView("change-password");
    } else if (response.requiresOnboarding) {
      await showStudentOnboarding(response.user);
    } else {
      await setSession(response.user);
    }
  } catch (err) {
    loginError.textContent = err.message;
  }
});

// ── OTP form ─────────────────────────────────────────────
const otpForm = document.querySelector("#otp-form");
const otpError = document.querySelector("#otp-error");
if (otpForm) {
  otpForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const code = String(new FormData(otpForm).get("code") || "").trim();
    try {
      const response = await apiFetch("/api/auth/verify-otp", {
        method: "POST",
        body: JSON.stringify({ userId: _pending2FAUserId, code })
      });
      _pending2FAUserId = null;
      clearAuthFeedback();
      if (response.mustChangePassword) {
        setAuthView("change-password");
      } else {
        await setSession(response.user);
      }
    } catch (err) {
      if (otpError) otpError.textContent = err.message;
    }
  });
}

// ── Forgot password ──────────────────────────────────────
document.querySelector("#go-forgot-password")?.addEventListener("click", (e) => {
  e.preventDefault();
  setAuthView("forgot");
});
const forgotForm = document.querySelector("#forgot-form");
const forgotMsg  = document.querySelector("#forgot-msg");
const forgotErr  = document.querySelector("#forgot-error");
if (forgotForm) {
  forgotForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const identifier = String(new FormData(forgotForm).get("identifier") || "").trim();
    try {
      await apiFetch("/api/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ username: identifier })
      });
      if (forgotMsg) { forgotMsg.textContent = "Se encontrarmos seu cadastro, enviaremos o link em breve."; forgotMsg.classList.remove("hidden"); }
      if (forgotErr) forgotErr.textContent = "";
    } catch (err) {
      if (forgotErr) forgotErr.textContent = err.message;
    }
  });
}

// ── Reset password (via token na URL) ───────────────────
let _isResetFlow = false;
const resetForm  = document.querySelector("#reset-form");
const resetError = document.querySelector("#reset-error");
if (resetForm) {
  resetForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(resetForm);
    const token = String(fd.get("token") || "").trim();
    const newPassword = String(fd.get("newPassword") || "").trim();
    const confirmPassword = String(fd.get("confirmPassword") || "").trim();
    if (newPassword !== confirmPassword) { if (resetError) resetError.textContent = "Senhas não coincidem"; return; }
    const _pwErrReset = validatePasswordStrength(newPassword);
    if (_pwErrReset) { if (resetError) resetError.textContent = _pwErrReset; return; }
    try {
      await apiFetch("/api/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ token, newPassword })
      });
      setAuthView("login");
      resetForm.reset();
      loginError.textContent = "";
      alert("Senha redefinida com sucesso! Faça login.");
    } catch (err) {
      if (resetError) resetError.textContent = err.message;
    }
  });
}

// ── Change password form ───────────────────────────────────
const changePasswordForm = document.querySelector("#change-password-form");
const changePasswordError = document.querySelector("#change-password-error");
if (changePasswordForm) {
  changePasswordForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(changePasswordForm);
    const newPassword = String(data.get("newPassword") || "").trim();
    const confirmPassword = String(data.get("confirmPassword") || "").trim();
    if (newPassword !== confirmPassword) {
      changePasswordError.textContent = "As senhas não coincidem";
      return;
    }
    const _pwErrChange = validatePasswordStrength(newPassword);
    if (_pwErrChange) { changePasswordError.textContent = _pwErrChange; return; }
    try {
      await apiFetch("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ newPassword })
      });
      const me = await apiFetch("/api/profile");
      await setSession(me);
    } catch (err) {
      changePasswordError.textContent = err.message;
    }
  });
}

goLoginBtn.addEventListener("click", () => {
  clearAuthFeedback();
  setAuthView("login");
});

// ── Registro via link de turma ────────────────────────────
const registerTurmaForm = document.getElementById("register-turma-form");
if (registerTurmaForm) {
  registerTurmaForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(registerTurmaForm);
    const errEl = document.getElementById("register-turma-error");
    const pw = String(fd.get("password") || "");
    const cpw = String(fd.get("confirmPassword") || "");
    if (pw !== cpw) { if (errEl) errEl.textContent = "As senhas não coincidem"; return; }
    const _pwErrTurma = validatePasswordStrength(pw);
    if (_pwErrTurma) { if (errEl) errEl.textContent = _pwErrTurma; return; }
    try {
      const res = await apiFetch("/api/auth/register-by-turma", {
        method: "POST",
        body: JSON.stringify({
          turmaToken: String(fd.get("turmaToken") || ""),
          name: String(fd.get("name") || "").trim(),
          email: String(fd.get("email") || "").trim(),
          password: pw
        })
      });
      sessionStorage.removeItem("pendingTurmaToken");
      if (res.requiresOnboarding) await showStudentOnboarding(res.user);
      else await setSession(res.user);
    } catch (err) {
      if (errEl) errEl.textContent = err.message;
    }
  });
}

const registerInviteForm = document.getElementById("register-invite-form");
if (registerInviteForm) {
  registerInviteForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(registerInviteForm);
    const errEl = document.getElementById("register-invite-error");
    const pw = String(fd.get("password") || "");
    const cpw = String(fd.get("confirmPassword") || "");
    if (pw !== cpw) { if (errEl) errEl.textContent = "As senhas não coincidem"; return; }
    const _pwErrInvite = validatePasswordStrength(pw);
    if (_pwErrInvite) { if (errEl) errEl.textContent = _pwErrInvite; return; }
    try {
      const res = await apiFetch("/api/auth/register-by-invite", {
        method: "POST",
        body: JSON.stringify({
          inviteToken: String(fd.get("inviteToken") || ""),
          name: String(fd.get("name") || "").trim(),
          email: String(fd.get("email") || "").trim(),
          password: pw,
          confirmPassword: cpw
        })
      });
      sessionStorage.removeItem("pendingInvite");
      await setSession(res.user);
    } catch (err) {
      if (errEl) errEl.textContent = err.message;
    }
  });
}


document.querySelectorAll("[data-auth-target]").forEach((btn) => {
  btn.addEventListener("click", () => {
    clearAuthFeedback();
    setAuthView(btn.dataset.authTarget);
  });
});

// Show/hide turma-periodo fields based on role selection
const registerRoleSelect = document.querySelector("#register-role-select");
const registerAlunoFields = document.querySelector("#register-aluno-fields");
if (registerRoleSelect && registerAlunoFields) {
  registerRoleSelect.addEventListener("change", () => {
    registerAlunoFields.classList.toggle("hidden", registerRoleSelect.value !== "aluno");
  });
}

registerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearAuthFeedback();
  const data = new FormData(registerForm);
  const payload = {
    name: String(data.get("name") || "").trim(),
    username: String(data.get("username") || "").trim(),
    role: String(data.get("role") || "aluno"),
    email: String(data.get("email") || "").trim() || null,
    turma: String(data.get("turma") || "").trim() || null,
    periodo: String(data.get("periodo") || "").trim() || null,
    password: String(data.get("password") || "")
  };
  const confirmPassword = String(data.get("confirmPassword") || "");

  if (payload.password !== confirmPassword) {
    registerError.textContent = "As senhas não coincidem.";
    return;
  }
  const _pwErrRegister = validatePasswordStrength(payload.password);
  if (_pwErrRegister) { registerError.textContent = _pwErrRegister; return; }

  try {
    await apiFetch("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    registerSuccess.textContent = "Conta criada com sucesso. Faca o login.";
    registerForm.reset();
  } catch (err) {
    registerError.textContent = err.message;
  }
});

if (recoverForm) {
  recoverForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearAuthFeedback();
    const data = new FormData(recoverForm);
    const username = String(data.get("username") || "").trim();
    const newPassword = String(data.get("newPassword") || "");
    const confirmNewPassword = String(data.get("confirmNewPassword") || "");

    if (newPassword !== confirmNewPassword) {
      if (recoverError) recoverError.textContent = "As senhas nao coincidem.";
      return;
    }

    try {
      await apiFetch("/api/auth/recover", {
        method: "POST",
        body: JSON.stringify({ username, newPassword })
      });

      if (recoverSuccess) recoverSuccess.textContent = "Senha atualizada. Voce ja pode fazer login.";
      recoverForm.reset();
    } catch (err) {
      if (recoverError) recoverError.textContent = err.message;
    }
  });
}

// ── Onboarding photo upload ───────────────────────────────
const onboardingPhotoInput = document.querySelector("#onboarding-photo-input");
if (onboardingPhotoInput) {
  onboardingPhotoInput.addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (!file) return;
    resizeAndPreviewPhoto(file, "#onboarding-avatar-img", "#onboarding-avatar-initials", (dataUrl) => {
      state.pendingPhoto = dataUrl;
      onboardingError.textContent = "";
    }, (errorMessage) => {
      state.pendingPhoto = null;
      event.target.value = "";
      onboardingError.textContent = errorMessage;
    });
  });
}

// ── Onboarding form submit ────────────────────────────────
if (onboardingForm) {
  onboardingForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearAuthFeedback();
    const data = new FormData(onboardingForm);

    const email = String(data.get("email") || "").trim();
    const password = String(data.get("password") || "");
    const confirmPassword = String(data.get("confirmPassword") || "");
    const turma = String(data.get("turma") || "").trim();
    const periodo = String(data.get("periodo") || "").trim();
    const mode = String(data.get("onboardingMode") || "create");
    const inviteToken = String(data.get("inviteToken") || "").trim();
    const photo = state.pendingPhoto || null;

    if (password !== confirmPassword) { onboardingError.textContent = "As senhas não coincidem"; return; }
    const _pwErrOnboarding = validatePasswordStrength(password);
    if (_pwErrOnboarding) { onboardingError.textContent = _pwErrOnboarding; return; }

    const payload = { email, password, confirmPassword, turma, periodo, photo, mode };

    if (mode === "join") {
      payload.inviteToken = inviteToken;
    } else {
      const projectName = String(data.get("projectName") || "").trim();
      const projectDeadline = String(data.get("projectDeadline") || "").trim();
      const scrumRole = String(data.get("scrumRole") || "Development Team");
      const inviteEmails = String(data.get("inviteEmails") || "")
        .split(",")
        .map((e) => e.trim())
        .filter(Boolean);

      payload.projectName = projectName;
      payload.projectDeadline = projectDeadline;
      payload.scrumRole = scrumRole;
      payload.inviteEmails = inviteEmails;
    }

    try {
      const result = await apiFetch("/api/auth/student-onboarding", {
        method: "POST",
        body: JSON.stringify(payload)
      });

      sessionStorage.removeItem("pendingInvite");
      state.pendingPhoto = null;

      onboardingSuccess.textContent = mode === "join"
        ? "Perfil configurado! Voce entrou no projeto."
        : `Grupo criado! Convites enviados: ${result.invitesSent || 0}.`;

      await setSession(result.user);
    } catch (err) {
      onboardingError.textContent = err.message;
    }
  });
}

// ── Reset de senha via token do e-mail ────────────────────
(function handleResetToken() {
  const url = new URL(window.location.href);
  const token = url.searchParams.get("reset");
  if (!token) return;
  _isResetFlow = true;

  // Limpa token da URL sem recarregar
  url.searchParams.delete("reset");
  window.history.replaceState({}, "", url.toString());

  // Mostra tela de redefinição
  document.querySelector("#auth-screen").classList.remove("hidden");
  document.querySelector("#app-layout")?.classList.add("hidden");
  document.querySelector("#reset-token-input").value = token;
  setAuthView("reset");
})();
