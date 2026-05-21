/**
 * Testes de proteção CSRF — Fase 3 de segurança.
 *
 * Estratégia double-submit cookie:
 *  - Backend gera csrf_token (não-HttpOnly) no login, junto com o JWT.
 *  - Requests mutáveis autenticadas devem enviar X-CSRF-Token: <valor do cookie>.
 *  - Sem token, ou token errado → 403.
 *  - Endpoints públicos (sem sessão) são isentos.
 */

const http = require("http");
const path = require("path");

describe("Proteção CSRF", () => {
  let request;
  let server;
  let authCookie;       // campusflow_token=...
  let csrfToken;        // valor do csrf_token cookie
  let csrfCookieRaw;    // string completa do Set-Cookie csrf_token (para verificar flags)

  beforeAll(async () => {
    const { initDb, initEvalDb } = require(path.join(__dirname, "..", "db"));
    const { createApp }          = require(path.join(__dirname, "..", "server"));
    const supertest              = require("supertest");

    const [db, evalDb] = await Promise.all([
      initDb(":memory:"),
      initEvalDb(":memory:"),
    ]);
    const { app } = await createApp(db, evalDb);
    server  = http.createServer(app);
    request = supertest(server);

    // Registra e loga um usuário para obter cookies de sessão + CSRF
    await request.post("/api/auth/register").send({
      username: "csrf_user",
      name: "CSRF User",
      role: "aluno",
      email: "csrf_user@test.com",
      password: "Csrf@Test1",
    });

    const loginRes = await request.post("/api/auth/login").send({
      identifier: "csrf_user@test.com",
      password: "Csrf@Test1",
    });

    // Extrai cookies da resposta de login
    const cookies = loginRes.headers["set-cookie"] || [];
    const authEntry  = cookies.find(c => c.startsWith("campusflow_token="));
    const csrfEntry  = cookies.find(c => c.startsWith("csrf_token="));

    authCookie    = authEntry ? authEntry.split(";")[0] : "";
    csrfCookieRaw = csrfEntry || "";
    csrfToken     = csrfEntry ? decodeURIComponent(csrfEntry.split(";")[0].slice("csrf_token=".length)) : "";
  }, 60_000);

  afterAll(() => { if (server) server.close(); });

  // ── Endpoints públicos — isentos de CSRF ─────────────────────────────────
  describe("Endpoints públicos são isentos de CSRF", () => {
    test("POST /api/auth/register sem token CSRF não retorna 403", async () => {
      const res = await request.post("/api/auth/register").send({
        username: "csrf_pub_test",
        name: "Pub Test",
        role: "aluno",
        password: "Csrf@Test2",
      });
      // Pode ser 201 (criado) ou 409 (duplicado) — jamais 403
      expect(res.status).not.toBe(403);
    }, 30_000);

    test("POST /api/auth/login sem token CSRF não retorna 403", async () => {
      const res = await request.post("/api/auth/login").send({
        identifier: "csrf_user@test.com",
        password: "Csrf@Test1",
      });
      expect(res.status).not.toBe(403);
    }, 30_000);

    test("POST /api/auth/forgot-password sem token CSRF não retorna 403", async () => {
      const res = await request.post("/api/auth/forgot-password").send({
        email: "csrf@test.com",
      });
      expect(res.status).not.toBe(403);
    }, 30_000);
  });

  // ── Endpoints autenticados — exigem CSRF ─────────────────────────────────
  describe("Endpoints autenticados rejeitam mutações sem CSRF", () => {
    test("POST autenticado sem X-CSRF-Token retorna 403", async () => {
      const res = await request
        .post("/api/tasks")
        .set("Cookie", authCookie)
        .send({ title: "Sem CSRF", projectId: "1" });
      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/CSRF/i);
    }, 30_000);

    test("POST autenticado com X-CSRF-Token errado retorna 403", async () => {
      const res = await request
        .post("/api/tasks")
        .set("Cookie", authCookie)
        .set("X-CSRF-Token", "token-invalido-qualquer")
        .send({ title: "CSRF errado", projectId: "1" });
      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/CSRF/i);
    }, 30_000);

    test("POST autenticado com X-CSRF-Token correto passa a validação CSRF", async () => {
      const res = await request
        .post("/api/tasks")
        .set("Cookie", `${authCookie}; csrf_token=${csrfToken}`)
        .set("X-CSRF-Token", csrfToken)
        .send({ title: "Com CSRF correto", projectId: "1" });
      // Pode ser 400/404 (sem projeto válido) ou 201 — não deve ser 403
      expect(res.status).not.toBe(403);
    }, 30_000);

    test("PATCH autenticado sem X-CSRF-Token retorna 403", async () => {
      const res = await request
        .patch("/api/profile")
        .set("Cookie", authCookie)
        .send({ name: "Novo Nome" });
      expect(res.status).toBe(403);
    }, 30_000);

    test("DELETE autenticado sem X-CSRF-Token retorna 403", async () => {
      const res = await request
        .delete("/api/tasks/999")
        .set("Cookie", authCookie);
      expect(res.status).toBe(403);
    }, 30_000);
  });

  // ── Token CSRF gerado no login ────────────────────────────────────────────
  describe("Token CSRF é gerado corretamente no login", () => {
    test("Login retorna csrf_token cookie não-HttpOnly", async () => {
      // Usa cookie capturado no beforeAll — mesmo login, evita duplicar request
      expect(csrfCookieRaw).toBeTruthy();
      // Não deve conter HttpOnly — deve ser legível pelo JS do frontend
      expect(csrfCookieRaw.toLowerCase()).not.toContain("httponly");
    }, 30_000);

    test("csrf_token cookie tem valor de 64 caracteres hex", async () => {
      expect(csrfToken).toMatch(/^[0-9a-f]{64}$/);
    }, 30_000);

    test("csrf_token é diferente do JWT de sessão", async () => {
      const jwtValue = authCookie.replace("campusflow_token=", "");
      expect(csrfToken).not.toBe(jwtValue);
    }, 30_000);
  });
});
