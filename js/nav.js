// ── Router ────────────────────────────────────────────────
// Mapeia viewId → path da URL e vice-versa
const ROUTE_MAP = {
  "dashboard":  "/dashboard",
  "projetos":   "/projetos",
  "scrum":      "/scrum",
  "kanban":     "/kanban",
  "doc-tap":    "/tap",
  "doc-pi":     "/pi",
  "turmas":     "/turmas",
  "chat":       "/chat",
  "equipes":    "/equipes",
  "avaliacao":  "/avaliacao",
  "admincmd":   "/admin",
  "superadm":   "/superadmin",
};
const PATH_TO_VIEW = Object.fromEntries(Object.entries(ROUTE_MAP).map(([v, p]) => [p, v]));

function navigateTo(viewId, pushHistory = true) {
  const btn = [...navItems].find((b) => b.dataset.view === viewId);
  if (!btn || btn.classList.contains("hidden")) return;

  navItems.forEach((n) => n.classList.remove("active"));
  views.forEach((v) => v.classList.remove("active"));
  btn.classList.add("active");
  document.querySelector(`#${viewId}`)?.classList.add("active");
  viewTitle.textContent = btn.querySelector(".nav-label")?.textContent.trim() || btn.textContent.trim();

  if (viewId === "equipes") {
    loadEquipes();
    if (window._pendingProjectDetail) {
      const pid = window._pendingProjectDetail;
      window._pendingProjectDetail = null;
      // Aguarda o loadEquipes (que é async) antes de abrir o detalhe
      setTimeout(() => openProjectDetail(pid), 300);
    }
  }
  if (viewId === "turmas") loadTurmas();
  if (viewId === "chat") loadChatTurmaList();
  if (viewId === "avaliacao") renderAvaliacao();
  if (viewId === "superadm") loadSuperAdm();

  if (pushHistory) {
    const url = ROUTE_MAP[viewId] || "/dashboard";
    history.pushState({ viewId }, "", url);
  }
}

function resolveCurrentPath() {
  const p = window.location.pathname;
  if (p === "/" || p === "") return "dashboard";
  // Rota dinâmica /projetos/:id
  const projectMatch = p.match(/^\/projetos\/(\d+)$/);
  if (projectMatch) {
    // Abre o detalhe depois do boot
    window._pendingProjectDetail = Number(projectMatch[1]);
    return "equipes";
  }
  return PATH_TO_VIEW[p] || "dashboard";
}

// Substitui o antigo navItems.forEach
navItems.forEach((btn) => {
  btn.addEventListener("click", () => navigateTo(btn.dataset.view));
});

// Botão voltar/avançar do browser
window.addEventListener("popstate", (e) => {
  const viewId = e.state?.viewId || resolveCurrentPath();
  if (viewId === "project-detail" && e.state?.projectId) {
    openProjectDetail(e.state.projectId);
    return;
  }
  navigateTo(viewId, false);
});

// Expõe para outros módulos usarem após login
window._navigateTo = navigateTo;
window._resolveCurrentPath = resolveCurrentPath;

// ── Logout ────────────────────────────────────────────────
logoutBtn.addEventListener("click", async () => {
  if (state.chatInterval) { clearInterval(state.chatInterval); state.chatInterval = null; }
  try {
    await apiFetch("/api/auth/logout", { method: "POST", body: "{}" });
  } catch (_err) {
  } finally {
    clearSession();
  }
});

// ── Tutorial ───────────────────────────────────────────────
const TUTORIAL_STEPS = [
  { title: "Bem-vindo ao PILHA!", icon: "🎓", text: "O PILHA é o sistema de gestão ágil da UNIPAM. Aqui você organiza projetos, sprints e tarefas com metodologia Scrum." },
  { title: "Seu Dashboard", icon: "📅", text: "O Dashboard mostra o calendário com prazos destacados, um mini-kanban das tarefas e as próximas entregas do grupo." },
  { title: "Quadro de Tarefas (Kanban)", icon: "📋", text: "No Kanban você cria, move e visualiza tarefas em 3 colunas: Backlog → Fazendo → Concluído. Arraste os cards ou clique em Detalhes." },
  { title: "Documentos do Projeto", icon: "📋", text: "Em Projetos você pode preencher o TAP (Termo de Abertura) e o Projeto de Intervenção junto com sua equipe." },
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
