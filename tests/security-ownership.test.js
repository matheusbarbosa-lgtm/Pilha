/**
 * Testes de segurança: verificação de propriedade entre professores
 *
 * Garante que um professor NÃO consegue:
 *  - Editar projeto de outro professor
 *  - Mudar roles Scrum de projeto de outro professor
 *  - Submeter avaliação individual em projeto de outro professor
 *  - Aprovar/rejeitar TAP/PI de projeto de outro professor
 *  - Ver permissões de docs de turmas de outro professor
 *  - Exportar planilha de avaliação como aluno
 *  - Baixar anexo de tarefa de projeto fora do seu escopo
 */

const http = require("http");
const path = require("path");

async function loginUser(request, identifier, password) {
  const res = await request.post("/api/auth/login").send({ identifier, password });
  const cookies = res.headers["set-cookie"] || [];
  const authEntry = cookies.find((c) => c.startsWith("campusflow_token=")) || "";
  const csrfEntry = cookies.find((c) => c.startsWith("csrf_token=")) || "";
  const authCookie = authEntry.split(";")[0];
  const csrfToken = csrfEntry
    ? decodeURIComponent(csrfEntry.split(";")[0].slice("csrf_token=".length))
    : "";
  return { authCookie, csrfToken };
}

function auth(session) {
  return {
    cookie: `${session.authCookie}; csrf_token=${session.csrfToken}`,
    csrf: session.csrfToken,
  };
}

describe("Segurança: propriedade de projeto entre professores", () => {
  let request;
  let server;

  let prof1;   // { authCookie, csrfToken }
  let prof2;
  let aluno;
  let turma1Id;
  let turma2Id;
  let proj1Id;  // projeto do prof1 na turma1
  let proj2Id;  // projeto do prof2 na turma2
  let task1Id;  // tarefa no proj1

  beforeAll(async () => {
    const { initDb, initEvalDb } = require(path.join(__dirname, "..", "db"));
    const { createApp } = require(path.join(__dirname, "..", "server"));
    const supertest = require("supertest");

    const [db, evalDb] = await Promise.all([
      initDb(":memory:"),
      initEvalDb(":memory:"),
    ]);
    const { app } = await createApp(db, evalDb);
    server = http.createServer(app);
    request = supertest(server);

    // Registrar professores e aluno
    for (const u of [
      { username: "sec_prof1", name: "Sec Prof1", role: "professor", email: "sec_prof1@test.com", password: "Senha@1234" },
      { username: "sec_prof2", name: "Sec Prof2", role: "professor", email: "sec_prof2@test.com", password: "Senha@1234" },
      { username: "sec_aluno", name: "Sec Aluno", role: "aluno",     email: "sec_aluno@test.com", password: "Senha@1234" },
    ]) {
      await request.post("/api/auth/register").send(u);
    }

    prof1 = await loginUser(request, "sec_prof1@test.com", "Senha@1234");
    prof2 = await loginUser(request, "sec_prof2@test.com", "Senha@1234");
    aluno = await loginUser(request, "sec_aluno@test.com",  "Senha@1234");

    // Prof1 cria turma1
    const t1 = await request
      .post("/api/turmas")
      .set("Cookie", auth(prof1).cookie)
      .set("X-CSRF-Token", auth(prof1).csrf)
      .send({ curso: "Eng", periodo: "1", turma: "Sec Turma 1" });
    turma1Id = t1.body?.id;

    // Prof2 cria turma2
    const t2 = await request
      .post("/api/turmas")
      .set("Cookie", auth(prof2).cookie)
      .set("X-CSRF-Token", auth(prof2).csrf)
      .send({ curso: "TI", periodo: "2", turma: "Sec Turma 2" });
    turma2Id = t2.body?.id;

    if (!turma1Id || !turma2Id) {
      throw new Error(`Setup falhou: turma1Id=${turma1Id}, turma2Id=${turma2Id}`);
    }

    const commonProjFields = { deadline: "2026-12-31", members: ["Membro A"] };

    // Prof1 cria projeto na turma1
    const p1 = await request
      .post("/api/projects")
      .set("Cookie", auth(prof1).cookie)
      .set("X-CSRF-Token", auth(prof1).csrf)
      .send({ name: "Proj Sec 1", team: "Sec Turma 1", discipline: "Eng", turmaId: turma1Id, ...commonProjFields });
    proj1Id = p1.body?.id;

    // Prof2 cria projeto na turma2
    const p2 = await request
      .post("/api/projects")
      .set("Cookie", auth(prof2).cookie)
      .set("X-CSRF-Token", auth(prof2).csrf)
      .send({ name: "Proj Sec 2", team: "Sec Turma 2", discipline: "TI", turmaId: turma2Id, ...commonProjFields });
    proj2Id = p2.body?.id;

    if (!proj1Id || !proj2Id) {
      throw new Error(`Setup falhou: proj1Id=${proj1Id}, proj2Id=${proj2Id}. Respostas: p1=${JSON.stringify(p1.body)}, p2=${JSON.stringify(p2.body)}`);
    }

    // Cria tarefa no proj1
    const taskRes = await request
      .post("/api/tasks")
      .set("Cookie", auth(prof1).cookie)
      .set("X-CSRF-Token", auth(prof1).csrf)
      .send({ projectId: proj1Id, title: "Tarefa Sec 1", assignee: "Membro A", dueDate: "2026-12-31", priority: "normal", points: 1 });
    task1Id = taskRes.body?.id;
  }, 90_000);

  afterAll(() => { if (server) server.close(); });

  // ── PATCH /api/projects/:id ──────────────────────────────────────────────
  describe("PATCH /api/projects/:id", () => {
    test("Prof2 NÃO pode editar projeto do Prof1 → 403", async () => {
      expect(proj1Id).toBeDefined();
      const res = await request
        .patch(`/api/projects/${proj1Id}`)
        .set("Cookie", auth(prof2).cookie)
        .set("X-CSRF-Token", auth(prof2).csrf)
        .send({ name: "Hacked" });
      expect(res.status).toBe(403);
    });

    test("Prof1 PODE editar o próprio projeto → 200", async () => {
      expect(proj1Id).toBeDefined();
      const res = await request
        .patch(`/api/projects/${proj1Id}`)
        .set("Cookie", auth(prof1).cookie)
        .set("X-CSRF-Token", auth(prof1).csrf)
        .send({ name: "Proj Sec 1 Updated" });
      expect([200, 204]).toContain(res.status);
    });
  });

  // ── PATCH /api/projects/:id/members/:name/role (Scrum roles) ────────────
  describe("PATCH /api/projects/:id/members/:name/role", () => {
    test("Prof2 NÃO pode mudar role Scrum em projeto do Prof1 → 403", async () => {
      expect(proj1Id).toBeDefined();
      const res = await request
        .patch(`/api/projects/${proj1Id}/members/Fulano/role`)
        .set("Cookie", auth(prof2).cookie)
        .set("X-CSRF-Token", auth(prof2).csrf)
        .send({ role: "Product Owner" });
      expect(res.status).toBe(403);
    });
  });

  // ── PATCH /api/eval/:projectId/individual ────────────────────────────────
  describe("PATCH /api/eval/:projectId/individual", () => {
    test("Prof2 NÃO pode submeter avaliação individual em projeto do Prof1 → 403", async () => {
      expect(proj1Id).toBeDefined();
      const res = await request
        .patch(`/api/eval/${proj1Id}/individual`)
        .set("Cookie", auth(prof2).cookie)
        .set("X-CSRF-Token", auth(prof2).csrf)
        .send({ member_name: "Aluno Qualquer", score: 10 });
      expect(res.status).toBe(403);
    });

    test("Prof1 PODE submeter avaliação individual no próprio projeto → 200", async () => {
      expect(proj1Id).toBeDefined();
      const res = await request
        .patch(`/api/eval/${proj1Id}/individual`)
        .set("Cookie", auth(prof1).cookie)
        .set("X-CSRF-Token", auth(prof1).csrf)
        .send({ member_name: "Aluno Teste", score: 8, observacao: "Bom trabalho" });
      expect([200, 201]).toContain(res.status);
    });
  });

  // ── POST /api/projects/:id/docs/:type/approve ────────────────────────────
  describe("POST /api/projects/:id/docs/tap/approve", () => {
    test("Prof2 NÃO pode aprovar TAP de projeto do Prof1 → 403", async () => {
      expect(proj1Id).toBeDefined();
      const res = await request
        .post(`/api/projects/${proj1Id}/docs/tap/approve`)
        .set("Cookie", auth(prof2).cookie)
        .set("X-CSRF-Token", auth(prof2).csrf)
        .send({});
      expect(res.status).toBe(403);
    });

    test("Prof2 NÃO pode rejeitar PI de projeto do Prof1 → 403", async () => {
      expect(proj1Id).toBeDefined();
      const res = await request
        .post(`/api/projects/${proj1Id}/docs/pi/reject`)
        .set("Cookie", auth(prof2).cookie)
        .set("X-CSRF-Token", auth(prof2).csrf)
        .send({ reason: "Motivo qualquer" });
      expect(res.status).toBe(403);
    });
  });

  // ── GET /api/docs/permissions ────────────────────────────────────────────
  describe("GET /api/docs/permissions", () => {
    test("Aluno recebe 403", async () => {
      const res = await request
        .get("/api/docs/permissions")
        .set("Cookie", `${aluno.authCookie}; csrf_token=${aluno.csrfToken}`)
        .set("X-CSRF-Token", aluno.csrfToken);
      expect(res.status).toBe(403);
    });

    test("Prof1 recebe apenas suas turmas (não vê turmas do Prof2)", async () => {
      expect(turma1Id).toBeDefined();
      expect(turma2Id).toBeDefined();
      const res = await request
        .get("/api/docs/permissions")
        .set("Cookie", auth(prof1).cookie)
        .set("X-CSRF-Token", auth(prof1).csrf);
      expect([200]).toContain(res.status);
      const ids = (res.body || []).map((r) => r.turma_id);
      expect(ids).not.toContain(turma2Id);
    });
  });

  // ── GET /api/export/grading/project/:id — aluno bloqueado ───────────────
  describe("GET /api/export/grading/project/:id", () => {
    test("Aluno recebe 403 ao tentar exportar planilha de avaliação", async () => {
      expect(proj1Id).toBeDefined();
      const res = await request
        .get(`/api/export/grading/project/${proj1Id}`)
        .set("Cookie", `${aluno.authCookie}; csrf_token=${aluno.csrfToken}`)
        .set("X-CSRF-Token", aluno.csrfToken);
      expect(res.status).toBe(403);
    });

    test("Prof2 recebe 403 ao tentar exportar planilha de projeto do Prof1", async () => {
      expect(proj1Id).toBeDefined();
      const res = await request
        .get(`/api/export/grading/project/${proj1Id}`)
        .set("Cookie", auth(prof2).cookie)
        .set("X-CSRF-Token", auth(prof2).csrf);
      expect(res.status).toBe(403);
    });
  });

  // ── Anexos: permissão por escopo de projeto ──────────────────────────────
  describe("Anexos de tarefa", () => {
    test("Prof2 NÃO pode listar anexos de tarefa do projeto do Prof1 → 403", async () => {
      expect(task1Id).toBeDefined();
      const res = await request
        .get(`/api/tasks/${task1Id}/attachments`)
        .set("Cookie", auth(prof2).cookie)
        .set("X-CSRF-Token", auth(prof2).csrf);
      expect(res.status).toBe(403);
    });

    test("Aluno fora do projeto NÃO pode listar anexos → 403", async () => {
      expect(task1Id).toBeDefined();
      const res = await request
        .get(`/api/tasks/${task1Id}/attachments`)
        .set("Cookie", `${aluno.authCookie}; csrf_token=${aluno.csrfToken}`)
        .set("X-CSRF-Token", aluno.csrfToken);
      expect(res.status).toBe(403);
    });

    test("Prof2 NÃO pode baixar anexo de tarefa do projeto do Prof1 → 403", async () => {
      expect(task1Id).toBeDefined();
      // O attachment id 9999 não existe, mas a verificação de escopo ocorre antes do lookup
      const res = await request
        .get(`/api/tasks/${task1Id}/attachments/9999/download`)
        .set("Cookie", auth(prof2).cookie)
        .set("X-CSRF-Token", auth(prof2).csrf);
      expect(res.status).toBe(403);
    });
  });
});
