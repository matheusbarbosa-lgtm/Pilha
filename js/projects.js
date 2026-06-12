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
        const stLabel = { nao_iniciado: "Não iniciado", em_progresso: "Em progresso", concluido: "Concluído", todo: "Não iniciado", backlog: "Não iniciado", doing: "Em progresso", review: "Em progresso", done: "Concluído" }[t.status] || (statusMap[t.status] || t.status);
        return `
        <li class="task-list-item" data-open-task="${t.id}" title="Abrir tarefa no Kanban">
          <strong>${escapeHtml(t.title)}</strong>
          <div class="meta">
            <span class="badge">${scope}</span>

            <span>Responsavel: ${escapeHtml(t.assignee)}</span>
            <span>Projeto: ${escapeHtml(projectById(t.projectId)?.name || "-")}</span>
            <span>Entrega: ${dateLabel(t.dueDate)}</span>
            <span>Status: ${escapeHtml(stLabel)}</span>
            ${cfHtml}
          </div>
        </li>
      `;
      })
      .join("") || "<li>Nenhuma tarefa encontrada.</li>";

  // Clicar numa tarefa abre o detalhe (delegação, ligada uma vez)
  if (taskList && !taskList._taskClickWired) {
    taskList._taskClickWired = true;
    taskList.addEventListener("click", (e) => {
      const li = e.target.closest("[data-open-task]");
      if (li && typeof openTaskDetail === "function") openTaskDetail(Number(li.dataset.openTask));
    });
  }
}

function renderSprints() {
  if (sprintCards) sprintCards.innerHTML = "";
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

function openEditTaskModal(taskId) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task || !editTaskForm) return;
  setAssigneeOptions(editTaskAssigneeSelect, task.projectId, task.assignee);

  editTaskForm.elements.taskId.value = task.id;
  editTaskForm.elements.title.value = task.title;
  editTaskForm.elements.assignee.value = task.assignee;
  editTaskForm.elements.dueDate.value = task.dueDate;

  editTaskForm.elements.urgency.value = task.urgency || "medium";
  renderCustomFieldInputs(editTaskCustomFields, task.projectId, task.customValues || {});
  editTaskModal.showModal();
}

// ── TAP / PI — Documentos do projeto ─────────────────────

function fillDocProjectSelects() {
  const projects = state.projects;
  const opts = projects.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");
  const tapSel = document.getElementById("tap-project-select");
  const piSel = document.getElementById("pi-project-select");
  if (tapSel) tapSel.innerHTML = opts;
  if (piSel) piSel.innerHTML = opts;
}

const TAP_FIELDS = ["1-1","1-2-a","1-2-b","1-2-c","1-2-d","1-3","1-4-inicio","1-4-fim","1-5","1-6","1-7","1-8","1-9"];
const PI_FIELDS  = ["instituicao","curso","disciplina","professor","autor-a","autor-b","autor-c","autor-d","titulo","subtitulo","introducao","problema","justificativa","obj-geral","obj-especificos","referencial","metodologia","referencias"];
const DOC_EXTRA_STUDENTS_KEY = "extraStudents";

function normalizeDocExtraStudents(value) {
  return Array.isArray(value)
    ? value.map((name) => String(name || "").trim()).filter(Boolean)
    : [];
}

function renumberDocExtraStudents(type) {
  const container = document.getElementById(`${type}-extra-students`);
  if (!container) return;
  container.querySelectorAll(".doc-extra-student-input").forEach((input, index) => {
    input.placeholder = `Aluno adicional ${index + 1}`;
  });
}

function setDocTeamEditable(type, editable) {
  const section = document.querySelector(`[data-doc-team-section="${type}"]`);
  if (!section) return;
  const addBtn = section.querySelector(".doc-add-student-btn");
  if (addBtn) {
    addBtn.disabled = !editable;
    addBtn.classList.toggle("hidden", !editable);
  }
  section.querySelectorAll(".doc-remove-student-btn").forEach((btn) => {
    btn.disabled = !editable;
    btn.classList.toggle("hidden", !editable);
  });
}

function addDocExtraStudentField(type, value = "", options = {}) {
  const container = document.getElementById(`${type}-extra-students`);
  if (!container) return null;

  const row = document.createElement("div");
  row.className = "doc-extra-student-row";

  const input = document.createElement("input");
  input.className = "doc-field doc-extra-student-input";
  input.type = "text";
  input.value = value;
  input.setAttribute("aria-label", "Aluno adicional");

  const removeBtn = document.createElement("button");
  removeBtn.className = "btn-secondary btn-sm doc-remove-student-btn";
  removeBtn.type = "button";
  removeBtn.textContent = "Remover";
  removeBtn.addEventListener("click", () => {
    row.remove();
    renumberDocExtraStudents(type);
  });

  row.append(input, removeBtn);
  container.appendChild(row);
  renumberDocExtraStudents(type);

  const addBtn = document.querySelector(`[data-doc-team-section="${type}"] .doc-add-student-btn`);
  setDocTeamEditable(type, !addBtn?.disabled);
  if (options.focus) input.focus();
  return input;
}

function renderDocExtraStudents(type, students) {
  const container = document.getElementById(`${type}-extra-students`);
  if (!container) return;
  container.innerHTML = "";
  normalizeDocExtraStudents(students).forEach((name) => addDocExtraStudentField(type, name));
  renumberDocExtraStudents(type);
}

function collectDocExtraStudents(type) {
  const container = document.getElementById(`${type}-extra-students`);
  if (!container) return [];
  return [...container.querySelectorAll(".doc-extra-student-input")]
    .map((input) => input.value.trim())
    .filter(Boolean);
}

function clearDocPrintMirrors(type) {
  const section = document.getElementById(`doc-${type}`);
  if (!section) return;
  section.querySelectorAll(".doc-print-value").forEach((el) => el.remove());
  section.querySelectorAll(".doc-has-print-value").forEach((el) => el.classList.remove("doc-has-print-value"));
  section.querySelectorAll("textarea[data-print-original-height]").forEach((textarea) => {
    textarea.style.height = textarea.dataset.printOriginalHeight;
    delete textarea.dataset.printOriginalHeight;
  });
}

function prepareDocForPrint(type) {
  const section = document.getElementById(`doc-${type}`);
  if (!section) return;
  clearDocPrintMirrors(type);

  section.querySelectorAll("input.doc-field, input.doc-field-date, input.doc-field-inline, textarea.doc-field").forEach((field) => {
    if (field.type === "checkbox" || field.type === "radio" || field.type === "hidden") return;
    const mirror = document.createElement("div");
    mirror.className = "doc-print-value";
    if (field.tagName === "TEXTAREA") mirror.classList.add("multiline");
    if (field.classList.contains("doc-field-inline")) mirror.classList.add("inline");
    mirror.textContent = field.value || "";
    field.classList.add("doc-has-print-value");
    field.insertAdjacentElement("afterend", mirror);
  });

  section.querySelectorAll("textarea.doc-field").forEach((textarea) => {
    textarea.dataset.printOriginalHeight = textarea.style.height || "";
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight + 2}px`;
  });
}

function printDoc(type) {
  prepareDocForPrint(type);
  const printClass = `print-${type}`;
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    document.body.classList.remove("print-doc", printClass);
    clearDocPrintMirrors(type);
    window.removeEventListener("afterprint", cleanup);
  };

  document.body.classList.add("print-doc", printClass);
  window.addEventListener("afterprint", cleanup, { once: true });
  setTimeout(() => {
    try {
      window.print();
    } catch (err) {
      cleanup();
      alert("Erro ao abrir impressão: " + err.message);
    }
  }, 0);
}

async function loadDoc(type) {
  const sel = document.getElementById(`${type}-project-select`);
  const pid = sel?.value;
  if (!pid) return;
  try {
    const data = await apiFetch(`/api/projects/${pid}/docs/${type}`);
    const content = data.content || {};
    const fields = type === "tap" ? TAP_FIELDS : PI_FIELDS;
    for (const f of fields) {
      const el = document.getElementById(`${type}-${f}`);
      if (el) el.value = content[f] !== undefined ? content[f] : (el.defaultValue || "");
    }
    renderDocExtraStudents(type, content[DOC_EXTRA_STUDENTS_KEY]);
    // PI cronograma checkboxes
    if (type === "pi") {
      const rows = document.querySelectorAll("#pi-cronograma-tbody tr");
      const cronograma = Array.isArray(content.cronograma) ? content.cronograma : [];
      rows.forEach((tableRow, ri) => {
        const cells = tableRow.querySelectorAll("input");
        const row = cronograma[ri] || [];
        cells[0].value = row[0] || "";
        for (let ci = 1; ci < cells.length; ci++) cells[ci].checked = !!row[ci];
      });
    }
    // Atualiza banner de status e botões de aprovação
    updateDocStatusUI(
      type,
      data.approvalStatus || data.approval_status || "draft",
      data.approvedBy || data.approved_by,
      data.rejectedReason || data.rejected_reason
    );
  } catch (_) {}
}

function updateDocStatusUI(type, status, approvedBy, rejectedReason) {
  const isProf = state.currentUser?.role === "professor" || state.currentUser?.isAdmin;
  const banner    = document.getElementById(`${type}-status-banner`);
  const submitBtn = document.getElementById(`${type}-submit-btn`);
  const approveBtn = document.getElementById(`${type}-approve-btn`);
  const rejectBtn  = document.getElementById(`${type}-reject-btn`);
  const pdfBtn     = document.getElementById(`${type}-pdf-btn`);

  if (banner) {
    banner.className = `doc-status-banner ${status}`;
    const statusMsg = {
      draft:     "",
      submitted: "⏳ Aguardando revisão do professor.",
      approved:  `✅ Aprovado por ${escapeHtml(approvedBy || "professor")}.`,
      rejected:  `❌ Devolvido para correção${rejectedReason ? ": " + escapeHtml(rejectedReason) : ""}.`
    };
    banner.textContent = statusMsg[status] || "";
    banner.classList.toggle("hidden", !statusMsg[status]);
  }

  if (submitBtn) submitBtn.classList.toggle("hidden", isProf || status === "submitted" || status === "approved");
  if (approveBtn) approveBtn.classList.toggle("hidden", !isProf || status === "approved");
  if (rejectBtn)  rejectBtn.classList.toggle("hidden",  !isProf || status === "draft");
  if (pdfBtn) pdfBtn.style.display = "";

  // Campos são somente-leitura se aprovado
  const section = document.getElementById(`doc-${type}`);
  const readOnly = status === "approved" && !isProf;
  if (section) {
    section.querySelectorAll(".doc-field, .doc-field-date, .doc-field-inline").forEach((el) => {
      el.disabled = readOnly;
    });
  }
  setDocTeamEditable(type, !readOnly);
}

// ── Chat do documento ─────────────────────────────────────
let _docChatProjectId = null;
let _docChatType = null;

async function openDocChat(type) {
  const sel = document.getElementById(`${type}-project-select`);
  const pid = sel?.value;
  if (!pid) { alert("Selecione um projeto primeiro."); return; }
  _docChatProjectId = pid;
  _docChatType = type;

  const modal = document.getElementById("doc-chat-modal");
  const title = document.getElementById("doc-chat-title");
  if (title) title.textContent = `Chat de revisão — ${type.toUpperCase()}`;

  await loadDocChatMessages();
  modal?.showModal();
}

async function loadDocChatMessages() {
  const el = document.getElementById("doc-chat-messages");
  if (!el || !_docChatProjectId || !_docChatType) return;
  try {
    const rows = await apiFetch(`/api/projects/${_docChatProjectId}/docs/${_docChatType}/comments`);
    const myName = state.currentUser?.name;
    el.innerHTML = rows.map((m) => {
      const isMe = m.user_name === myName;
      const dt = new Date(m.created_at).toLocaleString("pt-BR", { day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit" });
      return `<div style="display:flex;flex-direction:column;align-items:${isMe ? "flex-end" : "flex-start"}">
        <div class="bubble-meta">${isMe ? "" : escapeHtml(m.user_name) + " · "}${dt}</div>
        <div class="chat-bubble ${isMe ? "bubble-me" : "bubble-other"}">${escapeHtml(m.content)}</div>
      </div>`;
    }).join("") || `<p style="color:var(--muted);text-align:center;padding:1rem">Sem mensagens ainda. Inicie a conversa!</p>`;
    el.scrollTop = el.scrollHeight;
  } catch (_) {}
}

document.getElementById("doc-chat-close")?.addEventListener("click", () => {
  document.getElementById("doc-chat-modal")?.close();
  _docChatProjectId = null;
  _docChatType = null;
});

document.getElementById("doc-chat-send")?.addEventListener("click", async () => {
  const inp = document.getElementById("doc-chat-input");
  const content = inp?.value.trim();
  if (!content || !_docChatProjectId || !_docChatType) return;
  try {
    await apiFetch(`/api/projects/${_docChatProjectId}/docs/${_docChatType}/comments`, {
      method: "POST", body: JSON.stringify({ content })
    });
    inp.value = "";
    await loadDocChatMessages();
  } catch (err) { alert(err.message); }
});

document.getElementById("doc-chat-input")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); document.getElementById("doc-chat-send")?.click(); }
});

// Botões de chat nos docs
document.querySelectorAll(".doc-chat-btn").forEach((btn) => {
  btn.addEventListener("click", () => openDocChat(btn.dataset.doc));
});

// Submit (aluno)
["tap","pi"].forEach((type) => {
  document.getElementById(`${type}-submit-btn`)?.addEventListener("click", async () => {
    const sel = document.getElementById(`${type}-project-select`);
    const pid = sel?.value;
    if (!pid) { alert("Selecione um projeto."); return; }
    if (!confirm("Enviar este documento para revisão do professor? O conteúdo será bloqueado para edição enquanto aguarda aprovação.")) return;
    try {
      await saveDoc(type);
      await apiFetch(`/api/projects/${pid}/docs/${type}/submit`, { method: "POST" });
      updateDocStatusUI(type, "submitted", null, null);
    } catch (err) { alert(err.message); }
  });

  document.getElementById(`${type}-approve-btn`)?.addEventListener("click", async () => {
    const sel = document.getElementById(`${type}-project-select`);
    const pid = sel?.value;
    if (!pid) return;
    if (!confirm(`Aprovar o ${type.toUpperCase()} deste grupo?`)) return;
    try {
      await apiFetch(`/api/projects/${pid}/docs/${type}/approve`, { method: "POST" });
      updateDocStatusUI(type, "approved", state.currentUser?.name, null);
    } catch (err) { alert(err.message); }
  });

  document.getElementById(`${type}-reject-btn`)?.addEventListener("click", async () => {
    const sel = document.getElementById(`${type}-project-select`);
    const pid = sel?.value;
    if (!pid) return;
    const reason = prompt("Motivo da devolução (aparecerá para o grupo):");
    if (reason === null) return;
    try {
      await apiFetch(`/api/projects/${pid}/docs/${type}/reject`, { method: "POST", body: JSON.stringify({ reason }) });
      updateDocStatusUI(type, "rejected", null, reason);
    } catch (err) { alert(err.message); }
  });

  document.getElementById(`${type}-pdf-btn`)?.addEventListener("click", () => printDoc(type));
});

document.querySelectorAll(".doc-add-student-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (btn.disabled) return;
    addDocExtraStudentField(btn.dataset.doc, "", { focus: true });
  });
});

async function saveDoc(type) {
  const sel = document.getElementById(`${type}-project-select`);
  const pid = sel?.value;
  if (!pid) { alert("Selecione um projeto."); return; }
  const fields = type === "tap" ? TAP_FIELDS : PI_FIELDS;
  const content = {};
  for (const f of fields) {
    const el = document.getElementById(`${type}-${f}`);
    if (el) content[f] = el.value;
  }
  content[DOC_EXTRA_STUDENTS_KEY] = collectDocExtraStudents(type);
  if (type === "pi") {
    const rows = document.querySelectorAll("#pi-cronograma-tbody tr");
    content.cronograma = [...rows].map(row => {
      const cells = row.querySelectorAll("input");
      return [cells[0]?.value || "", ...[...cells].slice(1).map(c => c.checked)];
    });
  }
  try {
    await apiFetch(`/api/projects/${pid}/docs/${type}`, { method: "PUT", body: JSON.stringify({ content }) });
    const btn = document.getElementById(`${type}-save-btn`);
    if (btn) { btn.textContent = "Salvo!"; setTimeout(() => { btn.textContent = "Salvar"; }, 1500); }
  } catch (err) { alert("Erro ao salvar: " + err.message); }
}

document.getElementById("tap-save-btn")?.addEventListener("click", () => saveDoc("tap"));
document.getElementById("pi-save-btn")?.addEventListener("click", () => saveDoc("pi"));
document.getElementById("tap-project-select")?.addEventListener("change", () => loadDoc("tap"));
document.getElementById("pi-project-select")?.addEventListener("change", () => loadDoc("pi"));

// Botões FAÇA O TAP / PROJETO INTERVEN nos cards
document.querySelectorAll(".doc-open-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const target = btn.dataset.viewTarget;
    document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
    document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
    document.getElementById(target)?.classList.add("active");
    const type = btn.dataset.doc;
    fillDocProjectSelects();
    // auto-select first project and load
    const sel = document.getElementById(`${type}-project-select`);
    if (sel && state.projects.length) { sel.value = state.projects[0].id; loadDoc(type); }
  });
});

// Botões ← Voltar
document.querySelectorAll(".doc-back-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const backView = btn.dataset.backView;
    document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
    document.getElementById(backView)?.classList.add("active");
    document.querySelector(`[data-view="${backView}"]`)?.classList.add("active");
  });
});

// ── Project modal handlers ────────────────────────────────
openProjectModalBtn?.addEventListener("click", async () => {
  projectModal?.showModal();
  // Popula o select de turmas a cada abertura
  const turmaSelect = document.getElementById("project-turma-select");
  if (turmaSelect) {
    try {
      const turmas = await apiFetch("/api/export/turmas");
      turmaSelect.innerHTML = '<option value="">Selecione a turma...</option>' +
        turmas.map(t => `<option value="${t.id}">${escapeHtml(t.label)}</option>`).join("");
    } catch (_) { /* mantém o select vazio se falhar */ }
  }
});
openSprintModalBtn?.addEventListener("click", () => sprintModal?.showModal());
openTaskModalBtn.addEventListener("click", () => taskModal.showModal());

// Botões "Cancelar" (data-close-dialog) — fecham o <dialog> mais próximo de forma confiável
document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-close-dialog]");
  if (!btn) return;
  const dlg = btn.closest("dialog");
  if (dlg) { try { dlg.close(); } catch (_) { dlg.removeAttribute("open"); } }
});
taskProjectSelect.addEventListener("change", () => {
  setAssigneeOptions(taskAssigneeSelect, taskProjectSelect.value, "Todos");
  renderCustomFieldInputs(taskCustomFields, taskProjectSelect.value);
});

taskProjectFilter.addEventListener("change", renderTaskList);
taskSearch.addEventListener("input", renderTaskList);

projectForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (event.submitter && event.submitter.value === "cancel") { projectForm.reset(); projectModal.close(); return; }
  const data = new FormData(projectForm);
  const members = String(data.get("members") || "")
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);
  const scrumRoles = buildScrumRolesByOrder(members);

  try {
    const turmaIdVal = Number(data.get("turmaId")) || undefined;
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
        startDate: String(data.get("startDate") || ""),
        turmaId: turmaIdVal
      })
    });

    projectModal.close();
    projectForm.reset();
    await refreshAndRender();
  } catch (err) {
    alert(err.message);
  }
});


taskForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  // Botão "Cancelar" (value="cancel") apenas fecha o modal
  if (event.submitter && event.submitter.value === "cancel") {
    state.pendingNewCardStatus = null;
    taskForm.reset();
    taskModal.close();
    return;
  }
  const data = new FormData(taskForm);

  const customValues = {};
  for (const [key, value] of data.entries()) {
    if (key.startsWith("cf_")) customValues[key.slice(3)] = value;
  }

  try {
    const created = await apiFetch("/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        projectId: String(data.get("projectId")),
        title: String(data.get("title")),
        assignee: String(data.get("assignee")),
        dueDate: String(data.get("dueDate")),
        startDate: String(data.get("startDate") || ""),
        priority: String(data.get("priority") || "normal"),
        description: String(data.get("description") || ""),
        customValues
      })
    });

    // Se o cartão foi criado a partir de uma coluna específica do Kanban,
    // aplica o status-alvo (o POST cria sempre como "nao_iniciado").
    if (state.pendingNewCardStatus && created?.id) {
      try {
        await apiFetch(`/api/tasks/${created.id}/status`, {
          method: "PATCH",
          body: JSON.stringify({ status: state.pendingNewCardStatus })
        });
      } catch (_) { /* status fica como padrão se falhar */ }
    }
    state.pendingNewCardStatus = null;

    taskModal.close();
    taskForm.reset();
    await refreshAndRender();
  } catch (err) {
    state.pendingNewCardStatus = null;
    alert(err.message);
  }
});

editTaskForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (event.submitter && event.submitter.value === "cancel") { editTaskModal.close(); return; }
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
        urgency: String(data.get("urgency") || "medium"),
        customValues
      })
    });

    editTaskModal.close();
    await refreshAndRender();
  } catch (err) {
    alert(err.message);
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
