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

  groupsEl.innerHTML = groups.map((group, gIdx) => {
    const items = group.items || [];
    const gDone = items.filter(i => i.done).length;
    return `
    <div class="checklist-group" data-g-idx="${gIdx}">
      <div class="checklist-group-header">
        <span>${escapeHtml(group.name || "Checklist")}</span>
        <span class="checklist-group-count">${gDone} de ${items.length}</span>
        <button class="checklist-group-delete" data-g-idx="${gIdx}" title="Remover grupo">×</button>
      </div>
      <div class="checklist-items">
        ${items.map((item, iIdx) => `
          <div class="checklist-item" data-g-idx="${gIdx}" data-i-idx="${iIdx}">
            <div class="checklist-circle${item.done ? " checked" : ""}" data-g-idx="${gIdx}" data-i-idx="${iIdx}"></div>
            <span class="checklist-item-text${item.done ? " done" : ""}">${escapeHtml(item.title)}</span>
            <button class="ci-del-btn" data-g-idx="${gIdx}" data-i-idx="${iIdx}" title="Remover">×</button>
          </div>
        `).join("") || `<div style="padding:0.5rem 0.85rem;color:var(--muted);font-size:0.82rem">Nenhum item ainda.</div>`}
      </div>
      <div class="checklist-add-item-row" data-g-idx="${gIdx}">
        <span>+</span>
        <input type="text" class="checklist-item-input" data-g-idx="${gIdx}" placeholder="Adicionar item..." />
      </div>
    </div>`;
  }).join("");
}

function renderDetailTags() {
  const tags = _detailTask?.tags || [];
  const el = document.querySelector("#tags-display");
  if (!el) return;
  el.innerHTML = tags.map((tg, idx) => `<span class="tag-pill">${escapeHtml(tg)}<button class="tag-pill-rm" data-tag-idx="${idx}" title="Remover">×</button></span>`).join("") || "";
}

function renderDetailSubtasks(task) {
  const el = document.querySelector("#subtasks-list");
  if (!el) return;
  const subtasks = task?.subtasks || [];
  el.innerHTML = subtasks.map((s) => {
    const done = s.status === "concluido" || s.status === "done";
    return `
      <div class="subtask-item${done ? " done" : ""}" data-subtask-id="${s.id}">
        <span class="subtask-dot${done ? " green" : ""}"></span>
        <span class="subtask-title">${escapeHtml(s.title)}</span>
        <button class="btn-link" data-open-task="${s.id}" style="font-size:0.75rem">Abrir</button>
      </div>`;
  }).join("") || `<p class="checklist-empty">Nenhuma subtarefa.</p>`;
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

  // Assignee select
  const assigneeEl = q("#detail-assignee");
  if (assigneeEl) setAssigneeOptions(assigneeEl, task.projectId, task.assignee);

  // Subtasks
  renderDetailSubtasks(task);

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

async function loadTaskAudit(taskId) {
  const listEl = document.getElementById("audit-log-list");
  if (!listEl) return;
  try {
    const rows = await apiFetch(`/api/tasks/${taskId}/audit`);
    const fieldName = { title: "Título", assignee: "Responsável", due_date: "Prazo", status: "Status", priority: "Prioridade", urgency: "Urgência" };
    listEl.innerHTML = rows.length
      ? rows.map((r) => {
          const dt = new Date(r.created_at).toLocaleString("pt-BR", { day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit" });
          return `<div class="audit-log-item"><strong>${escapeHtml(r.user_name)}</strong> alterou <strong>${fieldName[r.field] || r.field}</strong>: ${escapeHtml(r.old_val || "—")} → ${escapeHtml(r.new_val || "—")} <span style="float:right">${dt}</span></div>`;
        }).join("")
      : `<p style="color:var(--muted);font-size:.78rem;padding:.25rem .5rem">Sem alterações registradas.</p>`;
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
  if (file.size > 300 * 1024) {
    if (errEl) errEl.textContent = "Arquivo muito grande (máx 300KB)";
    e.target.value = "";
    return;
  }
  if (errEl) errEl.textContent = "";
  const formData = new FormData();
  formData.append("file", file);
  try {
    const tokenKey = typeof SESSION_TOKEN_KEY !== "undefined" ? SESSION_TOKEN_KEY : "pilha_tab_token";
    const token = sessionStorage.getItem(tokenKey) || "";
    const res = await fetch(`/api/tasks/${_detailTask.id}/attachments`, {
      method: "POST",
      credentials: "include",
      headers: token ? { "Authorization": `Bearer ${token}` } : {},
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

  // Close button
  modal.querySelector("#detail-close-btn")?.addEventListener("click", () => modal.close());

  // Backdrop close
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.close(); });

  // Save
  modal.querySelector("#detail-save-btn")?.addEventListener("click", async () => {
    if (!_detailTask) return;
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
    try {
      await apiFetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        body: JSON.stringify({ title, description, dueDate, startDate, points, status, priority, assignee, sprintId })
      });
      const t = state.tasks.find((t) => t.id === taskId || t.id === String(taskId));
      if (t) Object.assign(t, { title, description, dueDate, startDate, points, status, priority, assignee });
      renderKanban();
      renderDashboardMiniKanban();
    } catch (err) { alert(err.message); }
  });

  // Add subtask
  modal.querySelector("#subtask-add-btn")?.addEventListener("click", async () => {
    if (!_detailTask) return;
    const input = modal.querySelector("#subtask-new-input");
    const title = input?.value.trim();
    if (!title) return;
    try {
      await apiFetch("/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          projectId: _detailTask.projectId,
          title,
          assignee: _detailTask.assignee,
          dueDate: _detailTask.dueDate,
          sprintId: _detailTask.sprintId,
          points: 1,
          parentTaskId: _detailTask.id
        })
      });
      if (input) input.value = "";
      const updated = await apiFetch(`/api/tasks/${_detailTask.id}`);
      _detailTask.subtasks = updated.subtasks || [];
      renderDetailSubtasks(_detailTask);
      await refreshAndRender();
    } catch (err) { alert(err.message); }
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

    // Foco no input ao clicar em "+ Adicionar item"
    const addRow = e.target.closest(".checklist-add-item-row");
    if (addRow) {
      addRow.querySelector("input")?.focus();
    }
  });

  // Enter no input de item adiciona o item
  modal.querySelector("#checklist-groups")?.addEventListener("keydown", async (e) => {
    if (e.key !== "Enter") return;
    const input = e.target.closest(".checklist-item-input");
    if (!input || !_detailTask) return;
    const title = input.value.trim();
    if (!title) return;
    const groups = _normalizeChecklist(_detailTask.checklist || []);
    const gIdx = Number(input.dataset.gIdx);
    groups[gIdx].items.push({ id: Date.now(), title, done: false });
    try { await _saveChecklist(groups); input.value = ""; } catch (err) { alert(err.message); }
  });

  // Add tag
  modal.querySelector("#tag-add-btn")?.addEventListener("click", async () => {
    if (!_detailTask) return;
    const input = modal.querySelector("#tag-new-input");
    const tag = input?.value.trim();
    if (!tag) return;
    const newTags = [..._detailTask.tags, tag];
    try {
      await apiFetch(`/api/tasks/${_detailTask.id}/tags`, { method: "PATCH", body: JSON.stringify({ tags: newTags }) });
      _detailTask.tags = newTags;
      const t = state.tasks.find((t) => t.id === _detailTask.id || t.id === String(_detailTask.id));
      if (t) t.tags = [...newTags];
      if (input) input.value = "";
      renderDetailTags();
    } catch (err) { alert(err.message); }
  });

  // Remove tag (event delegation on tags-display)
  modal.querySelector("#tags-display")?.addEventListener("click", async (e) => {
    const btn = e.target.closest(".tag-pill-rm");
    if (!btn || !_detailTask) return;
    const idx = Number(btn.dataset.tagIdx);
    const newTags = _detailTask.tags.filter((_, i) => i !== idx);
    try {
      await apiFetch(`/api/tasks/${_detailTask.id}/tags`, { method: "PATCH", body: JSON.stringify({ tags: newTags }) });
      _detailTask.tags = newTags;
      const t = state.tasks.find((t) => t.id === _detailTask.id || t.id === String(_detailTask.id));
      if (t) t.tags = [...newTags];
      renderDetailTags();
    } catch (err) { alert(err.message); }
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
