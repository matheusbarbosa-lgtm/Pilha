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
    const titleAttr = tasksToday.length ? `title="${tasksToday.map((t) => escapeHtml(t.title)).join(", ")}"` : "";
    cells += `<div class="calendar-day${isToday ? " today" : ""}${hasDeadline ? " has-deadline" : ""}" ${titleAttr}>${d}${hasDeadline ? `<span class="cal-dot"></span>` : ""}</div>`;
  }
  gridEl.innerHTML = cells;
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
  const cols = [
    { key: "todo", elId: "dash-col-backlog" },
    { key: "doing", elId: "dash-col-doing" },
    { key: "done", elId: "dash-col-done" }
  ];

  cols.forEach(({ key, elId }) => {
    const el = document.querySelector(`#${elId}`);
    if (!el) return;
    const colTasks = state.tasks.filter((t) => t.status === key || (key === "todo" && t.status === "backlog")).slice(0, 4);
    el.innerHTML = colTasks.map((t) => `
      <div class="dash-task urgency-${t.urgency || "medium"}" data-open-task="${t.id}" title="${escapeHtml(t.title)}">
        <span>${escapeHtml(t.title)}</span>
        <small>${escapeHtml(projectById(t.projectId)?.name || "")}</small>
      </div>
    `).join("") || `<div class="dash-task-empty">—</div>`;

    el.addEventListener("click", (e) => {
      const item = e.target.closest("[data-open-task]");
      if (item) openTaskDetail(Number(item.dataset.openTask));
    });
  });
}

function renderActivityFeed() {
  const feedEl = document.querySelector("#activity-feed");
  if (!feedEl) return;

  const upcoming = state.tasks
    .filter((t) => t.status !== "done")
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 6);

  feedEl.innerHTML = upcoming.length
    ? upcoming.map((t) => {
        const daysLeft = Math.ceil((new Date(t.dueDate + "T00:00:00") - new Date()) / 86400000);
        const overdue = daysLeft < 0;
        return `
          <div class="activity-item${overdue ? " overdue" : ""}">
            <div class="activity-dot urgency-${t.urgency || "medium"}"></div>
            <div class="activity-info">
              <span class="activity-title">${escapeHtml(t.title)}</span>
              <small class="activity-meta">${escapeHtml(projectById(t.projectId)?.name || "")} · ${overdue ? `Atrasada ${Math.abs(daysLeft)}d` : daysLeft === 0 ? "Hoje!" : `${daysLeft}d`}</small>
            </div>
          </div>
        `;
      }).join("")
    : `<p class="activity-empty">Nenhuma tarefa pendente.</p>`;
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

function projectProgress(projectId) {
  const scoped = state.tasks.filter((t) => t.projectId === projectId);
  if (!scoped.length) return 0;
  const done = scoped.filter((t) => t.status === "done").length;
  return Math.round((done / scoped.length) * 100);
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
