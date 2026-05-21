// ── Política de senha forte (espelha backend) ─────────
function validatePasswordStrength(pw) {
  const s = String(pw || "");
  if (s.length < 8)            return "Senha deve ter pelo menos 8 caracteres";
  if (!/[A-Z]/.test(s))        return "Senha deve conter pelo menos uma letra maiúscula";
  if (!/[a-z]/.test(s))        return "Senha deve conter pelo menos uma letra minúscula";
  if (!/[0-9]/.test(s))        return "Senha deve conter pelo menos um número";
  if (!/[^A-Za-z0-9]/.test(s)) return "Senha deve conter pelo menos um caractere especial (!@#$%...)";
  return null;
}
function pwStrengthLevel(pw) {
  if (!pw || pw.length < 8) return "weak";
  const meets = [/[A-Z]/.test(pw), /[a-z]/.test(pw), /[0-9]/.test(pw), /[^A-Za-z0-9]/.test(pw)].filter(Boolean).length;
  if (meets === 4 && pw.length >= 12) return "strong";
  if (meets >= 3) return "good";
  if (meets >= 2) return "fair";
  return "weak";
}
const _checks = {
  length:  pw => pw.length >= 8,
  upper:   pw => /[A-Z]/.test(pw),
  lower:   pw => /[a-z]/.test(pw),
  number:  pw => /[0-9]/.test(pw),
  special: pw => /[^A-Za-z0-9]/.test(pw),
};
const cadPwBar  = document.getElementById("cad-pwbar");
const cadPwCrit = document.getElementById("cad-pwcrit");
document.getElementById("password").addEventListener("input", function () {
  const pw = this.value;
  if (cadPwBar)  cadPwBar.className = `pw-strength-bar ${pw ? pwStrengthLevel(pw) : ""}`;
  if (cadPwCrit) cadPwCrit.querySelectorAll("[data-crit]").forEach(li => {
    li.classList.toggle("met", _checks[li.dataset.crit]?.(pw) ?? false);
  });
});

const params = new URLSearchParams(window.location.search);
const token = params.get("invite");
const tokenInput = document.getElementById("invite-token");
const infoBox = document.getElementById("invite-info");
const errorMsg = document.getElementById("error-msg");
const successMsg = document.getElementById("success-msg");
const form = document.getElementById("cadastro-form");
const submitBtn = document.getElementById("submit-btn");

if (!token) {
  document.getElementById("form-area").style.display = "none";
  document.getElementById("footer-link").style.display = "none";
  document.getElementById("invalid-area").style.display = "block";
} else {
  tokenInput.value = token;
  fetch(`/api/invites/info?token=${encodeURIComponent(token)}`)
    .then(r => r.json())
    .then(data => {
      if (data.error) {
        document.getElementById("form-area").style.display = "none";
        document.getElementById("footer-link").style.display = "none";
        document.getElementById("invalid-area").style.display = "block";
      } else {
        infoBox.innerHTML = `Você foi convidado para o projeto <strong>${escapeHtml(data.projectName)}</strong>${data.inviterName ? ` por <strong>${escapeHtml(data.inviterName)}</strong>` : ''}. Crie sua conta para entrar.`;
        if (data.email) {
          const emailInput = document.getElementById("email");
          emailInput.value = data.email;
          emailInput.readOnly = true;
          emailInput.style.opacity = "0.7";
        }
      }
    })
    .catch(() => {
      infoBox.innerHTML = "Você foi convidado para um projeto no <strong>PILHA</strong>. Crie sua conta para entrar.";
    });
}

function escapeHtml(str) {
  return String(str || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorMsg.style.display = "none";
  submitBtn.disabled = true;
  submitBtn.textContent = "Criando conta...";

  const fd = new FormData(form);
  const pw = fd.get("password");
  const cpw = fd.get("confirmPassword");

  if (pw !== cpw) {
    errorMsg.textContent = "As senhas não coincidem.";
    errorMsg.style.display = "block";
    submitBtn.disabled = false;
    submitBtn.textContent = "Criar conta e entrar no projeto";
    return;
  }
  const pwErr = validatePasswordStrength(pw);
  if (pwErr) {
    errorMsg.textContent = pwErr;
    errorMsg.style.display = "block";
    submitBtn.disabled = false;
    submitBtn.textContent = "Criar conta e entrar no projeto";
    return;
  }

  try {
    const res = await fetch("/api/auth/register-by-invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inviteToken: fd.get("inviteToken"),
        name: fd.get("name").trim(),
        email: fd.get("email").trim(),
        password: pw,
        confirmPassword: cpw
      })
    });

    const data = await res.json();

    if (!res.ok) {
      errorMsg.textContent = data.error || "Erro ao criar conta.";
      errorMsg.style.display = "block";
      submitBtn.disabled = false;
      submitBtn.textContent = "Criar conta e entrar no projeto";
      return;
    }

    const sessionToken = res.headers.get("X-Auth-Token");
    if (sessionToken) {
      sessionStorage.setItem("pilha_tab_token", sessionToken);
    }

    form.style.display = "none";
    successMsg.style.display = "block";
    setTimeout(() => { window.location.href = "/app"; }, 1500);

  } catch (err) {
    errorMsg.textContent = "Erro de conexão. Tente novamente.";
    errorMsg.style.display = "block";
    submitBtn.disabled = false;
    submitBtn.textContent = "Criar conta e entrar no projeto";
  }
});
