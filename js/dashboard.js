function renderCalendar(year, month) {
  const gridEl = document.querySelector("#calendar-grid");
  const monthLabelEl = document.querySelector("#cal-month-label");
  if (!gridEl) return;

  const monthNames = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
  if (monthLabelEl) monthLabelEl.textContent = `${monthNames[month]} ${year}`;

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const deadlineDates = new Set();
  state.tasks.forEach((t) => {
    if (t.dueDate) {
      const d = new Date(t.dueDate + "T00:00:00");
      if (d.getFullYear() === year && d.getMonth() === month) deadlineDates.add(d.getDate());
    }
  });
  state.projects.forEach((p) => {
    if (p.deadline) {
      const d = new Date(p.deadline + "T00:00:00");
      if (d.getFullYear() === year && d.getMonth() === month) deadlineDates.add(d.getDate());
    }
  });

  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;

  let cells = "";
  for (let i = 0; i < firstDay; i++) cells += `<div class="calendar-day empty"></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const isToday = isCurrentMonth && today.getDate() === d;
    const hasDeadline = deadlineDates.has(d);
    const tasksToday = state.tasks.filter((t) => {
      if (!t.dueDate) return false;
      const td = new Date(t.dueDate + "T00:00:00");
      return td.getFullYear() === year && td.getMonth() === month && td.getDate() === d;
    });
    const projDeadline = state.projects.some((p) => {
      if (!p.deadline) return false;
      const pd = new Date(p.deadline + "T00:00:00");
      return pd.getFullYear() === year && pd.getMonth() === month && pd.getDate() === d;
    });
    const taskChips = tasksToday.slice(0, 2).map((t) => {
      const pr = (typeof priorityMeta === "function") ? priorityMeta(t.priority) : { color: "#2563eb" };
      return `<span class="cal-task" data-open-task="${t.id}" title="${escapeHtml(t.title)}" style="--c:${pr.color}">${escapeHtml(t.title.length > 16 ? t.title.slice(0, 15) + "…" : t.title)}</span>`;
    }).join("");
    const moreChip = tasksToday.length > 2 ? `<span class="cal-task-more">+${tasksToday.length - 2} tarefa(s)</span>` : "";
    cells += `<div class="calendar-day${isToday ? " today" : ""}${hasDeadline ? " has-deadline" : ""}">`
      + `<span class="cal-daynum">${d}${projDeadline ? ` <span class="cal-dot" title="Prazo do projeto"></span>` : ""}</span>`
      + taskChips + moreChip + `</div>`;
  }
  gridEl.innerHTML = cells;

  // clique numa tarefa do calendário abre os detalhes (uma vez)
  if (!gridEl._taskClickWired) {
    gridEl._taskClickWired = true;
    gridEl.addEventListener("click", (e) => {
      const el = e.target.closest("[data-open-task]");
      if (el && typeof openTaskDetail === "function") openTaskDetail(Number(el.dataset.openTask));
    });
  }
}

// Wire up calendar nav buttons once on load
(function initCalendarNav() {
  document.querySelector("#cal-prev")?.addEventListener("click", () => {
    state.calendarMonth--;
    if (state.calendarMonth < 0) { state.calendarMonth = 11; state.calendarYear--; }
    renderCalendar(state.calendarYear, state.calendarMonth);
  });
  document.querySelector("#cal-next")?.addEventListener("click", () => {
    state.calendarMonth++;
    if (state.calendarMonth > 11) { state.calendarMonth = 0; state.calendarYear++; }
    renderCalendar(state.calendarYear, state.calendarMonth);
  });
})();

function renderDashboardMiniKanban() {
  const ns = (s) => (typeof normStatus === "function") ? normStatus(s) : s;
  const cols = [
    { key: "nao_iniciado", elId: "dash-col-backlog" },
    { key: "em_progresso", elId: "dash-col-doing" },
    { key: "concluido", elId: "dash-col-done" }
  ];

  cols.forEach(({ key, elId }) => {
    const el = document.querySelector(`#${elId}`);
    if (!el) return;
    // TODAS as tarefas do kanban (sem subtarefas), de forma reduzida
    const colTasks = state.tasks.filter((t) => !t.parentTaskId && ns(t.status) === key);
    el.innerHTML = colTasks.map((t) => {
      const tags = Array.isArray(t.tags) ? t.tags : [];
      const tagsHtml = tags.slice(0, 3).map((tg) => {
        const name = typeof tg === "string" ? tg : (tg && tg.name) || "";
        const color = (tg && tg.color) || null;
        return color
          ? `<span class="dash-tag" style="background:${color}1f;color:${color};border-color:${color}55">${escapeHtml(name)}</span>`
          : `<span class="dash-tag">${escapeHtml(name)}</span>`;
      }).join("");
      return `<div class="dash-task" data-open-task="${t.id}" title="${escapeHtml(t.title)}">`
        + `<span class="dash-task-title">${escapeHtml(t.title)}</span>`
        + (tagsHtml ? `<div class="dash-task-tags">${tagsHtml}</div>` : "")
        + `</div>`;
    }).join("") || `<div class="dash-task-empty">—</div>`;
  });

  // clique nas tarefas → abre o detalhe (delegação, ligada uma vez)
  const kb = document.querySelector("#dash-kanban");
  if (kb && !kb._taskClickWired) {
    kb._taskClickWired = true;
    kb.addEventListener("click", (e) => {
      const item = e.target.closest("[data-open-task]");
      if (item && typeof openTaskDetail === "function") openTaskDetail(Number(item.dataset.openTask));
    });
  }
}

async function renderActivityFeed() {
  const feedEl = document.querySelector("#activity-feed");
  if (!feedEl) return;

  const statusLabel = (s) => ({
    nao_iniciado: "Não iniciado", em_progresso: "Em progresso", concluido: "Concluído",
    todo: "Não iniciado", backlog: "Não iniciado", doing: "Em progresso", review: "Em progresso", done: "Concluído",
  })[s] || s;
  const statusClass = (s) => {
    const n = (typeof normStatus === "function") ? normStatus(s) : s;
    return n === "concluido" ? "done" : n === "em_progresso" ? "doing" : "todo";
  };

  let rows = [];
  try { rows = await apiFetch("/api/activity/recent"); } catch (_) { rows = []; }

  feedEl.innerHTML = rows.length
    ? rows.map((r) => {
        const dt = r.createdAt ? new Date(String(r.createdAt).replace(" ", "T") + "Z").toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
        return `
          <div class="activity-item activity-clickable" data-open-task="${r.taskId}" title="Abrir tarefa">
            <div class="activity-dot status-${statusClass(r.newVal)}"></div>
            <div class="activity-info">
              <span class="activity-title">${escapeHtml(r.title)}</span>
              <small class="activity-meta">${escapeHtml(r.userName || "Alguém")} moveu para <strong>${escapeHtml(statusLabel(r.newVal))}</strong> · ${dt}</small>
            </div>
          </div>`;
      }).join("")
    : `<p class="activity-empty">Nenhuma movimentação recente.</p>`;

  if (!feedEl._wired) {
    feedEl._wired = true;
    feedEl.addEventListener("click", (e) => {
      const item = e.target.closest("[data-open-task]");
      if (item && typeof openTaskDetail === "function") openTaskDetail(Number(item.dataset.openTask));
    });
  }
}

function renderStats() {
  renderCalendar(state.calendarYear, state.calendarMonth);
  renderDashboardMiniKanban();
  renderActivityFeed();

  // keep legacy elements if they exist
  if (statsGrid) {
    const total = state.tasks.length;
    const done = state.tasks.filter((t) => t.status === "done").length;
    const stats = [
      { label: "Projetos", value: state.projects.length },
      { label: "Sprints", value: state.sprints.length },
      { label: "Tarefas", value: total },
      { label: "Concluídas", value: `${done}/${total || 0}` }
    ];
    statsGrid.innerHTML = stats.map((item) => `<article class="stat"><p>${item.label}</p><strong>${item.value}</strong></article>`).join("");
  }

  if (upcomingList) {
    const nextDeliveries = state.tasks.filter((t) => t.status !== "done").sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 4);
    upcomingList.innerHTML = nextDeliveries.map((t) => `<li>${escapeHtml(t.title)} — ${dateLabel(t.dueDate)}</li>`).join("") || "<li>Sem entregas pendentes.</li>";
  }

  if (statusList) {
    const statusOrder = ["todo", "doing", "done"];
    statusList.innerHTML = statusOrder.map((k) => `<li><span>${statusMap[k]}</span><strong>${state.tasks.filter((t) => t.status === k || (k === "todo" && t.status === "backlog")).length}</strong></li>`).join("");
  }
}

// Progresso do projeto baseado no TEMPO: do início até a data final (prazo).
// Começa em 0% na data de início e chega a 100% na data de entrega definida pelo professor.
function projectProgress(projectId) {
  const p = (typeof projectById === "function") ? projectById(projectId) : state.projects.find((x) => x.id === projectId);
  if (!p || !p.deadline) return 0;
  const end = new Date(`${p.deadline}T23:59:59`).getTime();
  const start = p.startDate ? new Date(`${p.startDate}T00:00:00`).getTime() : NaN;
  const now = Date.now();
  if (isNaN(end)) return 0;
  if (isNaN(start) || end <= start) return now >= end ? 100 : 0; // sem início válido
  if (now <= start) return 0;
  if (now >= end) return 100;
  return Math.round(((now - start) / (end - start)) * 100);
}

function getCurrentUserScrumRoles() {
  if (!state.currentUser?.name) return [];
  const name = state.currentUser.name;
  const roles = [];
  state.projects.forEach((project) => {
    const profiles = Array.isArray(project.memberProfiles)
      ? project.memberProfiles
      : (project.members || []).map((memberName) => ({ name: memberName, role: "Development Team" }));
    const mine = profiles.find((p) => p.name === name);
    if (mine) roles.push(`${project.name}: ${mine.role}`);
  });
  return roles;
}
