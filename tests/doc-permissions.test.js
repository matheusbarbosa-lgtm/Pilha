/**
 * Testes de segurança: Permissões TAP/PI por turma
 *
 * Garante que:
 *  1. Professor NÃO consegue liberar TAP/PI de turma que não é dele → 403
 *  2. Professor consegue liberar TAP/PI da própria turma → 200
 *  3. Aluno não consegue liberar TAP/PI → 403
 */

const http = require("http");
const path = require("path");

// Helper: faz login e retorna { authCookie, csrfToken }
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

describe("Permissões TAP/PI por turma", () => {
  let request;
  let server;
  let db;

  // IDs criados durante o setup
  let prof1Session; // { authCookie, csrfToken }
  let prof2Session;
  let alunoSession;
  let turma1Id;
  let turma2Id;

  beforeAll(async () => {
    const { initDb, initEvalDb } = require(path.join(__dirname, "..", "db"));
    const { createApp } = require(path.join(__dirname, "..", "server"));
    const supertest = require("supertest");

    const [mainDb, evalDb] = await Promise.all([
      initDb(":memory:"),
      initEvalDb(":memory:"),
    ]);
    db = mainDb;
    const { app } = await createApp(mainDb, evalDb);
    server = http.createServer(app);
    request = supertest(server);

    // Registrar professor 1
    await request.post("/api/auth/register").send({
      username: "prof_perm_1",
      name: "Prof Perm 1",
      role: "professor",
      email: "prof_perm_1@test.com",
      password: "Senha@1234",
    });

    // Registrar professor 2
    await request.post("/api/auth/register").send({
      username: "prof_perm_2",
      name: "Prof Perm 2",
      role: "professor",
      email: "prof_perm_2@test.com",
      password: "Senha@1234",
    });

    // Registrar aluno
    await request.post("/api/auth/register").send({
      username: "aluno_perm",
      name: "Aluno Perm",
      role: "aluno",
      email: "aluno_perm@test.com",
      password: "Senha@1234",
    });

    // Login dos três
    prof1Session = await loginUser(request, "prof_perm_1@test.com", "Senha@1234");
    prof2Session = await loginUser(request, "prof_perm_2@test.com", "Senha@1234");
    alunoSession = await loginUser(request, "aluno_perm@test.com", "Senha@1234");

    // Professor 1 cria turma 1
    const t1Res = await request
      .post("/api/turmas")
      .set("Cookie", `${prof1Session.authCookie}; csrf_token=${prof1Session.csrfToken}`)
      .set("X-CSRF-Token", prof1Session.csrfToken)
      .send({ curso: "Engenharia", periodo: "1", turma: "Turma Perm 1" });
    turma1Id = t1Res.body?.id || t1Res.body?.turma?.id;

    // Professor 2 cria turma 2
    const t2Res = await request
      .post("/api/turmas")
      .set("Cookie", `${prof2Session.authCookie}; csrf_token=${prof2Session.csrfToken}`)
      .set("X-CSRF-Token", prof2Session.csrfToken)
      .send({ curso: "Computação", periodo: "2", turma: "Turma Perm 2" });
    turma2Id = t2Res.body?.id || t2Res.body?.turma?.id;

    // Falha explícita no setup em vez de silenciosamente pular testes
    if (!turma1Id || !turma2Id) {
      throw new Error(`Setup falhou: turma1Id=${turma1Id}, turma2Id=${turma2Id}. Respostas: t1=${JSON.stringify(t1Res.body)}, t2=${JSON.stringify(t2Res.body)}`);
    }
  }, 60_000);

  afterAll(() => { if (server) server.close(); });

  // ── Aluno não pode liberar ───────────────────────────────
  describe("Aluno", () => {
    test("Aluno não pode POST /api/docs/permissions → 403", async () => {
      expect(turma1Id).toBeDefined();
      const res = await request
        .post(`/api/docs/permissions/${turma1Id}/tap`)
        .set("Cookie", `${alunoSession.authCookie}; csrf_token=${alunoSession.csrfToken}`)
        .set("X-CSRF-Token", alunoSession.csrfToken)
        .send({});
      expect(res.status).toBe(403);
    }, 30_000);

    test("Aluno não pode DELETE /api/docs/permissions → 403", async () => {
      expect(turma1Id).toBeDefined();
      const res = await request
        .delete(`/api/docs/permissions/${turma1Id}/tap`)
        .set("Cookie", `${alunoSession.authCookie}; csrf_token=${alunoSession.csrfToken}`)
        .set("X-CSRF-Token", alunoSession.csrfToken);
      expect(res.status).toBe(403);
    }, 30_000);
  });

  // ── Professor na turma de outro professor ────────────────
  describe("Professor tentando liberar turma que não é dele", () => {
    test("Professor 1 NÃO pode liberar turma do Professor 2 → 403", async () => {
      expect(turma2Id).toBeDefined();
      const res = await request
        .post(`/api/docs/permissions/${turma2Id}/tap`)
        .set("Cookie", `${prof1Session.authCookie}; csrf_token=${prof1Session.csrfToken}`)
        .set("X-CSRF-Token", prof1Session.csrfToken)
        .send({});
      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/responsável/i);
    }, 30_000);

    test("Professor 1 NÃO pode bloquear turma do Professor 2 → 403", async () => {
      expect(turma2Id).toBeDefined();
      const res = await request
        .delete(`/api/docs/permissions/${turma2Id}/pi`)
        .set("Cookie", `${prof1Session.authCookie}; csrf_token=${prof1Session.csrfToken}`)
        .set("X-CSRF-Token", prof1Session.csrfToken);
      expect(res.status).toBe(403);
    }, 30_000);
  });

  // ── Professor na própria turma ───────────────────────────
  describe("Professor liberando a própria turma", () => {
    test("Professor 1 PODE liberar TAP da própria turma → 200", async () => {
      expect(turma1Id).toBeDefined();
      const res = await request
        .post(`/api/docs/permissions/${turma1Id}/tap`)
        .set("Cookie", `${prof1Session.authCookie}; csrf_token=${prof1Session.csrfToken}`)
        .set("X-CSRF-Token", prof1Session.csrfToken)
        .send({});
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    }, 30_000);

    test("Professor 1 PODE liberar PI da própria turma → 200", async () => {
      expect(turma1Id).toBeDefined();
      const res = await request
        .post(`/api/docs/permissions/${turma1Id}/pi`)
        .set("Cookie", `${prof1Session.authCookie}; csrf_token=${prof1Session.csrfToken}`)
        .set("X-CSRF-Token", prof1Session.csrfToken)
        .send({});
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    }, 30_000);

    test("Professor 1 PODE bloquear TAP da própria turma → 200", async () => {
      expect(turma1Id).toBeDefined();
      const res = await request
        .delete(`/api/docs/permissions/${turma1Id}/tap`)
        .set("Cookie", `${prof1Session.authCookie}; csrf_token=${prof1Session.csrfToken}`)
        .set("X-CSRF-Token", prof1Session.csrfToken);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    }, 30_000);
  });
});
