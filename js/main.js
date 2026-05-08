// ── renderByRole ──────────────────────────────────────────
function renderByRole() {
  const professor = isProfessor();
  if (openProjectModalBtn) openProjectModalBtn.classList.toggle("hidden", !professor);
  if (openSprintModalBtn) openSprintModalBtn.classList.toggle("hidden", !professor);
  if (adminNavItem) adminNavItem.classList.toggle("hidden", !isAdmin());
  const equipesNavItem = document.querySelector("#equipes-nav-item");
  if (equipesNavItem) equipesNavItem.classList.toggle("hidden", false); // todos veem equipes
  const turmasNavItem = document.querySelector("#turmas-nav-item");
  if (turmasNavItem) turmasNavItem.classList.toggle("hidden", !professor);
  const avaliacaoNavItem = document.querySelector("#avaliacao-nav-item");
  if (avaliacaoNavItem) avaliacaoNavItem.classList.toggle("hidden", !professor);
  const superadmNavItem = document.querySelector("#superadm-nav-item");
  if (superadmNavItem) superadmNavItem.classList.toggle("hidden", !isSuperAdmin());

  // Popup de perfil incompleto para professor
  if (professor && state.currentUser && !state.currentUser.profileComplete) {
    const popup = document.getElementById("prof-profile-popup");
    if (popup && !localStorage.getItem("prof_popup_dismissed")) {
      popup.classList.remove("hidden");
    }
  }
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
    if (!isProfessor()) {
      const equipesView = document.querySelector("#equipes");
      if (equipesView?.classList.contains("active")) {
        document.querySelector('[data-view="dashboard"]')?.click();
      }
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
  const projectsListCard = document.getElementById("projects-list-card");
  if (projectsListCard) projectsListCard.classList.toggle("hidden", !professor);

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
  renderStats();
  fillDocProjectSelects();
  renderProjects();
  renderTaskList();
  renderSprints();
  renderScrumTeam();
  renderKanban();
  renderCustomFieldsManager();
  // Popula tarefa pai no modal de nova tarefa
  const parentSel = document.getElementById("task-parent-select");
  if (parentSel) {
    parentSel.innerHTML = `<option value="">— nenhuma —</option>` +
      state.tasks.filter((t) => !t.parentTaskId).map((t) =>
        `<option value="${t.id}">${escapeHtml(t.title)}</option>`
      ).join("");
  }
}

async function refreshAndRender() {
  await loadData();
  renderAll();
}

// ── Boot ──────────────────────────────────────────────────
if (!_isResetFlow) bootSession();
