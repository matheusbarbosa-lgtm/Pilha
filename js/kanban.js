function renderPersonalSidebar() {
  const sidebarEl = document.querySelector("#personal-tasks-list");
  if (!sidebarEl || !state.currentUser) return;

  const myName = state.currentUser.name;
  const myTasks = state.tasks
    .filter((t) => t.assignee === myName && t.status !== "done")
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  sidebarEl.innerHTML = myTasks.length
    ? myTasks.map((t) => `
        <div class="personal-task urgency-${t.urgency || "medium"}" data-open-task="${t.id}">
          <span class="personal-task-title">${escapeHtml(t.title)}</span>
          <small class="personal-task-meta">${statusMap[t.status] || t.status} · ${dateLabel(t.dueDate)}</small>
        </div>
      `).join("")
    : `<p class="personal-empty">Nenhuma tarefa pendente.</p>`;

  sidebarEl.addEventListener("click", (e) => {
    const el = e.target.closest("[data-open-task]");
    if (el) openTaskDetail(Number(el.dataset.openTask));
  });
}

function renderKanban() {
  const cols = [
    { key: "nao_iniciado", label: "Não Iniciado" },
    { key: "em_progresso", label: "Em Progresso" },
    { key: "concluido",    label: "Concluído" }
  ];

  const projectSel    = document.getElementById("kanban-project-select");
  const searchEl      = document.getElementById("kanban-search");
  const filterAssignee = document.getElementById("kanban-filter-assignee");
  const filterStatus  = document.getElementById("kanban-filter-status");
  const filterPriority = document.getElementById("kanban-filter-priority");
  const projects      = state.projects || [];

  // Popula projeto select
  if (projectSel) {
    const cur = projectSel.value;
    projectSel.innerHTML = projects.map((p) =>
      `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");
    if (cur && projects.find((p) => String(p.id) === cur)) projectSel.value = cur;
  }

  const selectedProjectId = projectSel?.value ? Number(projectSel.value) : (projects[0]?.id ? Number(projects[0].id) : null);

  // Popula filtro de responsável
  if (filterAssignee && selectedProjectId) {
    const members = getProjectMembers(String(selectedProjectId));
    const curAssignee = filterAssignee.value;
    filterAssignee.innerHTML = `<option value="">Todos os responsáveis</option>` +
      members.map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join("");
    filterAssignee.value = curAssignee;
  }

  const searchTerm    = (searchEl?.value || "").toLowerCase();
  const assigneeFilter = filterAssignee?.value || "";
  const statusFilter  = filterStatus?.value || "";
  const priorityFilter = filterPriority?.value || "";

  renderPersonalSidebar();

  // Normaliza status legado
  function normStatus(s) {
    if (s === "todo" || s === "backlog") return "nao_iniciado";
    if (s === "doing") return "em_progresso";
    if (s === "done") return "concluido";
    return s;
  }

  const priorityOrder = { urgente: 0, alta: 1, normal: 2, baixa: 3 };

  kanbanBoard.innerHTML = cols
    .map(({ key, label }) => {
      const cards = state.tasks
        .filter((t) => {
          if (t.parentTaskId) return false; // subtarefas não aparecem no board principal
          const matchStatus  = normStatus(t.status) === key;
          const matchProject = !selectedProjectId || Number(t.projectId) === selectedProjectId;
          const matchSearch  = !searchTerm || t.title.toLowerCase().includes(searchTerm);
          const matchAssignee = !assigneeFilter || t.assignee === assigneeFilter;
          const matchPriority = !priorityFilter || t.priority === priorityFilter;
          const matchStatusF = !statusFilter || normStatus(t.status) === statusFilter;
          return matchStatus && matchProject && matchSearch && matchAssignee && matchPriority && matchStatusF;
        })
        .sort((a, b) => {
          const pa = priorityOrder[a.priority] ?? 2;
          const pb = priorityOrder[b.priority] ?? 2;
          return pa !== pb ? pa - pb : a.dueDate.localeCompare(b.dueDate);
        });

      const priorityColors = { urgente: "#e53e3e", alta: "#dd6b20", normal: "#d69e2e", baixa: "#38a169" };

      return `
        <section class="kanban-col ${key}" data-status-col="${key}">
          <h3>${label} <span class="col-count">${cards.length}</span></h3>
          ${cards.map((card) => {
              const checklist = Array.isArray(card.checklist) ? card.checklist : [];
              const checkDone = checklist.filter((i) => i.done).length;
              const checkTotal = checklist.length;
              const tags = Array.isArray(card.tags) ? card.tags : [];
              const progressBar = checkTotal > 0
                ? `<div class="ticket-checklist-bar"><span style="width:${Math.round(checkDone/checkTotal*100)}%"></span></div>`
                : "";
              const tagsHtml = tags.length
                ? `<div class="ticket-tags">${tags.slice(0, 3).map((tg) => `<span class="tag-pill">${escapeHtml(tg)}</span>`).join("")}</div>`
                : "";
              const priColor = priorityColors[card.priority] || "#d69e2e";
              return `
                <article class="ticket" style="border-left:4px solid ${priColor}" data-id="${card.id}" draggable="true">
                  <strong class="ticket-title" data-open-task="${card.id}">${escapeHtml(card.title)}</strong>
                  <small>${escapeHtml(projectById(card.projectId)?.name || "")}</small>
                  <div class="ticket-info">
                    <span>👤 ${escapeHtml(card.assignee)}</span>
                    <span>📅 ${dateLabel(card.dueDate)}</span>
                  </div>
                  ${tagsHtml}
                  ${progressBar}
                  <div class="ticket-actions">
                    <button type="button" class="btn-link" data-open-task="${card.id}">Detalhes</button>
                  </div>
                </article>`;
            }).join("")}
        </section>`;
    })
    .join("");

  // Wire filtros (uma vez por render — usa removeEventListener via clone)
  [searchEl, filterAssignee, filterStatus, filterPriority, projectSel].forEach((el) => {
    if (!el) return;
    const clone = el.cloneNode(true);
    el.parentNode?.replaceChild(clone, el);
    clone.addEventListener("input", renderKanban);
    clone.addEventListener("change", renderKanban);
  });
}

// ── Kanban board event handlers ───────────────────────────
kanbanBoard.addEventListener("click", (event) => {
  const target = event.target;
  const openEl = target.closest("[data-open-task]");
  if (openEl) {
    openTaskDetail(Number(openEl.dataset.openTask));
    return;
  }
  if ((target instanceof HTMLButtonElement) && target.dataset.editTaskId) {
    openEditTaskModal(target.dataset.editTaskId);
  }
});

kanbanBoard.addEventListener("dragstart", (event) => {
  const ticket = event.target.closest(".ticket");
  if (!ticket) return;
  draggingTaskId = ticket.dataset.id;
});

kanbanBoard.addEventListener("dragend", () => {
  draggingTaskId = null;
  document.querySelectorAll(".kanban-col.drop-target").forEach((col) => col.classList.remove("drop-target"));
});

kanbanBoard.addEventListener("dragover", (event) => {
  const column = event.target.closest("[data-status-col]");
  if (!column) return;
  event.preventDefault();
  column.classList.add("drop-target");
});

kanbanBoard.addEventListener("dragleave", (event) => {
  const column = event.target.closest("[data-status-col]");
  if (!column) return;
  column.classList.remove("drop-target");
});

kanbanBoard.addEventListener("drop", async (event) => {
  const column = event.target.closest("[data-status-col]");
  if (!column || !draggingTaskId) return;
  event.preventDefault();
  column.classList.remove("drop-target");
  const targetStatus = column.dataset.statusCol;
  const task = state.tasks.find((item) => item.id === draggingTaskId);
  if (!task || task.status === targetStatus) return;

  try {
    await moveTaskToStatus(draggingTaskId, targetStatus);
  } catch (err) {
    alert(err.message);
  }
});

kanbanBoard.addEventListener("change", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLSelectElement) || !target.dataset.statusId) return;

  try {
    await moveTaskToStatus(target.dataset.statusId, target.value);
  } catch (err) {
    alert(err.message);
  }
});

document.querySelector("#kanban-project-select")?.addEventListener("change", renderKanban);
