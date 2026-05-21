/**
 * Testes de migração bcrypt → Argon2id — Fase 4 de segurança.
 *
 * Estratégia:
 *  - Novos registros usam Argon2id ($argon2id).
 *  - Usuários antigos com hash bcrypt são migrados transparentemente no login.
 *  - Usuários já migrados continuam funcionando normalmente.
 */

const http  = require("http");
const path  = require("path");

describe("Migração Argon2id", () => {
  let request;
  let server;
  let db;

  beforeAll(async () => {
    const { initDb, initEvalDb } = require(path.join(__dirname, "..", "db"));
    const { createApp }          = require(path.join(__dirname, "..", "server"));
    const supertest              = require("supertest");

    const [mainDb, evalDb] = await Promise.all([
      initDb(":memory:"),
      initEvalDb(":memory:"),
    ]);
    db = mainDb;
    const { app } = await createApp(mainDb, evalDb);
    server  = http.createServer(app);
    request = supertest(server);
  }, 60_000);

  afterAll(() => { if (server) server.close(); });

  // ── Novos registros usam Argon2id ────────────────────────────────────────
  describe("Novos registros", () => {
    test("Registro cria hash Argon2id ($argon2id)", async () => {
      const res = await request.post("/api/auth/register").send({
        username: "argon_user",
        name: "Argon User",
        role: "aluno",
        email: "argon_user@test.com",
        password: "Argon@Test1",
      });
      expect(res.status).toBe(201);

      const user = await db.get("SELECT password_hash FROM users WHERE username = ?", ["argon_user"]);
      expect(user).toBeTruthy();
      expect(user.password_hash).toMatch(/^\$argon2id/);
    }, 30_000);

    test("Login com usuário Argon2id funciona", async () => {
      const res = await request.post("/api/auth/login").send({
        identifier: "argon_user@test.com",
        password: "Argon@Test1",
      });
      expect(res.status).toBe(200);
      expect(res.body.user).toBeTruthy();
    }, 30_000);

    test("Login com senha errada para usuário Argon2id retorna 401", async () => {
      const res = await request.post("/api/auth/login").send({
        identifier: "argon_user@test.com",
        password: "SenhaErrada1",
      });
      expect(res.status).toBe(401);
    }, 30_000);
  });

  // ── Migração transparente de bcrypt → Argon2id ───────────────────────────
  describe("Migração transparente no login", () => {
    const bcrypt = require("bcryptjs");

    test("Usuário com hash bcrypt faz login com sucesso", async () => {
      // Insere diretamente com hash bcrypt (simula usuário legado)
      const bcryptHash = bcrypt.hashSync("Legacy@Pass1", 10);
      await db.run(
        "INSERT INTO users (username, name, role, email, onboarding_done, password_hash) VALUES (?, ?, 'aluno', ?, 1, ?)",
        ["legacy_user", "Legacy User", "legacy@test.com", bcryptHash]
      );

      // Verifica que o hash é bcrypt antes do login
      const before = await db.get("SELECT password_hash FROM users WHERE username = ?", ["legacy_user"]);
      expect(before.password_hash).toMatch(/^\$2[ab]\$/);

      const res = await request.post("/api/auth/login").send({
        identifier: "legacy@test.com",
        password: "Legacy@Pass1",
      });
      expect(res.status).toBe(200);
      expect(res.body.user).toBeTruthy();
    }, 30_000);

    test("Após login, hash bcrypt é migrado para Argon2id", async () => {
      // O login anterior deve ter migrado o hash
      const after = await db.get("SELECT password_hash FROM users WHERE username = ?", ["legacy_user"]);
      expect(after.password_hash).toMatch(/^\$argon2id/);
    }, 30_000);

    test("Após migração, login continua funcionando com Argon2id", async () => {
      const res = await request.post("/api/auth/login").send({
        identifier: "legacy@test.com",
        password: "Legacy@Pass1",
      });
      expect(res.status).toBe(200);
    }, 30_000);

    test("Senha errada para usuário legado retorna 401 sem migrar hash", async () => {
      // Insere outro usuário legado
      const bcryptHash = bcrypt.hashSync("Legacy@Pass2", 10);
      await db.run(
        "INSERT INTO users (username, name, role, email, onboarding_done, password_hash) VALUES (?, ?, 'aluno', ?, 1, ?)",
        ["legacy_user2", "Legacy User2", "legacy2@test.com", bcryptHash]
      );

      await request.post("/api/auth/login").send({
        identifier: "legacy2@test.com",
        password: "SenhaErrada",
      });

      // Hash NÃO deve ter sido migrado (falha de autenticação não migra)
      const after = await db.get("SELECT password_hash FROM users WHERE username = ?", ["legacy_user2"]);
      expect(after.password_hash).toMatch(/^\$2[ab]\$/);
    }, 30_000);
  });

  // ── Fluxos de mudança de senha ────────────────────────────────────────────
  describe("Mudança de senha usa Argon2id", () => {
    let authCookie;
    let csrfToken;

    beforeAll(async () => {
      await request.post("/api/auth/register").send({
        username: "change_pw_user",
        name: "Change PW",
        role: "aluno",
        email: "changepw@test.com",
        password: "Change@Pass1",
      });

      const loginRes = await request.post("/api/auth/login").send({
        identifier: "changepw@test.com",
        password: "Change@Pass1",
      });
      const cookies = loginRes.headers["set-cookie"] || [];
      const authEntry = cookies.find(c => c.startsWith("campusflow_token="));
      const csrfEntry = cookies.find(c => c.startsWith("csrf_token="));
      authCookie = authEntry ? authEntry.split(";")[0] : "";
      csrfToken  = csrfEntry ? decodeURIComponent(csrfEntry.split(";")[0].slice("csrf_token=".length)) : "";
    }, 60_000);

    test("change-password salva hash Argon2id", async () => {
      const res = await request
        .post("/api/auth/change-password")
        .set("Cookie", `${authCookie}; csrf_token=${csrfToken}`)
        .set("X-CSRF-Token", csrfToken)
        .send({ newPassword: "Changed@Pass2" });
      expect(res.status).toBe(200);

      const user = await db.get("SELECT password_hash FROM users WHERE username = ?", ["change_pw_user"]);
      expect(user.password_hash).toMatch(/^\$argon2id/);
    }, 30_000);
  });
});
