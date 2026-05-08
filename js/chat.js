// ── Turmas (professor) ────────────────────────────────────
async function loadTurmas() {
  if (!isProfessor()) return;
  try {
    state.turmas = await apiFetch("/api/turmas");
  } catch (_) { state.turmas = []; }
  renderTurmas();
}

function renderTurmas() {
  const listEl = document.getElementById("turmas-list");
  if (!listEl) return;
  if (!state.turmas.length) {
    listEl.innerHTML = "<p style='color:var(--muted);padding:1rem'>Nenhuma turma criada ainda.</p>";
    return;
  }
  listEl.innerHTML = state.turmas.map((t) => `
    <div class="turma-row">
      <div class="turma-info">
        <strong>${escapeHtml(t.curso)} · ${escapeHtml(t.periodo)}º · Turma ${escapeHtml(t.turma)}</strong>
        <small>Link: <a href="${escapeHtml(t.link)}" target="_blank">${escapeHtml(t.link)}</a></small>
      </div>
      <button class="btn-secondary" onclick="navigator.clipboard.writeText('${escapeHtml(t.link)}').then(()=>alert('Link copiado!'))">Copiar link</button>
    </div>
  `).join("");
}

const turmaFormEl = document.getElementById("turma-form");
if (turmaFormEl) {
  turmaFormEl.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(turmaFormEl);
    const errEl = document.getElementById("turma-form-error");
    try {
      await apiFetch("/api/turmas", {
        method: "POST",
        body: JSON.stringify({
          curso: String(fd.get("curso") || "").trim(),
          periodo: String(fd.get("periodo") || "").trim(),
          turma: String(fd.get("turma") || "").trim()
        })
      });
      turmaFormEl.reset();
      if (errEl) errEl.textContent = "";
      await loadTurmas();
    } catch (err) {
      if (errEl) errEl.textContent = err.message;
    }
  });
}

// ── Chat ─────────────────────────────────────────────────
async function loadChatTurmaList() {
  const listEl = document.getElementById("chat-turma-list");
  if (!listEl) return;
  let turmas = [];
  if (isProfessor()) {
    turmas = state.turmas.length ? state.turmas : await apiFetch("/api/turmas").catch(() => []);
  } else if (state.currentUser?.turmaId) {
    // Aluno: só a turma dele
    turmas = [{ id: state.currentUser.turmaId, turma: state.currentUser.turma, periodo: state.currentUser.periodo, curso: state.currentUser.curso }];
  }
  listEl.innerHTML = turmas.map((t) => `
    <div class="chat-turma-item${state.chatTurmaId === t.id ? " active" : ""}" data-turma-id="${t.id}">
      <strong>${escapeHtml(t.turma || "")}</strong>
      <small>${escapeHtml(t.curso || "")} · ${escapeHtml(t.periodo || "")}</small>
    </div>
  `).join("") || "<p style='padding:0.75rem;color:var(--muted);font-size:0.8rem'>Nenhuma turma.</p>";

  listEl.querySelectorAll(".chat-turma-item").forEach((el) => {
    el.addEventListener("click", () => openChat(Number(el.dataset.turmaId)));
  });

  // Auto-abre se só tiver uma turma
  if (turmas.length === 1 && !state.chatTurmaId) openChat(turmas[0].id);
}

async function openChat(turmaId) {
  state.chatTurmaId = turmaId;
  document.getElementById("chat-empty")?.classList.add("hidden");
  document.getElementById("chat-area")?.classList.remove("hidden");
  const turma = (state.turmas.find((t) => t.id === turmaId)) || { turma: "", curso: "" };
  const headerEl = document.getElementById("chat-header");
  if (headerEl) headerEl.textContent = `Chat — Turma ${turma.turma || ""} ${turma.curso || ""}`;
  await loadChatMessages(turmaId);
  loadChatTurmaList(); // atualiza seleção ativa

  if (state.chatInterval) clearInterval(state.chatInterval);
  state.chatInterval = setInterval(() => {
    if (state.chatTurmaId === turmaId) loadChatMessages(turmaId);
  }, 8000);
}

async function loadChatMessages(turmaId) {
  const container = document.getElementById("chat-messages");
  if (!container) return;
  try {
    const msgs = await apiFetch(`/api/chat/${turmaId}`);
    container.innerHTML = msgs.map((m) => {
      const isMe = m.sender_name === state.currentUser?.name;
      const initial = (m.sender_name || "?").charAt(0).toUpperCase();
      return `
        <div class="chat-msg${isMe ? " me" : ""}">
          <div class="chat-avatar">${initial}</div>
          <div class="chat-bubble">
            <div class="chat-sender">${escapeHtml(m.sender_name)}</div>
            <div class="chat-text">${escapeHtml(m.content)}</div>
            <div class="chat-time">${new Date(m.created_at).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}</div>
          </div>
        </div>`;
    }).join("") || "<p style='text-align:center;color:var(--muted);padding:2rem'>Seja o primeiro a enviar uma mensagem!</p>";
    container.scrollTop = container.scrollHeight;
  } catch (_) {}
}

document.getElementById("chat-send-btn")?.addEventListener("click", async () => {
  if (!state.chatTurmaId) return;
  const input = document.getElementById("chat-input");
  const content = input?.value.trim();
  if (!content) return;
  try {
    await apiFetch(`/api/chat/${state.chatTurmaId}`, {
      method: "POST",
      body: JSON.stringify({ content })
    });
    if (input) input.value = "";
    await loadChatMessages(state.chatTurmaId);
  } catch (err) { alert(err.message); }
});

document.getElementById("chat-input")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); document.getElementById("chat-send-btn")?.click(); }
});

// ── Chat tabs (turma / projeto) ───────────────────────────
document.querySelectorAll(".chat-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".chat-tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".chat-tab-panel").forEach((p) => p.classList.add("hidden"));
    tab.classList.add("active");
    const panel = document.getElementById(`chat-tab-${tab.dataset.chatTab}`);
    panel?.classList.remove("hidden");
    if (tab.dataset.chatTab === "projeto") loadChatProjectList();
  });
});

// ── Chat de projeto ───────────────────────────────────────
let _chatProjectId = null;
let _chatProjInterval = null;

async function loadChatProjectList() {
  const listEl = document.getElementById("chat-project-list");
  if (!listEl) return;
  const projects = state.projects || [];
  listEl.innerHTML = projects.map((p) => `
    <div class="chat-turma-item${_chatProjectId === p.id ? " active" : ""}" data-proj-id="${p.id}">
      <strong>${escapeHtml(p.name)}</strong>
      <small>${escapeHtml(p.team || "")}</small>
    </div>`
  ).join("") || "<p style='padding:.75rem;color:var(--muted);font-size:.8rem'>Nenhum projeto.</p>";

  listEl.querySelectorAll("[data-proj-id]").forEach((el) => {
    el.addEventListener("click", () => openProjectChat(el.dataset.projId));
  });

  if (projects.length === 1 && !_chatProjectId) openProjectChat(projects[0].id);
}

async function openProjectChat(projectId) {
  _chatProjectId = String(projectId);
  document.getElementById("chat-proj-empty")?.classList.add("hidden");
  document.getElementById("chat-proj-area")?.classList.remove("hidden");
  const p = state.projects.find((x) => String(x.id) === String(projectId));
  const hdr = document.getElementById("chat-proj-header");
  if (hdr) hdr.textContent = `Chat — ${p?.name || "Projeto"}`;
  await loadProjectChatMessages();

  if (_chatProjInterval) clearInterval(_chatProjInterval);
  _chatProjInterval = setInterval(() => {
    if (_chatProjectId === String(projectId)) loadProjectChatMessages();
  }, 6000);
}

async function loadProjectChatMessages() {
  const el = document.getElementById("chat-proj-messages");
  if (!el || !_chatProjectId) return;
  try {
    const msgs = await apiFetch(`/api/projects/${_chatProjectId}/messages`);
    const myName = state.currentUser?.name;
    el.innerHTML = msgs.map((m) => {
      const isMe = m.sender_name === myName;
      return `
        <div class="chat-msg${isMe ? " me" : ""}">
          <div class="chat-avatar">${(m.sender_name || "?").charAt(0).toUpperCase()}</div>
          <div class="chat-bubble">
            <div class="chat-sender">${isMe ? "Você" : escapeHtml(m.sender_name)}</div>
            <div class="chat-text">${escapeHtml(m.content)}</div>
            <div class="chat-time">${new Date(m.created_at).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}</div>
          </div>
        </div>`;
    }).join("") || "<p style='text-align:center;color:var(--muted);padding:2rem'>Seja o primeiro a enviar uma mensagem!</p>";
    el.scrollTop = el.scrollHeight;
  } catch (_) {}
}

document.getElementById("chat-proj-send-btn")?.addEventListener("click", async () => {
  const input = document.getElementById("chat-proj-input");
  const content = input?.value.trim();
  if (!content || !_chatProjectId) return;
  try {
    await apiFetch(`/api/projects/${_chatProjectId}/messages`, {
      method: "POST", body: JSON.stringify({ content })
    });
    if (input) input.value = "";
    await loadProjectChatMessages();
  } catch (err) { alert(err.message); }
});

document.getElementById("chat-proj-input")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); document.getElementById("chat-proj-send-btn")?.click(); }
});
