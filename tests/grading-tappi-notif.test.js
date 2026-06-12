/**
 * Testes de Hotfix — Avaliação, TAP/PI e Notificações
 *
 * Bug 1: Exportação da planilha de avaliação errada
 *   - Atividades duplicadas (mesmo nome) criavam coluna única
 *   - Cores todas vermelhas em vez de por seção
 *   - Nota Final não incluía pontos individuais
 *   - Entrega não era individual por aluno
 *
 * Bug 2: Entrega individual por aluno
 *   - Entrega era salva em eval_meta (projeto inteiro)
 *   - Agora salva em eval_individual.entrega_score (por aluno)
 *
 * Bug 3: Professor não conseguia liberar TAP/PI
 *   - getProjectsWithMembers não retornava turma_id
 *   - Frontend ficava sem turma_id e mostrava alerta de erro
 *
 * Bug 4: Sininho de notificações persistentes
 *   - Notificação de tarefa movida agora salva no banco
 *   - GET /api/notifications retorna apenas do usuário logado
 *   - PATCH /api/notifications/:id/read e read-all funcionam
 */

const http = require("http");
const path = require("path");
const ExcelJS = require("exceljs");

process.env.NODE_ENV = "test";

async function login(request, identifier, password) {
  const res = await request.post("/api/auth/login").send({ identifier, password });
  const cookies = res.headers["set-cookie"] || [];
  const authEntry = cookies.find((c) => c.startsWith("campusflow_token=")) || "";
  const csrfEntry = cookies.find((c) => c.startsWith("csrf_token=")) || "";
  return {
    authCookie: authEntry.split(";")[0],
    csrfToken: csrfEntry
      ? decodeURIComponent(csrfEntry.split(";")[0].slice("csrf_token=".length))
      : "",
  };
}

function cookieHeader(s) {
  return `${s.authCookie}; csrf_token=${s.csrfToken}`;
}

describe("Grading, TAP/PI e Notificações", () => {
  let request, server, db, evalDb;
  let prof1, prof2, aluno1, aluno2;
  let prof1Id, aluno1Id, aluno2Id;
  let turma1Id, proj1Id;
  let act1Id, act2Id; // duas atividades com mesmo nome em planejamento

  beforeAll(async () => {
    const { initDb, initEvalDb } = require(path.join(__dirname, "..", "db"));
    const { createApp } = require(path.join(__dirname, "..", "server"));
    const supertest = require("supertest");

    [db, evalDb] = await Promise.all([initDb(":memory:"), initEvalDb(":memory:")]);
    const { app } = await createApp(db, evalDb);
    server = http.createServer(app);
    request = supertest(server);

    const users = [
      { username: "gtn_prof1", name: "GTN Prof1", role: "professor", email: "gtn_prof1@t.com", password: "Senha@1234" },
      { username: "gtn_prof2", name: "GTN Prof2", role: "professor", email: "gtn_prof2@t.com", password: "Senha@1234" },
      { username: "gtn_aluno1", name: "GTN Aluno1", role: "aluno", email: "gtn_aluno1@t.com", password: "Senha@1234" },
      { username: "gtn_aluno2", name: "GTN Aluno2", role: "aluno", email: "gtn_aluno2@t.com", password: "Senha@1234" },
    ];
    for (const u of users) {
      const r = await request.post("/api/auth/register").send(u);
      if (r.status !== 201 && r.status !== 200)
        throw new Error(`Falha ao criar ${u.username}: ${JSON.stringify(r.body)}`);
    }

    [prof1, prof2, aluno1, aluno2] = await Promise.all([
      login(request, "gtn_prof1@t.com", "Senha@1234"),
      login(request, "gtn_prof2@t.com", "Senha@1234"),
      login(request, "gtn_aluno1@t.com", "Senha@1234"),
      login(request, "gtn_aluno2@t.com", "Senha@1234"),
    ]);

    const rows = await Promise.all([
      db.get("SELECT id FROM users WHERE username = 'gtn_prof1'"),
      db.get("SELECT id FROM users WHERE username = 'gtn_aluno1'"),
      db.get("SELECT id FROM users WHERE username = 'gtn_aluno2'"),
    ]);
    prof1Id  = rows[0]?.id;
    aluno1Id = rows[1]?.id;
    aluno2Id = rows[2]?.id;
    if (!prof1Id || !aluno1Id || !aluno2Id) throw new Error("IDs ausentes no setup");

    // Turma e projeto
    const t1 = await request.post("/api/turmas")
      .set("Cookie", cookieHeader(prof1)).set("X-CSRF-Token", prof1.csrfToken)
      .send({ curso: "Eng", periodo: "1", turma: "GTN Turma1" });
    turma1Id = t1.body?.id;
    if (!turma1Id) throw new Error(`turma1Id ausente: ${JSON.stringify(t1.body)}`);

    await db.run("UPDATE users SET turma_id = ? WHERE id IN (?,?)", [turma1Id, aluno1Id, aluno2Id]);

    const p1 = await request.post("/api/projects")
      .set("Cookie", cookieHeader(prof1)).set("X-CSRF-Token", prof1.csrfToken)
      .send({
        name: "GTN Proj1", team: "GTN Turma1", discipline: "Eng",
        deadline: "2026-12-31", members: ["GTN Aluno1", "GTN Aluno2"], turmaId: turma1Id,
      });
    proj1Id = p1.body?.id;
    if (!proj1Id) throw new Error(`proj1Id ausente: ${JSON.stringify(p1.body)}`);

    // Criar duas atividades com o MESMO nome em planejamento (testa dedup por ID)
    const a1 = await request.post(`/api/eval/${proj1Id}/activities`)
      .set("Cookie", cookieHeader(prof1)).set("X-CSRF-Token", prof1.csrfToken)
      .send({ section: "planejamento", name: "Standup", max_pts: 1 });
    act1Id = a1.body?.id;

    const a2 = await request.post(`/api/eval/${proj1Id}/activities`)
      .set("Cookie", cookieHeader(prof1)).set("X-CSRF-Token", prof1.csrfToken)
      .send({ section: "planejamento", name: "Standup", max_pts: 0.5 });
    act2Id = a2.body?.id;

    if (!act1Id || !act2Id) throw new Error(`IDs de atividades ausentes: act1=${act1Id} act2=${act2Id}`);

    // Dar pontos para Aluno1 nas duas atividades
    await request.patch(`/api/eval/activities/${act1Id}/scores`)
      .set("Cookie", cookieHeader(prof1)).set("X-CSRF-Token", prof1.csrfToken)
      .send({ member_name: "GTN Aluno1", score: 0.8 });
    await request.patch(`/api/eval/activities/${act2Id}/scores`)
      .set("Cookie", cookieHeader(prof1)).set("X-CSRF-Token", prof1.csrfToken)
      .send({ member_name: "GTN Aluno1", score: 0.5 });

    // Entrega individual: aluno1 = 7, aluno2 = 3
    await request.patch(`/api/eval/${proj1Id}/individual`)
      .set("Cookie", cookieHeader(prof1)).set("X-CSRF-Token", prof1.csrfToken)
      .send({ member_name: "GTN Aluno1", entrega_score: 7 });
    await request.patch(`/api/eval/${proj1Id}/individual`)
      .set("Cookie", cookieHeader(prof1)).set("X-CSRF-Token", prof1.csrfToken)
      .send({ member_name: "GTN Aluno2", entrega_score: 3 });

    // Pontos individuais: aluno1 = 2
    await request.patch(`/api/eval/${proj1Id}/individual`)
      .set("Cookie", cookieHeader(prof1)).set("X-CSRF-Token", prof1.csrfToken)
      .send({ member_name: "GTN Aluno1", score: 2 });

    // Observação
    await request.patch(`/api/eval/${proj1Id}/individual`)
      .set("Cookie", cookieHeader(prof1)).set("X-CSRF-Token", prof1.csrfToken)
      .send({ member_name: "GTN Aluno1", observacao: "Ótimo trabalho!" });
  });

  afterAll(() => server?.close());

  // ── Bug 1 + 2: Exportação de avaliação ────────────────────

  describe("Bug 1+2: Exportação XLSX de avaliação", () => {
    let wb;

    beforeAll(async () => {
      const res = await request.get(`/api/export/grading/project/${proj1Id}`)
        .set("Cookie", cookieHeader(prof1))
        .buffer(true).parse((res, cb) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => cb(null, Buffer.concat(chunks)));
        });
      expect(res.status).toBe(200);
      wb = new ExcelJS.Workbook();
      await wb.xlsx.load(res.body);
    });

    test("1. Planilha tem pelo menos 1 worksheet", () => {
      expect(wb.worksheets.length).toBeGreaterThan(0);
    });

    test("2. Headers: Nº, Projeto, Aluno presentes", () => {
      const ws = wb.worksheets[0];
      const row1 = ws.getRow(1);
      const vals = [];
      row1.eachCell((c) => { if (c.value) vals.push(String(c.value)); });
      expect(vals.some(v => v.includes("Nº") || v === "Nº")).toBe(true);
      expect(vals.some(v => v.includes("Projeto"))).toBe(true);
      expect(vals.some(v => v.includes("Aluno"))).toBe(true);
    });

    test("3. Header PLANEJAMENTO presente com cor verde escuro", () => {
      const ws = wb.worksheets[0];
      let planCell = null;
      ws.getRow(1).eachCell((c) => {
        if (String(c.value || "").includes("PLANEJAMENTO")) planCell = c;
      });
      expect(planCell).not.toBeNull();
      const argb = planCell.fill?.fgColor?.argb || "";
      // Verde escuro: FF1B5E20
      expect(argb.toUpperCase()).toMatch(/1B5E20/);
    });

    test("4. Duas atividades 'Standup' geram duas colunas distintas", () => {
      const ws = wb.worksheets[0];
      const row2 = ws.getRow(2);
      const actNames = [];
      row2.eachCell((c) => { if (c.value) actNames.push(String(c.value)); });
      const standupCols = actNames.filter(v => v.toLowerCase().startsWith("standup"));
      expect(standupCols.length).toBe(2);
    });

    test("5. Entrega de Aluno1 (7) e Aluno2 (3) aparecem como valores diferentes", () => {
      const ws = wb.worksheets[0];
      // Encontrar coluna ENTREGA no header row 1
      let entregaCol = -1;
      ws.getRow(1).eachCell((c, col) => {
        if (String(c.value || "").toUpperCase().includes("ENTREGA")) entregaCol = col;
      });
      expect(entregaCol).toBeGreaterThan(0);

      // Coletar valores de entrega nas linhas de dados
      const entregaVals = [];
      ws.eachRow((row, rowNum) => {
        if (rowNum <= 3) return;
        const val = row.getCell(entregaCol).value;
        if (val != null) entregaVals.push(Number(val));
      });
      expect(entregaVals).toContain(7);
      expect(entregaVals).toContain(3);
    });

    test("6. Nota Final de Aluno1 inclui pontos individuais (0.8+0.5+7+2=10.3)", () => {
      const ws = wb.worksheets[0];
      let notaCol = -1;
      ws.getRow(1).eachCell((c, col) => {
        if (String(c.value || "").toUpperCase().includes("NOTA")) notaCol = col;
      });
      expect(notaCol).toBeGreaterThan(0);

      const notas = [];
      ws.eachRow((row, rowNum) => {
        if (rowNum <= 3) return;
        const aluno = row.getCell(3).value;
        const nota  = row.getCell(notaCol).value;
        if (String(aluno || "").includes("Aluno1") && nota != null) notas.push(Number(nota));
      });
      expect(notas.length).toBeGreaterThan(0);
      // 0.8 (act1) + 0.5 (act2) + 7 (entrega) + 2 (individual) = 10.3
      expect(notas[0]).toBeCloseTo(10.3, 1);
    });

    test("7. Observação individual de Aluno1 presente na planilha", () => {
      const ws = wb.worksheets[0];
      let found = false;
      ws.eachRow((row, rowNum) => {
        if (rowNum <= 3) return;
        row.eachCell((c) => {
          if (String(c.value || "").includes("Ótimo trabalho!")) found = true;
        });
      });
      expect(found).toBe(true);
    });
  });

  // ── Bug 3: turma_id na API de projetos ────────────────────

  describe("Bug 3: GET /api/projects retorna turma_id", () => {
    test("8. Projeto retornado pelo /api/projects tem turma_id definido", async () => {
      const res = await request.get("/api/projects")
        .set("Cookie", cookieHeader(prof1));
      expect(res.status).toBe(200);
      const proj = res.body.find(p => String(p.id) === String(proj1Id));
      expect(proj).toBeDefined();
      expect(proj.turma_id).toBe(turma1Id);
    });

    test("9. Professor de outra turma recebe 403 ao tentar liberar docs da turma1", async () => {
      const res = await request.post(`/api/docs/permissions/${turma1Id}/tap`)
        .set("Cookie", cookieHeader(prof2)).set("X-CSRF-Token", prof2.csrfToken);
      expect(res.status).toBe(403);
    });

    test("10. Professor responsável consegue liberar TAP para turma1", async () => {
      const res = await request.post(`/api/docs/permissions/${turma1Id}/tap`)
        .set("Cookie", cookieHeader(prof1)).set("X-CSRF-Token", prof1.csrfToken);
      expect(res.status).toBe(200);
      // Limpar
      await request.delete(`/api/docs/permissions/${turma1Id}/tap`)
        .set("Cookie", cookieHeader(prof1)).set("X-CSRF-Token", prof1.csrfToken);
    });

    test("11. Aluno não consegue liberar TAP (403)", async () => {
      const res = await request.post(`/api/docs/permissions/${turma1Id}/tap`)
        .set("Cookie", cookieHeader(aluno1)).set("X-CSRF-Token", aluno1.csrfToken);
      expect(res.status).toBe(403);
    });
  });

  // ── Bug 4: Notificações persistentes ──────────────────────

  describe("Bug 4: Notificações persistentes", () => {
    test("12. GET /api/notifications retorna apenas notificações do usuário logado", async () => {
      // Criar notificação direto no banco para aluno1
      await db.run(
        "INSERT INTO notifications (user_id, type, message, link) VALUES (?, 'test', 'Msg aluno1', '/test')",
        [aluno1Id]
      );
      // Criar outra para aluno2
      await db.run(
        "INSERT INTO notifications (user_id, type, message, link) VALUES (?, 'test', 'Msg aluno2', '/test2')",
        [aluno2Id]
      );

      const res = await request.get("/api/notifications")
        .set("Cookie", cookieHeader(aluno1));
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      // Só deve ver as notificações do aluno1
      const msgs = res.body.map(n => n.message);
      expect(msgs).toContain("Msg aluno1");
      expect(msgs).not.toContain("Msg aluno2");
    });

    test("13. Usuário não acessa notificação de outro usuário via ID", async () => {
      const notif = await db.get(
        "SELECT id FROM notifications WHERE user_id = ? AND message = 'Msg aluno2'",
        [aluno2Id]
      );
      expect(notif).toBeDefined();

      // aluno1 tenta marcar notificação de aluno2 como lida
      const res = await request.patch(`/api/notifications/${notif.id}/read`)
        .set("Cookie", cookieHeader(aluno1)).set("X-CSRF-Token", aluno1.csrfToken);
      expect(res.status).toBe(200); // endpoint retorna ok mas WHERE user_id = req.user.id garante isolamento

      // Confirmar que ainda está não lida para aluno2
      const check = await db.get("SELECT is_read FROM notifications WHERE id = ?", [notif.id]);
      expect(check.is_read).toBe(0);
    });

    test("14. PATCH /api/notifications/:id/read marca como lida", async () => {
      const notif = await db.get(
        "SELECT id FROM notifications WHERE user_id = ? AND message = 'Msg aluno1'",
        [aluno1Id]
      );
      const res = await request.patch(`/api/notifications/${notif.id}/read`)
        .set("Cookie", cookieHeader(aluno1)).set("X-CSRF-Token", aluno1.csrfToken);
      expect(res.status).toBe(200);
      const check = await db.get("SELECT is_read FROM notifications WHERE id = ?", [notif.id]);
      expect(check.is_read).toBe(1);
    });

    test("15. PATCH /api/notifications/read-all marca todas do usuário como lidas", async () => {
      // Criar duas não lidas para aluno2
      await db.run(
        "INSERT INTO notifications (user_id, type, message) VALUES (?, 'test', 'Unread A')", [aluno2Id]
      );
      await db.run(
        "INSERT INTO notifications (user_id, type, message) VALUES (?, 'test', 'Unread B')", [aluno2Id]
      );

      const res = await request.patch("/api/notifications/read-all")
        .set("Cookie", cookieHeader(aluno2)).set("X-CSRF-Token", aluno2.csrfToken);
      expect(res.status).toBe(200);

      const unread = await db.all(
        "SELECT id FROM notifications WHERE user_id = ? AND is_read = 0", [aluno2Id]
      );
      expect(unread.length).toBe(0);
    });

    test("16. Mover tarefa gera notificação persistente no banco", async () => {
      // Criar tarefa
      const tk = await request.post("/api/tasks")
        .set("Cookie", cookieHeader(prof1)).set("X-CSRF-Token", prof1.csrfToken)
        .send({ projectId: proj1Id, title: "Notif Task", assignee: "GTN Aluno1", dueDate: "2026-12-31" });
      const taskId = tk.body?.id;
      expect(taskId).toBeTruthy();

      // Contar notificações de aluno1 antes
      const before = await db.all(
        "SELECT id FROM notifications WHERE user_id = ? AND type = 'task_moved'", [aluno1Id]
      );

      // Mover tarefa
      await request.patch(`/api/tasks/${taskId}/status`)
        .set("Cookie", cookieHeader(prof1)).set("X-CSRF-Token", prof1.csrfToken)
        .send({ status: "doing" });

      // Verificar que notificação foi criada
      const after = await db.all(
        "SELECT id FROM notifications WHERE user_id = ? AND type = 'task_moved'", [aluno1Id]
      );
      expect(after.length).toBeGreaterThan(before.length);
    });
  });
});
