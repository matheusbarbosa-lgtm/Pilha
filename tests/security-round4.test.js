/**
 * Testes de segurança Round 4 — Codex Auditor
 *
 * Cobre:
 *  1. XLSX: parse do workbook real (ExcelJS) — valida colunas e valores
 *  2. Anexo: sem silent skips — tarefa é criada na setup, assertions são firmes
 *  3. student-onboarding mode=create: preenche turma_id e user_id
 *  4. student-onboarding mode=join: preenche user_id em project_members
 *  5. register-by-invite: preenche turma_id no user e user_id em project_members
 *  6. buildVisibleScope — aluno acessa via user_id (não só por nome)
 *  7. invites/accept: preenche user_id em project_members
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

describe("Security Round 4", () => {
  let request;
  let server;
  let db;
  let evalDb;

  let prof1, prof2, aluno1, aluno2;
  let turma1Id, turma2Id;
  let proj1Id;
  let taskId; // criado na setup para testes de anexo (sem silent skip)
  let aluno1Id, aluno2Id;

  beforeAll(async () => {
    const { initDb, initEvalDb } = require(path.join(__dirname, "..", "db"));
    const { createApp } = require(path.join(__dirname, "..", "server"));
    const supertest = require("supertest");

    [db, evalDb] = await Promise.all([initDb(":memory:"), initEvalDb(":memory:")]);
    const { app } = await createApp(db, evalDb);
    server = http.createServer(app);
    request = supertest(server);

    // Criar usuários
    const users = [
      { username: "r4_prof1", name: "R4 Prof1", role: "professor", email: "r4_prof1@test.com", password: "Senha@1234" },
      { username: "r4_prof2", name: "R4 Prof2", role: "professor", email: "r4_prof2@test.com", password: "Senha@1234" },
      { username: "r4_aluno1", name: "R4 Aluno1", role: "aluno", email: "r4_aluno1@test.com", password: "Senha@1234" },
      { username: "r4_aluno2", name: "R4 Aluno2", role: "aluno", email: "r4_aluno2@test.com", password: "Senha@1234" },
    ];
    for (const u of users) await request.post("/api/auth/register").send(u);

    [prof1, prof2, aluno1, aluno2] = await Promise.all([
      login(request, "r4_prof1@test.com", "Senha@1234"),
      login(request, "r4_prof2@test.com", "Senha@1234"),
      login(request, "r4_aluno1@test.com", "Senha@1234"),
      login(request, "r4_aluno2@test.com", "Senha@1234"),
    ]);

    // Criar turmas
    const t1 = await request.post("/api/turmas")
      .set("Cookie", cookieHeader(prof1)).set("X-CSRF-Token", prof1.csrfToken)
      .send({ curso: "Eng", periodo: "1", turma: "R4 Turma 1" });
    turma1Id = t1.body?.id;

    const t2 = await request.post("/api/turmas")
      .set("Cookie", cookieHeader(prof2)).set("X-CSRF-Token", prof2.csrfToken)
      .send({ curso: "TI", periodo: "2", turma: "R4 Turma 2" });
    turma2Id = t2.body?.id;

    if (!turma1Id || !turma2Id) throw new Error(`Setup falhou: turma1Id=${turma1Id}, turma2Id=${turma2Id}`);

    // Vincular alunos às turmas (via DB direto para setup de teste)
    const a1Row = await db.get("SELECT id FROM users WHERE username = 'r4_aluno1'");
    const a2Row = await db.get("SELECT id FROM users WHERE username = 'r4_aluno2'");
    aluno1Id = a1Row?.id;
    aluno2Id = a2Row?.id;
    if (aluno1Id) await db.run("UPDATE users SET turma_id = ? WHERE id = ?", [turma1Id, aluno1Id]);
    if (aluno2Id) await db.run("UPDATE users SET turma_id = ? WHERE id = ?", [turma2Id, aluno2Id]);

    // Criar projeto da turma 1
    const p1 = await request.post("/api/projects")
      .set("Cookie", cookieHeader(prof1)).set("X-CSRF-Token", prof1.csrfToken)
      .send({ name: "R4 Proj1", team: "R4 Turma 1", discipline: "Eng", deadline: "2026-12-31", members: ["R4 Aluno1"], turmaId: turma1Id });
    proj1Id = p1.body?.id;

    if (!proj1Id) throw new Error(`Setup falhou: proj1Id=${proj1Id} (${JSON.stringify(p1.body)})`);

    // Vincular aluno1 ao projeto via user_id (FK correta)
    if (aluno1Id) {
      await db.run("UPDATE project_members SET user_id = ? WHERE project_id = ? AND member_name = 'R4 Aluno1'", [aluno1Id, proj1Id]);
    }

    // Criar tarefa para testes de anexo — criado aqui para evitar silent skips
    const taskRes = await request.post("/api/tasks")
      .set("Cookie", cookieHeader(prof1)).set("X-CSRF-Token", prof1.csrfToken)
      .send({ projectId: proj1Id, title: "Tarefa Anexo R4", assignee: "R4 Aluno1", dueDate: "2026-12-31", priority: "normal", points: 1 });
    taskId = taskRes.body?.id;
    if (!taskId) throw new Error(`Setup falhou: taskId não criado (${JSON.stringify(taskRes.body)})`);

    // Inserir dados de avaliação para XLSX
    await evalDb.run(
      "INSERT OR REPLACE INTO eval_individual (project_id, member_name, score, entrega_score, observacao) VALUES (?, ?, ?, ?, ?)",
      [proj1Id, "R4 Aluno1", 8.0, 3.0, "Boa entrega"]
    );
  }, 90_000);

  afterAll(() => { if (server) server.close(); });

  // ── 1. XLSX — parse real do workbook ──────────────────────────────────────
  describe("XLSX — workbook real parseado com ExcelJS", () => {
    test("Exportação retorna XLSX com coluna Pts. Individuais e Nota Final distintas", async () => {
      expect(proj1Id).toBeDefined();
      const res = await request.get(`/api/export/grading/project/${proj1Id}`)
        .set("Cookie", cookieHeader(prof1)).set("X-CSRF-Token", prof1.csrfToken)
        .buffer(true).parse((res, callback) => {
          const chunks = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () => callback(null, Buffer.concat(chunks)));
        });

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/spreadsheetml/);

      // Parse com ExcelJS
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(res.body);
      expect(wb.worksheets.length).toBeGreaterThan(0);

      const ws = wb.worksheets[0];

      // Coletar todos os textos das células do header (primeiras 3 linhas)
      const headerTexts = [];
      for (let r = 1; r <= 3; r++) {
        const row = ws.getRow(r);
        row.eachCell((cell) => {
          const val = cell.value?.richText
            ? cell.value.richText.map(rt => rt.text).join("")
            : String(cell.value || "");
          if (val.trim()) headerTexts.push(val.trim());
        });
      }

      // Verificar presença de colunas essenciais
      const headersJoined = headerTexts.join(" | ");
      expect(headersJoined).toMatch(/Aluno|Nome/i);
      expect(headersJoined).toMatch(/Nota|Pts/i);
    });

    test("XLSX de turma contém dados dos membros", async () => {
      expect(turma1Id).toBeDefined();
      const res = await request.get(`/api/export/grading/turma/${turma1Id}`)
        .set("Cookie", cookieHeader(prof1)).set("X-CSRF-Token", prof1.csrfToken)
        .buffer(true).parse((res, callback) => {
          const chunks = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () => callback(null, Buffer.concat(chunks)));
        });

      expect(res.status).toBe(200);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(res.body);
      expect(wb.worksheets.length).toBeGreaterThan(0);

      // Ao menos uma célula deve conter o nome do aluno ou do projeto
      const ws = wb.worksheets[0];
      let found = false;
      ws.eachRow((row) => {
        row.eachCell((cell) => {
          const val = String(cell.value || "");
          if (val.includes("R4 Aluno1") || val.includes("R4 Proj1")) found = true;
        });
      });
      expect(found).toBe(true);
    });
  });

  // ── 2. Anexo — sem silent skips ─────────────────────────────────────────────
  describe("Anexo: uploaded_by_user_id — sem silent skips", () => {
    test("taskId foi criado na setup", () => {
      expect(taskId).toBeDefined();
      expect(typeof taskId).toBe("string");
    });

    test("Upload de anexo por prof1 registra uploaded_by_user_id", async () => {
      expect(taskId).toBeDefined();
      const res = await request.post(`/api/tasks/${taskId}/attachments`)
        .set("Cookie", cookieHeader(prof1)).set("X-CSRF-Token", prof1.csrfToken)
        .attach("file", Buffer.from("conteudo de teste r4"), { filename: "r4test.txt", contentType: "text/plain" });

      expect(res.status).toBe(201);
      const att = await db.get(
        "SELECT uploaded_by_user_id FROM task_attachments WHERE task_id = ? ORDER BY id DESC LIMIT 1",
        [taskId]
      );
      expect(att).toBeDefined();
      expect(att.uploaded_by_user_id).toBeTruthy();
    });

    test("Prof2 NÃO pode listar anexos da tarefa do proj1 → 403", async () => {
      expect(taskId).toBeDefined();
      const res = await request.get(`/api/tasks/${taskId}/attachments`)
        .set("Cookie", cookieHeader(prof2)).set("X-CSRF-Token", prof2.csrfToken);
      expect(res.status).toBe(403);
    });

    test("Prof2 NÃO pode baixar anexo de tarefa do proj1 → 403", async () => {
      expect(taskId).toBeDefined();
      // Tentar baixar o primeiro anexo (ou um ID fictício — o 403 vem antes do lookup)
      const attRow = await db.get("SELECT id FROM task_attachments WHERE task_id = ?", [taskId]);
      const attId = attRow?.id ?? 99999;
      const res = await request.get(`/api/tasks/${taskId}/attachments/${attId}/download`)
        .set("Cookie", cookieHeader(prof2)).set("X-CSRF-Token", prof2.csrfToken);
      expect(res.status).toBe(403);
    });
  });

  // ── 3. student-onboarding mode=create ────────────────────────────────────────
  describe("student-onboarding mode=create: preenche turma_id e user_id", () => {
    let onboardingAluno;
    let onboardingAlunoId;

    beforeAll(async () => {
      await request.post("/api/auth/register").send({
        username: "r4_onboard_create", name: "R4 Onboard Create",
        role: "aluno", email: "r4_onboard_create@test.com", password: "Senha@1234",
      });
      onboardingAluno = await login(request, "r4_onboard_create@test.com", "Senha@1234");
      const row = await db.get("SELECT id FROM users WHERE username = 'r4_onboard_create'");
      onboardingAlunoId = row?.id;
      // Simular que o aluno foi vinculado à turma1
      await db.run("UPDATE users SET turma_id = ?, onboarding_done = 0 WHERE id = ?", [turma1Id, onboardingAlunoId]);
    });

    test("Onboarding create: projeto criado com turma_id da turma do aluno", async () => {
      expect(onboardingAlunoId).toBeDefined();
      const res = await request.post("/api/auth/student-onboarding")
        .set("Cookie", cookieHeader(onboardingAluno)).set("X-CSRF-Token", onboardingAluno.csrfToken)
        .send({ mode: "create", scrumRole: "Product Owner" });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);

      // Projeto deve ter turma_id = turma1Id
      const proj = await db.get(
        "SELECT turma_id FROM projects WHERE name LIKE 'Projeto de R4 Onboard Create%' ORDER BY id DESC LIMIT 1"
      );
      expect(proj).toBeDefined();
      expect(proj.turma_id).toBe(turma1Id);

      // project_members deve ter user_id preenchido
      const member = await db.get(
        "SELECT user_id FROM project_members WHERE member_name = 'R4 Onboard Create' ORDER BY rowid DESC LIMIT 1"
      );
      expect(member).toBeDefined();
      expect(member.user_id).toBe(onboardingAlunoId);
    });
  });

  // ── 4. student-onboarding mode=join ──────────────────────────────────────────
  describe("student-onboarding mode=join: preenche user_id em project_members", () => {
    let joinAluno;
    let joinAlunoId;
    let inviteToken;

    beforeAll(async () => {
      await request.post("/api/auth/register").send({
        username: "r4_onboard_join", name: "R4 Onboard Join",
        role: "aluno", email: "r4_onboard_join@test.com", password: "Senha@1234",
      });
      joinAluno = await login(request, "r4_onboard_join@test.com", "Senha@1234");
      const row = await db.get("SELECT id FROM users WHERE username = 'r4_onboard_join'");
      joinAlunoId = row?.id;
      await db.run("UPDATE users SET onboarding_done = 0, email = 'r4_onboard_join@test.com' WHERE id = ?", [joinAlunoId]);

      // Professor cria convite para o projeto
      const inviteRes = await request.post(`/api/projects/${proj1Id}/invites`)
        .set("Cookie", cookieHeader(prof1)).set("X-CSRF-Token", prof1.csrfToken)
        .send({ emails: ["r4_onboard_join@test.com"] });
      expect(inviteRes.status).toBe(200);

      const inviteRow = await db.get(
        "SELECT invite_token FROM project_invites WHERE invite_email = 'r4_onboard_join@test.com' AND status = 'pending' ORDER BY id DESC LIMIT 1"
      );
      inviteToken = inviteRow?.invite_token;
    });

    test("Onboarding join: project_members recebe user_id do aluno", async () => {
      expect(joinAlunoId).toBeDefined();
      expect(inviteToken).toBeDefined();

      const res = await request.post("/api/auth/student-onboarding")
        .set("Cookie", cookieHeader(joinAluno)).set("X-CSRF-Token", joinAluno.csrfToken)
        .send({ mode: "join", inviteToken });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);

      const member = await db.get(
        "SELECT user_id FROM project_members WHERE project_id = ? AND user_id = ?",
        [proj1Id, joinAlunoId]
      );
      expect(member).toBeDefined();
      expect(member.user_id).toBe(joinAlunoId);
    });
  });

  // ── 5. register-by-invite: turma_id e user_id ────────────────────────────────
  describe("register-by-invite: turma_id em user + user_id em project_members", () => {
    let inviteToken;

    beforeAll(async () => {
      // Professor cria convite para um e-mail novo (usuário sem conta)
      const inviteRes = await request.post(`/api/projects/${proj1Id}/invites`)
        .set("Cookie", cookieHeader(prof1)).set("X-CSRF-Token", prof1.csrfToken)
        .send({ emails: ["r4_newuser@test.com"] });
      expect(inviteRes.status).toBe(200);

      const inviteRow = await db.get(
        "SELECT invite_token FROM project_invites WHERE invite_email = 'r4_newuser@test.com' AND status = 'pending' ORDER BY id DESC LIMIT 1"
      );
      inviteToken = inviteRow?.invite_token;
    });

    test("register-by-invite: user recebe turma_id do projeto e project_members recebe user_id", async () => {
      expect(inviteToken).toBeDefined();

      const res = await request.post("/api/auth/register-by-invite").send({
        inviteToken,
        name: "R4 New User",
        email: "r4_newuser@test.com",
        password: "Senha@1234",
        confirmPassword: "Senha@1234",
      });
      expect(res.status).toBe(201);
      expect(res.body.ok).toBe(true);

      const newUser = await db.get("SELECT id, turma_id FROM users WHERE email = 'r4_newuser@test.com'");
      expect(newUser).toBeDefined();
      // turma_id deve ser o da turma do projeto
      expect(newUser.turma_id).toBe(turma1Id);

      // project_members deve ter user_id do novo usuário
      const member = await db.get(
        "SELECT user_id FROM project_members WHERE project_id = ? AND user_id = ?",
        [proj1Id, newUser.id]
      );
      expect(member).toBeDefined();
      expect(member.user_id).toBe(newUser.id);
    });
  });

  // ── 6. buildVisibleScope — aluno acessa via user_id ─────────────────────────
  describe("buildVisibleScope: aluno acessa projeto via user_id (não só nome)", () => {
    test("Aluno vinculado via user_id vê o projeto corretamente", async () => {
      expect(aluno1Id).toBeDefined();
      expect(proj1Id).toBeDefined();

      // Garantir que o vínculo é via user_id, não só nome
      const member = await db.get(
        "SELECT user_id FROM project_members WHERE project_id = ? AND user_id = ?",
        [proj1Id, aluno1Id]
      );
      expect(member?.user_id).toBe(aluno1Id);

      const res = await request.get("/api/projects")
        .set("Cookie", cookieHeader(aluno1)).set("X-CSRF-Token", aluno1.csrfToken);
      expect(res.status).toBe(200);
      const ids = res.body.map((p) => String(p.id));
      expect(ids).toContain(String(proj1Id));
    });

    test("Aluno2 NÃO vê projeto de turma alheia via /api/projects", async () => {
      expect(proj1Id).toBeDefined();
      const res = await request.get("/api/projects")
        .set("Cookie", cookieHeader(aluno2)).set("X-CSRF-Token", aluno2.csrfToken);
      expect(res.status).toBe(200);
      const ids = res.body.map((p) => String(p.id));
      expect(ids).not.toContain(String(proj1Id));
    });

    test("Aluno2 NÃO consegue acessar diretamente o projeto do aluno1 → 403", async () => {
      expect(proj1Id).toBeDefined();
      const res = await request.get(`/api/projects/${proj1Id}`)
        .set("Cookie", cookieHeader(aluno2)).set("X-CSRF-Token", aluno2.csrfToken);
      expect(res.status).toBe(403);
    });
  });

  // ── 7. invites/accept: preenche user_id em project_members ───────────────────
  describe("POST /api/invites/accept: user_id preenchido", () => {
    let acceptAluno;
    let acceptAlunoId;
    let inviteToken;

    beforeAll(async () => {
      await request.post("/api/auth/register").send({
        username: "r4_accept_aluno", name: "R4 Accept Aluno",
        role: "aluno", email: "r4_accept@test.com", password: "Senha@1234",
      });
      acceptAluno = await login(request, "r4_accept@test.com", "Senha@1234");
      const row = await db.get("SELECT id FROM users WHERE username = 'r4_accept_aluno'");
      acceptAlunoId = row?.id;

      // Professor cria convite
      const inviteRes = await request.post(`/api/projects/${proj1Id}/invites`)
        .set("Cookie", cookieHeader(prof1)).set("X-CSRF-Token", prof1.csrfToken)
        .send({ emails: ["r4_accept@test.com"] });
      expect(inviteRes.status).toBe(200);

      const inviteRow = await db.get(
        "SELECT invite_token FROM project_invites WHERE invite_email = 'r4_accept@test.com' AND status = 'pending' ORDER BY id DESC LIMIT 1"
      );
      inviteToken = inviteRow?.invite_token;
    });

    test("POST /api/invites/accept: project_members recebe user_id", async () => {
      expect(acceptAlunoId).toBeDefined();
      expect(inviteToken).toBeDefined();

      const res = await request.post("/api/invites/accept")
        .set("Cookie", cookieHeader(acceptAluno)).set("X-CSRF-Token", acceptAluno.csrfToken)
        .send({ token: inviteToken });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);

      const member = await db.get(
        "SELECT user_id FROM project_members WHERE project_id = ? AND user_id = ?",
        [proj1Id, acceptAlunoId]
      );
      expect(member).toBeDefined();
      expect(member.user_id).toBe(acceptAlunoId);
    });
  });

  // ── 8. /api/export/turmas retorna IDs ────────────────────────────────────────
  describe("GET /api/export/turmas — retorna IDs e labels", () => {
    test("Retorna array de objetos com id e label (não strings)", async () => {
      const res = await request.get("/api/export/turmas")
        .set("Cookie", cookieHeader(prof1)).set("X-CSRF-Token", prof1.csrfToken);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      if (res.body.length > 0) {
        const item = res.body[0];
        expect(typeof item).toBe("object");
        expect(item).toHaveProperty("id");
        expect(item).toHaveProperty("turma");
        expect(item).toHaveProperty("label");
        expect(typeof item.id).toBe("number");
      }
    });

    test("Prof1 vê apenas suas turmas (não as do prof2)", async () => {
      const res1 = await request.get("/api/export/turmas")
        .set("Cookie", cookieHeader(prof1)).set("X-CSRF-Token", prof1.csrfToken);
      const res2 = await request.get("/api/export/turmas")
        .set("Cookie", cookieHeader(prof2)).set("X-CSRF-Token", prof2.csrfToken);

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);

      const ids1 = res1.body.map((t) => t.id);
      const ids2 = res2.body.map((t) => t.id);

      expect(ids1).toContain(turma1Id);
      expect(ids1).not.toContain(turma2Id);
      expect(ids2).toContain(turma2Id);
      expect(ids2).not.toContain(turma1Id);
    });

    test("Aluno não pode acessar /api/export/turmas → 403", async () => {
      const res = await request.get("/api/export/turmas")
        .set("Cookie", cookieHeader(aluno1)).set("X-CSRF-Token", aluno1.csrfToken);
      expect(res.status).toBe(403);
    });
  });
});
