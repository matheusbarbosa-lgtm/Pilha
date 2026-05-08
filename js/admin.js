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

// ── Admin: Create Professor ────────────────────────────────
document.querySelector("#create-professor-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = new FormData(e.target);
  const payload = {
    name: String(data.get("name") || "").trim(),
    email: String(data.get("email") || "").trim(),
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

// ── Exportar Turma ────────────────────────────────────────
document.getElementById("btn-export-turma")?.addEventListener("click", () => {
  const select = document.getElementById("export-turma-select");
  const turma = select?.value?.trim();
  if (!turma) { alert("Selecione uma turma para exportar."); return; }
  window.location = `/api/export/grading/turma/${encodeURIComponent(turma)}`;
});

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
