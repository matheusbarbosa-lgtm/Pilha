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
            <a href="/api/export/grading/project/${pid}" class="btn-export-xlsx" title="Exportar planilha de avaliação deste grupo">⬇ Exportar Grupo</a>
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
                  ${planActHeaders || '<th class="eval-act-th eval-act-empty">—</th>'}
                  <th class="eval-th-total">Total</th>
                  ${devActHeaders || '<th class="eval-act-th eval-act-empty">—</th>'}
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

    // Populate turma dropdown from loaded projects
    const turmaSelect = document.getElementById("export-turma-select");
    if (turmaSelect) {
      const turmas = [...new Set(projects.map(p => (p.team || "").split(/\s*[-–]\s*/)[0].trim()).filter(Boolean))].sort();
      turmaSelect.innerHTML = '<option value="">Selecione a turma...</option>' +
        turmas.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("");
    }
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
