// ════════════════════════════════════════════════════════════════════════
//  KANBAN BOARD — render data-driven, cards profissionais, drag & drop
//  Estrutura preparada para colunas dinâmicas por turma (fase futura):
//  hoje usamos KANBAN_COLUMNS fixas; amanhã a config virá do backend.
// ════════════════════════════════════════════════════════════════════════

// Definição de colunas (data-driven). `kind` carrega a lógica Scrum/Kanban
// (início / progresso / conclusão) mesmo que o rótulo mude no futuro.
const KANBAN_COLUMNS = [
  { key: "nao_iniciado", label: "Não iniciado", kind: "todo" },
  { key: "em_progresso", label: "Em progresso", kind: "progress" },
  { key: "concluido",    label: "Concluído",    kind: "done" }
];

// Metadados de prioridade — cor da etiqueta/borda + rótulo.
const PRIORITY_META = {
  urgente: { label: "Urgente", color: "#e11d48", soft: "#ffe4e6", text: "#9f1239" },
  alta:    { label: "Alta",    color: "#f97316", soft: "#ffedd5", text: "#9a3412" },
  normal:  { label: "Normal",  color: "#2563eb", soft: "#dbeafe", text: "#1e40af" },
  baixa:   { label: "Baixa",   color: "#16a34a", soft: "#dcfce7", text: "#166534" },
  // aliases legados
  media:   { label: "Normal",  color: "#2563eb", soft: "#dbeafe", text: "#1e40af" }
};
function priorityMeta(p) { return PRIORITY_META[p] || PRIORITY_META.normal; }

// Normaliza status legado → chaves novas das colunas.
function normStatus(s) {
  if (s === "todo" || s === "backlog") return "nao_iniciado";
  if (s === "doing" || s === "review") return "em_progresso";
  if (s === "done") return "concluido";
  return s;
}

// Iniciais para avatar (1-2 letras).
function nameInitials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Cor estável (determinística) para o avatar a partir do nome.
function avatarColor(name) {
  const palette = ["#1565C0", "#7c3aed", "#0891b2", "#db2777", "#ea580c", "#0d9488", "#4f46e5", "#b45309"];
  let h = 0;
  for (const ch of String(name || "")) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return palette[h % palette.length];
}

// Estado visual da data de entrega.
function dueDateMeta(dueDate, status) {
  if (!dueDate) return null;
  const done = normStatus(status) === "concluido";
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = new Date(`${dueDate}T00:00:00`);
  const diffDays = Math.round((due - today) / 86400000);
  let cls = "ok";
  if (done) cls = "done";
  else if (diffDays < 0) cls = "overdue";
  else if (diffDays <= 2) cls = "soon";
  return { label: dateLabel(dueDate), cls, diffDays, done };
}

// Conta itens de checklist (formato em grupos OU plano legado).
function checklistProgress(checklist) {
  if (!Array.isArray(checklist) || !checklist.length) return null;
  let items = [];
  if (checklist[0] && Array.isArray(checklist[0].items)) {
    items = checklist.flatMap((g) => g.items || []);
  } else {
    items = checklist;
  }
  if (!items.length) return null;
  const done = items.filter((i) => i.done).length;
  return { done, total: items.length, pct: Math.round((done / items.length) * 100) };
}

// ── Sidebar "Minhas tarefas" ──────────────────────────────────────────────
function renderPersonalSidebar() {
  const sidebarEl = document.querySelector("#personal-tasks-list");
  if (!sidebarEl || !state.currentUser) return;

  const myName = state.currentUser.name;
  const myTasks = state.tasks
    .filter((t) => !t.parentTaskId && t.assignee === myName && normStatus(t.status) !== "concluido")
    .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));

  sidebarEl.innerHTML = myTasks.length
    ? myTasks.map((t) => {
        const due = dueDateMeta(t.dueDate, t.status);
        const colLabel = (KANBAN_COLUMNS.find((c) => c.key === normStatus(t.status)) || {}).label || t.status;
        return `
        <div class="personal-task" data-open-task="${t.id}">
          <span class="personal-task-title">${escapeHtml(t.title)}</span>
          <small class="personal-task-meta">
            <span class="dot-status ${normStatus(t.status)}"></span>${escapeHtml(colLabel)}
            ${due ? ` · <span class="due-${due.cls}">${due.label}</span>` : ""}
          </small>
        </div>`;
      }).join("")
    : `<p class="personal-empty">Nenhuma tarefa pendente para você. 🎉</p>`;
}

// ── Card individual ───────────────────────────────────────────────────────
function renderKanbanCard(card) {
  const pri = priorityMeta(card.priority);
  const project = projectById(card.projectId);
  const tags = Array.isArray(card.tags) ? card.tags : [];
  const due = dueDateMeta(card.dueDate, card.status);
  const chk = checklistProgress(card.checklist);

  // Etiquetas coloridas no topo: prioridade sempre + tags (até 3).
  // (Etiquetas com cor própria por tag chegam na Fase 7; hoje cor por prioridade.)
  const tagChips = tags.slice(0, 3).map((tg) => {
    const label = typeof tg === "string" ? tg : (tg && tg.name) || "";
    const color = (tg && tg.color) || null;
    return color
      ? `<span class="card-tag" style="background:${color}1a;color:${color};border-color:${color}55">${escapeHtml(label)}</span>`
      : `<span class="card-tag">${escapeHtml(label)}</span>`;
  }).join("");
  const moreTags = tags.length > 3 ? `<span class="card-tag card-tag-more">+${tags.length - 3}</span>` : "";

  const checklistBadge = chk
    ? `<span class="card-meta-item ${chk.pct === 100 ? "is-complete" : ""}" title="Checklist ${chk.done}/${chk.total}">
         <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
         ${chk.done}/${chk.total}
       </span>`
    : "";

  const githubBadge = card.githubRepo
    ? `<span class="card-meta-item" title="Repositório vinculado">
         <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 .5C5.7.5.5 5.7.5 12c0 5.1 3.3 9.4 7.9 10.9.6.1.8-.2.8-.5v-1.7c-3.2.7-3.9-1.5-3.9-1.5-.5-1.3-1.3-1.7-1.3-1.7-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.7 1.3 3.4 1 .1-.8.4-1.3.7-1.6-2.6-.3-5.3-1.3-5.3-5.7 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17 4.6 18 4.9 18 4.9c.6 1.6.2 2.8.1 3.1.8.8 1.2 1.8 1.2 3.1 0 4.4-2.7 5.4-5.3 5.7.4.4.8 1.1.8 2.2v3.3c0 .3.2.6.8.5 4.6-1.5 7.9-5.8 7.9-10.9C23.5 5.7 18.3.5 12 .5z"/></svg>
       </span>`
    : "";

  const dueBadge = due
    ? `<span class="card-meta-item card-due card-due-${due.cls}" title="Entrega">
         <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
         ${due.label}
       </span>`
    : "";

  const assignee = card.assignee && card.assignee !== "Todos"
    ? `<span class="card-avatar" style="background:${avatarColor(card.assignee)}" title="${escapeHtml(card.assignee)}">${escapeHtml(nameInitials(card.assignee))}</span>`
    : `<span class="card-avatar card-avatar-all" title="Tarefa geral (todos)">👥</span>`;

  const progressBar = chk
    ? `<div class="card-progress"><span style="width:${chk.pct}%"></span></div>`
    : "";

  return `
    <article class="kcard pri-${card.priority || "normal"}" data-id="${card.id}" draggable="true" style="--pri:${pri.color}">
      <div class="kcard-labels">
        <span class="card-tag card-tag-pri" style="background:${pri.soft};color:${pri.text}">${pri.label}</span>
        ${tagChips}${moreTags}
      </div>
      <h4 class="kcard-title" data-open-task="${card.id}">${escapeHtml(card.title)}</h4>
      ${project ? `<div class="kcard-project"><span class="kcard-project-dot"></span>${escapeHtml(project.name)}</div>` : ""}
      ${progressBar}
      <div class="kcard-footer">
        <div class="kcard-meta">
          ${dueBadge}${checklistBadge}${githubBadge}
        </div>
        ${assignee}
      </div>
    </article>`;
}

// ── Render principal do board ─────────────────────────────────────────────
function renderKanban() {
  if (!kanbanBoard) return;

  const projectSel     = document.getElementById("kanban-project-select");
  const searchEl       = document.getElementById("kanban-search");
  const filterAssignee = document.getElementById("kanban-filter-assignee");
  const filterStatus   = document.getElementById("kanban-filter-status");
  const filterPriority = document.getElementById("kanban-filter-priority");
  const projects       = state.projects || [];

  // Popula projeto select preservando seleção
  if (projectSel) {
    const cur = projectSel.value;
    projectSel.innerHTML = projects.length
      ? projects.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("")
      : `<option value="">Nenhum projeto</option>`;
    if (cur && projects.find((p) => String(p.id) === cur)) projectSel.value = cur;
  }

  const selectedProjectId = projectSel?.value
    ? Number(projectSel.value)
    : (projects[0]?.id ? Number(projects[0].id) : null);

  // Popula filtro de responsável a partir dos membros do projeto
  if (filterAssignee && selectedProjectId) {
    const members = getProjectMembers(String(selectedProjectId));
    const curAssignee = filterAssignee.value;
    filterAssignee.innerHTML = `<option value="">Todos os responsáveis</option>` +
      members.map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join("");
    filterAssignee.value = curAssignee;
  }

  const searchTerm     = (searchEl?.value || "").toLowerCase();
  const assigneeFilter = filterAssignee?.value || "";
  const statusFilter   = filterStatus?.value || "";
  const priorityFilter = filterPriority?.value || "";

  renderPersonalSidebar();

  const priorityOrder = { urgente: 0, alta: 1, normal: 2, media: 2, baixa: 3 };

  const columnsHtml = KANBAN_COLUMNS.map((col) => {
    const cards = state.tasks
      .filter((t) => {
        if (t.parentTaskId) return false; // subtarefas ficam fora do board
        if (normStatus(t.status) !== col.key) return false;
        if (selectedProjectId && Number(t.projectId) !== selectedProjectId) return false;
        if (searchTerm && !String(t.title).toLowerCase().includes(searchTerm)) return false;
        if (assigneeFilter && t.assignee !== assigneeFilter) return false;
        if (priorityFilter && t.priority !== priorityFilter) return false;
        if (statusFilter && normStatus(t.status) !== statusFilter) return false;
        return true;
      })
      .sort((a, b) => {
        const pa = priorityOrder[a.priority] ?? 2;
        const pb = priorityOrder[b.priority] ?? 2;
        return pa !== pb ? pa - pb : String(a.dueDate).localeCompare(String(b.dueDate));
      });

    const cardsHtml = cards.length
      ? cards.map(renderKanbanCard).join("")
      : `<div class="kcol-empty">
           <div class="kcol-empty-icon">🗂️</div>
           <p>Nenhuma tarefa nesta coluna</p>
         </div>`;

    return `
      <section class="kcol kind-${col.kind}" data-status-col="${col.key}">
        <header class="kcol-head">
          <span class="kcol-accent"></span>
          <h3 class="kcol-title">${escapeHtml(col.label)}</h3>
          <span class="kcol-count">${cards.length}</span>
          <button class="kcol-menu-btn" type="button" data-col-menu="${col.key}" title="Opções da coluna" aria-label="Opções da coluna">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>
          </button>
          <div class="kcol-menu" data-col-menu-panel="${col.key}" hidden>
            <button type="button" class="kcol-menu-item" data-add-card="${col.key}">+ Adicionar cartão</button>
            <button type="button" class="kcol-menu-item" data-collapse-col="${col.key}">Recolher coluna</button>
          </div>
        </header>
        <div class="kcol-cards" data-cards-for="${col.key}">
          ${cardsHtml}
        </div>
        <button class="kcol-add" type="button" data-add-card="${col.key}">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Adicionar cartão
        </button>
      </section>`;
  }).join("");

  kanbanBoard.style.setProperty("--kanban-cols", KANBAN_COLUMNS.length);
  kanbanBoard.innerHTML = projects.length
    ? columnsHtml
    : `<div class="kanban-empty-board">
         <div class="kanban-empty-icon">📋</div>
         <h3>Nenhum projeto disponível</h3>
         <p>Crie ou participe de um projeto para usar o Kanban.</p>
       </div>`;

  wireKanbanFilters();
}

// ── Liga filtros (uma única vez, via flag — os elementos são fixos no HTML) ─
function wireKanbanFilters() {
  if (renderKanban._filtersWired) return;
  renderKanban._filtersWired = true;

  ["kanban-search"].forEach((id) => {
    document.getElementById(id)?.addEventListener("input", renderKanban);
  });
  ["kanban-filter-assignee", "kanban-filter-status", "kanban-filter-priority", "kanban-project-select"].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", renderKanban);
  });

  document.getElementById("kanban-clear-filters")?.addEventListener("click", () => {
    const s = document.getElementById("kanban-search"); if (s) s.value = "";
    const a = document.getElementById("kanban-filter-assignee"); if (a) a.value = "";
    const st = document.getElementById("kanban-filter-status"); if (st) st.value = "";
    const p = document.getElementById("kanban-filter-priority"); if (p) p.value = "";
    renderKanban();
  });

  document.getElementById("kanban-toggle-personal")?.addEventListener("click", () => {
    document.querySelector(".kanban-wrapper")?.classList.toggle("hide-personal");
    document.getElementById("kanban-toggle-personal")?.classList.toggle("active");
  });

  // Clique nas tarefas da sidebar "Minhas tarefas" (fora do board)
  document.getElementById("kanban-personal-panel")?.addEventListener("click", (e) => {
    const el = e.target.closest("[data-open-task]");
    if (el) openTaskDetail(Number(el.dataset.openTask));
  });
}

// ── Abrir modal "Nova tarefa" já vinculado a uma coluna/projeto ────────────
function openNewCardForColumn(statusKey) {
  const projectSel = document.getElementById("kanban-project-select");
  const projectId = projectSel?.value || (state.projects[0]?.id ? String(state.projects[0].id) : "");
  if (!projectId) { alert("Crie ou selecione um projeto primeiro."); return; }

  // Guarda o status-alvo para aplicar após a criação (o POST cria como 'nao_iniciado').
  state.pendingNewCardStatus = statusKey && statusKey !== "nao_iniciado" ? statusKey : null;

  if (taskModal && taskProjectSelect) {
    taskProjectSelect.value = projectId;
    setAssigneeOptions(taskAssigneeSelect, projectId, "Todos");
    renderCustomFieldInputs(taskCustomFields, projectId);
    taskModal.showModal();
    taskModal.querySelector('input[name="title"]')?.focus();
  }
}

// ════════════════════════════════════════════════════════════════════════
//  Event handlers do board
// ════════════════════════════════════════════════════════════════════════

// Cliques: abrir tarefa, menu de coluna, adicionar cartão, recolher
kanbanBoard.addEventListener("click", (event) => {
  // Botões da coluna primeiro (não ficam dentro de cards)
  const addBtn = event.target.closest("[data-add-card]");
  if (addBtn) {
    closeAllColMenus();
    openNewCardForColumn(addBtn.dataset.addCard);
    return;
  }

  const collapseBtn = event.target.closest("[data-collapse-col]");
  if (collapseBtn) {
    document.querySelector(`.kcol[data-status-col="${collapseBtn.dataset.collapseCol}"]`)?.classList.toggle("collapsed");
    closeAllColMenus();
    return;
  }

  const menuBtn = event.target.closest("[data-col-menu]");
  if (menuBtn) {
    event.stopPropagation();
    const panel = kanbanBoard.querySelector(`[data-col-menu-panel="${menuBtn.dataset.colMenu}"]`);
    const isOpen = panel && !panel.hidden;
    closeAllColMenus();
    if (panel && !isOpen) panel.hidden = false;
    return;
  }

  // Clicar em qualquer parte do card abre os detalhes
  const card = event.target.closest(".kcard");
  if (card && card.dataset.id) {
    openTaskDetail(Number(card.dataset.id));
    return;
  }
});

function closeAllColMenus() {
  kanbanBoard.querySelectorAll("[data-col-menu-panel]").forEach((p) => { p.hidden = true; });
}
document.addEventListener("click", (e) => {
  if (!e.target.closest(".kcol-head")) closeAllColMenus();
});

// ── Drag & Drop ───────────────────────────────────────────────────────────
kanbanBoard.addEventListener("dragstart", (event) => {
  const card = event.target.closest(".kcard");
  if (!card) return;
  draggingTaskId = card.dataset.id;
  card.classList.add("dragging");
  document.body.classList.add("kanban-dragging");
  if (event.dataTransfer) { event.dataTransfer.effectAllowed = "move"; }
});

kanbanBoard.addEventListener("dragend", () => {
  draggingTaskId = null;
  document.body.classList.remove("kanban-dragging");
  kanbanBoard.querySelectorAll(".kcard.dragging").forEach((c) => c.classList.remove("dragging"));
  kanbanBoard.querySelectorAll(".kcol.drop-target").forEach((col) => col.classList.remove("drop-target"));
});

kanbanBoard.addEventListener("dragover", (event) => {
  const column = event.target.closest("[data-status-col]");
  if (!column || !draggingTaskId) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  kanbanBoard.querySelectorAll(".kcol.drop-target").forEach((c) => { if (c !== column) c.classList.remove("drop-target"); });
  column.classList.add("drop-target");
});

kanbanBoard.addEventListener("dragleave", (event) => {
  const column = event.target.closest("[data-status-col]");
  if (!column) return;
  // só remove se realmente saiu da coluna
  if (!column.contains(event.relatedTarget)) column.classList.remove("drop-target");
});

kanbanBoard.addEventListener("drop", async (event) => {
  const column = event.target.closest("[data-status-col]");
  if (!column || !draggingTaskId) return;
  event.preventDefault();
  column.classList.remove("drop-target");
  const targetStatus = column.dataset.statusCol;
  const taskId = draggingTaskId;
  const task = state.tasks.find((item) => item.id === taskId || item.id === String(taskId));
  if (!task || normStatus(task.status) === targetStatus) return;

  const prevStatus = task.status;
  // Otimista: atualiza local e re-renderiza; reverte se o backend falhar.
  task.status = targetStatus;
  renderKanban();
  renderDashboardMiniKanban?.();
  const cardEl = kanbanBoard.querySelector(`.kcard[data-id="${taskId}"]`);
  cardEl?.classList.add("card-saving");

  try {
    await apiFetch(`/api/tasks/${taskId}/status`, { method: "PATCH", body: JSON.stringify({ status: targetStatus }) });
  } catch (err) {
    task.status = prevStatus; // reverte
    renderKanban();
    renderDashboardMiniKanban?.();
    alert(err.message || "Não foi possível mover a tarefa.");
  }
});

// Select de status dentro do card (fallback de acessibilidade, se existir)
kanbanBoard.addEventListener("change", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLSelectElement) || !target.dataset.statusId) return;
  try {
    await moveTaskToStatus(target.dataset.statusId, target.value);
  } catch (err) { alert(err.message); }
});
