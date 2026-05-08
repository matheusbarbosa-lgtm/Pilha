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
  turmas: [],
  chatTurmaId: null,
  chatInterval: null,
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


const openProjectModalBtn = document.querySelector("#open-project-modal");
const openSprintModalBtn = null;
const openTaskModalBtn = document.querySelector("#open-task-modal");

const projectModal = document.querySelector("#project-modal");
const projectForm = document.querySelector("#project-form");
const sprintModal = null;
const sprintForm = null;
const taskModal = document.querySelector("#task-modal");
const taskForm = document.querySelector("#task-form");
const taskProjectSelect = document.querySelector("#task-project-select");

const taskSprintSelect = null;
const taskAssigneeSelect = document.querySelector("#task-assignee-select");
const editTaskModal = document.querySelector("#edit-task-modal");
const editTaskForm = document.querySelector("#edit-task-form");
const editTaskSprintSelect = null;
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

// ── Detect pending invite / turma token on page load ─────
(function detectPendingInvite() {
  const url = new URL(window.location.href);
  const inviteToken = url.searchParams.get("invite");
  if (inviteToken) sessionStorage.setItem("pendingInvite", inviteToken);
  const turmaToken = url.searchParams.get("turma");
  if (turmaToken) sessionStorage.setItem("pendingTurmaToken", turmaToken);
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
const SESSION_TOKEN_KEY = "pilha_tab_token";

async function apiFetch(path, options = {}) {
  const tabToken = sessionStorage.getItem(SESSION_TOKEN_KEY);
  const headers = {
    "Content-Type": "application/json",
    ...(tabToken ? { "Authorization": `Bearer ${tabToken}` } : {}),
    ...(options.headers || {})
  };

  const response = await fetch(path, {
    credentials: "include",
    headers,
    ...options
  });

  // Salva token novo no sessionStorage desta aba (isolamento por aba)
  const newToken = response.headers.get("X-Auth-Token");
  if (newToken) sessionStorage.setItem(SESSION_TOKEN_KEY, newToken);

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body.error || `Erro HTTP ${response.status}`;
    const err = new Error(message);
    err.data = body;
    throw err;
  }

  return body;
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
  const [projects, tasks, students] = await Promise.all([
    apiFetch("/api/projects"),
    apiFetch("/api/tasks"),
    apiFetch("/api/students")
  ]);

  state.projects = projects;
  state.sprints = [];
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

  setAssigneeOptions(taskAssigneeSelect, taskProjectSelect.value || state.projects[0]?.id);

  if (cfProjectSelect) {
    cfProjectSelect.innerHTML = state.projects
      .map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`)
      .join("");
    renderCustomFieldsManager();
  }

  renderCustomFieldInputs(taskCustomFields, taskProjectSelect.value || state.projects[0]?.id);
}

// ── SCRUM_COLS constant ────────────────────────────────────
const SCRUM_COLS = [
  { key: "Product Owner",    label: "Product Owner",    badge: "po",  avatarClass: "po",   icon: "👑" },
  { key: "Scrum Master",     label: "Scrum Master",     badge: "sm",  avatarClass: "sm-c", icon: "🛡️" },
  { key: "Development Team", label: "Development Team", badge: "dev", avatarClass: "dev",  icon: "💻" },
  { key: "sem_papel",        label: "Sem papel",        badge: "sp",  avatarClass: "",      icon: "👤" }
];
