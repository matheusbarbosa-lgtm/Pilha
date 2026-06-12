// ════════════════════════════════════════════════════════════════════════
//  Integração GitHub — primeira versão (status, repositórios, eventos)
// ════════════════════════════════════════════════════════════════════════

let _ghRepos = [];

async function loadGithubIntegration() {
  await Promise.all([_loadGhStatus(), _loadGhRepos(), _loadGhEvents(), _loadGhLinks()]);
  _populateGhProjectSelect();
}

function _ghIsStaff() {
  return state.currentUser?.role === "professor" || Boolean(state.currentUser?.isAdmin);
}

// Lista os vínculos repo↔projeto (com botão desvincular para professor/ADM)
async function _loadGhLinks() {
  const el = document.querySelector("#integ-links-list");
  if (!el) return;
  let links = [];
  try { links = await apiFetch("/api/integrations/github/links"); } catch (_) { links = []; }
  const staff = _ghIsStaff();
  el.innerHTML = links.length
    ? `<div class="integ-links-title">Repositórios vinculados</div>` + links.map((l) => `
        <div class="integ-link-item">
          <span class="integ-link-info">
            <strong>${escapeHtml(l.repoFullName || "—")}</strong>
            <small>→ ${escapeHtml(l.projectName || "")}${l.linkedByName ? ` · por ${escapeHtml(l.linkedByName)}` : ""}</small>
          </span>
          ${staff ? `<button class="btn-link integ-unlink" data-link-id="${l.id}" data-repo="${escapeHtml(l.repoFullName || "")}" data-proj="${escapeHtml(l.projectName || "")}">Desvincular</button>`
                  : (l.isMine ? `<span class="integ-link-locked">🔒 vinculado</span>` : "")}
        </div>`).join("")
    : "";

  el.querySelectorAll(".integ-unlink").forEach((b) => {
    b.addEventListener("click", async () => {
      if (!confirm(`Desvincular o repositório "${b.dataset.repo}" do projeto "${b.dataset.proj}"?\n\nO aluno poderá vincular novamente depois.`)) return;
      try {
        await apiFetch(`/api/integrations/github/links/${b.dataset.linkId}`, { method: "DELETE" });
        _loadGhLinks();
      } catch (err) { alert(err.message); }
    });
  });
}

async function _loadGhStatus() {
  const dot = document.querySelector("#integ-status");
  const txt = document.querySelector("#integ-status-text");
  const hint = document.querySelector("#integ-hint");
  const btn = document.querySelector("#integ-connect-btn");
  if (!txt) return;
  try {
    const s = await apiFetch("/api/integrations/github");
    if (s.connected) {
      dot.className = "integ-status connected";
      txt.textContent = s.account ? `Conectado — @${s.account}` : "Conectado";
      if (btn) btn.textContent = "Reconfigurar";
      if (hint) hint.textContent = "";
    } else {
      dot.className = "integ-status";
      txt.textContent = "Não conectado";
      if (btn) btn.textContent = "Conectar GitHub";
      if (hint) hint.textContent = s.configured ? "" : "GitHub App ainda não configurado no servidor (.env).";
    }
  } catch (err) {
    txt.textContent = "Erro ao carregar status";
    if (hint) hint.textContent = err.message || "";
  }
}

async function _loadGhRepos() {
  const listEl = document.querySelector("#integ-repos-list");
  const repoSel = document.querySelector("#integ-link-repo");
  if (!listEl) return;
  try {
    _ghRepos = await apiFetch("/api/integrations/github/repositories");
  } catch (_) { _ghRepos = []; }

  listEl.innerHTML = _ghRepos.length
    ? _ghRepos.map((r) => `
        <div class="integ-repo">
          <span class="integ-repo-name">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.5 2.5 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.5 2.5 0 0 1 4.5 9h8Z"/></svg>
            ${escapeHtml(r.full_name || r.name || "—")}
          </span>
          ${r.private ? `<span class="integ-badge">privado</span>` : `<span class="integ-badge public">público</span>`}
          ${r.html_url ? `<a href="${escapeHtml(r.html_url)}" target="_blank" rel="noopener" class="integ-repo-link">abrir ↗</a>` : ""}
        </div>`).join("")
    : `<p class="integ-empty">Nenhum repositório disponível ainda. Conecte o GitHub e instale o app nos repositórios desejados.</p>`;

  if (repoSel) {
    repoSel.innerHTML = _ghRepos.length
      ? _ghRepos.map((r) => `<option value="${r.id}">${escapeHtml(r.full_name || r.name)}</option>`).join("")
      : `<option value="">Nenhum repositório</option>`;
  }
}

async function _loadGhEvents() {
  const el = document.querySelector("#integ-events-list");
  if (!el) return;
  let rows = [];
  try { rows = await apiFetch("/api/integrations/github/events"); } catch (_) { rows = []; }
  el.innerHTML = rows.length
    ? rows.map((e) => {
        const dt = e.created_at ? new Date(e.created_at.replace(" ", "T") + "Z").toLocaleString("pt-BR") : "";
        return `
        <div class="integ-event">
          <span class="integ-event-type">${escapeHtml(e.event_type || "evento")}${e.action ? ` · ${escapeHtml(e.action)}` : ""}</span>
          <span class="integ-event-repo">${escapeHtml(e.repository_full_name || "—")}</span>
          <span class="integ-event-date">${dt}</span>
        </div>`;
      }).join("")
    : `<p class="integ-empty">Nenhum evento recebido ainda.</p>`;
}

function _populateGhProjectSelect() {
  const projSel = document.querySelector("#integ-link-project");
  if (!projSel) return;
  const projects = state.projects || [];
  projSel.innerHTML = projects.length
    ? projects.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("")
    : `<option value="">Nenhum projeto</option>`;
}

// ── Bloco de contribuições do GitHub (perfil / modal de membro) ───────────
async function renderGithubContributions(userId, container, opts = {}) {
  if (!container) return;
  container.innerHTML = `<div class="gh-stats-loading">Carregando contribuições…</div>`;
  let d;
  try { d = await apiFetch(`/api/users/${userId}/contributions`); }
  catch (e) { container.innerHTML = `<div class="gh-stats-notice">Não foi possível carregar as contribuições.</div>`; return; }

  const metric = (label, val, cls = "") =>
    `<div class="gh-metric ${cls}"><span class="gh-metric-val">${val == null ? 0 : val}</span><span class="gh-metric-label">${label}</span></div>`;

  // erro/diagnóstico (vem em d.error OU d.githubError dependendo do caminho)
  const err = d.error || d.githubError || null;
  const ERR_MSG = {
    sem_login: "Sem usuário do GitHub vinculado a esta conta.",
    app_nao_configurado: "Integração GitHub ainda não configurada no servidor (.env).",
    sem_repo_vinculado: "Você ainda não vinculou um repositório a um projeto (vá em Integrações → Vincular ao projeto).",
    sem_token: "Não foi possível autenticar no GitHub (verifique APP_ID / private key).",
    limite_ou_permissao: "Sem permissão no repositório ou limite da API atingido. Confira se o app está instalado no repo.",
    erro_api: "Erro ao consultar a API do GitHub.",
    falha_calculo: "Falha ao calcular as contribuições.",
  };

  let notice = "";
  if (err) {
    const canDefine = (err === "sem_login") && opts.canEdit;
    notice = `<div class="gh-stats-notice">${escapeHtml(ERR_MSG[err] || String(err))}${canDefine ? ` <button class="btn-link" data-set-gh="${userId}">Definir usuário</button>` : ""}</div>`;
  } else if (d.githubLogin && (d.commits || 0) + (d.prsOpened || 0) + (d.linesAdded || 0) === 0) {
    // sem erro, mas tudo zerado → provável divergência de login
    notice = `<div class="gh-stats-notice">Nenhuma atividade encontrada este mês para <strong>@${escapeHtml(d.githubLogin)}</strong>. Confira se esse é o mesmo usuário que aparece como <em>autor dos commits</em> no GitHub.${opts.canEdit ? ` <button class="btn-link" data-set-gh="${userId}">Alterar usuário</button>` : ""}</div>`;
  }

  const reposInfo = (d.repos && d.repos.length) ? ` · repos: ${d.repos.map(escapeHtml).join(", ")}` : "";
  const cachedInfo = d.cached && d.computedAt ? ` · atualizado ${new Date(String(d.computedAt).replace(" ", "T") + "Z").toLocaleString("pt-BR")}` : "";

  container.innerHTML = `
    <div class="gh-stats-head">
      <span class="gh-stats-title">📊 Contribuições${d.period ? ` · ${escapeHtml(d.period)}` : ""}${d.githubLogin ? ` · @${escapeHtml(d.githubLogin)}` : ""}${reposInfo}${cachedInfo}</span>
      <button class="btn-link" data-refresh-gh="${userId}">Atualizar</button>
    </div>
    ${notice}
    <div class="gh-stats-grid">
      ${metric("Commits no mês", d.commits)}
      ${metric("PRs abertos", d.prsOpened)}
      ${metric("PRs mergeados", d.prsMerged)}
      ${metric("Reviews feitas", d.reviews)}
      ${metric("Tarefas concluídas", d.tasksDone, "gh-metric-task")}
      ${metric("Arquivos alterados", d.filesChanged)}
      ${metric("Linhas adicionadas", "+" + (d.linesAdded || 0), "gh-added")}
      ${metric("Linhas removidas", "−" + (d.linesRemoved || 0), "gh-removed")}
    </div>`;

  container.querySelector("[data-refresh-gh]")?.addEventListener("click", async (e) => {
    e.target.textContent = "Atualizando…";
    try { await apiFetch(`/api/users/${userId}/contributions?refresh=1`); } catch (_) {}
    renderGithubContributions(userId, container, opts);
  });
  container.querySelector("[data-set-gh]")?.addEventListener("click", async () => {
    const login = prompt("Usuário do GitHub (ex: joaovitor):");
    if (login == null) return;
    try {
      await apiFetch(`/api/users/${userId}/github-login`, { method: "PATCH", body: JSON.stringify({ githubLogin: login }) });
      renderGithubContributions(userId, container, opts);
    } catch (err) { alert(err.message); }
  });
}

// ── Eventos da UI (ligados uma vez) ───────────────────────────────────────
(function initGithubIntegration() {
  document.querySelector("#integ-connect-btn")?.addEventListener("click", async () => {
    const hint = document.querySelector("#integ-hint");
    try {
      const d = await apiFetch("/api/integrations/github/connect");
      if (d.installUrl) { window.location.href = d.installUrl; }
    } catch (err) {
      if (hint) hint.textContent = err.message || "Não foi possível iniciar a conexão.";
    }
  });

  document.querySelector("#integ-link-btn")?.addEventListener("click", async () => {
    const projSel = document.querySelector("#integ-link-project");
    const repoSel = document.querySelector("#integ-link-repo");
    const projectId = projSel?.value;
    const repoId = repoSel?.value;
    if (!projectId || !repoId) { alert("Selecione um projeto e um repositório."); return; }
    const repoName = repoSel.options[repoSel.selectedIndex]?.text || "este repositório";
    const projName = projSel.options[projSel.selectedIndex]?.text || "este projeto";

    const msg = `Tem certeza que você quer mesmo vincular "${repoName}" ao projeto "${projName}"?\n\n`
      + `Atenção: após confirmar, qualquer mudança só poderá ser feita mediante pedido ao professor.`;
    if (!confirm(msg)) return;

    try {
      await apiFetch(`/api/integrations/github/projects/${projectId}/link`, {
        method: "POST",
        body: JSON.stringify({ githubRepositoryId: Number(repoId) })
      });
      alert("Repositório vinculado ao projeto com sucesso!");
      _loadGhLinks();
    } catch (err) { alert(err.message); }
  });
})();
