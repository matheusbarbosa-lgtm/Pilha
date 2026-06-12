// ── Detalhe do projeto ────────────────────────────────────
async function openProjectDetail(projectId) {
  const statusMap = { todo: "Backlog", backlog: "Backlog", doing: "Fazendo", done: "Concluído" };
  const roleLabel = { "Product Owner": "PO", "Scrum Master": "SM", "Development Team": "DEV" };
  const roleBadge = { "Product Owner": "po", "Scrum Master": "sm", "Development Team": "dev" };

  try {
    const p = await apiFetch(`/api/projects/${projectId}`);

    // Esconde todas as views, mostra project-detail
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    document.querySelectorAll(".nav-item").forEach((n) => n.classList.remove("active"));
    document.getElementById("project-detail")?.classList.add("active");

    const viewTitle = document.getElementById("view-title");
    if (viewTitle) viewTitle.textContent = p.name;

    history.pushState({ viewId: "project-detail", projectId }, "", `/projetos/${projectId}`);

    // Info
    const fmt = (d) => d ? new Date(d + "T00:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" }) : "";
    const isProf = state.currentUser?.role === "professor" || state.currentUser?.isAdmin;
    const deadlineHtml = isProf
      ? `<div style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;">
           <span>📅 Prazo:</span>
           <input type="date" id="pd-deadline-input" value="${p.deadline || ""}" style="border:1px solid var(--border);border-radius:var(--r);padding:.2rem .5rem;font-size:.82rem;" />
           <button id="pd-deadline-save-btn" class="btn-primary btn-sm" style="font-size:.75rem;">Salvar</button>
         </div>`
      : (p.deadline ? `<span>📅 Prazo: <strong>${fmt(p.deadline)}</strong></span>` : "");
    const infoItems = [
      p.team     ? `<span>📚 Turma: <strong>${escapeHtml(p.team)}</strong></span>` : "",
      p.discipline ? `<span>📖 Disciplina: <strong>${escapeHtml(p.discipline)}</strong></span>` : "",
      p.startDate  ? `<span>🗓️ Início: <strong>${fmt(p.startDate)}</strong></span>` : "",
      deadlineHtml,
    ].filter(Boolean).join("");
    document.getElementById("pd-info").innerHTML = infoItems || "<span style='color:var(--muted)'>Sem informações adicionais.</span>";

    // Listener do botão Salvar prazo (apenas professor/admin)
    document.getElementById("pd-deadline-save-btn")?.addEventListener("click", async () => {
      const input = document.getElementById("pd-deadline-input");
      const newDeadline = input?.value;
      if (!newDeadline) return;
      try {
        await apiFetch(`/api/projects/${projectId}`, { method: "PATCH", body: JSON.stringify({ deadline: newDeadline }) });
        const proj = state.projects.find((x) => String(x.id) === String(projectId));
        if (proj) proj.deadline = newDeadline;
        if (typeof renderKanban === "function") renderKanban();
        if (typeof renderStats === "function") renderStats();
        input.style.borderColor = "var(--success, #22c55e)";
        setTimeout(() => { if (input) input.style.borderColor = ""; }, 1500);
      } catch (err) { alert(err.message); }
    });

    document.getElementById("pd-title").textContent = p.name;

    // Equipe Scrum
    const profiles = Array.isArray(p.memberProfiles) ? p.memberProfiles : [];
    const byRole = { "Product Owner": [], "Scrum Master": [], "Development Team": [] };
    profiles.forEach((m) => {
      const r = byRole[m.role] ? m.role : "Development Team";
      byRole[r].push(m.name);
    });
    document.getElementById("pd-team").innerHTML = ["Product Owner", "Scrum Master", "Development Team"].map((r) => `
      <div style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;">
        <span class="role-badge ${roleBadge[r]}" style="font-size:.65rem;min-width:2.5rem;text-align:center;">${roleLabel[r]}</span>
        ${byRole[r].length ? byRole[r].map((n) => `<span>${escapeHtml(n)}</span>`).join(", ") : "<span style='color:var(--muted)'>—</span>"}
      </div>`).join("");

    // Descrição
    const descCard = document.getElementById("pd-description-card");
    const descEl   = document.getElementById("pd-description");
    if (p.description) {
      descCard.style.display = "";
      descEl.textContent = p.description;
    } else {
      descCard.style.display = "none";
    }

    // Tarefas
    const tasks = Array.isArray(p.tasks) ? p.tasks : [];
    document.getElementById("pd-tasks").innerHTML = tasks.length
      ? `<table style="width:100%;border-collapse:collapse;font-size:.83rem;">
          <thead><tr style="color:var(--muted);text-align:left;">
            <th style="padding:.3rem .5rem;">Tarefa</th>
            <th style="padding:.3rem .5rem;">Responsável</th>
            <th style="padding:.3rem .5rem;">Prazo</th>
            <th style="padding:.3rem .5rem;">Status</th>
          </tr></thead>
          <tbody>${tasks.map((t) => `
            <tr style="border-top:1px solid var(--border);cursor:pointer;" data-open-task="${t.id}">
              <td style="padding:.35rem .5rem;">${escapeHtml(t.title)}</td>
              <td style="padding:.35rem .5rem;">${escapeHtml(t.assignee)}</td>
              <td style="padding:.35rem .5rem;">${fmt(t.due_date)}</td>
              <td style="padding:.35rem .5rem;">${statusMap[t.status] || t.status}</td>
            </tr>`).join("")}
          </tbody>
        </table>`
      : "<p style='color:var(--muted);font-size:.85rem;'>Nenhuma tarefa cadastrada.</p>";
    // Tarefas clicáveis → abre modal de detalhe
    document.getElementById("pd-tasks")?.addEventListener("click", (e) => {
      const row = e.target.closest("[data-open-task]");
      if (row && typeof openTaskDetail === "function") openTaskDetail(Number(row.dataset.openTask));
    });

    // Botões TAP / PI — visíveis apenas se docs liberados (alunos) ou sempre (prof/admin)
    // isProf já declarado acima nesta mesma função
    const docBtnsEl = document.getElementById("pd-doc-btns");
    if (docBtnsEl) docBtnsEl.style.display = (isProf || p.docsUnlocked) ? "flex" : "none";

    document.querySelectorAll(".pd-doc-btn").forEach((btn) => {
      btn.onclick = () => {
        const type = btn.dataset.doc;
        document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
        document.getElementById(`doc-${type}`)?.classList.add("active");
        history.pushState({ viewId: `doc-${type}` }, "", `/${type}`);
        const viewTitle2 = document.getElementById("view-title");
        if (viewTitle2) viewTitle2.textContent = type === "tap" ? "TAP" : "Projeto de Intervenção";
        fillDocProjectSelects();
        const sel = document.getElementById(`${type}-project-select`);
        if (sel) { sel.value = String(projectId); loadDoc(type); }
      };
    });

    // Painel de unlock de docs (professor/admin)
    const unlockPanel = document.getElementById("pd-unlock-panel");
    const unlockBtn   = document.getElementById("pd-unlock-btn");
    const unlockStatus = document.getElementById("pd-unlock-status");
    if (unlockPanel && isProf) {
      unlockPanel.style.display = "";
      let unlocked = p.docsUnlocked;
      const refresh = () => {
        unlockStatus.textContent = unlocked ? "Documentos liberados para os alunos" : "Documentos bloqueados para os alunos";
        unlockBtn.textContent = unlocked ? "🔒 Bloquear" : "🔓 Liberar TAP e PI";
        unlockBtn.className = unlocked ? "btn-secondary btn-sm" : "btn-primary btn-sm";
        if (docBtnsEl) docBtnsEl.style.display = "flex";
      };
      refresh();
      unlockBtn.onclick = async () => {
        try {
          const r = await apiFetch(`/api/projects/${projectId}/unlock-docs`, { method: "PATCH" });
          unlocked = r.docsUnlocked;
          refresh();
        } catch (e) { alert(e.message); }
      };
    } else if (unlockPanel) {
      unlockPanel.style.display = "none";
    }

  } catch (err) { alert(err.message); }
}

// Botão voltar do project-detail
document.getElementById("project-detail-back")?.addEventListener("click", () => {
  history.back();
});

// ── Equipes (aluno) — mostra só o próprio grupo ──────────
function renderEquipesAluno() {
  const profGrid = document.querySelector("#equipes-prof-grid");
  const alunoGroupsEl = document.querySelector("#equipes-aluno-groups");
  const profCard = profGrid?.closest("article");
  const filtersRow = document.getElementById("equipes-filters-row");

  if (profCard) profCard.style.display = "none";
  if (filtersRow) filtersRow.style.display = "none";

  if (!alunoGroupsEl) return;

  if (!state.projects.length) {
    alunoGroupsEl.innerHTML = `<p class="equipes-empty">Você ainda não faz parte de nenhum grupo.</p>`;
    return;
  }

  const myName = state.currentUser?.name;
  const roleLabel = { "Product Owner": " · PO", "Scrum Master": " · SM", "Development Team": "" };

  alunoGroupsEl.innerHTML = state.projects.map((p) => {
    const profiles = Array.isArray(p.memberProfiles) ? p.memberProfiles : [];
    const fmt = (d) => d ? new Date(d + "T00:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" }) : "";
    const myProfile = profiles.find((m) => m.name === myName);
    const isPO = myProfile?.role === "Product Owner";

    const memberListHtml = profiles.map((m) => {
      const initials = (m.name || "?").split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase();
      const isMe = m.name === myName;
      const rl = roleLabel[m.role] || "";
      return `
        <div class="group-member-row" style="${isMe ? "background:var(--primary-faint,#4f6ef710);border-radius:var(--r);" : ""}">
          <div class="gm-avatar">${escapeHtml(initials)}</div>
          <span class="gm-name">${escapeHtml(m.name)}${rl ? `<small style="color:var(--muted)">${rl}</small>` : ""}${isMe ? " <small style='color:var(--primary)'>(você)</small>" : ""}</span>
        </div>`;
    }).join("");

    // Botão de definir nome (só para PO quando nome não confirmado)
    const nameBtnHtml = (isPO && !p.nameConfirmed)
      ? `<button class="btn-outline-primary btn-sm pnm-open-btn" data-pid="${escapeHtml(p.id)}" data-pname="${escapeHtml(p.name)}" style="font-size:.75rem;letter-spacing:.04em;font-weight:600;">✏️ DEFINIR NOME DO PROJETO</button>`
      : "";

    return `
      <article class="card group-project-card">
        <div class="group-project-header">
          <div class="group-project-title-row">
            <h3 class="group-project-name" style="flex:1;">${escapeHtml(p.name)}</h3>
            ${nameBtnHtml}
            <span class="chip" style="background:var(--primary-faint,#4f6ef720);color:var(--primary,#4f6ef7);font-size:.7rem;">${profiles.length} membro${profiles.length !== 1 ? "s" : ""}</span>
          </div>
          <div class="group-project-meta">
            ${p.team ? `<span class="group-meta-pill">📚 ${escapeHtml(p.team)}</span>` : ""}
            ${p.discipline ? `<span class="group-meta-pill">📖 ${escapeHtml(p.discipline)}</span>` : ""}
            ${p.deadline ? `<span class="group-meta-pill">📅 até ${fmt(p.deadline)}</span>` : ""}
          </div>
          ${p.description ? `<p class="group-project-description">${escapeHtml(p.description)}</p>` : ""}
        </div>
        <div class="group-member-list">${memberListHtml}</div>
      </article>`;
  }).join("");

  // Ligar botões de definir nome após renderizar o HTML
  alunoGroupsEl.querySelectorAll(".pnm-open-btn").forEach((btn) => {
    btn.addEventListener("click", () => openNameModal(btn.dataset.pid, btn.dataset.pname));
  });
}

function openNameModal(projectId, currentName) {
  let modal = document.getElementById("project-name-modal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "project-name-modal";
    modal.style.cssText = "position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45);";
    modal.innerHTML = `
      <div style="background:var(--surface,#fff);border-radius:var(--r-lg,12px);padding:2rem;width:min(480px,92vw);box-shadow:0 8px 32px rgba(0,0,0,.18);display:flex;flex-direction:column;gap:1.25rem;">
        <h2 style="margin:0;font-size:1.1rem;font-weight:700;">Definir nome do projeto</h2>
        <div>
          <label style="font-size:.85rem;color:var(--muted);display:block;margin-bottom:.4rem;">Nome do projeto</label>
          <input id="pnm-input" type="text" maxlength="120" style="width:100%;box-sizing:border-box;font-size:1rem;padding:.55rem .75rem;border:1.5px solid var(--line);border-radius:var(--r);outline:none;" placeholder="Ex: Sistema de Gestão de Estoque" />
        </div>
        <label style="display:flex;align-items:flex-start;gap:.6rem;font-size:.82rem;color:var(--muted);cursor:pointer;line-height:1.45;">
          <input id="pnm-check" type="checkbox" style="width:18px;height:18px;min-width:18px;max-width:18px;margin:.15rem 0 0;padding:0;flex:0 0 18px;accent-color:var(--primary);" />
          <span style="flex:1;">Estou ciente de que, após confirmar, o nome do projeto <strong style="color:var(--text);">só poderá ser alterado pelo professor responsável.</strong></span>
        </label>
        <div style="display:flex;gap:.75rem;justify-content:flex-end;">
          <button class="btn-secondary" id="pnm-cancel">Cancelar</button>
          <button class="btn-primary" id="pnm-confirm">Confirmar nome</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
  }

  const input = modal.querySelector("#pnm-input");
  const check = modal.querySelector("#pnm-check");
  input.value = currentName;
  check.checked = false;
  modal.style.display = "flex";
  input.focus();

  modal.querySelector("#pnm-cancel").onclick = () => { modal.style.display = "none"; };
  modal.onclick = (e) => { if (e.target === modal) modal.style.display = "none"; };

  modal.querySelector("#pnm-confirm").onclick = async () => {
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    if (!check.checked) { check.parentElement.style.color = "var(--danger,#c0392b)"; check.focus(); return; }
    check.parentElement.style.color = "";
    try {
      await apiFetch(`/api/projects/${projectId}/confirm-name`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      modal.style.display = "none";
      await loadData();
      renderAll();
      renderEquipesAluno();
    } catch (e) { alert(e.message); }
  };
}

// ── Equipes (admin) ───────────────────────────────────────
async function loadEquipes() {
  const isProf = state.currentUser?.role === "professor" || state.currentUser?.isAdmin;
  if (isProf) {
    try {
      _allUsers = await apiFetch("/api/admin/users");
    } catch (_err) {
      _allUsers = [];
    }
    renderEquipes();
  } else {
    // Aluno: mostra só o próprio grupo usando state.projects
    renderEquipesAluno();
  }
}

function memberCard(u, isProf) {
  const initials = (u.name || "?").split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase();
  const photo = u.photo ? `<img src="${u.photo}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">` : initials;
  const roleLabel = isProf ? (u.isAdmin >= 2 ? "Super Admin" : u.isAdmin >= 1 ? "Admin" : "Professor") : (u.scrumRole || "Aluno");
  const adminBadge = u.isAdmin >= 1 ? `<span class="chip" style="background:#7a010a22;color:#7a010a;font-size:0.65rem;font-weight:700;">ADMIN</span>` : "";
  return `
    <div class="equipe-member-card" data-open-member="${escapeHtml(u.name || "")}">
      <div class="equipe-avatar">${photo}</div>
      <strong style="font-size:.9rem;line-height:1.2">${escapeHtml(u.name || "")}</strong>
      ${adminBadge}
      <small style="color:var(--muted)">${escapeHtml(roleLabel)}</small>
      ${u.project_name ? `<small style="color:var(--muted);font-size:.75rem">${escapeHtml(u.project_name)}</small>` : ""}
    </div>`;
}

async function openMemberProfile(name) {
  const modal = document.getElementById("member-profile-modal");
  if (!modal) return;
  try {
    // Busca dos dados da API (usa admin/users como fallback)
    const allUsers = await apiFetch("/api/admin/users").catch(() => []);
    const u = allUsers.find((x) => x.name === name) || { name };
    const profileFull = await apiFetch("/api/profile").catch(() => ({})); // só pra ter foto se for o próprio
    const photo = (u.name === state.currentUser?.name ? profileFull.user?.photo : null) || u.photo;

    const avatarEl = document.getElementById("mp-avatar");
    if (avatarEl) {
      avatarEl.innerHTML = photo
        ? `<img src="${photo}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`
        : (name || "?").charAt(0).toUpperCase();
    }
    const set = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
    set("mp-name", escapeHtml(name));
    set("mp-role-badge", escapeHtml(u.role === "professor" ? "Professor" : "Aluno"));
    set("mp-project-row", u.project_name ? `<span class="mp-label">Projeto:</span> ${escapeHtml(u.project_name || "")} · ${escapeHtml(u.turma || "")} · ${escapeHtml(u.periodo || "")}` : "");
    set("mp-bio-row", u.bio ? `<span class="mp-label">Sobre:</span> ${escapeHtml(u.bio)}` : "");

    let skills = [];
    try { skills = JSON.parse(u.skills || "[]"); } catch (_) {}
    set("mp-skills-row", skills.length ? `<span class="mp-label">Skills:</span> ${skills.map((s) => `<span class="tag-pill">${escapeHtml(s)}</span>`).join(" ")}` : "");
    set("mp-grad-row", u.graduations ? `<span class="mp-label">Graduações:</span> ${escapeHtml(u.graduations)}` : "");
    set("mp-spec-row", u.specialty ? `<span class="mp-label">Especialidades:</span> ${escapeHtml(u.specialty)}` : "");
    set("mp-exp-row", u.experience_years > 0 ? `<span class="mp-label">Experiência:</span> ${u.experience_years} anos` : "");

    // Contribuições do GitHub (professor/admin/o próprio podem ver/editar o login)
    const ghContainer = document.getElementById("mp-contributions");
    if (ghContainer) {
      if (u.id && typeof renderGithubContributions === "function") {
        const canEdit = state.currentUser?.role === "professor" || state.currentUser?.isAdmin || u.name === state.currentUser?.name;
        renderGithubContributions(u.id, ghContainer, { canEdit });
      } else {
        ghContainer.innerHTML = "";
      }
    }

    modal.showModal();
  } catch (err) { console.error(err); }
}

document.getElementById("mp-close-btn")?.addEventListener("click", () => {
  document.getElementById("member-profile-modal")?.close();
});

// Filtros de equipes
["equipes-search","equipes-periodo-filter","equipes-turma-filter"].forEach((id) => {
  document.getElementById(id)?.addEventListener("input", loadEquipes);
  document.getElementById(id)?.addEventListener("change", loadEquipes);
});

// Tabs equipes
document.querySelectorAll(".equipes-tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".equipes-tab").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".equipes-tab-panel").forEach((p) => p.classList.add("hidden"));
    btn.classList.add("active");
    const tab = btn.dataset.tab;
    document.getElementById(`equipes-tab-${tab}`)?.classList.remove("hidden");
    if (tab === "scrum") renderScrumKanban();
  });
});

// ── Popup perfil professor ────────────────────────────────
document.getElementById("prof-popup-skip")?.addEventListener("click", () => {
  localStorage.setItem("prof_popup_dismissed", "1");
  document.getElementById("prof-profile-popup")?.classList.add("hidden");
});

document.getElementById("prof-popup-save")?.addEventListener("click", async () => {
  const bio = document.getElementById("prof-bio-input")?.value.trim() || "";
  const graduations = document.getElementById("prof-grad-input")?.value.trim() || "";
  const specialty = document.getElementById("prof-spec-input")?.value.trim() || "";
  const experience_years = Number(document.getElementById("prof-exp-input")?.value || 0);
  try {
    await apiFetch("/api/profile/extended", {
      method: "PATCH",
      body: JSON.stringify({ bio, graduations, specialty, experience_years })
    });
    localStorage.setItem("prof_popup_dismissed", "1");
    document.getElementById("prof-profile-popup")?.classList.add("hidden");
    state.currentUser = { ...state.currentUser, profileComplete: true };
  } catch (err) { alert(err.message); }
});

// ── Modal perfil estendido ────────────────────────────────
document.getElementById("profile-extended-btn")?.addEventListener("click", async () => {
  const profileExtModal = document.getElementById("profile-extended-modal");
  if (!profileExtModal) return;
  try {
    const { user } = await apiFetch("/api/profile");
    document.getElementById("ext-bio").value = user.bio || "";
    let skills = []; try { skills = JSON.parse(user.skills || "[]"); } catch(_) {}
    document.getElementById("ext-skills").value = skills.join(", ");
    document.getElementById("ext-grad").value = user.graduations || "";
    document.getElementById("ext-spec").value = user.specialty || "";
    document.getElementById("ext-exp").value = user.experience_years || 0;
  } catch (_) {}
  profileExtModal.showModal();
});

document.getElementById("profile-ext-close")?.addEventListener("click", () => {
  document.getElementById("profile-extended-modal")?.close();
});

document.getElementById("profile-ext-save")?.addEventListener("click", async () => {
  const bio = document.getElementById("ext-bio")?.value.trim() || "";
  const skillsRaw = document.getElementById("ext-skills")?.value || "";
  const skills = skillsRaw.split(",").map((s) => s.trim()).filter(Boolean);
  const graduations = document.getElementById("ext-grad")?.value.trim() || "";
  const specialty = document.getElementById("ext-spec")?.value.trim() || "";
  const experience_years = Number(document.getElementById("ext-exp")?.value || 0);
  const errEl = document.getElementById("profile-ext-error");
  try {
    await apiFetch("/api/profile/extended", {
      method: "PATCH",
      body: JSON.stringify({ bio, skills, graduations, specialty, experience_years })
    });
    state.currentUser = { ...state.currentUser, profileComplete: true };
    document.getElementById("profile-extended-modal")?.close();
  } catch (err) { if (errEl) errEl.textContent = err.message; }
});

// ── EQUIPES (admin) ───────────────────────────────────────
let _allUsers = [];

function renderEquipes(searchTerm = "", roleFilter = "all") {
  const term = searchTerm.toLowerCase().trim();

  const filtered = _allUsers.filter((u) => {
    const matchRole = roleFilter === "all" || u.role === roleFilter;
    const matchSearch = !term
      || u.name.toLowerCase().includes(term)
      || u.username.toLowerCase().includes(term)
      || (u.email || "").toLowerCase().includes(term);
    return matchRole && matchSearch;
  });

  const profs = filtered.filter((u) => u.role === "professor");
  const alunos = filtered.filter((u) => u.role === "aluno");

  const profCountEl = document.querySelector("#prof-count");
  const alunoCountEl = document.querySelector("#aluno-count");
  if (profCountEl) profCountEl.textContent = profs.length;
  if (alunoCountEl) alunoCountEl.textContent = alunos.length;

  const profGrid = document.querySelector("#equipes-prof-grid");
  const alunoGroupsEl = document.querySelector("#equipes-aluno-groups");

  // ── Mapa de alunos por nome para lookup rápido ─────────────
  const userByName = new Map(_allUsers.map((u) => [u.name, u]));


  function userCard(u) {
    const initials = (u.name || "?").split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase();
    const adminBadge = u.isAdmin ? `<span class="chip" style="background:#1565C0;color:#fff;font-size:0.7rem;padding:1px 6px;">ADMIN</span>` : "";
    const statusBadge = u.onboardingDone
      ? `<span class="chip" style="background:#22c55e1a;color:#16a34a;font-size:0.7rem;">Ativo</span>`
      : `<span class="chip" style="background:#f59e0b1a;color:#d97706;font-size:0.7rem;">Pendente</span>`;
    const turmaInfo = u.turma ? `<div class="equipe-meta-item">📚 ${escapeHtml(u.turma)}${u.periodo ? ` · ${escapeHtml(u.periodo)}` : ""}</div>` : "";
    const emailInfo = u.email ? `<div class="equipe-meta-item">✉️ ${escapeHtml(u.email)}</div>` : "";
    return `
      <div class="equipe-card">
        <div class="equipe-avatar">${escapeHtml(initials)}</div>
        <div class="equipe-info">
          <div class="equipe-name">${escapeHtml(u.name)} ${adminBadge}</div>
          <div class="equipe-username">@${escapeHtml(u.username)} <span class="chip" style="background:var(--border);color:var(--muted);font-size:0.68rem;padding:1px 5px;font-family:monospace;">ID ${u.id}</span></div>
          <div class="equipe-badges">${statusBadge}</div>
          <div class="equipe-meta">${emailInfo}${turmaInfo}</div>
        </div>
      </div>`;
  }

  if (profGrid) {
    profGrid.innerHTML = profs.length
      ? profs.map(userCard).join("")
      : `<p class="equipes-empty">Nenhum professor encontrado.</p>`;
  }

  // ── Alunos agrupados por projeto ────────────────────────────
  if (!alunoGroupsEl) return;

  // Montar set de nomes de alunos filtrados para filtrar grupos
  const alunoNamesFiltered = new Set(alunos.map((u) => u.name));

  // Coletar projetos que têm ao menos 1 aluno filtrado
  const projectsWithAlunos = (state.projects || []).map((p) => {
    const profiles = Array.isArray(p.memberProfiles) ? p.memberProfiles : [];
    const membersInFilter = profiles.filter((m) => {
      if (roleFilter === "professor") return false;
      const u = userByName.get(m.name);
      if (u && u.role !== "aluno") return false;
      return !term || alunoNamesFiltered.has(m.name);
    });
    return { project: p, members: membersInFilter };
  }).filter((g) => g.members.length > 0);

  // Alunos sem nenhum projeto
  const alunosInProjects = new Set(
    (state.projects || []).flatMap((p) =>
      (p.memberProfiles || [])
        .filter((m) => { const u = userByName.get(m.name); return !u || u.role === "aluno"; })
        .map((m) => m.name)
    )
  );
  const semGrupo = alunos.filter((u) => !alunosInProjects.has(u.name));

  if (projectsWithAlunos.length === 0 && semGrupo.length === 0) {
    alunoGroupsEl.innerHTML = `<p class="equipes-empty" style="margin-top:.5rem;">Nenhum aluno encontrado.</p>`;
    return;
  }

  const groupsHtml = projectsWithAlunos.map(({ project: p, members }) => {
    // Coletar turma/período dos membros para exibir no cabeçalho do grupo
    const turmas = [...new Set(members.map((m) => userByName.get(m.name)?.turma).filter(Boolean))];
    const periodos = [...new Set(members.map((m) => userByName.get(m.name)?.periodo).filter(Boolean))];
    const turmaStr = turmas.length ? turmas.join(", ") : (p.team || "");
    const periodoStr = periodos.length ? periodos.join(", ") : "";

    const deadlineFormatted = p.deadline
      ? new Date(p.deadline + "T00:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })
      : "";
    const startFormatted = p.startDate
      ? new Date(p.startDate + "T00:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })
      : "";

    const myName = state.currentUser?.name;
    const isProf = state.currentUser?.role === "professor" || state.currentUser?.isAdmin;
    const isPO = p.memberProfiles?.some((m) => m.name === myName && m.role === "Product Owner");
    const canManage = isProf || isPO;

    const memberListHtml = members.map((m) => {
      const u = userByName.get(m.name);
      const initials = (m.name || "?").split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase();
      const roleLabel = m.role === "Product Owner" ? " · PO" : m.role === "Scrum Master" ? " · SM" : "";
      const removeBtn = canManage && m.role !== "Product Owner"
        ? `<button class="btn-icon-danger" data-remove-member="${encodeURIComponent(m.name)}" data-project-id="${p.id}" title="Remover">✕</button>`
        : "";
      return `
        <div class="group-member-row" data-member-name="${encodeURIComponent(m.name)}" style="cursor:pointer;" data-open-member="${escapeHtml(m.name)}">
          <div class="gm-avatar">${u?.photo ? `<img src="${u.photo}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">` : escapeHtml(initials)}</div>
          <span class="gm-name">${escapeHtml(m.name)}${roleLabel ? `<small style="color:var(--muted)">${roleLabel}</small>` : ""}</span>
          ${removeBtn}
        </div>`;
    }).join("");

    const addPanel = canManage ? `
      <div class="group-add-member">
        <input class="group-add-input" type="email" placeholder="E-mail do aluno..." data-project-id="${p.id}" />
        <button class="btn-secondary btn-sm" data-add-member="${p.id}">+ Adicionar</button>
        <small class="group-add-error" data-project-error="${p.id}" style="color:var(--danger);display:block;min-height:1.2em"></small>
      </div>` : "";

    const nameEditHtml = canManage ? `
      <div class="group-project-name-edit" data-project-id="${p.id}" style="display:flex;align-items:center;gap:0.4rem;flex:1;">
        <button class="btn-link gp-open-detail-btn" data-project-id="${p.id}" style="font-size:1rem;font-weight:700;text-align:left;padding:0;">${escapeHtml(p.name)}</button>
        <button class="btn-icon gp-edit-name-btn" title="Editar nome" data-project-id="${p.id}" data-current-name="${escapeHtml(p.name)}" style="opacity:.55;font-size:.85rem;">✏️</button>
      </div>` : `<h3 class="group-project-name" style="flex:1;">${escapeHtml(p.name)}</h3>`;

    const descEditHtml = canManage ? `
      <div class="group-description-edit" data-project-id="${p.id}">
        <textarea class="group-description-textarea" data-project-id="${p.id}" placeholder="Sobre o projeto (opcional)..." rows="2">${escapeHtml(p.description || "")}</textarea>
        <div class="group-desc-actions" style="display:none;">
          <button class="btn-primary btn-sm gp-save-desc-btn" data-project-id="${p.id}">Salvar</button>
          <button class="btn-secondary btn-sm gp-cancel-desc-btn" data-project-id="${p.id}">Cancelar</button>
        </div>
      </div>` : (p.description ? `<p class="group-project-description">${escapeHtml(p.description)}</p>` : "");

    return `
      <article class="card group-project-card">
        <div class="group-project-header">
          <div class="group-project-title-row">
            ${nameEditHtml}
            <span class="chip" style="background:var(--primary-faint,#4f6ef720);color:var(--primary,#4f6ef7);font-size:.7rem;">${members.length} aluno${members.length !== 1 ? "s" : ""}</span>
          </div>
          <div class="group-project-meta">
            ${turmaStr ? `<span class="group-meta-pill">📚 ${escapeHtml(turmaStr)}${periodoStr ? " · " + escapeHtml(periodoStr) : ""}</span>` : ""}
            ${p.discipline ? `<span class="group-meta-pill">📖 ${escapeHtml(p.discipline)}</span>` : ""}
            ${startFormatted ? `<span class="group-meta-pill">🗓️ ${escapeHtml(startFormatted)}${deadlineFormatted ? " → " + escapeHtml(deadlineFormatted) : ""}</span>` : deadlineFormatted ? `<span class="group-meta-pill">🗓️ até ${escapeHtml(deadlineFormatted)}</span>` : ""}
            ${isProf ? `<span class="group-meta-pill gp-deadline-pill">📅 Entrega: <input type="date" class="gp-deadline-input" data-project-id="${p.id}" value="${p.deadline || ""}" title="Data final do projeto (somente professor)" /></span>` : ""}
          </div>
          ${descEditHtml}
        </div>
        <div class="group-member-list">${memberListHtml}</div>
        ${addPanel}
        ${isProf ? `<div class="doc-release-row" data-project-id="${p.id}">
          <span style="font-size:.75rem;color:var(--muted);align-self:center;">Liberar:</span>
          <button class="doc-release-btn" data-release-type="tap" data-project-id="${p.id}">TAP</button>
          <button class="doc-release-btn" data-release-type="pi" data-project-id="${p.id}">PI</button>
        </div>` : ""}
      </article>
    `;
  }).join("");

  const semGrupoHtml = semGrupo.length ? `
    <article class="card group-project-card" style="opacity:.85;">
      <div class="group-project-header">
        <div class="group-project-title-row">
          <h3 class="group-project-name" style="color:var(--muted);">Sem grupo</h3>
          <span class="chip" style="font-size:.7rem;">${semGrupo.length} aluno${semGrupo.length !== 1 ? "s" : ""}</span>
        </div>
        <p class="group-project-description" style="color:var(--muted);">Alunos ainda não associados a nenhum projeto.</p>
      </div>
      <div class="group-members-grid">
        ${semGrupo.map((u) => userCard(u)).join("")}
      </div>
    </article>
  ` : "";

  alunoGroupsEl.innerHTML = groupsHtml + semGrupoHtml;

  // ── Remover membro
  alunoGroupsEl.querySelectorAll("[data-remove-member]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const memberName = decodeURIComponent(btn.dataset.removeMember);
      const projectId = btn.dataset.projectId;
      if (!confirm(`Remover ${memberName} do projeto?`)) return;
      try {
        await apiFetch(`/api/projects/${projectId}/members/${encodeURIComponent(memberName)}`, { method: "DELETE" });
        await loadEquipes();
      } catch (err) {
        alert(err.message);
      }
    });
  });

  // ── Adicionar membro
  alunoGroupsEl.querySelectorAll("[data-add-member]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const projectId = btn.dataset.addMember;
      const input = alunoGroupsEl.querySelector(`.group-add-input[data-project-id="${projectId}"]`);
      const errEl = alunoGroupsEl.querySelector(`[data-project-error="${projectId}"]`);
      if (!input) return;
      const email = input.value.trim();
      if (!email) { if (errEl) errEl.textContent = "Digite o e-mail do aluno"; return; }
      try {
        if (errEl) errEl.textContent = "";
        await apiFetch(`/api/projects/${projectId}/members`, { method: "POST", body: JSON.stringify({ email }) });
        input.value = "";
        await loadEquipes();
      } catch (err) {
        if (errEl) errEl.textContent = err.message;
      }
    });
  });

  // Enter no input de adicionar
  alunoGroupsEl.querySelectorAll(".group-add-input").forEach((input) => {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        alunoGroupsEl.querySelector(`[data-add-member="${input.dataset.projectId}"]`)?.click();
      }
    });
  });

  // ── Clicar em membro → abre perfil ───────────────────────
  alunoGroupsEl.querySelectorAll("[data-open-member]").forEach((row) => {
    row.addEventListener("click", (e) => {
      if (e.target.closest("button")) return; // não abrir se clicou em botão
      openMemberProfile(decodeURIComponent(row.dataset.memberName || row.dataset.openMember));
    });
  });

  // ── Liberar TAP/PI por projeto ────────────────────────────
  alunoGroupsEl.querySelectorAll(".doc-release-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const type = btn.dataset.releaseType;
      const projectId = btn.dataset.projectId;
      // Usa turma_id direto do projeto (campo enviado pelo backend via FK)
      const proj = state.projects.find((x) => String(x.id) === String(projectId));
      let turmaId = proj?.turma_id || null;
      // Fallback: buscar via memberProfiles somente se turma_id não disponível
      if (!turmaId) {
        for (const mp of (proj?.memberProfiles || [])) {
          const u = _allUsers.find((x) => x.name === mp.name);
          const tid = u?.turmaId || u?.turma_id;
          if (tid) { turmaId = tid; break; }
        }
      }
      if (!turmaId) { alert("Não foi possível identificar a turma do projeto. Verifique se o projeto está vinculado a uma turma."); return; }
      const isReleased = btn.classList.contains("released");
      try {
        if (isReleased) {
          await apiFetch(`/api/docs/permissions/${turmaId}/${type}`, { method: "DELETE" });
          btn.classList.remove("released");
          btn.title = "";
        } else {
          await apiFetch(`/api/docs/permissions/${turmaId}/${type}`, { method: "POST" });
          btn.classList.add("released");
          btn.title = "Liberado";
        }
      } catch (err) { alert(err.message); }
    });
  });

  // ── Professor edita a data final do projeto ──────────────
  alunoGroupsEl.querySelectorAll(".gp-deadline-input").forEach((input) => {
    input.addEventListener("change", async () => {
      const projectId = input.dataset.projectId;
      const deadline = input.value;
      if (!deadline) return;
      try {
        await apiFetch(`/api/projects/${projectId}`, { method: "PATCH", body: JSON.stringify({ deadline }) });
        const p = state.projects.find((x) => String(x.id) === String(projectId));
        if (p) p.deadline = deadline;
        input.style.outline = "2px solid #16a34a";
        setTimeout(() => { input.style.outline = ""; }, 1200);
        if (typeof renderAll === "function") renderAll(); // atualiza barra de progresso etc.
      } catch (err) { alert(err.message); }
    });
  });

  // ── Abrir detalhe do projeto ─────────────────────────────
  alunoGroupsEl.querySelectorAll(".gp-open-detail-btn").forEach((btn) => {
    btn.addEventListener("click", () => openProjectDetail(btn.dataset.projectId));
  });

  // ── Editar nome do projeto (inline) ─────────────────────
  alunoGroupsEl.querySelectorAll(".gp-edit-name-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const projectId = btn.dataset.projectId;
      const currentName = btn.dataset.currentName;
      const nameWrap = btn.closest(".group-project-name-edit");
      if (!nameWrap) return;
      const newName = prompt("Novo nome do projeto:", currentName);
      if (!newName || newName.trim() === currentName) return;
      if (!confirm(`Renomear o projeto para "${newName.trim()}"? Isso atualizará o nome em todo o sistema.`)) return;
      apiFetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        body: JSON.stringify({ name: newName.trim() })
      }).then(async () => {
        await refreshAndRender();
        const equipes = document.querySelector('[data-view="equipes"]');
        if (equipes) equipes.click();
      }).catch((err) => alert(err.message));
    });
  });

  // ── Editar descrição / Sobre o Projeto ───────────────────
  alunoGroupsEl.querySelectorAll(".group-description-textarea").forEach((textarea) => {
    const projectId = textarea.dataset.projectId;
    const actions = textarea.closest(".group-description-edit")?.querySelector(".group-desc-actions");
    const origValue = textarea.value;

    textarea.addEventListener("focus", () => {
      if (actions) actions.style.display = "flex";
    });

    const cancelBtn = alunoGroupsEl.querySelector(`.gp-cancel-desc-btn[data-project-id="${projectId}"]`);
    const saveBtn   = alunoGroupsEl.querySelector(`.gp-save-desc-btn[data-project-id="${projectId}"]`);

    if (cancelBtn) cancelBtn.addEventListener("click", () => {
      textarea.value = origValue;
      if (actions) actions.style.display = "none";
    });

    if (saveBtn) saveBtn.addEventListener("click", async () => {
      try {
        await apiFetch(`/api/projects/${projectId}`, {
          method: "PATCH",
          body: JSON.stringify({ description: textarea.value })
        });
        if (actions) actions.style.display = "none";
        // Atualiza o estado local para não perder o valor ao re-render
        const proj = state.projects.find((p) => String(p.id) === String(projectId));
        if (proj) proj.description = textarea.value;
      } catch (err) { alert(err.message); }
    });
  });
}

document.querySelector("#equipes-search")?.addEventListener("input", (e) => {
  renderEquipes(e.target.value, document.querySelector("#equipes-role-filter")?.value || "all");
});
document.querySelector("#equipes-role-filter")?.addEventListener("change", (e) => {
  renderEquipes(document.querySelector("#equipes-search")?.value || "", e.target.value);
});

// ── EQUIPES: tabs ─────────────────────────────────────────
(function initEquipesTabs() {
  document.querySelectorAll(".equipes-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".equipes-tab").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".equipes-tab-panel").forEach((p) => p.classList.add("hidden"));
      tab.classList.add("active");
      const panelId = `equipes-tab-${tab.dataset.tab}`;
      document.querySelector(`#${panelId}`)?.classList.remove("hidden");
      if (tab.dataset.tab === "scrum") renderScrumKanban();
    });
  });
})();

// ── SCRUM KANBAN por projeto ───────────────────────────────
let _scrumDragging = null; // { memberName, fromRole }

function renderScrumKanban() {
  const kanbanEl = document.querySelector("#scrum-kanban");
  const projectSel = document.querySelector("#scrum-project-select");
  if (!kanbanEl || !projectSel) return;

  // populate project select — PRESERVA a seleção atual (senão volta sempre pro 1º)
  const _cur = projectSel.value;
  projectSel.innerHTML = state.projects.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");
  if (_cur && state.projects.find((p) => String(p.id) === _cur)) projectSel.value = _cur;

  const projectId = Number(projectSel.value) || state.projects[0]?.id;
  if (!projectId) { kanbanEl.innerHTML = `<p style="color:var(--muted)">Nenhum projeto disponível.</p>`; return; }

  const project = state.projects.find((p) => p.id === projectId || p.id === String(projectId));
  const profiles = Array.isArray(project?.memberProfiles) ? project.memberProfiles : [];

  // group by role
  const byRole = {};
  SCRUM_COLS.forEach((c) => { byRole[c.key] = []; });
  profiles.forEach((m) => {
    const validRoles = ["Product Owner", "Scrum Master", "Development Team"];
    const role = validRoles.includes(m.role) ? m.role : "sem_papel";
    byRole[role].push(m);
  });

  // só PO do projeto ou professor/admin pode atribuir papéis
  const myName = state.currentUser?.name;
  const isProf = state.currentUser?.role === "professor" || state.currentUser?.isAdmin;
  const isPO   = profiles.some((m) => m.name === myName && m.role === "Product Owner");
  const canAssign = isProf || isPO;

  kanbanEl.innerHTML = SCRUM_COLS.map(({ key, label, badge, avatarClass, icon }) => {
    const members = byRole[key];
    return `
      <div class="scrum-kanban-col" data-scrum-col="${key}">
        <div class="scrum-kanban-col-header">
          <span>${icon}</span>
          <span class="scrum-kanban-col-title">${label}</span>
          <span class="role-badge ${badge}">${badge.toUpperCase()}</span>
          <span class="scrum-kanban-col-count">${members.length}</span>
        </div>
        <div class="scrum-col-body" data-scrum-drop="${key}">
          ${members.length
            ? members.map((m) => `
                <div class="scrum-member-card${canAssign ? "" : " no-drag"}"
                     ${canAssign ? 'draggable="true"' : ""}
                     data-member="${encodeURIComponent(m.name)}" data-role="${key}">
                  <div class="sm-avatar ${avatarClass}">${escapeHtml((m.name||"?").charAt(0).toUpperCase())}</div>
                  <div>
                    <div class="sm-name">${escapeHtml(m.name)}</div>
                    <div class="sm-sub">${key === "sem_papel" ? "Sem papel atribuído" : label}</div>
                  </div>
                </div>
              `).join("")
            : `<div class="scrum-kanban-empty">—</div>`
          }
        </div>
      </div>
    `;
  }).join("");

  // drag events (só se canAssign)
  kanbanEl.querySelectorAll(".scrum-member-card:not(.no-drag)").forEach((card) => {
    card.addEventListener("dragstart", () => {
      _scrumDragging = {
        memberName: decodeURIComponent(card.dataset.member),
        fromRole: card.dataset.role
      };
      card.classList.add("dragging");
    });
    card.addEventListener("dragend", () => {
      card.classList.remove("dragging");
      kanbanEl.querySelectorAll(".scrum-kanban-col").forEach((c) => c.classList.remove("drag-over"));
    });
  });

  kanbanEl.querySelectorAll(".scrum-kanban-col").forEach((col) => {
    col.addEventListener("dragover", (e) => {
      e.preventDefault();
      col.classList.add("drag-over");
    });
    col.addEventListener("dragleave", () => col.classList.remove("drag-over"));
    col.addEventListener("drop", async (e) => {
      e.preventDefault();
      col.classList.remove("drag-over");
      if (!_scrumDragging) return;

      const newRole = col.dataset.scrumCol;
      if (_scrumDragging.fromRole === newRole) return;

      const { memberName } = _scrumDragging;
      _scrumDragging = null;

      try {
        await apiFetch(
          `/api/projects/${projectId}/members/${encodeURIComponent(memberName)}/role`,
          { method: "PATCH", body: JSON.stringify({ role: newRole }) }
        );
        // update state locally
        const proj = state.projects.find((p) => p.id === projectId || p.id === String(projectId));
        if (proj && Array.isArray(proj.memberProfiles)) {
          const m = proj.memberProfiles.find((mp) => mp.name === memberName);
          if (m) m.role = newRole;
        }
        renderScrumKanban();
      } catch (err) {
        alert(`Erro ao mover ${memberName}: ${err.message}`);
        renderScrumKanban();
      }
    });
  });
}

// project change → re-render scrum kanban
document.querySelector("#scrum-project-select")?.addEventListener("change", renderScrumKanban);
