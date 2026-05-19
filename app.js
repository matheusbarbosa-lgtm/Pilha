// Escapa caracteres HTML para evitar XSS em innerHTML
function escapeHtml(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const statusMap = {
  todo: "Backlog",
  backlog: "Backlog",
  doing: "Fazendo",
  done: "Concluído"
};

const priorityMap = {
  baixa: "Baixa",
  media: "Média",
  alta: "Alta"
};

const urgencyMap = {
  low: "Baixa",
  medium: "Média",
  high: "Alta"
};

const projectTemplates = [
  {
    id: "template-tcc",
    name: "TCC Completo",
    description: "Fluxo de planejamento, desenvolvimento, revisao e apresentacao final.",
    projectName: "TCC - Sistema Academico",
    team: "Turma Final - Grupo",
    durationDays: 30,
    memberSlots: 4,
    sprints: [
      { key: "s1", name: "Sprint 1", goal: "Pesquisa e requisitos", startOffset: 0, endOffset: 7 },
      { key: "s2", name: "Sprint 2", goal: "Implementacao e testes", startOffset: 8, endOffset: 20 },
      { key: "s3", name: "Sprint 3", goal: "Ajustes finais e apresentacao", startOffset: 21, endOffset: 30 }
    ],
    tasks: [
      { title: "Definir escopo e problema", sprintKey: "s1", dueOffset: 3, assignee: "Todos", points: 5 },
      { title: "Criar backlog inicial", sprintKey: "s1", dueOffset: 6, assignee: "@1", points: 3 },
      { title: "Desenvolver funcionalidades centrais", sprintKey: "s2", dueOffset: 15, assignee: "@2", points: 8 },
      { title: "Executar testes e correcao", sprintKey: "s2", dueOffset: 20, assignee: "@3", points: 5 },
      { title: "Montar slides e roteiro", sprintKey: "s3", dueOffset: 27, assignee: "Todos", points: 3 },
      { title: "Ensaiar apresentacao", sprintKey: "s3", dueOffset: 30, assignee: "@4", points: 2 }
    ]
  },
  {
    id: "template-grupo",
    name: "Trabalho em Grupo",
    description: "Template rapido para entregas semanais de disciplinas.",
    projectName: "Trabalho Integrador",
    team: "Turma - Grupo",
    durationDays: 14,
    memberSlots: 3,
    sprints: [
      { key: "s1", name: "Sprint 1", goal: "Pesquisa e estrutura", startOffset: 0, endOffset: 6 },
      { key: "s2", name: "Sprint 2", goal: "Entrega e revisao", startOffset: 7, endOffset: 14 }
    ],
    tasks: [
      { title: "Dividir responsabilidades", sprintKey: "s1", dueOffset: 1, assignee: "Todos", points: 2 },
      { title: "Pesquisar referencial teorico", sprintKey: "s1", dueOffset: 5, assignee: "@1", points: 3 },
      { title: "Montar documento final", sprintKey: "s2", dueOffset: 11, assignee: "@2", points: 5 },
      { title: "Revisao e formatacao", sprintKey: "s2", dueOffset: 14, assignee: "@3", points: 3 }
    ]
  },
  {
    id: "template-feira",
    name: "Feira de Ciencias",
    description: "Planejamento da ideia, prototipo e apresentacao para banca.",
    projectName: "Projeto Feira de Ciencias",
    team: "Turma - Equipe",
    durationDays: 21,
    memberSlots: 4,
    sprints: [
      { key: "s1", name: "Sprint 1", goal: "Ideia e validacao", startOffset: 0, endOffset: 7 },
      { key: "s2", name: "Sprint 2", goal: "Prototipo", startOffset: 8, endOffset: 15 },
      { key: "s3", name: "Sprint 3", goal: "Pitch e preparacao", startOffset: 16, endOffset: 21 }
    ],
    tasks: [
      { title: "Escolher tema da experiencia", sprintKey: "s1", dueOffset: 2, assignee: "Todos", points: 3 },
      { title: "Montar materiais do prototipo", sprintKey: "s2", dueOffset: 12, assignee: "@1", points: 5 },
      { title: "Registrar resultados", sprintKey: "s2", dueOffset: 15, assignee: "@2", points: 3 },
      { title: "Preparar stand e demonstracao", sprintKey: "s3", dueOffset: 21, assignee: "@3", points: 5 }
    ]
  }
];

const state = {
  currentUser: null,
  projects: [],
  sprints: [],
  tasks: [],
  students: [],
  customFields: {},
  templateBusy: false,
  pendingPhoto: null,
  profilePhotoLoaded: false,
  profilePendingPhoto: null,
  boards: [],
  activeBoard: null,
  boardColumns: [],
  calendarYear: new Date().getFullYear(),
  calendarMonth: new Date().getMonth()
};

// ── DOM refs ──────────────────────────────────────────────
const authScreen = document.querySelector("#auth-screen");
const appLayout = document.querySelector("#app-layout");
const authViews = [...document.querySelectorAll(".auth-view")];
const goLoginBtn = document.querySelector("#go-login");
const goRegisterBtn = document.querySelector("#go-register");
const goRecoverBtn = document.querySelector("#go-recover"); // removido por segurança
const loginForm = document.querySelector("#login-form");
const registerForm = document.querySelector("#register-form");
const recoverForm = document.querySelector("#recover-form");
const onboardingForm = document.querySelector("#student-onboarding-form");
const loginError = document.querySelector("#login-error");
const registerError = document.querySelector("#register-error");
const registerSuccess = document.querySelector("#register-success");
const recoverError = document.querySelector("#recover-error");
const recoverSuccess = document.querySelector("#recover-success");
const onboardingError = document.querySelector("#onboarding-error");
const onboardingSuccess = document.querySelector("#onboarding-success");
const logoutBtn = document.querySelector("#logout-btn");
const activeUserName = document.querySelector("#active-user-name");
const activeUserRole = document.querySelector("#active-user-role");

const navItems = [...document.querySelectorAll(".nav-item")];
const views = [...document.querySelectorAll(".view")];
const viewTitle = document.querySelector("#view-title");
const adminNavItem = document.querySelector("#admin-nav-item");
const adminCmdInput = document.querySelector("#admin-cmd-input");
const adminCmdRun = document.querySelector("#admin-cmd-run");
const adminCmdOutput = document.querySelector("#admin-cmd-output");

const statsGrid = document.querySelector("#stats-grid");
const upcomingList = document.querySelector("#upcoming-list");
const statusList = document.querySelector("#status-list");
const projectsTable = document.querySelector("#projects-table");
const taskList = document.querySelector("#task-list");
const taskProjectFilter = document.querySelector("#task-project-filter");
const taskSearch = document.querySelector("#task-search");
const sprintCards = document.querySelector("#sprint-cards");
const kanbanBoard = document.querySelector("#kanban-board");
const templateList = document.querySelector("#template-list");
const templateNote = document.querySelector("#template-note");

const openProjectModalBtn = document.querySelector("#open-project-modal");
const openSprintModalBtn = document.querySelector("#open-sprint-modal");
const openTaskModalBtn = document.querySelector("#open-task-modal");

const projectModal = document.querySelector("#project-modal");
const projectForm = document.querySelector("#project-form");
const sprintModal = document.querySelector("#sprint-modal");
const sprintForm = document.querySelector("#sprint-form");
const taskModal = document.querySelector("#task-modal");
const taskForm = document.querySelector("#task-form");
const taskProjectSelect = document.querySelector("#task-project-select");
const taskPrioritySelect = document.querySelector("#task-priority-select");
const taskSprintSelect = document.querySelector("#task-sprint-select");
const taskAssigneeSelect = document.querySelector("#task-assignee-select");
const editTaskModal = document.querySelector("#edit-task-modal");
const editTaskForm = document.querySelector("#edit-task-form");
const editTaskSprintSelect = document.querySelector("#edit-task-sprint-select");
const editTaskAssigneeSelect = document.querySelector("#edit-task-assignee-select");

const customFieldsCard = document.querySelector("#custom-fields-card");
const cfProjectSelect = document.querySelector("#cf-project-select");
const cfList = document.querySelector("#cf-list");
const openCfModalBtn = document.querySelector("#open-cf-modal");
const customFieldModal = document.querySelector("#custom-field-modal");
const customFieldForm = document.querySelector("#custom-field-form");
const cfTypeSelect = document.querySelector("#cf-type-select");
const cfOptionsLabel = document.querySelector("#cf-options-label");
const taskCustomFields = document.querySelector("#task-custom-fields");
const editTaskCustomFields = document.querySelector("#edit-task-custom-fields");

// ── Profile modal refs ────────────────────────────────────
const profileModal = document.querySelector("#profile-modal");
const openProfileModalBtn = document.querySelector("#open-profile-modal");
const profileCloseBtn = document.querySelector("#profile-close-btn");
const profileSaveBtn = document.querySelector("#profile-save-btn");
const profilePhotoInput = document.querySelector("#profile-photo-input");
const profilePhotoBtn = document.querySelector("#profile-photo-btn");
const profileTurmaInput = document.querySelector("#profile-turma");
const profilePeriodoInput = document.querySelector("#profile-periodo");
const profileCursoInput = document.querySelector("#profile-curso");
const profileError = document.querySelector("#profile-error");
const profileSuccess = document.querySelector("#profile-success");

let draggingTaskId = null;

const dateFmt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });

// ── Detect pending invite on page load ────────────────────
(function detectPendingInvite() {
  const url = new URL(window.location.href);
  const inviteToken = url.searchParams.get("invite");
  if (inviteToken) sessionStorage.setItem("pendingInvite", inviteToken);
})();

// ── Auth helpers ──────────────────────────────────────────
function setAuthView(viewName) {
  authViews.forEach((view) => view.classList.add("hidden"));
  const target = document.querySelector(`#auth-view-${viewName}`);
  if (target) target.classList.remove("hidden");
}

function clearAuthFeedback() {
  loginError.textContent = "";
  registerError.textContent = "";
  registerSuccess.textContent = "";
  if (recoverError) recoverError.textContent = "";
  if (recoverSuccess) recoverSuccess.textContent = "";
  if (onboardingError) onboardingError.textContent = "";
  if (onboardingSuccess) onboardingSuccess.textContent = "";
}

function dateLabel(value) {
  return dateFmt.format(new Date(`${value}T00:00:00`));
}

function addDaysIso(baseDate, days) {
  const date = new Date(baseDate);
  date.setDate(date.getDate() + days);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isProfessor() {
  return state.currentUser?.role === "professor";
}

function isAdmin() {
  return Boolean(state.currentUser?.isAdmin);
}
function isSuperAdmin() {
  return Boolean(state.currentUser?.isSuperAdmin);
}

// ── API ───────────────────────────────────────────────────
async function apiFetch(path, options = {}) {
  const response = await fetch(path, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body.error || `Erro HTTP ${response.status}`;
    const err = new Error(message);
    err.data = body;
    throw err;
  }

  return body;
}

// ── Subscription / Billing ────────────────────────────────
let _subscriptionData = null;

async function loadSubscription() {
  try {
    _subscriptionData = await apiFetch("/api/subscription");
    updatePlanBadge();
    checkTrialExpired();
  } catch (_) {}
}

function updatePlanBadge() {
  const badge = document.querySelector("#plan-badge");
  if (!badge || !_subscriptionData) return;
  const { status, daysLeft, plan } = _subscriptionData;
  badge.classList.remove("hidden", "plan-trial", "plan-active", "plan-expired");
  if (status === "trial" && daysLeft > 0) {
    badge.textContent = `Trial · ${daysLeft}d`;
    badge.classList.add("plan-trial");
  } else if (status === "active" && daysLeft > 0) {
    const label = plan === "starter" ? "Starter" : plan === "pro" ? "Pro" : "Escola";
    badge.textContent = `${label} · ${daysLeft}d`;
    badge.classList.add("plan-active");
  } else {
    badge.textContent = "Assinar";
    badge.classList.add("plan-expired");
  }
  badge.classList.remove("hidden");
}

function checkTrialExpired() {
  if (!_subscriptionData) return;
  const overlay = document.querySelector("#trial-expired-overlay");
  if (!overlay) return;
  const expired = !_subscriptionData.active && !state.currentUser?.isAdmin;
  overlay.classList.toggle("hidden", !expired);
  if (expired) overlay.style.display = "flex";
  else overlay.style.display = "";
}

async function openBillingModal() {
  const modal = document.querySelector("#billing-modal");
  if (!modal) return;
  await loadSubscription();
  const statusArea = document.querySelector("#billing-status-area");
  if (statusArea && _subscriptionData) {
    const { status, plan, daysLeft, trialEndsAt, periodEndsAt } = _subscriptionData;
    let html = "";
    if (status === "trial") {
      html = daysLeft > 0
        ? `<div class="billing-status-badge trial">Trial ativo · ${daysLeft} dia(s) restante(s)</div>`
        : `<div class="billing-status-badge expired">Trial encerrado</div>`;
    } else if (status === "active") {
      const label = plan === "starter" ? "Starter" : plan === "pro" ? "Pro" : "Escola";
      html = `<div class="billing-status-badge active">Plano ${label} ativo · ${daysLeft} dia(s) restante(s)</div>`;
    } else {
      html = `<div class="billing-status-badge expired">Assinatura expirada</div>`;
    }
    statusArea.innerHTML = html;
  }
  modal.showModal();
}

async function subscribePlan(plan) {
  const btns = document.querySelectorAll(".billing-subscribe-btn");
  btns.forEach(b => { b.disabled = true; });
  try {
    const data = await apiFetch("/api/payment/create", {
      method: "POST",
      body: JSON.stringify({ plan })
    });
    if (data.init_point) {
      window.location.href = data.init_point;
    } else {
      alert("Erro ao criar preferência de pagamento");
    }
  } catch (err) {
    alert(err.message || "Erro ao processar pagamento");
    btns.forEach(b => { b.disabled = false; });
  }
}

function initBillingListeners() {
  const planBadge = document.querySelector("#plan-badge");
  planBadge?.addEventListener("click", openBillingModal);

  const closeBtn = document.querySelector("#billing-modal-close");
  closeBtn?.addEventListener("click", () => document.querySelector("#billing-modal")?.close());

  document.querySelectorAll(".billing-subscribe-btn").forEach(btn => {
    btn.addEventListener("click", () => subscribePlan(btn.dataset.plan));
  });

  const upgradeBtn = document.querySelector("#trial-expired-upgrade-btn");
  upgradeBtn?.addEventListener("click", () => {
    document.querySelector("#trial-expired-overlay").style.display = "none";
    openBillingModal();
  });

  // Handle return from Mercado Pago
  const urlParams = new URLSearchParams(window.location.search);
  const payStatus = urlParams.get("payment");
  if (payStatus === "success") {
    history.replaceState({}, "", "/app");
    loadSubscription().then(() => {
      alert("Pagamento confirmado! Seu plano foi ativado.");
    });
  } else if (payStatus === "failure") {
    history.replaceState({}, "", "/app");
    alert("Pagamento não aprovado. Tente novamente.");
  } else if (payStatus === "pending") {
    history.replaceState({}, "", "/app");
    alert("Pagamento pendente. Assim que confirmado, seu plano será ativado.");
  }
}

const MAX_PHOTO_FILE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

function validatePhotoFile(file) {
  if (!file) return "Arquivo de foto ausente.";
  if (!ACCEPTED_PHOTO_TYPES.has(file.type)) {
    return "Formato de foto invalido. Use JPG, PNG, WEBP ou GIF.";
  }
  if (file.size > MAX_PHOTO_FILE_BYTES) {
    return "Foto muito grande. Maximo 5MB.";
  }
  return "";
}

// ── Photo resize & preview ────────────────────────────────
function resizeAndPreviewPhoto(file, imgSelector, initialsSelector, onDone, onError) {
  const fileError = validatePhotoFile(file);
  if (fileError) {
    if (onError) onError(fileError);
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const MAX = 220;
      const ratio = Math.min(MAX / img.width, MAX / img.height, 1);
      canvas.width = Math.round(img.width * ratio);
      canvas.height = Math.round(img.height * ratio);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
      if (onDone) onDone(dataUrl);
      const imgEl = document.querySelector(imgSelector);
      const initialsEl = document.querySelector(initialsSelector);
      if (imgEl) { imgEl.src = dataUrl; imgEl.classList.remove("hidden"); }
      if (initialsEl) initialsEl.classList.add("hidden");
    };
    img.onerror = () => {
      if (onError) onError("Nao foi possivel processar a imagem. Tente outra foto.");
    };
    img.src = e.target.result;
  };
  reader.onerror = () => {
    if (onError) onError("Falha ao ler o arquivo da foto.");
  };
  reader.readAsDataURL(file);
}

// ── Topbar display ────────────────────────────────────────
function updateTopbarPhoto(photoDataUrl) {
  const pillPhoto = document.querySelector("#user-pill-photo");
  const pillInitials = document.querySelector("#user-pill-initials");
  if (pillPhoto && photoDataUrl) {
    pillPhoto.src = photoDataUrl;
    pillPhoto.classList.remove("hidden");
    if (pillInitials) pillInitials.classList.add("hidden");
  }
}

function updateTopbarDisplay() {
  if (!state.currentUser) return;
  activeUserName.textContent = state.currentUser.name || "";
  activeUserRole.textContent = isProfessor() ? "Professor" : "Aluno";
  const pillInitials = document.querySelector("#user-pill-initials");
  if (pillInitials && document.querySelector("#user-pill-photo")?.classList.contains("hidden")) {
    pillInitials.textContent = (state.currentUser.name || "?").charAt(0).toUpperCase();
  }
}

// ── Data loading ──────────────────────────────────────────
async function loadData() {
  const [projects, sprints, tasks, students] = await Promise.all([
    apiFetch("/api/projects"),
    apiFetch("/api/sprints"),
    apiFetch("/api/tasks"),
    apiFetch("/api/students")
  ]);

  state.projects = projects;
  state.sprints = sprints;
  state.tasks = tasks;
  state.students = students;

  state.customFields = {};
  await Promise.all(
    projects.map(async (p) => {
      const fields = await apiFetch(`/api/projects/${p.id}/fields`);
      state.customFields[p.id] = fields;
    })
  );
}

function projectById(id) {
  return state.projects.find((p) => p.id === id);
}

function sprintById(id) {
  return state.sprints.find((s) => s.id === id);
}

function getProjectMembers(projectId) {
  const project = projectById(projectId);
  const membersFromProfiles = Array.isArray(project?.memberProfiles)
    ? project.memberProfiles.map((m) => m.name)
    : [];
  const members = membersFromProfiles.length ? membersFromProfiles : (project?.members || []);
  if (members.length) return members;
  if (state.currentUser?.name) return [state.currentUser.name];
  return [];
}

function buildScrumRolesByOrder(members) {
  const clean = members.filter(Boolean);
  const roles = {};
  clean.forEach((member, idx) => {
    if (idx === 0) roles[member] = "Product Owner";
    else if (idx === 1) roles[member] = "Scrum Master";
    else roles[member] = "Development Team";
  });
  return roles;
}

function getAllowedAssignees(projectId) {
  if (isProfessor()) {
    const fromProject = getProjectMembers(projectId);
    return fromProject.length ? fromProject : state.students;
  }
  return getProjectMembers(projectId);
}

function setAssigneeOptions(selectEl, projectId, selectedValue = "Todos") {
  if (!selectEl) return;
  const allowedAssignees = getAllowedAssignees(projectId);
  const options = ['<option value="Todos">Todos (tarefa geral)</option>']
    .concat(allowedAssignees.map((name) => `<option value="${name}">${name}</option>`))
    .join("");
  selectEl.innerHTML = options;
  selectEl.value = selectedValue;
  if (selectEl.value !== selectedValue) {
    selectEl.value = "Todos";
  }
}

function renderCustomFieldInputs(container, projectId, currentValues = {}) {
  if (!container) return;
  const fields = state.customFields[projectId] || [];
  if (!fields.length) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = `
    <div class="cf-inputs-group">
      <small class="cf-inputs-label">Campos customizados</small>
      ${fields.map((f) => {
        const val = currentValues[f.id] !== undefined ? currentValues[f.id] : "";
        if (f.fieldType === "select") {
          const opts = f.options.map((o) => `<option value="${escapeHtml(o)}" ${val === o ? "selected" : ""}>${escapeHtml(o)}</option>`).join("");
          return `<label>${escapeHtml(f.name)} <select name="cf_${f.id}"><option value="">—</option>${opts}</select></label>`;
        }
        if (f.fieldType === "checkbox") {
          return `<label class="cf-checkbox"><input type="checkbox" name="cf_${f.id}" value="sim" ${val === "sim" ? "checked" : ""}> ${escapeHtml(f.name)}</label>`;
        }
        return `<label>${escapeHtml(f.name)} <input type="${f.fieldType}" name="cf_${f.id}" value="${escapeHtml(val)}" /></label>`;
      }).join("")}
    </div>
  `;
}

function renderCustomFieldsManager() {
  if (!cfProjectSelect || !cfList) return;

  const projectId = cfProjectSelect.value;
  const fields = state.customFields[projectId] || [];

  cfList.innerHTML = fields.length
    ? fields.map((f) => `
        <li class="cf-item">
          <span><strong>${escapeHtml(f.name)}</strong> <em>(${escapeHtml(f.fieldType)})</em>${f.fieldType === "select" ? ` — ${f.options.map(escapeHtml).join(", ")}` : ""}</span>
          <button class="btn-link cf-delete-btn" data-field-id="${f.id}" data-project-id="${projectId}">Remover</button>
        </li>
      `).join("")
    : "<li>Nenhum campo definido para este projeto.</li>";
}

function fillSelects() {
  const projectOptions = ['<option value="all">Todos os projetos</option>']
    .concat(state.projects.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`))
    .join("");

  taskProjectFilter.innerHTML = projectOptions;
  taskProjectSelect.innerHTML = state.projects
    .map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`)
    .join("");

  taskSprintSelect.innerHTML = state.sprints
    .map((s) => `<option value="${s.id}">${escapeHtml(s.name)} (${dateLabel(s.start)} - ${dateLabel(s.end)})</option>`)
    .join("");
  setAssigneeOptions(taskAssigneeSelect, taskProjectSelect.value || state.projects[0]?.id);

  if (editTaskSprintSelect) {
    editTaskSprintSelect.innerHTML = taskSprintSelect.innerHTML;
  }

  if (cfProjectSelect) {
    cfProjectSelect.innerHTML = state.projects
      .map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`)
      .join("");
    renderCustomFieldsManager();
  }

  renderCustomFieldInputs(taskCustomFields, taskProjectSelect.value || state.projects[0]?.id);
}

function renderTemplates() {
  if (!templateList) return;

  const professor = isProfessor();
  templateNote.textContent = professor
    ? "Clique em um modelo para criar projeto + sprints + tarefas automaticamente."
    : "Apenas professor pode aplicar modelos. Alunos visualizam os projetos gerados.";

  templateList.innerHTML = projectTemplates
    .map(
      (template) => `
      <article class="template-card">
        <h4>${template.name}</h4>
        <p>${template.description}</p>
        <div class="template-meta">
          <span class="chip">${template.sprints.length} sprints</span>
          <span class="chip">${template.tasks.length} tarefas</span>
          <span class="chip">${template.durationDays} dias</span>
        </div>
        <button
          class="btn-secondary"
          data-template-id="${template.id}"
          ${!professor || state.templateBusy ? "disabled" : ""}
        >
          ${state.templateBusy ? "Aplicando..." : professor ? "Usar modelo" : "Apenas professor"}
        </button>
      </article>
    `
    )
    .join("");
}

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

function renderProjects() {
  projectsTable.innerHTML =
    state.projects
      .map((p) => {
        const progress = projectProgress(p.id);
        const profiles = Array.isArray(p.memberProfiles)
          ? p.memberProfiles
          : (p.members || []).map((name) => ({ name, role: "Development Team" }));
        const memberLabel = profiles.map((m) => `${escapeHtml(m.name)} (${escapeHtml(m.role)})`).join(", ");
        return `
        <tr>
          <td>${escapeHtml(p.name)}</td>
          <td>${escapeHtml(p.discipline || "—")}</td>
          <td>${escapeHtml(p.team)}</td>
          <td>${memberLabel}</td>
          <td>${dateLabel(p.deadline)}</td>
          <td>
            <div class="progress"><span style="width:${progress}%;"></span></div>
            <small>${progress}%</small>
          </td>
        </tr>
      `;
      })
      .join("") || "<tr><td colspan=\"6\">Nenhum projeto para este usuario.</td></tr>";
}

function renderTaskList() {
  const term = taskSearch.value.toLowerCase().trim();
  const projectFilter = taskProjectFilter.value;

  const filtered = state.tasks.filter((task) => {
    const projectOk = projectFilter === "all" || task.projectId === projectFilter;
    const textOk = task.title.toLowerCase().includes(term);
    return projectOk && textOk;
  });

  taskList.innerHTML =
    filtered
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .map((t) => {
        const scope = t.assignee === "Todos" ? "Geral" : "Individual";
        const fields = state.customFields[t.projectId] || [];
        const cfHtml = fields.map((f) => {
          const val = t.customValues?.[f.id];
          if (!val && val !== "0") return "";
          return `<span>${escapeHtml(f.name)}: ${escapeHtml(val)}</span>`;
        }).filter(Boolean).join("");
        return `
        <li>
          <strong>${escapeHtml(t.title)}</strong>
          <div class="meta">
            <span class="badge">${scope}</span>
            <span class="priority-badge ${t.priority || "media"}">Prioridade: ${priorityMap[t.priority || "media"]}</span>
            <span>Responsavel: ${escapeHtml(t.assignee)}</span>
            <span>Projeto: ${escapeHtml(projectById(t.projectId)?.name || "-")}</span>
            <span>Sprint: ${escapeHtml(sprintById(t.sprintId)?.name || "-")}</span>
            <span>Entrega: ${dateLabel(t.dueDate)}</span>
            <span>Status: ${statusMap[t.status]}</span>
            <span>Pontos: ${t.points}</span>
            ${cfHtml}
          </div>
        </li>
      `;
      })
      .join("") || "<li>Nenhuma tarefa encontrada.</li>";
}

function renderSprints() {
  sprintCards.innerHTML = state.sprints
    .map((s) => {
      const sprintTasks = state.tasks.filter((t) => t.sprintId === s.id);
      const done = sprintTasks.filter((t) => t.status === "done").length;
      return `
        <article class="sprint-card">
          <h3>${escapeHtml(s.name)}</h3>
          <p><strong>Objetivo:</strong> ${escapeHtml(s.goal)}</p>
          <p><strong>Periodo:</strong> ${dateLabel(s.start)} a ${dateLabel(s.end)}</p>
          <p><strong>Progresso:</strong> ${done}/${sprintTasks.length || 0} tarefas concluidas</p>
        </article>
      `;
    })
    .join("");
}

function renderScrumTeam() {
  const container = document.querySelector("#scrum-team-display");
  if (!container) return;

  if (!state.projects.length) {
    container.innerHTML = "<p style='color:var(--muted);font-size:0.85rem;padding:0.5rem 0;'>Nenhum projeto visivel.</p>";
    return;
  }

  const roleClass = { "Product Owner": "po", "Scrum Master": "sm", "Development Team": "dev" };
  const roleShort = { "Product Owner": "PO", "Scrum Master": "SM", "Development Team": "DEV" };
  const roleOrder = ["Product Owner", "Scrum Master", "Development Team"];

  container.innerHTML = state.projects.map((project) => {
    const profiles = Array.isArray(project.memberProfiles)
      ? project.memberProfiles
      : (project.members || []).map((name) => ({ name, role: "Development Team" }));

    const byRole = {};
    roleOrder.forEach((r) => { byRole[r] = []; });
    profiles.forEach((m) => {
      const role = roleOrder.includes(m.role) ? m.role : "Development Team";
      byRole[role].push(m.name);
    });

    return `
      <div class="scrum-team-project">
        <h4 class="scrum-team-project-name">${escapeHtml(project.name)}
          <span class="scrum-team-turma">${escapeHtml(project.team || "")}</span>
        </h4>
        <div class="scrum-team-grid">
          ${roleOrder.map((roleName) => `
            <div class="scrum-team-role-col">
              <div class="scrum-team-role-label ${roleClass[roleName]}">
                <span class="role-short">${roleShort[roleName]}</span>
                ${roleName}
              </div>
              ${byRole[roleName].length
                ? byRole[roleName].map((memberName) => {
                    const isCurrentUser = state.currentUser?.name === memberName;
                    return `
                      <div class="scrum-team-member ${isCurrentUser ? "is-me" : ""}">
                        <div class="scrum-member-avatar ${roleClass[roleName]}">${escapeHtml(memberName.charAt(0).toUpperCase())}</div>
                        <span>${escapeHtml(memberName)}${isCurrentUser ? " (você)" : ""}</span>
                      </div>`;
                  }).join("")
                : '<span class="scrum-team-empty">—</span>'
              }
            </div>
          `).join("")}
        </div>
      </div>
    `;
  }).join("");
}

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
    { key: "todo", label: "Backlog" },
    { key: "doing", label: "Fazendo" },
    { key: "done", label: "Concluído" }
  ];

  renderPersonalSidebar();

  kanbanBoard.innerHTML = cols
    .map(({ key, label }) => {
      const cards = state.tasks
        .filter((t) => t.status === key || (key === "todo" && t.status === "backlog"))
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

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
              return `
                <article class="ticket urgency-${card.urgency || "medium"}" data-id="${card.id}" draggable="true">
                  <strong class="ticket-title" data-open-task="${card.id}">${escapeHtml(card.title)}</strong>
                  <small>${escapeHtml(projectById(card.projectId)?.name || "")}</small>
                  <div class="ticket-info">
                    <span>${escapeHtml(card.assignee)}</span>
                    <span>${dateLabel(card.dueDate)}</span>
                    <span class="priority-badge ${card.priority || "media"}">${priorityMap[card.priority || "media"]}</span>
                  </div>
                  ${tagsHtml}
                  ${progressBar}
                  <div class="ticket-actions">
                    <button type="button" class="btn-link" data-open-task="${card.id}">Detalhes</button>
                    <button type="button" class="btn-link" data-edit-task-id="${card.id}">Editar</button>
                  </div>
                </article>
              `;
            }).join("")}
        </section>
      `;
    })
    .join("");
}

function renderByRole() {
  const professor = isProfessor();
  openProjectModalBtn.classList.toggle("hidden", !professor);
  openSprintModalBtn.classList.toggle("hidden", !professor);
  if (adminNavItem) adminNavItem.classList.toggle("hidden", !isAdmin());
  const equipesNavItem = document.querySelector("#equipes-nav-item");
  if (equipesNavItem) equipesNavItem.classList.toggle("hidden", !isAdmin());
  const avaliacaoNavItem = document.querySelector("#avaliacao-nav-item");
  if (avaliacaoNavItem) avaliacaoNavItem.classList.toggle("hidden", !professor);
  const superadmNavItem = document.querySelector("#superadm-nav-item");
  if (superadmNavItem) superadmNavItem.classList.toggle("hidden", !isSuperAdmin());
  if (!professor) {
    const avaliacaoView = document.querySelector("#avaliacao");
    if (avaliacaoView?.classList.contains("active")) {
      document.querySelector('[data-view="dashboard"]')?.click();
    }
  }
  if (!isAdmin()) {
    const adminView = document.querySelector("#admincmd");
    if (adminView?.classList.contains("active")) {
      document.querySelector('[data-view="dashboard"]')?.click();
    }
    const equipesView = document.querySelector("#equipes");
    if (equipesView?.classList.contains("active")) {
      document.querySelector('[data-view="dashboard"]')?.click();
    }
  }
  if (!isSuperAdmin()) {
    // Remove completamente o conteúdo do painel se não for SUPER
    const sadmView = document.querySelector("#superadm");
    if (sadmView) {
      if (sadmView.classList.contains("active")) {
        document.querySelector('[data-view="dashboard"]')?.click();
      }
      // Limpa qualquer conteúdo que possa ter ficado no DOM
      const codeEl = document.querySelector("#sadm-code-content");
      const tableEl = document.querySelector("#sadm-table-content");
      const copyEl = document.querySelector("#sadm-copy-list");
      if (codeEl) codeEl.textContent = "";
      if (tableEl) tableEl.innerHTML = "";
      if (copyEl) copyEl.innerHTML = "";
      _sadmFiles = null;
      _sadmDbTables = null;
    }
  }

  if (customFieldsCard) customFieldsCard.classList.toggle("hidden", !professor);

  updateTopbarDisplay();

  if (!state.profilePhotoLoaded) {
    state.profilePhotoLoaded = true;
    apiFetch("/api/profile").then(({ user }) => {
      if (user.photo) updateTopbarPhoto(user.photo);
    }).catch(() => {});
  }
}

function renderAll() {
  if (!state.currentUser) return;
  renderByRole();
  fillSelects();
  fillBoardsProjectSelect();
  renderTemplates();
  renderStats();
  renderProjects();
  renderTaskList();
  renderSprints();
  renderScrumTeam();
  renderKanban();
  renderCustomFieldsManager();
}

async function refreshAndRender() {
  await loadData();
  renderAll();
}

// ── Template helpers ──────────────────────────────────────
function pickTemplateMembers(slotCount) {
  const students = [...state.students];
  if (students.length === 0 && state.currentUser?.name) {
    return [state.currentUser.name];
  }

  const selected = [];
  for (let i = 0; i < slotCount; i += 1) {
    selected.push(students[i % students.length]);
  }

  return Array.from(new Set(selected));
}

function resolveAssignee(token, members) {
  if (token === "Todos") return "Todos";

  if (token.startsWith("@")) {
    const index = Number(token.slice(1)) - 1;
    return members[index] || members[0] || "Todos";
  }

  return token;
}

async function applyTemplate(templateId) {
  if (!isProfessor() || state.templateBusy) return;

  const template = projectTemplates.find((item) => item.id === templateId);
  if (!template) return;

  state.templateBusy = true;
  renderTemplates();

  try {
    const baseDate = new Date();
    const dateSuffix = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" }).format(baseDate);
    const members = pickTemplateMembers(template.memberSlots);
    const scrumRoles = buildScrumRolesByOrder(members);

    const projectResult = await apiFetch("/api/projects", {
      method: "POST",
      body: JSON.stringify({
        name: `${template.projectName} (${dateSuffix})`,
        team: template.team,
        members,
        scrumRoles,
        deadline: addDaysIso(baseDate, template.durationDays)
      })
    });

    const sprintMap = new Map();
    for (const sprint of template.sprints) {
      const sprintResult = await apiFetch("/api/sprints", {
        method: "POST",
        body: JSON.stringify({
          name: `${sprint.name} - ${template.name}`,
          goal: sprint.goal,
          start: addDaysIso(baseDate, sprint.startOffset),
          end: addDaysIso(baseDate, sprint.endOffset)
        })
      });

      sprintMap.set(sprint.key, sprintResult.id);
    }

    for (const task of template.tasks) {
      const sprintId = sprintMap.get(task.sprintKey);
      if (!sprintId) continue;

      await apiFetch("/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          projectId: projectResult.id,
          title: task.title,
          assignee: resolveAssignee(task.assignee, members),
          dueDate: addDaysIso(baseDate, task.dueOffset),
          priority: task.priority || "media",
          sprintId,
          points: task.points
        })
      });
    }

    await refreshAndRender();
    alert(`Modelo '${template.name}' aplicado com sucesso.`);
  } catch (err) {
    alert(`Falha ao aplicar modelo: ${err.message}`);
  } finally {
    state.templateBusy = false;
    renderTemplates();
  }
}

function openEditTaskModal(taskId) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task || !editTaskForm) return;
  setAssigneeOptions(editTaskAssigneeSelect, task.projectId, task.assignee);

  editTaskForm.elements.taskId.value = task.id;
  editTaskForm.elements.title.value = task.title;
  editTaskForm.elements.assignee.value = task.assignee;
  editTaskForm.elements.dueDate.value = task.dueDate;
  editTaskForm.elements.priority.value = task.priority || "media";
  editTaskForm.elements.urgency.value = task.urgency || "medium";
  editTaskForm.elements.sprintId.value = task.sprintId;
  editTaskForm.elements.points.value = task.points;
  renderCustomFieldInputs(editTaskCustomFields, task.projectId, task.customValues || {});
  editTaskModal.showModal();
}

async function moveTaskToStatus(taskId, newStatus) {
  await apiFetch(`/api/tasks/${taskId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status: newStatus })
  });
  await refreshAndRender();
}

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
  await loadSubscription();
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
  state.currentUser = null;
  document.body.classList.remove("theme-professor", "theme-aluno");
  state.profilePhotoLoaded = false;
  state.pendingPhoto = null;
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
  try {
    const data = await apiFetch("/api/auth/me");
    if (data.user.role === "aluno" && !data.user.onboardingDone) {
      await showStudentOnboarding(data.user);
    } else {
      await setSession(data.user);
    }
  } catch (_err) {
    clearSession();
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

// ── Navigation ────────────────────────────────────────────
navItems.forEach((btn) => {
  btn.addEventListener("click", () => {
    navItems.forEach((n) => n.classList.remove("active"));
    views.forEach((v) => v.classList.remove("active"));
    btn.classList.add("active");
    const viewId = btn.dataset.view;
    document.querySelector(`#${viewId}`)?.classList.add("active");
    viewTitle.textContent = btn.querySelector(".nav-label")?.textContent.trim() || btn.textContent.trim();

    if (viewId === "quadros") {
      const sel = document.querySelector("#boards-project-select");
      if (sel && state.projects.length && !sel.value) {
        sel.innerHTML = state.projects.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");
      }
      if (sel?.value) loadBoards(sel.value);
    }

    if (viewId === "equipes") {
      loadEquipes();
    }

    if (viewId === "avaliacao") {
      renderAvaliacao();
    }

    if (viewId === "superadm") {
      loadSuperAdm();
    }
  });
});

// ── Auth form listeners ───────────────────────────────────
const _loginFullnameField = document.querySelector("#login-fullname-field");
const _loginFullnameInput = _loginFullnameField?.querySelector("input");

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(loginForm);
  const username = String(data.get("username") || "").trim();
  const password = String(data.get("password") || "").trim();
  const fullName = String(data.get("fullName") || "").trim();

  try {
    const response = await apiFetch("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password, fullName })
    });

    // Reset name field after successful login
    if (_loginFullnameField) _loginFullnameField.classList.add("hidden");
    if (_loginFullnameInput) { _loginFullnameInput.value = ""; _loginFullnameInput.required = false; }

    clearAuthFeedback();
    if (response.mustChangePassword) {
      setAuthView("change-password");
    } else if (response.requiresOnboarding) {
      await showStudentOnboarding(response.user);
    } else {
      await setSession(response.user);
    }
  } catch (err) {
    // If server asks for name confirmation, show the name field
    if (err.data?.requiresName || err.message?.includes("Nome completo")) {
      if (_loginFullnameField) {
        _loginFullnameField.classList.remove("hidden");
        _loginFullnameInput.required = true;
        _loginFullnameInput.focus();
      }
    }
    loginError.textContent = err.message;
  }
});

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

goRegisterBtn.addEventListener("click", () => {
  clearAuthFeedback();
  setAuthView("register");
});

if (goRecoverBtn) goRecoverBtn.addEventListener("click", () => {
  clearAuthFeedback();
  setAuthView("recover");
});

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
    registerError.textContent = "As senhas nao coincidem.";
    return;
  }

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

// ── Billing ────────────────────────────────────────────────
initBillingListeners();

// ── Logout ────────────────────────────────────────────────
logoutBtn.addEventListener("click", async () => {
  try {
    await apiFetch("/api/auth/logout", { method: "POST", body: "{}" });
  } catch (_err) {
  } finally {
    clearSession();
  }
});

// ── Admin CMD ─────────────────────────────────────────────
if (adminCmdRun && adminCmdInput && adminCmdOutput) {
  const runAdminCommand = async () => {
    const cmd = adminCmdInput.value.trim();
    if (!cmd) return;
    adminCmdOutput.textContent += `\n> ${cmd}`;

    try {
      const result = await apiFetch("/api/admin/cmd", {
        method: "POST",
        body: JSON.stringify({ cmd })
      });
      adminCmdOutput.textContent += `\n${result.output || "OK"}`;
      await refreshAndRender();
    } catch (err) {
      adminCmdOutput.textContent += `\n[ERRO] ${err.message}`;
    }

    adminCmdInput.value = "";
    adminCmdOutput.scrollTop = adminCmdOutput.scrollHeight;
  };

  adminCmdRun.addEventListener("click", runAdminCommand);
  adminCmdInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      runAdminCommand();
    }
  });
}

// ── Profile modal ─────────────────────────────────────────
if (openProfileModalBtn && profileModal) {
  openProfileModalBtn.addEventListener("click", async () => {
    profileError.textContent = "";
    profileSuccess.textContent = "";
    state.profilePendingPhoto = null;

    try {
      const { user } = await apiFetch("/api/profile");

      document.querySelector("#profile-name").textContent = user.name || "";
      document.querySelector("#profile-username").textContent = "@" + (user.username || "");
      document.querySelector("#profile-email").textContent = user.email || "(nao configurado)";
      profileTurmaInput.value = user.turma || "";
      profilePeriodoInput.value = user.periodo || "";
      if (profileCursoInput) profileCursoInput.value = user.curso || "";

      const avatarImg = document.querySelector("#profile-avatar-img");
      const avatarInitials = document.querySelector("#profile-avatar-initials");
      if (user.photo) {
        avatarImg.src = user.photo;
        avatarImg.classList.remove("hidden");
        avatarInitials.classList.add("hidden");
      } else {
        avatarImg.classList.add("hidden");
        avatarInitials.textContent = (user.name || "?").charAt(0).toUpperCase();
        avatarInitials.classList.remove("hidden");
      }

      const scrumRolesEl = document.querySelector("#profile-scrum-roles");
      const roles = getCurrentUserScrumRoles();
      scrumRolesEl.innerHTML = roles.length
        ? roles.map((r) => `<span class="badge">${escapeHtml(r)}</span>`).join(" ")
        : "<span style='color:var(--muted);'>sem papel definido</span>";

    } catch (err) {
      console.error("Erro ao carregar perfil:", err);
    }

    profileModal.showModal();
  });
}

if (profileCloseBtn) {
  profileCloseBtn.addEventListener("click", () => profileModal.close());
}

if (profilePhotoBtn && profilePhotoInput) {
  profilePhotoBtn.addEventListener("click", () => profilePhotoInput.click());
  profilePhotoInput.addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (!file) return;
    resizeAndPreviewPhoto(file, "#profile-avatar-img", "#profile-avatar-initials", (dataUrl) => {
      state.profilePendingPhoto = dataUrl;
      profileError.textContent = "";
    }, (errorMessage) => {
      state.profilePendingPhoto = null;
      event.target.value = "";
      profileError.textContent = errorMessage;
    });
  });
}

if (profileSaveBtn) {
  profileSaveBtn.addEventListener("click", async () => {
    profileError.textContent = "";
    profileSuccess.textContent = "";

    const avatarImg = document.querySelector("#profile-avatar-img");
    const photo = state.profilePendingPhoto
      || (!avatarImg.classList.contains("hidden") && avatarImg.src.startsWith("data:") ? avatarImg.src : null);

    try {
      const result = await apiFetch("/api/profile", {
        method: "PATCH",
        body: JSON.stringify({
          turma: profileTurmaInput.value.trim(),
          periodo: profilePeriodoInput.value.trim(),
          curso: profileCursoInput?.value.trim() || "",
          photo
        })
      });

      state.currentUser = { ...state.currentUser, ...result.user };
      state.profilePendingPhoto = null;
      profileSuccess.textContent = "Perfil atualizado com sucesso.";

      if (photo) updateTopbarPhoto(photo);
      updateTopbarDisplay();
    } catch (err) {
      profileError.textContent = err.message;
    }
  });
}

// ── Project modal ─────────────────────────────────────────
openProjectModalBtn.addEventListener("click", () => projectModal.showModal());
openSprintModalBtn.addEventListener("click", () => sprintModal.showModal());
openTaskModalBtn.addEventListener("click", () => taskModal.showModal());
taskProjectSelect.addEventListener("change", () => {
  setAssigneeOptions(taskAssigneeSelect, taskProjectSelect.value, "Todos");
  renderCustomFieldInputs(taskCustomFields, taskProjectSelect.value);
});

templateList.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement) || !target.dataset.templateId) return;
  await applyTemplate(target.dataset.templateId);
});

taskProjectFilter.addEventListener("change", renderTaskList);
taskSearch.addEventListener("input", renderTaskList);

projectForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(projectForm);
  const members = String(data.get("members") || "")
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);
  const scrumRoles = buildScrumRolesByOrder(members);

  try {
    await apiFetch("/api/projects", {
      method: "POST",
      body: JSON.stringify({
        name: String(data.get("name")),
        team: String(data.get("team")),
        members,
        scrumRoles,
        deadline: String(data.get("deadline")),
        description: String(data.get("description") || ""),
        discipline: String(data.get("discipline") || ""),
        startDate: String(data.get("startDate") || "")
      })
    });

    projectModal.close();
    projectForm.reset();
    await refreshAndRender();
  } catch (err) {
    alert(err.message);
  }
});

sprintForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(sprintForm);

  try {
    await apiFetch("/api/sprints", {
      method: "POST",
      body: JSON.stringify({
        name: String(data.get("name")),
        goal: String(data.get("goal")),
        start: String(data.get("start")),
        end: String(data.get("end"))
      })
    });

    sprintModal.close();
    sprintForm.reset();
    await refreshAndRender();
  } catch (err) {
    alert(err.message);
  }
});

taskForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(taskForm);

  const customValues = {};
  for (const [key, value] of data.entries()) {
    if (key.startsWith("cf_")) customValues[key.slice(3)] = value;
  }

  try {
    await apiFetch("/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        projectId: String(data.get("projectId")),
        title: String(data.get("title")),
        assignee: String(data.get("assignee")),
        dueDate: String(data.get("dueDate")),
        priority: String(data.get("priority") || "media"),
        urgency: String(data.get("urgency") || "medium"),
        sprintId: String(data.get("sprintId")),
        points: Number(data.get("points")),
        description: String(data.get("description") || ""),
        customValues
      })
    });

    taskModal.close();
    taskForm.reset();
    if (taskPrioritySelect) taskPrioritySelect.value = "media";
    await refreshAndRender();
  } catch (err) {
    alert(err.message);
  }
});

editTaskForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(editTaskForm);

  const customValues = {};
  for (const [key, value] of data.entries()) {
    if (key.startsWith("cf_")) customValues[key.slice(3)] = value;
  }

  try {
    await apiFetch(`/api/tasks/${String(data.get("taskId"))}`, {
      method: "PATCH",
      body: JSON.stringify({
        title: String(data.get("title")),
        assignee: String(data.get("assignee")),
        dueDate: String(data.get("dueDate")),
        priority: String(data.get("priority") || "media"),
        urgency: String(data.get("urgency") || "medium"),
        sprintId: String(data.get("sprintId")),
        points: Number(data.get("points")),
        customValues
      })
    });

    editTaskModal.close();
    await refreshAndRender();
  } catch (err) {
    alert(err.message);
  }
});

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

// ── Task Detail Modal ──────────────────────────────────────
// The modal uses static elements in index.html — we populate them here.

let _detailTask = null; // currently-open task

function renderDetailChecklist() {
  const checklist = _detailTask?.checklist || [];
  const itemsEl = document.querySelector("#checklist-items");
  const labelEl = document.querySelector("#checklist-label");
  const barEl = document.querySelector("#checklist-bar");
  if (!itemsEl) return;
  const done = checklist.filter((i) => i.done).length;
  const total = checklist.length;
  if (labelEl) labelEl.textContent = `${done} / ${total} itens`;
  if (barEl) barEl.style.width = total ? `${Math.round(done / total * 100)}%` : "0%";
  itemsEl.innerHTML = checklist.map((item, idx) => `
    <div class="checklist-item">
      <input type="checkbox" id="ci-${idx}" data-ci-idx="${idx}" ${item.done ? "checked" : ""}>
      <label for="ci-${idx}">${escapeHtml(item.title)}</label>
      <button class="btn-link ci-del-btn" data-ci-idx="${idx}" title="Remover">×</button>
    </div>
  `).join("") || `<p class="checklist-empty">Nenhum item ainda.</p>`;
}

function renderDetailTags() {
  const tags = _detailTask?.tags || [];
  const el = document.querySelector("#tags-display");
  if (!el) return;
  el.innerHTML = tags.map((tg, idx) => `<span class="tag-pill">${escapeHtml(tg)}<button class="tag-pill-rm" data-tag-idx="${idx}" title="Remover">×</button></span>`).join("") || "";
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
  if (q("#detail-points")) q("#detail-points").value = task.points || 1;
  if (q("#detail-priority")) q("#detail-priority").value = task.priority || "media";
  if (q("#detail-status")) q("#detail-status").value = task.status === "backlog" ? "todo" : (task.status || "todo");

  const urgencyBadge = q("#detail-urgency-badge");
  const urgencyLabels = { high: "🔴 Alta", medium: "🟡 Média", low: "🟢 Baixa" };
  if (urgencyBadge) {
    urgencyBadge.textContent = urgencyLabels[task.urgency || "medium"];
    urgencyBadge.className = `urgency-badge urgency-${task.urgency || "medium"}`;
  }

  // Assignee select
  const assigneeEl = q("#detail-assignee");
  if (assigneeEl) {
    setAssigneeOptions(assigneeEl, task.projectId, task.assignee);
  }

  // urgency buttons highlight
  modal.querySelectorAll(".urgency-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.urgency === (task.urgency || "medium"));
  });

  renderDetailChecklist();
  renderDetailTags();
  loadTaskComments(taskId, modal.querySelector("#comments-list"));

  modal.showModal();
}

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
    const priority = modal.querySelector("#detail-priority")?.value || "media";
    const points = Number(modal.querySelector("#detail-points")?.value) || 1;
    const status = modal.querySelector("#detail-status")?.value || "todo";
    const assignee = modal.querySelector("#detail-assignee")?.value || _detailTask.assignee;
    try {
      await apiFetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        body: JSON.stringify({ title, description, dueDate, priority, points, status, assignee })
      });
      const t = state.tasks.find((t) => t.id === taskId || t.id === String(taskId));
      if (t) Object.assign(t, { title, description, dueDate, priority, points, status, assignee });
      renderKanban();
      renderDashboardMiniKanban();
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

  // Add checklist item
  modal.querySelector("#checklist-add-btn")?.addEventListener("click", async () => {
    if (!_detailTask) return;
    const input = modal.querySelector("#checklist-new-input");
    const title = input?.value.trim();
    if (!title) return;
    const newList = [..._detailTask.checklist, { id: Date.now(), title, done: false }];
    try {
      await apiFetch(`/api/tasks/${_detailTask.id}/checklist`, { method: "PATCH", body: JSON.stringify({ checklist: newList }) });
      _detailTask.checklist = newList;
      const t = state.tasks.find((t) => t.id === _detailTask.id || t.id === String(_detailTask.id));
      if (t) t.checklist = [...newList];
      if (input) input.value = "";
      renderDetailChecklist();
    } catch (err) { alert(err.message); }
  });

  // Checklist item toggle / delete (event delegation)
  modal.querySelector("#checklist-items")?.addEventListener("change", async (e) => {
    const cb = e.target;
    if (!cb.matches("input[type=checkbox][data-ci-idx]") || !_detailTask) return;
    const idx = Number(cb.dataset.ciIdx);
    _detailTask.checklist[idx].done = cb.checked;
    try {
      await apiFetch(`/api/tasks/${_detailTask.id}/checklist`, { method: "PATCH", body: JSON.stringify({ checklist: _detailTask.checklist }) });
      const t = state.tasks.find((t) => t.id === _detailTask.id || t.id === String(_detailTask.id));
      if (t) t.checklist = [..._detailTask.checklist];
      renderDetailChecklist();
    } catch (err) { cb.checked = !cb.checked; _detailTask.checklist[idx].done = cb.checked; }
  });

  modal.querySelector("#checklist-items")?.addEventListener("click", async (e) => {
    const btn = e.target.closest(".ci-del-btn");
    if (!btn || !_detailTask) return;
    const idx = Number(btn.dataset.ciIdx);
    const newList = _detailTask.checklist.filter((_, i) => i !== idx);
    try {
      await apiFetch(`/api/tasks/${_detailTask.id}/checklist`, { method: "PATCH", body: JSON.stringify({ checklist: newList }) });
      _detailTask.checklist = newList;
      const t = state.tasks.find((t) => t.id === _detailTask.id || t.id === String(_detailTask.id));
      if (t) t.checklist = [...newList];
      renderDetailChecklist();
    } catch (err) { alert(err.message); }
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

// ── Tutorial ───────────────────────────────────────────────
const TUTORIAL_STEPS = [
  { title: "Bem-vindo ao PILHA!", icon: "🎓", text: "O PILHA é o sistema de gestão ágil da UNIPAM. Aqui você organiza projetos, sprints e tarefas com metodologia Scrum." },
  { title: "Seu Dashboard", icon: "📅", text: "O Dashboard mostra o calendário com prazos destacados, um mini-kanban das tarefas e as próximas entregas do grupo." },
  { title: "Quadro de Tarefas (Kanban)", icon: "📋", text: "No Kanban você cria, move e visualiza tarefas em 3 colunas: Backlog → Fazendo → Concluído. Arraste os cards ou clique em Detalhes." },
  { title: "Quadros Personalizados", icon: "🗂️", text: "Em Quadros você pode criar quadros com colunas customizadas para organizar seu fluxo do seu jeito." },
  { title: "Seu Perfil", icon: "👤", text: "Complete seu perfil com foto, turma e período. Clique no seu nome no topo para acessar." }
];

let tutorialStep = 0;

function startTutorial() {
  if (localStorage.getItem("pilha_tutorial_done")) return;
  tutorialStep = 0;
  showTutorialStep();
  const overlay = document.querySelector("#tutorial-overlay");
  if (overlay) overlay.classList.remove("hidden");
}

function showTutorialStep() {
  const overlay = document.querySelector("#tutorial-overlay");
  if (!overlay) return;
  const step = TUTORIAL_STEPS[tutorialStep];
  const titleEl = document.querySelector("#tutorial-title");
  const descEl = document.querySelector("#tutorial-desc");
  const stepNumEl = document.querySelector("#tutorial-step-num");
  const iconEl = document.querySelector("#tutorial-icon");
  const prevBtn = document.querySelector("#tutorial-prev");
  const nextBtn = document.querySelector("#tutorial-next");
  const dotsEl = document.querySelector("#tutorial-dots");

  if (titleEl) titleEl.textContent = step.title;
  if (descEl) descEl.textContent = step.text;
  if (iconEl) iconEl.textContent = step.icon;
  if (stepNumEl) stepNumEl.textContent = `Passo ${tutorialStep + 1} de ${TUTORIAL_STEPS.length}`;
  if (prevBtn) prevBtn.style.display = tutorialStep === 0 ? "none" : "";
  if (nextBtn) nextBtn.textContent = tutorialStep === TUTORIAL_STEPS.length - 1 ? "Concluir ✓" : "Próximo →";

  if (dotsEl) {
    dotsEl.innerHTML = TUTORIAL_STEPS.map((_, i) => `<span class="tutorial-dot${i === tutorialStep ? " active" : ""}"></span>`).join("");
  }
}

function skipTutorial() {
  localStorage.setItem("pilha_tutorial_done", "1");
  const overlay = document.querySelector("#tutorial-overlay");
  if (overlay) overlay.classList.add("hidden");
}

(function initTutorial() {
  document.querySelector("#tutorial-prev")?.addEventListener("click", () => {
    if (tutorialStep > 0) { tutorialStep--; showTutorialStep(); }
  });
  document.querySelector("#tutorial-next")?.addEventListener("click", () => {
    if (tutorialStep < TUTORIAL_STEPS.length - 1) { tutorialStep++; showTutorialStep(); }
    else skipTutorial();
  });
  document.querySelector("#tutorial-skip")?.addEventListener("click", skipTutorial);
})();

// ── Custom Boards (Quadros) ────────────────────────────────
function fillBoardsProjectSelect() {
  const sel = document.querySelector("#boards-project-select");
  if (!sel) return;
  sel.innerHTML = state.projects.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");
}

async function loadBoards(projectId) {
  if (!projectId) return;
  try {
    state.boards = await apiFetch(`/api/projects/${projectId}/boards`);
    renderBoardsList();
  } catch (_err) {
    state.boards = [];
    renderBoardsList();
  }
}

function renderBoardsList() {
  const container = document.querySelector("#boards-list");
  if (!container) return;

  container.innerHTML = state.boards.length
    ? state.boards.map((b) => `
        <div class="board-card" data-board-id="${b.id}">
          <span>${escapeHtml(b.name)}</span>
          <div class="board-card-actions">
            <button class="btn-secondary btn-sm" data-open-board="${b.id}">Abrir</button>
            <button class="btn-danger btn-sm" data-delete-board="${b.id}">×</button>
          </div>
        </div>
      `).join("")
    : `<p class="boards-empty">Nenhum quadro criado. Clique em "Novo Quadro".</p>`;

  container.querySelectorAll("[data-open-board]").forEach((btn) => {
    btn.addEventListener("click", () => openBoard(Number(btn.dataset.openBoard)));
  });
  container.querySelectorAll("[data-delete-board]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Remover este quadro?")) return;
      const projectId = document.querySelector("#boards-project-select")?.value;
      try {
        await apiFetch(`/api/projects/${projectId}/boards/${btn.dataset.deleteBoard}`, { method: "DELETE" });
        await loadBoards(projectId);
      } catch (err) { alert(err.message); }
    });
  });
}

async function openBoard(boardId) {
  state.activeBoard = state.boards.find((b) => b.id === boardId);
  if (!state.activeBoard) return;

  try {
    state.boardColumns = await apiFetch(`/api/boards/${boardId}/columns`);
  } catch (_err) { state.boardColumns = []; }

  renderBoardView();
}

function renderBoardView() {
  const viewEl = document.querySelector("#custom-board-view");
  const board = state.activeBoard;
  if (!viewEl || !board) return;

  viewEl.innerHTML = `
    <div class="custom-board-header">
      <h3>${escapeHtml(board.name)}</h3>
      <button class="btn-secondary btn-sm" id="cb-add-col-btn">+ Coluna</button>
    </div>
    <div class="custom-board-cols">
      ${state.boardColumns.map((col) => `
        <div class="kanban-col custom-col" data-col-id="${col.id}" style="border-top-color:${col.color || "#1565C0"}">
          <h4>${escapeHtml(col.name)}</h4>
          <button class="btn-link btn-sm col-delete-btn" data-col-id="${col.id}">Remover coluna</button>
        </div>
      `).join("")}
    </div>
  `;

  viewEl.querySelector("#cb-add-col-btn")?.addEventListener("click", async () => {
    const name = prompt("Nome da nova coluna:");
    if (!name) return;
    try {
      await apiFetch(`/api/boards/${board.id}/columns`, { method: "POST", body: JSON.stringify({ name }) });
      await openBoard(board.id);
    } catch (err) { alert(err.message); }
  });

  viewEl.querySelectorAll(".col-delete-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Remover esta coluna?")) return;
      try {
        await apiFetch(`/api/boards/${board.id}/columns/${btn.dataset.colId}`, { method: "DELETE" });
        await openBoard(board.id);
      } catch (err) { alert(err.message); }
    });
  });

  viewEl.classList.remove("hidden");
}

// boards project select change
document.querySelector("#boards-project-select")?.addEventListener("change", (e) => {
  loadBoards(e.target.value);
});

// create board modal
const createBoardModal = document.querySelector("#create-board-modal");
document.querySelector("#open-board-modal")?.addEventListener("click", () => {
  createBoardModal?.showModal();
});

document.querySelector("#create-board-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = new FormData(e.target);
  const name = String(data.get("boardName") || "").trim();
  const projectId = document.querySelector("#boards-project-select")?.value;
  if (!name || !projectId) return;
  try {
    await apiFetch(`/api/projects/${projectId}/boards`, { method: "POST", body: JSON.stringify({ name }) });
    createBoardModal?.close();
    e.target.reset();
    await loadBoards(projectId);
  } catch (err) { alert(err.message); }
});

// ── Admin: Create Professor ────────────────────────────────
document.querySelector("#create-professor-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = new FormData(e.target);
  const payload = {
    name: String(data.get("name") || "").trim(),
    username: String(data.get("username") || "").trim(),
    password: String(data.get("password") || "")
  };
  const errEl = document.querySelector("#create-prof-error");
  const okEl = document.querySelector("#create-prof-success");
  if (errEl) errEl.textContent = "";
  if (okEl) okEl.textContent = "";
  try {
    await apiFetch("/api/admin/professor", { method: "POST", body: JSON.stringify(payload) });
    if (okEl) okEl.textContent = `Professor ${payload.name} criado com sucesso.`;
    e.target.reset();
  } catch (err) {
    if (errEl) errEl.textContent = err.message;
  }
});

// ── Custom Fields ─────────────────────────────────────────
if (cfProjectSelect) {
  cfProjectSelect.addEventListener("change", renderCustomFieldsManager);
}

if (openCfModalBtn && customFieldModal) {
  openCfModalBtn.addEventListener("click", () => {
    if (customFieldForm) customFieldForm.reset();
    if (cfOptionsLabel) cfOptionsLabel.classList.add("hidden");
    customFieldModal.showModal();
  });
}

if (cfTypeSelect && cfOptionsLabel) {
  cfTypeSelect.addEventListener("change", () => {
    cfOptionsLabel.classList.toggle("hidden", cfTypeSelect.value !== "select");
  });
}

if (customFieldForm && customFieldModal) {
  customFieldForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(customFieldForm);
    const projectId = cfProjectSelect?.value;
    if (!projectId) return;

    const name = String(data.get("name") || "").trim();
    const fieldType = String(data.get("fieldType") || "text");
    const optionsRaw = String(data.get("options") || "");
    const options = optionsRaw.split(",").map((o) => o.trim()).filter(Boolean);

    try {
      await apiFetch(`/api/projects/${projectId}/fields`, {
        method: "POST",
        body: JSON.stringify({ name, fieldType, options })
      });
      customFieldModal.close();
      await refreshAndRender();
    } catch (err) {
      alert(err.message);
    }
  });
}

if (cfList) {
  cfList.addEventListener("click", async (event) => {
    const btn = event.target.closest(".cf-delete-btn");
    if (!btn) return;
    const { fieldId, projectId } = btn.dataset;
    if (!fieldId || !projectId) return;
    if (!confirm("Remover este campo? Os valores salvos nas tarefas tambem serao apagados.")) return;

    try {
      await apiFetch(`/api/projects/${projectId}/fields/${fieldId}`, { method: "DELETE" });
      await refreshAndRender();
    } catch (err) {
      alert(err.message);
    }
  });
}

// ── SUPER ADM ─────────────────────────────────────────────
let _sadmFiles = null;
let _sadmDbTables = null;
let _sadmActiveTab = "code";

async function loadSuperAdm() {
  // Guarda de segurança client-side
  if (!isSuperAdmin()) {
    document.querySelector('[data-view="dashboard"]')?.click();
    return;
  }

  // Tab switching
  document.querySelectorAll(".sadm-tab").forEach((tab) => {
    tab.onclick = () => {
      document.querySelectorAll(".sadm-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      _sadmActiveTab = tab.dataset.sadmtab;
      document.querySelector("#sadm-logs-panel").classList.toggle("hidden", _sadmActiveTab !== "logs");
      document.querySelector("#sadm-code-panel").classList.toggle("hidden", _sadmActiveTab !== "code");
      document.querySelector("#sadm-copy-panel").classList.toggle("hidden", _sadmActiveTab !== "copy");
      document.querySelector("#sadm-db-panel").classList.toggle("hidden", _sadmActiveTab !== "db");
      if (_sadmActiveTab === "db" && !_sadmDbTables) loadSadmDb();
      if (_sadmActiveTab === "copy") renderSadmCopyList();
      if (_sadmActiveTab === "logs") loadSadmLogs();
    };
  });

  // Copy button in code viewer
  const copyBtn = document.querySelector("#sadm-copy-btn");
  if (copyBtn) {
    copyBtn.onclick = () => {
      const content = document.querySelector("#sadm-code-content")?.textContent || "";
      if (!content) return;
      navigator.clipboard.writeText(content).then(() => {
        copyBtn.textContent = "Copiado!";
        copyBtn.classList.add("copied");
        setTimeout(() => { copyBtn.textContent = "Copiar"; copyBtn.classList.remove("copied"); }, 2000);
      });
    };
  }

  // Default: load logs tab on first open
  await loadSadmLogs();
  if (_sadmActiveTab === "code" && !_sadmFiles) await loadSadmFiles();
  if (_sadmActiveTab === "db" && !_sadmDbTables) await loadSadmDb();
}

async function loadSadmLogs() {
  const wrap = document.querySelector("#sadm-logs-content");
  const meta = document.querySelector("#sadm-logs-meta");
  if (!wrap) return;
  wrap.innerHTML = '<div class="sadm-loading">Carregando...</div>';
  try {
    const data = await apiFetch("/api/superadmin/logs");
    const logs = data.logs || [];
    if (meta) meta.textContent = `${logs.length} registros`;
    if (!logs.length) {
      wrap.innerHTML = '<div class="sadm-empty">Nenhum acesso registrado ainda.</div>';
      return;
    }
    const rows = logs.map((l) => {
      const dt = new Date(l.logged_at + "Z");
      const fmt = isNaN(dt) ? l.logged_at : dt.toLocaleString("pt-BR");
      const badge = l.is_admin >= 2
        ? `<span style="color:#f59e0b;font-weight:700">SUPER</span>`
        : l.is_admin === 1
          ? `<span style="color:#6366f1;font-weight:700">ADM</span>`
          : `<span style="color:var(--text-muted)">${escapeHtml(l.role)}</span>`;
      return `<tr>
        <td>${escapeHtml(fmt)}</td>
        <td><b>${escapeHtml(l.name)}</b></td>
        <td style="font-family:monospace">${escapeHtml(l.username)}</td>
        <td>${badge}</td>
        <td style="font-family:monospace;font-size:.68rem;color:var(--text-muted)">${escapeHtml(l.ip || "-")}</td>
      </tr>`;
    }).join("");
    wrap.innerHTML = `<table>
      <thead><tr>
        <th>Data/Hora</th><th>Nome</th><th>Usuário</th><th>Tipo</th><th>IP</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  } catch (e) {
    wrap.innerHTML = `<div class="sadm-empty">Erro: ${escapeHtml(String(e.message))}</div>`;
  }
}

function renderSadmCopyList() {
  const wrap = document.querySelector("#sadm-copy-list");
  if (!_sadmFiles) {
    wrap.innerHTML = '<div class="sadm-loading">Carregando...</div>';
    loadSadmFiles().then(() => renderSadmCopyList());
    return;
  }
  wrap.innerHTML = _sadmFiles.map((f) => `
    <div class="sadm-copy-card">
      <div class="sadm-copy-card-head">
        <span class="sadm-copy-card-title">${escapeHtml(f.name)}</span>
        <div class="sadm-copy-card-actions">
          <span class="sadm-copy-card-meta">${f.lines} linhas · ${(new Blob([f.content]).size / 1024).toFixed(1)} KB</span>
          <button class="sadm-copy-btn" data-filename="${escapeHtml(f.name)}" type="button">Copiar</button>
        </div>
      </div>
      <pre>${escapeHtml(f.content)}</pre>
    </div>
  `).join("");

  // Bind copy buttons
  wrap.querySelectorAll(".sadm-copy-btn[data-filename]").forEach((btn) => {
    btn.onclick = () => {
      const filename = btn.dataset.filename;
      const file = _sadmFiles.find((f) => f.name === filename);
      if (!file) return;
      navigator.clipboard.writeText(file.content).then(() => {
        btn.textContent = "Copiado!";
        btn.classList.add("copied");
        setTimeout(() => { btn.textContent = "Copiar"; btn.classList.remove("copied"); }, 2000);
      });
    };
  });
}

async function loadSadmFiles() {
  const fileList = document.querySelector("#sadm-file-list");
  fileList.innerHTML = '<div class="sadm-loading">Carregando arquivos...</div>';
  try {
    const data = await apiFetch("/api/superadmin/files");
    _sadmFiles = data.files;
    fileList.innerHTML = '<div class="sadm-section-label">Arquivos</div>';
    _sadmFiles.forEach((f, idx) => {
      const el = document.createElement("div");
      el.className = "sadm-item";
      el.innerHTML = `<span>${escapeHtml(f.name)}</span><span class="sadm-item-badge">${f.lines}L</span>`;
      el.onclick = () => {
        fileList.querySelectorAll(".sadm-item").forEach((i) => i.classList.remove("active"));
        el.classList.add("active");
        document.querySelector("#sadm-file-name").textContent = f.name;
        document.querySelector("#sadm-file-meta").textContent = `${f.lines} linhas · ${(new Blob([f.content]).size / 1024).toFixed(1)} KB`;
        document.querySelector("#sadm-code-content").textContent = f.content;
      };
      fileList.appendChild(el);
      if (idx === 0) el.click();
    });
  } catch (e) {
    fileList.innerHTML = `<div class="sadm-loading">Erro ao carregar: ${escapeHtml(String(e.message || e))}</div>`;
  }
}

async function loadSadmDb() {
  const tableList = document.querySelector("#sadm-table-list");
  tableList.innerHTML = '<div class="sadm-loading">Carregando tabelas...</div>';
  try {
    const data = await apiFetch("/api/superadmin/db");
    _sadmDbTables = data.tables;
    tableList.innerHTML = '<div class="sadm-section-label">Tabelas</div>';
    _sadmDbTables.forEach((t, idx) => {
      const el = document.createElement("div");
      el.className = "sadm-item";
      el.innerHTML = `<span>${escapeHtml(t.name)}</span><span class="sadm-item-badge">${t.count}</span>`;
      el.onclick = () => {
        tableList.querySelectorAll(".sadm-item").forEach((i) => i.classList.remove("active"));
        el.classList.add("active");
        document.querySelector("#sadm-table-name").textContent = t.name;
        loadSadmTableRows(t.name, t.count);
      };
      tableList.appendChild(el);
      if (idx === 0) el.click();
    });
  } catch (e) {
    tableList.innerHTML = `<div class="sadm-loading">Erro: ${escapeHtml(String(e.message || e))}</div>`;
  }
}

async function loadSadmTableRows(tableName, count) {
  const wrap = document.querySelector("#sadm-table-content");
  const meta = document.querySelector("#sadm-table-meta");
  wrap.innerHTML = '<div class="sadm-loading">Carregando...</div>';
  meta.textContent = "";
  try {
    const data = await apiFetch(`/api/superadmin/db/${encodeURIComponent(tableName)}`);
    const rows = data.rows;
    if (!rows.length) {
      wrap.innerHTML = '<div class="sadm-empty">Tabela vazia</div>';
      meta.textContent = "0 registros";
      return;
    }
    const cols = Object.keys(rows[0]);
    meta.textContent = `${count} registros · ${rows.length < count ? `mostrando ${rows.length}` : ""}`;
    const colsHtml = cols.map((c) => `<th>${escapeHtml(c)}</th>`).join("");
    const rowsHtml = rows.map((r) =>
      `<tr>${cols.map((c) => {
        let val = r[c];
        if (val === null || val === undefined) val = "NULL";
        const s = String(val);
        return `<td title="${escapeHtml(s)}">${escapeHtml(s.length > 80 ? s.slice(0, 80) + "…" : s)}</td>`;
      }).join("")}</tr>`
    ).join("");
    wrap.innerHTML = `<table><thead><tr>${colsHtml}</tr></thead><tbody>${rowsHtml}</tbody></table>`;
  } catch (e) {
    wrap.innerHTML = `<div class="sadm-empty">Erro: ${escapeHtml(String(e.message || e))}</div>`;
  }
}

// ── EQUIPES (admin) ───────────────────────────────────────
let _allUsers = [];

async function loadEquipes() {
  try {
    _allUsers = await apiFetch("/api/admin/users");
  } catch (_err) {
    _allUsers = [];
  }
  renderEquipes();
}

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

  function memberCard(memberName, scrumRole) {
    const u = userByName.get(memberName);
    const initials = memberName.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase();
    const statusBadge = u
      ? (u.onboardingDone
          ? `<span class="chip" style="background:#22c55e1a;color:#16a34a;font-size:0.68rem;">Ativo</span>`
          : `<span class="chip" style="background:#f59e0b1a;color:#d97706;font-size:0.68rem;">Pendente</span>`)
      : "";
    const turmaInfo = u?.turma
      ? `<div class="equipe-meta-item">📚 ${escapeHtml(u.turma)}${u.periodo ? ` · ${escapeHtml(u.periodo)}` : ""}</div>`
      : "";
    const scrumBadgeClass = scrumRole === "Product Owner" ? "po" : scrumRole === "Scrum Master" ? "sm" : "dev";
    const scrumBadge = `<span class="role-badge ${scrumBadgeClass}" style="font-size:0.65rem;">${escapeHtml(scrumRole === "Development Team" ? "DEV" : scrumRole === "Product Owner" ? "PO" : "SM")}</span>`;
    const usernameInfo = u ? `<div class="equipe-username" style="font-size:.72rem;">@${escapeHtml(u.username)} <span class="chip" style="background:var(--border);color:var(--muted);font-size:0.65rem;padding:1px 4px;font-family:monospace;">ID ${u.id}</span></div>` : "";

    // highlight se busca bater neste membro
    const highlight = term && (memberName.toLowerCase().includes(term) || (u?.username || "").toLowerCase().includes(term));

    return `
      <div class="equipe-card group-member-card${highlight ? " highlighted" : ""}">
        <div class="equipe-avatar" style="width:36px;height:36px;font-size:.8rem;flex-shrink:0;">${escapeHtml(initials)}</div>
        <div class="equipe-info">
          <div class="equipe-name" style="font-size:.88rem;display:flex;align-items:center;gap:.4rem;">
            ${escapeHtml(memberName)} ${scrumBadge} ${statusBadge}
          </div>
          ${usernameInfo}
          <div class="equipe-meta">${turmaInfo}</div>
        </div>
      </div>
    `;
  }

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

    const membersSorted = [...members].sort((a, b) => {
      const order = { "Product Owner": 0, "Scrum Master": 1, "Development Team": 2 };
      return (order[a.role] ?? 3) - (order[b.role] ?? 3);
    });

    return `
      <article class="card group-project-card">
        <div class="group-project-header">
          <div class="group-project-title-row">
            <h3 class="group-project-name">${escapeHtml(p.name)}</h3>
            <span class="chip" style="background:var(--primary-faint,#4f6ef720);color:var(--primary,#4f6ef7);font-size:.7rem;">${members.length} aluno${members.length !== 1 ? "s" : ""}</span>
          </div>
          <div class="group-project-meta">
            ${turmaStr ? `<span class="group-meta-pill">📚 ${escapeHtml(turmaStr)}${periodoStr ? " · " + escapeHtml(periodoStr) : ""}</span>` : ""}
            ${p.discipline ? `<span class="group-meta-pill">📖 ${escapeHtml(p.discipline)}</span>` : ""}
            ${startFormatted ? `<span class="group-meta-pill">🗓️ ${escapeHtml(startFormatted)}${deadlineFormatted ? " → " + escapeHtml(deadlineFormatted) : ""}</span>` : deadlineFormatted ? `<span class="group-meta-pill">🗓️ até ${escapeHtml(deadlineFormatted)}</span>` : ""}
          </div>
          ${p.description ? `<p class="group-project-description">${escapeHtml(p.description)}</p>` : ""}
        </div>
        <div class="group-members-grid">
          ${membersSorted.map((m) => memberCard(m.name, m.role)).join("")}
        </div>
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
const SCRUM_COLS = [
  { key: "Product Owner",    label: "Product Owner",    badge: "po",  avatarClass: "po",   icon: "👑" },
  { key: "Scrum Master",     label: "Scrum Master",     badge: "sm",  avatarClass: "sm-c", icon: "🛡️" },
  { key: "Development Team", label: "Development Team", badge: "dev", avatarClass: "dev",  icon: "💻" }
];

let _scrumDragging = null; // { memberName, fromRole }

function renderScrumKanban() {
  const kanbanEl = document.querySelector("#scrum-kanban");
  const projectSel = document.querySelector("#scrum-project-select");
  if (!kanbanEl || !projectSel) return;

  // populate project select
  projectSel.innerHTML = state.projects.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");

  const projectId = Number(projectSel.value) || state.projects[0]?.id;
  if (!projectId) { kanbanEl.innerHTML = `<p style="color:var(--muted)">Nenhum projeto disponível.</p>`; return; }

  const project = state.projects.find((p) => p.id === projectId || p.id === String(projectId));
  const profiles = Array.isArray(project?.memberProfiles) ? project.memberProfiles : [];

  // group by role
  const byRole = {};
  SCRUM_COLS.forEach((c) => { byRole[c.key] = []; });
  profiles.forEach((m) => {
    const role = SCRUM_COLS.find((c) => c.key === m.role) ? m.role : "Development Team";
    byRole[role].push(m);
  });

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
                <div class="scrum-member-card" draggable="true"
                     data-member="${encodeURIComponent(m.name)}" data-role="${key}">
                  <div class="sm-avatar ${avatarClass}">${escapeHtml((m.name||"?").charAt(0).toUpperCase())}</div>
                  <div>
                    <div class="sm-name">${escapeHtml(m.name)}</div>
                    <div class="sm-sub">${label}</div>
                  </div>
                </div>
              `).join("")
            : `<div class="scrum-kanban-empty">Nenhum membro</div>`
          }
        </div>
      </div>
    `;
  }).join("");

  // drag events
  kanbanEl.querySelectorAll(".scrum-member-card").forEach((card) => {
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

// ── Avaliação (professor only) ─────────────────────────────

async function renderAvaliacao() {
  const container = document.getElementById("avaliacao-list");
  if (!container) return;
  container.innerHTML = '<p style="padding:1rem;color:var(--muted)">Carregando avaliações...</p>';
  try {
    const evalData = await apiFetch("/api/eval");
    const projects = state.projects;
    const memberPhotos = evalData.memberPhotos || {};

    // Calcular número do grupo por turma (ordem de cadastro = id crescente)
    const sortedByIdAsc = [...projects].sort((a, b) => Number(a.id) - Number(b.id));
    const turmaCounters = {};
    const projectGroupNums = {};
    for (const proj of sortedByIdAsc) {
      const turmaKey = (proj.team || "").split(/\s*[-–]\s*/)[0].trim() || "Geral";
      if (!turmaCounters[turmaKey]) turmaCounters[turmaKey] = 0;
      turmaCounters[turmaKey]++;
      projectGroupNums[String(proj.id)] = turmaCounters[turmaKey];
    }

    const activitiesByProject = {};
    const individualByProject = {};
    const metaByProject = {};
    // actScoreMap[actId][memberName] = score
    const actScoreMap = {};

    for (const act of evalData.activities) {
      const pid = String(act.project_id);
      if (!activitiesByProject[pid]) activitiesByProject[pid] = { planejamento: [], desenvolvimento: [] };
      activitiesByProject[pid][act.section].push(act);
    }
    for (const s of (evalData.activityScores || [])) {
      const aid = String(s.activity_id);
      if (!actScoreMap[aid]) actScoreMap[aid] = {};
      actScoreMap[aid][s.member_name] = Number(s.score);
    }
    for (const ind of evalData.individual) {
      const pid = String(ind.project_id);
      if (!individualByProject[pid]) individualByProject[pid] = {};
      individualByProject[pid][ind.member_name] = ind.score;
    }
    for (const meta of evalData.meta) {
      metaByProject[String(meta.project_id)] = meta;
    }

    if (projects.length === 0) {
      container.innerHTML = '<p style="padding:1rem;color:var(--muted)">Nenhum projeto encontrado.</p>';
      return;
    }

    container.innerHTML = projects.map((proj, idx) => {
      const pid = String(proj.id);
      const planActs = activitiesByProject[pid]?.planejamento || [];
      const devActs = activitiesByProject[pid]?.desenvolvimento || [];
      const indMap = individualByProject[pid] || {};
      const meta = metaByProject[pid] || { entrega_score: 0, observacoes: "" };
      const members = (proj.memberProfiles || []).map(m => m.name);

      const planMaxUsed = planActs.reduce((s, a) => s + Number(a.max_pts), 0);
      const devMaxUsed = devActs.reduce((s, a) => s + Number(a.max_pts), 0);
      const planRemaining = (6 - planMaxUsed).toFixed(1);
      const devRemaining = (7 - devMaxUsed).toFixed(1);

      const planCols = planActs.length + 1;
      const devCols = devActs.length + 1;

      const planActHeaders = planActs.map(act => `
        <th class="eval-act-th">
          <div class="eval-act-th-inner">
            <span class="eval-act-name" title="${escapeHtml(act.name)}">${escapeHtml(act.name)}</span>
            <div class="eval-act-meta">
              <span class="eval-act-pts">${Number(act.max_pts)}pts</span>
              <button class="eval-del-act btn-link" data-act-id="${act.id}" data-pid="${pid}" title="Remover atividade">×</button>
            </div>
          </div>
        </th>
      `).join("");

      const devActHeaders = devActs.map(act => `
        <th class="eval-act-th">
          <div class="eval-act-th-inner">
            <span class="eval-act-name" title="${escapeHtml(act.name)}">${escapeHtml(act.name)}</span>
            <div class="eval-act-meta">
              <span class="eval-act-pts">${Number(act.max_pts)}pts</span>
              <button class="eval-del-act btn-link" data-act-id="${act.id}" data-pid="${pid}" title="Remover atividade">×</button>
            </div>
          </div>
        </th>
      `).join("");

      const memberRows = members.length === 0
        ? `<tr><td colspan="20" style="text-align:center;padding:1rem;color:var(--muted)">Sem membros cadastrados</td></tr>`
        : members.map((memberName, mIdx) => {
          const planMemberTotal = planActs.reduce((s, a) => s + (actScoreMap[String(a.id)]?.[memberName] ?? 0), 0);
          const devMemberTotal = devActs.reduce((s, a) => s + (actScoreMap[String(a.id)]?.[memberName] ?? 0), 0);
          const individualScore = Number(indMap[memberName] || 0);
          const notaFinal = planMemberTotal + devMemberTotal + Number(meta.entrega_score || 0) + individualScore;

          const planScoreCells = planActs.map(act => {
            const val = actScoreMap[String(act.id)]?.[memberName] ?? 0;
            return `
            <td class="eval-score-cell">
              <input type="number" class="eval-score-input"
                     data-act-id="${act.id}" data-pid="${pid}" data-section="planejamento"
                     data-member="${escapeHtml(memberName)}"
                     value="${val}" min="0" max="${Number(act.max_pts)}" step="0.5" />
            </td>`;
          }).join("");

          const devScoreCells = devActs.map(act => {
            const val = actScoreMap[String(act.id)]?.[memberName] ?? 0;
            return `
            <td class="eval-score-cell">
              <input type="number" class="eval-score-input"
                     data-act-id="${act.id}" data-pid="${pid}" data-section="desenvolvimento"
                     data-member="${escapeHtml(memberName)}"
                     value="${val}" min="0" max="${Number(act.max_pts)}" step="0.5" />
            </td>`;
          }).join("");

          const entregaCell = mIdx === 0
            ? `<td class="eval-score-cell" rowspan="${members.length}">
                <input type="number" class="eval-entrega-input" data-pid="${pid}"
                       value="${Number(meta.entrega_score || 0)}" min="0" max="7" step="0.5" />
               </td>`
            : "";

          const memberPhoto = memberPhotos[memberName];
          const avatarHtml = memberPhoto
            ? `<img src="${memberPhoto}" class="eval-member-photo" alt="${escapeHtml(memberName)}" />`
            : `<span class="eval-member-initials">${escapeHtml(memberName.charAt(0).toUpperCase())}</span>`;

          return `
            <tr>
              <td class="eval-num">${projectGroupNums[pid] || (mIdx + 1)}</td>
              <td class="eval-name">
                <div class="eval-member-cell">
                  <div class="eval-member-avatar">${avatarHtml}</div>
                  <span>${escapeHtml(memberName)}</span>
                </div>
              </td>
              ${planScoreCells}
              <td class="eval-total" data-pid="${pid}" data-section="planejamento">${planMemberTotal.toFixed(1)}</td>
              ${devScoreCells}
              <td class="eval-total" data-pid="${pid}" data-section="desenvolvimento">${devMemberTotal.toFixed(1)}</td>
              ${entregaCell}
              <td class="eval-score-cell">
                <input type="number" class="eval-individual-input"
                       data-pid="${pid}" data-member="${escapeHtml(memberName)}"
                       value="${individualScore}" min="0" max="10" step="0.5" />
              </td>
              <td class="eval-nota" data-pid="${pid}" data-member="${escapeHtml(memberName)}">${notaFinal.toFixed(1)}</td>
            </tr>
          `;
        }).join("");

      return `
        <div class="eval-project-block" data-pid="${pid}">
          <div class="eval-project-header">
            <span class="eval-project-num">${projectGroupNums[pid] || idx + 1}</span>
            <div class="eval-project-info">
              <strong>${escapeHtml(proj.name)}</strong>
              <small>${escapeHtml(proj.team)}${proj.discipline ? " · " + escapeHtml(proj.discipline) : ""}</small>
            </div>
          </div>
          <div class="eval-table-wrap">
            <table class="eval-table">
              <thead>
                <tr class="eval-thead-sections">
                  <th rowspan="2" class="eval-th-fixed eval-th-num">Nº</th>
                  <th rowspan="2" class="eval-th-fixed eval-th-nome">NOME</th>
                  <th colspan="${planCols}" class="eval-th-plan">PLANEJAMENTO — 6 PTS</th>
                  <th colspan="${devCols}" class="eval-th-dev">DESENVOLVIMENTO — 7 PTS</th>
                  <th rowspan="2" class="eval-th-entrega">ENTREGA<br><small>7 PTS</small></th>
                  <th rowspan="2" class="eval-th-indiv">INDIVIDUAL</th>
                  <th rowspan="2" class="eval-th-nota">NOTA<br>FINAL</th>
                </tr>
                <tr class="eval-thead-acts">
                  ${planActHeaders || '<th class="eval-act-th eval-act-empty">Total</th>'}
                  <th class="eval-th-total">Total</th>
                  ${devActHeaders || '<th class="eval-act-th eval-act-empty">Total</th>'}
                  <th class="eval-th-total">Total</th>
                </tr>
              </thead>
              <tbody>${memberRows}</tbody>
            </table>
          </div>
          <div class="eval-actions-row">
            <div class="eval-section-add" data-pid="${pid}" data-section="planejamento">
              <button class="btn-secondary eval-add-act-btn">+ Atividade Planejamento</button>
              <span class="eval-remaining${Number(planRemaining) < 0 ? " eval-remaining-over" : ""}">Disponível: ${planRemaining} pts</span>
            </div>
            <div class="eval-section-add" data-pid="${pid}" data-section="desenvolvimento">
              <button class="btn-secondary eval-add-act-btn">+ Atividade Desenvolvimento</button>
              <span class="eval-remaining${Number(devRemaining) < 0 ? " eval-remaining-over" : ""}">Disponível: ${devRemaining} pts</span>
            </div>
          </div>
          <div class="eval-add-form hidden" id="eval-add-form-${pid}">
            <input type="text" placeholder="Nome da atividade" class="eval-add-name" />
            <input type="number" placeholder="Pts máx" class="eval-add-maxpts" min="0.5" max="10" step="0.5" value="1" style="width:90px;" />
            <button class="btn-primary eval-add-confirm">Adicionar</button>
            <button class="btn-secondary eval-add-cancel">Cancelar</button>
          </div>
          <div class="eval-obs-section">
            <label class="eval-obs-label">Observações do projeto:</label>
            <textarea class="eval-obs-input" data-pid="${pid}" placeholder="Observações gerais sobre este projeto...">${escapeHtml(meta.observacoes || "")}</textarea>
          </div>
        </div>
      `;
    }).join("");

    attachAvaliacaoEvents(container);
  } catch (err) {
    container.innerHTML = `<p style="padding:1rem;color:var(--danger)">Erro ao carregar: ${escapeHtml(err.message)}</p>`;
  }
}

function updateProjectCalculations(pid, container) {
  const block = container.querySelector(`.eval-project-block[data-pid="${pid}"]`);
  if (!block) return;

  const entregaInput = block.querySelector('.eval-entrega-input');
  const entregaScore = parseFloat(entregaInput?.value) || 0;

  // Recalcular por linha (cada linha = um membro)
  block.querySelectorAll('tbody tr').forEach(row => {
    let planRowTotal = 0;
    row.querySelectorAll('.eval-score-input[data-section="planejamento"]').forEach(inp => {
      planRowTotal += parseFloat(inp.value) || 0;
    });
    let devRowTotal = 0;
    row.querySelectorAll('.eval-score-input[data-section="desenvolvimento"]').forEach(inp => {
      devRowTotal += parseFloat(inp.value) || 0;
    });

    const planCell = row.querySelector('.eval-total[data-section="planejamento"]');
    if (planCell) planCell.textContent = planRowTotal.toFixed(1);

    const devCell = row.querySelector('.eval-total[data-section="desenvolvimento"]');
    if (devCell) devCell.textContent = devRowTotal.toFixed(1);

    const indInput = row.querySelector('.eval-individual-input');
    const indScore = parseFloat(indInput?.value) || 0;

    const notaCell = row.querySelector('.eval-nota');
    if (notaCell) notaCell.textContent = (planRowTotal + devRowTotal + entregaScore + indScore).toFixed(1);
  });
}

function attachAvaliacaoEvents(container) {
  container.querySelectorAll(".eval-score-input").forEach(input => {
    input.addEventListener("change", () => {
      const max = parseFloat(input.max);
      const val = parseFloat(input.value) || 0;
      if (!isNaN(max) && val > max) input.value = max;
      if (val < 0) input.value = 0;
      updateProjectCalculations(input.dataset.pid, container);
    });
    input.addEventListener("blur", async () => {
      const actId = input.dataset.actId;
      const memberName = input.dataset.member;
      const score = Math.max(0, parseFloat(input.value) || 0);
      try {
        await apiFetch(`/api/eval/activities/${actId}/scores`, {
          method: "PATCH",
          body: JSON.stringify({ member_name: memberName, score })
        });
        updateProjectCalculations(input.dataset.pid, container);
      } catch (err) { console.error("Erro ao salvar nota:", err); }
    });
  });

  container.querySelectorAll(".eval-entrega-input").forEach(input => {
    input.addEventListener("change", () => {
      const val = Math.min(7, Math.max(0, parseFloat(input.value) || 0));
      input.value = val;
      updateProjectCalculations(input.dataset.pid, container);
    });
    input.addEventListener("blur", async () => {
      const pid = input.dataset.pid;
      const score = Math.min(7, Math.max(0, parseFloat(input.value) || 0));
      try {
        await apiFetch(`/api/eval/${pid}/meta`, { method: "PATCH", body: JSON.stringify({ entrega_score: score }) });
        updateProjectCalculations(pid, container);
      } catch (err) { console.error(err); }
    });
  });

  container.querySelectorAll(".eval-individual-input").forEach(input => {
    input.addEventListener("change", () => {
      updateProjectCalculations(input.dataset.pid, container);
    });
    input.addEventListener("blur", async () => {
      const pid = input.dataset.pid;
      const memberName = input.dataset.member;
      const score = Math.max(0, parseFloat(input.value) || 0);
      try {
        await apiFetch(`/api/eval/${pid}/individual`, { method: "PATCH", body: JSON.stringify({ member_name: memberName, score }) });
        updateProjectCalculations(pid, container);
      } catch (err) { console.error(err); }
    });
  });

  container.querySelectorAll(".eval-obs-input").forEach(textarea => {
    let _obsTimer = null;
    textarea.addEventListener("input", () => {
      clearTimeout(_obsTimer);
      _obsTimer = setTimeout(async () => {
        const pid = textarea.dataset.pid;
        try {
          await apiFetch(`/api/eval/${pid}/meta`, { method: "PATCH", body: JSON.stringify({ observacoes: textarea.value }) });
        } catch (err) { console.error(err); }
      }, 1000);
    });
  });

  container.querySelectorAll(".eval-add-act-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const sectionDiv = btn.closest(".eval-section-add");
      const pid = sectionDiv.dataset.pid;
      const section = sectionDiv.dataset.section;
      const form = document.getElementById(`eval-add-form-${pid}`);
      if (form) {
        form.classList.remove("hidden");
        form.dataset.section = section;
        form.querySelector(".eval-add-name").value = "";
        form.querySelector(".eval-add-maxpts").value = "1";
        form.querySelector(".eval-add-name").focus();
      }
    });
  });

  container.querySelectorAll(".eval-add-confirm").forEach(btn => {
    btn.addEventListener("click", async () => {
      const form = btn.closest(".eval-add-form");
      const pid = form.closest(".eval-project-block").dataset.pid;
      const section = form.dataset.section;
      const name = form.querySelector(".eval-add-name").value.trim();
      const maxPts = parseFloat(form.querySelector(".eval-add-maxpts").value) || 1;
      if (!name) { alert("Nome da atividade é obrigatório"); return; }
      try {
        await apiFetch(`/api/eval/${pid}/activities`, {
          method: "POST",
          body: JSON.stringify({ section, name, max_pts: maxPts })
        });
        await renderAvaliacao();
      } catch (err) { alert(`Erro: ${err.message}`); }
    });
  });

  container.querySelectorAll(".eval-add-cancel").forEach(btn => {
    btn.addEventListener("click", () => {
      btn.closest(".eval-add-form").classList.add("hidden");
    });
  });

  container.querySelectorAll(".eval-del-act").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm("Remover esta atividade e suas notas?")) return;
      const actId = btn.dataset.actId;
      try {
        await apiFetch(`/api/eval/activities/${actId}`, { method: "DELETE" });
        await renderAvaliacao();
      } catch (err) { alert(`Erro: ${err.message}`); }
    });
  });
}

// ── Boot ──────────────────────────────────────────────────
bootSession();
