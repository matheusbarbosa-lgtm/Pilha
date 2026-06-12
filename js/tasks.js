// ── Task Detail Modal ──────────────────────────────────────
let _detailTask = null; // currently-open task

// Normaliza checklist para formato de grupos: [{id, name, items:[{id,title,done}]}]
function _normalizeChecklist(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  if (raw[0] && Array.isArray(raw[0].items)) return raw; // já é o novo formato
  // Formato antigo: array plano de itens → converte para 1 grupo
  return [{ id: Date.now(), name: "Checklist", items: raw }];
}

function renderDetailChecklist() {
  const groups = _normalizeChecklist(_detailTask?.checklist || []);
  const groupsEl = document.querySelector("#checklist-groups");
  const labelEl = document.querySelector("#checklist-label");
  const barEl = document.querySelector("#checklist-bar");
  if (!groupsEl) return;

  const allItems = groups.flatMap(g => g.items || []);
  const done = allItems.filter(i => i.done).length;
  const total = allItems.length;
  if (labelEl) labelEl.textContent = `${done}/${total}`;
  if (barEl) barEl.style.width = total ? `${Math.round(done / total * 100)}%` : "0%";

  // Opções de responsável (membros do projeto da tarefa)
  const members = (typeof getProjectMembers === "function" && _detailTask)
    ? getProjectMembers(String(_detailTask.projectId)) : [];
  const today = new Date(); today.setHours(0, 0, 0, 0);

  groupsEl.innerHTML = groups.map((group, gIdx) => {
    const items = group.items || [];
    const gDone = items.filter(i => i.done).length;
    const gPct = items.length ? Math.round(gDone / items.length * 100) : 0;
    return `
    <div class="checklist-group" data-g-idx="${gIdx}">
      <div class="checklist-group-header">
        <span class="checklist-group-name">${escapeHtml(group.name || "Checklist")}</span>
        <span class="checklist-group-count">${gDone}/${items.length} · ${gPct}%</span>
        <button class="checklist-group-delete" data-g-idx="${gIdx}" title="Remover grupo">×</button>
      </div>
      <div class="checklist-group-bar"><span style="width:${gPct}%"></span></div>
      <div class="checklist-items">
        ${items.map((item, iIdx) => {
          const overdue = !item.done && item.dueDate && new Date(`${item.dueDate}T00:00:00`) < today;
          const assigneeOpts = `<option value="">Sem responsável</option>` +
            members.map((m) => `<option value="${escapeHtml(m)}"${item.assignee === m ? " selected" : ""}>${escapeHtml(m)}</option>`).join("");
          return `
          <div class="checklist-item${overdue ? " overdue" : ""}" data-g-idx="${gIdx}" data-i-idx="${iIdx}">
            <div class="checklist-circle${item.done ? " checked" : ""}" data-g-idx="${gIdx}" data-i-idx="${iIdx}"></div>
            <div class="ci-main">
              <input class="ci-title-input${item.done ? " done" : ""}" value="${escapeHtml(item.title)}" data-g-idx="${gIdx}" data-i-idx="${iIdx}" />
              <div class="ci-meta">
                <select class="ci-assignee" data-g-idx="${gIdx}" data-i-idx="${iIdx}" title="Responsável">${assigneeOpts}</select>
                <input type="date" class="ci-due${overdue ? " overdue" : ""}" value="${item.dueDate || ""}" data-g-idx="${gIdx}" data-i-idx="${iIdx}" title="Data de entrega" />
              </div>
            </div>
            <button class="ci-del-btn" data-g-idx="${gIdx}" data-i-idx="${iIdx}" title="Remover">×</button>
          </div>`;
        }).join("") || `<div class="checklist-empty-item">Nenhum item ainda.</div>`}
      </div>
      <div class="checklist-add-item-row" data-g-idx="${gIdx}">
        <input type="text" class="checklist-item-input" data-g-idx="${gIdx}" placeholder="Adicionar um item..." />
        <button type="button" class="checklist-item-add-btn" data-g-idx="${gIdx}">Adicionar</button>
      </div>
    </div>`;
  }).join("");
}

// Paleta de cores das etiquetas (estilo Trello)
const LABEL_COLORS = ["#61bd4f", "#f2d600", "#ff9f1a", "#eb5a46", "#c377e0", "#0079bf", "#00c2e0", "#ff78cb", "#344563"];
let _selectedTagColor = LABEL_COLORS[0];

// Normaliza uma tag (string legada OU objeto {name,color}) para {name,color}
function _normTag(tg) {
  if (tg && typeof tg === "object") return { name: tg.name || "", color: tg.color || null };
  return { name: String(tg || ""), color: null };
}

function renderDetailTags() {
  const tags = (_detailTask?.tags || []).map(_normTag);
  const el = document.querySelector("#tags-display");
  if (el) {
    el.innerHTML = tags.length
      ? tags.map((tg, idx) => {
          const c = tg.color;
          const style = c ? `style="background:${c};color:#fff;border-color:${c}"` : "";
          return `<span class="tag-pill${c ? " colored" : ""}" ${style}>${escapeHtml(tg.name)}<button class="tag-rm-btn" data-tag-idx="${idx}" title="Remover">×</button></span>`;
        }).join("")
      : `<span class="tags-empty">Nenhuma etiqueta.</span>`;
  }
  // Paleta de cores
  const pal = document.querySelector("#tag-color-palette");
  if (pal) {
    pal.innerHTML = LABEL_COLORS.map((c) =>
      `<button type="button" class="tag-swatch${c === _selectedTagColor ? " selected" : ""}" data-color="${c}" style="background:${c}" title="Cor da etiqueta"></button>`
    ).join("");
  }
}

// Normaliza o repositório para uma URL clicável e atualiza o link "abrir"
function _githubUrl(repo) {
  const r = String(repo || "").trim();
  if (!r) return "";
  if (/^https?:\/\//i.test(r)) return r;
  if (/^(www\.)?github\.com\//i.test(r)) return "https://" + r.replace(/^www\./i, "");
  if (/^[\w.-]+\/[\w.-]+$/.test(r)) return "https://github.com/" + r; // owner/repo
  return "";
}
function _updateGithubLink(repo) {
  const link = document.querySelector("#github-open-link");
  if (!link) return;
  const url = _githubUrl(repo);
  if (url) { link.href = url; link.classList.remove("hidden"); }
  else { link.removeAttribute("href"); link.classList.add("hidden"); }
}


async function openTaskDetail(taskId) {
  const modal = document.querySelector("#task-detail-modal");
  if (!modal) return;

  let task = state.tasks.find((t) => t.id === taskId || t.id === String(taskId));
  if (!task) {
    try { task = await apiFetch(`/api/tasks/${taskId}`); } catch (e) { return; }
  }

  _detailTask = {
    ...task,
    checklist: Array.isArray(task.checklist) ? [...task.checklist] : [],
    tags: Array.isArray(task.tags) ? [...task.tags] : []
  };

  // Populate static fields
  const q = (id) => modal.querySelector(id);
  if (q("#detail-task-id")) q("#detail-task-id").value = task.id;
  if (q("#detail-project-id")) q("#detail-project-id").value = task.projectId;
  if (q("#detail-title")) q("#detail-title").value = task.title;
  if (q("#detail-description")) q("#detail-description").value = task.description || "";
  if (q("#detail-due-date")) q("#detail-due-date").value = task.dueDate;
  if (q("#detail-start-date")) q("#detail-start-date").value = task.startDate || "";
  if (q("#detail-points")) q("#detail-points").value = task.points || 1;

  let mappedStatus = task.status;
  if (mappedStatus === "todo" || mappedStatus === "backlog") mappedStatus = "nao_iniciado";
  else if (mappedStatus === "doing") mappedStatus = "em_progresso";
  else if (mappedStatus === "done") mappedStatus = "concluido";
  if (q("#detail-status")) q("#detail-status").value = mappedStatus;

  if (q("#detail-priority")) q("#detail-priority").value = task.priority || "normal";

  const urgencyBadge = q("#detail-urgency-badge");
  const priorityLabels = { urgente: "🔴 Urgente", alta: "🟠 Alta", normal: "🟡 Normal", baixa: "🟢 Baixa" };
  if (urgencyBadge) {
    urgencyBadge.textContent = priorityLabels[task.priority || "normal"] || task.priority;
    urgencyBadge.className = `urgency-badge priority-${task.priority || "normal"}`;
  }

  // Chip de status + nome do projeto no cabeçalho
  const statusChip = q("#detail-status-chip");
  if (statusChip) {
    const statusLabels = { nao_iniciado: "Não iniciado", em_progresso: "Em progresso", concluido: "Concluído" };
    statusChip.textContent = statusLabels[mappedStatus] || mappedStatus;
    statusChip.className = `tdm-status-chip ${mappedStatus}`;
  }
  const projLabel = q("#tdm-project-label");
  if (projLabel) {
    const proj = (typeof projectById === "function") ? projectById(task.projectId) : null;
    projLabel.textContent = proj ? `📁 ${proj.name}` : "";
  }

  // GitHub (repo + nota)
  if (q("#github-repo-input")) q("#github-repo-input").value = task.githubRepo || "";
  if (q("#github-note-input")) q("#github-note-input").value = task.githubNote || "";
  _updateGithubLink(task.githubRepo || "");

  // Assignee select
  const assigneeEl = q("#detail-assignee");
  if (assigneeEl) setAssigneeOptions(assigneeEl, task.projectId, task.assignee);

  renderDetailChecklist();
  renderDetailTags();
  loadTaskComments(taskId, modal.querySelector("#comments-list"));
  loadTaskAttachments(taskId);
  loadTaskAudit(taskId);

  modal.showModal();
}

async function loadTaskAttachments(taskId) {
  const listEl = document.getElementById("attachments-list");
  const errEl  = document.getElementById("attachment-error");
  if (!listEl) return;
  try {
    const rows = await apiFetch(`/api/tasks/${taskId}/attachments`);
    listEl.innerHTML = rows.length
      ? rows.map((a) => {
          const kb = (a.size / 1024).toFixed(1);
          return `<div class="attachment-item" data-att-id="${a.id}">
            <a href="/api/tasks/${taskId}/attachments/${a.id}/download" target="_blank">${escapeHtml(a.original_name)}</a>
            <span class="att-size">${kb}KB</span>
            <button class="btn-icon att-del-btn" data-att-id="${a.id}" title="Remover">×</button>
          </div>`;
        }).join("")
      : `<p style="color:var(--muted);font-size:.82rem">Nenhum anexo ainda.</p>`;

    listEl.querySelectorAll(".att-del-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Remover este anexo?")) return;
        try {
          await apiFetch(`/api/tasks/${taskId}/attachments/${btn.dataset.attId}`, { method: "DELETE" });
          loadTaskAttachments(taskId);
        } catch (e) { alert(e.message); }
      });
    });
  } catch (_) { if (listEl) listEl.innerHTML = ""; }
}

// Mensagem natural para cada evento do histórico
function _auditMessage(r) {
  const st = { nao_iniciado: "Não iniciado", em_progresso: "Em progresso", concluido: "Concluído", todo: "Não iniciado", doing: "Em progresso", done: "Concluído", backlog: "Não iniciado", review: "Em progresso" };
  const pr = { urgente: "Urgente", alta: "Alta", normal: "Normal", baixa: "Baixa", media: "Normal" };
  const strong = (v) => `<strong>${escapeHtml(v)}</strong>`;
  switch (r.field) {
    case "status":              return `moveu para ${strong(st[r.new_val] || r.new_val)}`;
    case "priority":            return `alterou a prioridade para ${strong(pr[r.new_val] || r.new_val)}`;
    case "title":               return `renomeou para ${strong(r.new_val)}`;
    case "assignee":            return `definiu o responsável como ${strong(r.new_val)}`;
    case "due_date":            return `alterou a data de entrega para ${strong(r.new_val)}`;
    case "urgency":             return `alterou a urgência`;
    case "checklist":           return `atualizou o check-list`;
    case "checklist_item_done": return `concluiu o item ${strong(r.new_val)}`;
    case "tags":                return r.new_val ? `definiu as etiquetas: ${strong(r.new_val)}` : `removeu as etiquetas`;
    case "anexo":               return `anexou ${strong(r.new_val)}`;
    case "anexo_removido":      return `removeu o anexo ${strong(r.old_val)}`;
    case "github_repo":         return `vinculou o repositório ${strong(r.new_val)}`;
    case "comentario":          return `comentou`;
    default:                    return `alterou ${escapeHtml(r.field)}`;
  }
}

async function loadTaskAudit(taskId) {
  const listEl = document.getElementById("audit-log-list");
  if (!listEl) return;
  try {
    const rows = await apiFetch(`/api/tasks/${taskId}/audit`);
    listEl.innerHTML = rows.length
      ? rows.slice().reverse().map((r) => {
          const dt = new Date(r.created_at).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
          return `<div class="audit-log-item">
            <span class="audit-dot"></span>
            <div class="audit-text"><strong>${escapeHtml(r.user_name)}</strong> ${_auditMessage(r)}<small>${dt}</small></div>
          </div>`;
        }).join("")
      : `<p style="color:var(--muted);font-size:.8rem;padding:.4rem .1rem">Nenhuma atividade registrada ainda.</p>`;
  } catch (_) {}
}

// Toggle audit log
document.getElementById("audit-log-toggle")?.addEventListener("click", () => {
  const list = document.getElementById("audit-log-list");
  const toggle = document.getElementById("audit-log-toggle");
  if (!list) return;
  list.classList.toggle("hidden");
  toggle.textContent = list.classList.contains("hidden")
    ? "Histórico de alterações ▸"
    : "Histórico de alterações ▾";
});

// Anexar arquivo
document.getElementById("attachment-file-input")?.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  const errEl = document.getElementById("attachment-error");
  if (!file || !_detailTask) return;
  if (file.size > 80 * 1024 * 1024) {
    if (errEl) errEl.textContent = "Arquivo muito grande (máx 80MB)";
    e.target.value = "";
    return;
  }
  if (errEl) errEl.textContent = "";
  const formData = new FormData();
  formData.append("file", file);
  try {
    const tokenKey = typeof SESSION_TOKEN_KEY !== "undefined" ? SESSION_TOKEN_KEY : "pilha_tab_token";
    const token = sessionStorage.getItem(tokenKey) || "";
    const csrf = (typeof getCsrfToken === "function") ? getCsrfToken() : null;
    const upHeaders = {};
    if (token) upHeaders["Authorization"] = `Bearer ${token}`;
    if (csrf) upHeaders["X-CSRF-Token"] = csrf; // multipart: NÃO definir Content-Type (boundary automático)
    const res = await fetch(`/api/tasks/${_detailTask.id}/attachments`, {
      method: "POST",
      credentials: "include",
      headers: upHeaders,
      body: formData
    });
    const newToken = res.headers.get("X-Auth-Token");
    if (newToken) sessionStorage.setItem(tokenKey, newToken);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error || "Erro ao enviar");
    }
    e.target.value = "";
    loadTaskAttachments(_detailTask.id);
  } catch (err) { if (errEl) errEl.textContent = err.message; }
});

// Wire up task-detail-modal events ONCE
(function initTaskDetailModal() {
  const modal = document.querySelector("#task-detail-modal");
  if (!modal) return;

  // Close buttons (cabeçalho + cancelar lateral)
  modal.querySelector("#detail-close-btn")?.addEventListener("click", () => modal.close());
  modal.querySelector("#detail-close-btn-2")?.addEventListener("click", () => modal.close());

  // Backdrop close
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.close(); });

  // "Mostrar/Ocultar detalhes" — divide o painel: chat em cima, atividade embaixo
  modal.querySelector("#toggle-details-btn")?.addEventListener("click", (e) => {
    const block = modal.querySelector("#activity-block");
    const feed = modal.querySelector(".tdm-feed");
    if (!block) return;
    const nowHidden = block.classList.toggle("hidden");
    feed?.classList.toggle("details-open", !nowHidden);
    e.currentTarget.textContent = nowHidden ? "Mostrar detalhes" : "Ocultar detalhes";
    e.currentTarget.classList.toggle("active", !nowHidden);
  });

  // Barra de ações estilo Trello — ações reais ligadas às seções/painel
  modal.querySelector(".tdm-actionbar")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-task-action]");
    if (!btn) return;
    const act = btn.dataset.taskAction;
    const detailsPanel = modal.querySelector("#tdm-details-panel");
    const detailsBtn = modal.querySelector(".tdm-action-details");
    const showDetails = () => { detailsPanel?.classList.remove("hidden"); detailsBtn?.classList.add("active"); };
    const focusInto = (sel, focusSel) => {
      const sec = modal.querySelector(sel);
      sec?.scrollIntoView({ behavior: "smooth", block: "center" });
      if (focusSel) setTimeout(() => modal.querySelector(focusSel)?.focus(), 250);
    };
    if (act === "labels")        focusInto("#section-tags", "#tag-new-input");
    else if (act === "dates")    { showDetails(); focusInto("#tdm-details-panel", "#detail-due-date"); }
    else if (act === "checklist") { modal.querySelector("#checklist-add-group-btn")?.click(); focusInto("#section-checklist"); }
    else if (act === "members")  { showDetails(); focusInto("#tdm-details-panel", "#detail-assignee"); }
    else if (act === "attachment") modal.querySelector("#attachment-file-input")?.click();
    else if (act === "details")  {
      const isHidden = detailsPanel?.classList.toggle("hidden");
      detailsBtn?.classList.toggle("active", !isHidden);
    }
  });

  // Save
  modal.querySelector("#detail-save-btn")?.addEventListener("click", async () => {
    if (!_detailTask) return;
    const saveBtn = modal.querySelector("#detail-save-btn");
    const taskId = _detailTask.id;
    const title = modal.querySelector("#detail-title")?.value.trim() || _detailTask.title;
    const description = modal.querySelector("#detail-description")?.value || "";
    const dueDate = modal.querySelector("#detail-due-date")?.value || _detailTask.dueDate;
    const startDate = modal.querySelector("#detail-start-date")?.value || "";
    const points = Number(modal.querySelector("#detail-points")?.value) || 1;
    const status = modal.querySelector("#detail-status")?.value || "nao_iniciado";
    const priority = modal.querySelector("#detail-priority")?.value || "normal";
    const assignee = modal.querySelector("#detail-assignee")?.value || _detailTask.assignee;
    const sprintId = _detailTask.sprintId;
    const origLabel = saveBtn ? saveBtn.textContent : "";
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "Salvando..."; }
    try {
      await apiFetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        body: JSON.stringify({ title, description, dueDate, startDate, points, status, priority, assignee, sprintId })
      });
      Object.assign(_detailTask, { title, description, dueDate, startDate, points, status, priority, assignee });
      const t = state.tasks.find((t) => t.id === taskId || t.id === String(taskId));
      if (t) Object.assign(t, { title, description, dueDate, startDate, points, status, priority, assignee });
      // Atualiza cabeçalho (chip de status + selo de prioridade)
      const statusChip = modal.querySelector("#detail-status-chip");
      if (statusChip) {
        const statusLabels = { nao_iniciado: "Não iniciado", em_progresso: "Em progresso", concluido: "Concluído" };
        statusChip.textContent = statusLabels[status] || status;
        statusChip.className = `tdm-status-chip ${status}`;
      }
      const badge = modal.querySelector("#detail-urgency-badge");
      if (badge) {
        const priorityLabels = { urgente: "🔴 Urgente", alta: "🟠 Alta", normal: "🟡 Normal", baixa: "🟢 Baixa" };
        badge.textContent = priorityLabels[priority] || priority;
        badge.className = `urgency-badge priority-${priority}`;
      }
      renderKanban();
      renderDashboardMiniKanban();
      // Feedback visual
      if (saveBtn) {
        saveBtn.classList.add("saved");
        saveBtn.textContent = "✓ Salvo!";
        setTimeout(() => { saveBtn.disabled = false; saveBtn.classList.remove("saved"); saveBtn.textContent = origLabel || "Salvar alterações"; }, 1600);
      }
    } catch (err) {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = origLabel || "Salvar alterações"; }
      alert(err.message);
    }
  });

  // Urgency buttons
  modal.querySelectorAll(".urgency-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!_detailTask) return;
      const lvl = btn.dataset.urgency;
      const taskId = _detailTask.id;
      try {
        await apiFetch(`/api/tasks/${taskId}/urgency`, { method: "PATCH", body: JSON.stringify({ urgency: lvl }) });
        _detailTask.urgency = lvl;
        const t = state.tasks.find((t) => t.id === taskId || t.id === String(taskId));
        if (t) t.urgency = lvl;
        modal.querySelectorAll(".urgency-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        const badge = modal.querySelector("#detail-urgency-badge");
        const urgencyLabels = { high: "🔴 Alta", medium: "🟡 Média", low: "🟢 Baixa" };
        if (badge) { badge.textContent = urgencyLabels[lvl]; badge.className = `urgency-badge urgency-${lvl}`; }
        renderKanban();
      } catch (err) { alert(err.message); }
    });
  });

  // Helper: salvar checklist no servidor
  async function _saveChecklist(groups) {
    if (!_detailTask) return;
    await apiFetch(`/api/tasks/${_detailTask.id}/checklist`, { method: "PATCH", body: JSON.stringify({ checklist: groups }) });
    _detailTask.checklist = groups;
    const t = state.tasks.find((t) => t.id === _detailTask.id || t.id === String(_detailTask.id));
    if (t) t.checklist = groups;
    renderDetailChecklist();
  }

  // Helper: adicionar item de checklist a partir de um input (Enter ou botão)
  async function _addItemFromInput(input) {
    if (!input || !_detailTask) return;
    const title = input.value.trim();
    if (!title) { input.focus(); return; }
    const groups = _normalizeChecklist(_detailTask.checklist || []);
    const gIdx = Number(input.dataset.gIdx);
    if (!groups[gIdx]) return;
    groups[gIdx].items.push({ id: Date.now(), title, done: false });
    try {
      await _saveChecklist(groups); // re-renderiza
      // refoca o input do mesmo grupo para adicionar vários itens em sequência
      modal.querySelector(`.checklist-item-input[data-g-idx="${gIdx}"]`)?.focus();
    } catch (err) { alert(err.message); }
  }

  // Adicionar novo grupo de checklist
  modal.querySelector("#checklist-add-group-btn")?.addEventListener("click", async () => {
    if (!_detailTask) return;
    const groups = _normalizeChecklist(_detailTask.checklist || []);
    groups.push({ id: Date.now(), name: "Checklist", items: [] });
    try { await _saveChecklist(groups); } catch (err) { alert(err.message); }
  });

  // Delegação de eventos no container de grupos
  modal.querySelector("#checklist-groups")?.addEventListener("click", async (e) => {
    if (!_detailTask) return;
    const groups = _normalizeChecklist(_detailTask.checklist || []);

    // Toggle item (clique no círculo)
    const circle = e.target.closest(".checklist-circle");
    if (circle) {
      const gIdx = Number(circle.dataset.gIdx);
      const iIdx = Number(circle.dataset.iIdx);
      groups[gIdx].items[iIdx].done = !groups[gIdx].items[iIdx].done;
      try { await _saveChecklist(groups); } catch (err) { alert(err.message); }
      return;
    }

    // Deletar item
    const delBtn = e.target.closest(".ci-del-btn");
    if (delBtn) {
      const gIdx = Number(delBtn.dataset.gIdx);
      const iIdx = Number(delBtn.dataset.iIdx);
      groups[gIdx].items.splice(iIdx, 1);
      try { await _saveChecklist(groups); } catch (err) { alert(err.message); }
      return;
    }

    // Deletar grupo
    const delGroup = e.target.closest(".checklist-group-delete");
    if (delGroup) {
      const gIdx = Number(delGroup.dataset.gIdx);
      if (!confirm(`Remover "${groups[gIdx].name}" e todos os seus itens?`)) return;
      groups.splice(gIdx, 1);
      try { await _saveChecklist(groups); } catch (err) { alert(err.message); }
      return;
    }

    // Botão "Adicionar" do item (precisa vir ANTES do branch da linha)
    const addItemBtn = e.target.closest(".checklist-item-add-btn");
    if (addItemBtn) {
      const row = addItemBtn.closest(".checklist-add-item-row");
      await _addItemFromInput(row?.querySelector(".checklist-item-input"));
      return;
    }

    // Foco no input ao clicar na linha de adicionar
    const addRow = e.target.closest(".checklist-add-item-row");
    if (addRow) {
      addRow.querySelector("input")?.focus();
    }
  });

  // Enter no input de item adiciona o item
  modal.querySelector("#checklist-groups")?.addEventListener("keydown", async (e) => {
    if (e.key !== "Enter") return;
    const input = e.target.closest(".checklist-item-input");
    if (input) { e.preventDefault(); await _addItemFromInput(input); return; }
    // Enter no título do item salva (tira o foco)
    if (e.target.closest(".ci-title-input")) { e.preventDefault(); e.target.blur(); }
  });

  // Alterações em item: responsável, data de entrega, título
  modal.querySelector("#checklist-groups")?.addEventListener("change", async (e) => {
    if (!_detailTask) return;
    const el = e.target;
    const isAssignee = el.classList.contains("ci-assignee");
    const isDue = el.classList.contains("ci-due");
    const isTitle = el.classList.contains("ci-title-input");
    if (!isAssignee && !isDue && !isTitle) return;
    const gIdx = Number(el.dataset.gIdx);
    const iIdx = Number(el.dataset.iIdx);
    const groups = _normalizeChecklist(_detailTask.checklist || []);
    const item = groups[gIdx]?.items?.[iIdx];
    if (!item) return;
    if (isAssignee) item.assignee = el.value || null;
    else if (isDue) item.dueDate = el.value || null;
    else if (isTitle) {
      const v = el.value.trim();
      if (!v) { el.value = item.title; return; } // não permite título vazio
      item.title = v;
    }
    try { await _saveChecklist(groups); } catch (err) { alert(err.message); }
  });

  // Seleção de cor na paleta
  modal.querySelector("#tag-color-palette")?.addEventListener("click", (e) => {
    const sw = e.target.closest(".tag-swatch");
    if (!sw) return;
    _selectedTagColor = sw.dataset.color;
    modal.querySelectorAll("#tag-color-palette .tag-swatch").forEach((s) => s.classList.toggle("selected", s === sw));
  });

  // Add tag (com cor selecionada)
  async function _addTag() {
    if (!_detailTask) return;
    const input = modal.querySelector("#tag-new-input");
    const name = input?.value.trim();
    if (!name) { input?.focus(); return; }
    const newTags = [...(_detailTask.tags || []), { name, color: _selectedTagColor }];
    try {
      await apiFetch(`/api/tasks/${_detailTask.id}/tags`, { method: "PATCH", body: JSON.stringify({ tags: newTags }) });
      _detailTask.tags = newTags;
      const t = state.tasks.find((t) => t.id === _detailTask.id || t.id === String(_detailTask.id));
      if (t) t.tags = [...newTags];
      if (input) input.value = "";
      renderDetailTags();
      renderKanban();
    } catch (err) { alert(err.message); }
  }
  modal.querySelector("#tag-add-btn")?.addEventListener("click", _addTag);
  modal.querySelector("#tag-new-input")?.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); _addTag(); } });

  // Remove tag (event delegation on tags-display)
  modal.querySelector("#tags-display")?.addEventListener("click", async (e) => {
    const btn = e.target.closest(".tag-rm-btn");
    if (!btn || !_detailTask) return;
    const idx = Number(btn.dataset.tagIdx);
    const newTags = (_detailTask.tags || []).filter((_, i) => i !== idx);
    try {
      await apiFetch(`/api/tasks/${_detailTask.id}/tags`, { method: "PATCH", body: JSON.stringify({ tags: newTags }) });
      _detailTask.tags = newTags;
      const t = state.tasks.find((t) => t.id === _detailTask.id || t.id === String(_detailTask.id));
      if (t) t.tags = [...newTags];
      renderDetailTags();
      renderKanban();
    } catch (err) { alert(err.message); }
  });

  // Salvar GitHub (repo + nota)
  modal.querySelector("#github-repo-input")?.addEventListener("input", (e) => _updateGithubLink(e.target.value));
  modal.querySelector("#github-save-btn")?.addEventListener("click", async () => {
    if (!_detailTask) return;
    const btn = modal.querySelector("#github-save-btn");
    const repo = modal.querySelector("#github-repo-input")?.value.trim() || "";
    const note = modal.querySelector("#github-note-input")?.value.trim() || "";
    const orig = btn ? btn.textContent : "";
    if (btn) { btn.disabled = true; btn.textContent = "Salvando..."; }
    try {
      await apiFetch(`/api/tasks/${_detailTask.id}/github`, { method: "PATCH", body: JSON.stringify({ repo, note }) });
      _detailTask.githubRepo = repo; _detailTask.githubNote = note;
      const t = state.tasks.find((t) => t.id === _detailTask.id || t.id === String(_detailTask.id));
      if (t) { t.githubRepo = repo; t.githubNote = note; }
      _updateGithubLink(repo);
      loadTaskAudit(_detailTask.id);
      renderKanban();
      if (btn) { btn.classList.add("saved"); btn.textContent = "✓ Salvo!"; setTimeout(() => { btn.disabled = false; btn.classList.remove("saved"); btn.textContent = orig || "Salvar GitHub"; }, 1500); }
    } catch (err) { if (btn) { btn.disabled = false; btn.textContent = orig || "Salvar GitHub"; } alert(err.message); }
  });

  // Add comment
  modal.querySelector("#comment-send-btn")?.addEventListener("click", async () => {
    if (!_detailTask) return;
    const input = modal.querySelector("#comment-new-input");
    const content = input?.value.trim();
    if (!content) return;
    try {
      await apiFetch(`/api/tasks/${_detailTask.id}/comments`, { method: "POST", body: JSON.stringify({ content }) });
      if (input) input.value = "";
      loadTaskComments(_detailTask.id, modal.querySelector("#comments-list"));
    } catch (err) { alert(err.message); }
  });
})();

async function loadTaskComments(taskId, container) {
  if (!container) return;
  try {
    const comments = await apiFetch(`/api/tasks/${taskId}/comments`);
    const currentName = state.currentUser?.name;
    container.innerHTML = comments.length
      ? comments.map((c) => `
          <div class="comment-item" data-comment-id="${c.id}">
            <div class="comment-header">
              <strong>${escapeHtml(c.authorName || "Usuário")}</strong>
              <small>${c.createdAt ? new Date(c.createdAt).toLocaleString("pt-BR") : ""}</small>
              ${currentName === c.authorName || state.currentUser?.isAdmin ? `<button class="btn-link comment-delete" data-cid="${c.id}" title="Remover">×</button>` : ""}
            </div>
            <p>${escapeHtml(c.content)}</p>
          </div>
        `).join("")
      : `<p class="comments-empty">Nenhum comentário.</p>`;

    container.querySelectorAll(".comment-delete").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          await apiFetch(`/api/tasks/${taskId}/comments/${btn.dataset.cid}`, { method: "DELETE" });
          loadTaskComments(taskId, container);
        } catch (err) { alert(err.message); }
      });
    });
  } catch (_err) {
    container.innerHTML = `<p class="comments-empty">Erro ao carregar comentários.</p>`;
  }
}

// close task detail modal on backdrop click
document.querySelector("#task-detail-modal")?.addEventListener("click", (e) => {
  if (e.target === e.currentTarget) e.currentTarget.close();
});

async function moveTaskToStatus(taskId, newStatus) {
  await apiFetch(`/api/tasks/${taskId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status: newStatus })
  });
  await refreshAndRender();
}
