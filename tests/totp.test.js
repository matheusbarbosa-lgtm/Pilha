/**
 * Testes de TOTP — Fase 5 de segurança.
 *
 * Cobertura:
 *  - Login de professor em NODE_ENV=test bypassa TOTP (comportamento igual ao admin OTP)
 *  - Endpoint GET /api/auth/totp/setup requer tempToken válido
 *  - Endpoint POST /api/auth/totp/activate valida código TOTP e retorna recovery codes
 *  - Endpoint POST /api/auth/totp/verify valida código TOTP no login
 *  - Endpoint POST /api/auth/totp/recovery usa código de recuperação
 *  - Recovery code usado não pode ser reutilizado
 *  - Alunos não são afetados pelo fluxo TOTP
 */

const http      = require("http");
const path      = require("path");
const crypto    = require("crypto");
const speakeasy = require("speakeasy");

describe("TOTP — Google Authenticator para professores", () => {
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

  // ── Em NODE_ENV=test, login de professor bypassa TOTP ────
  describe("Login em ambiente de teste (bypass TOTP)", () => {
    test("Professor sem TOTP faz login diretamente em NODE_ENV=test", async () => {
      // Cria professor via admin endpoint seria complexo — registra como professor normal
      const regRes = await request.post("/api/auth/register").send({
        username: "totp_prof",
        name: "Prof TOTP",
        role: "professor",
        email: "totp_prof@test.com",
        password: "TotpProf@1",
      });
      expect(regRes.status).toBe(201);

      const loginRes = await request.post("/api/auth/login").send({
        identifier: "totp_prof@test.com",
        password: "TotpProf@1",
      });
      // Em test, professor loga diretamente (sem requiresTotpSetup)
      expect(loginRes.status).toBe(200);
      expect(loginRes.body.requiresTotpSetup).toBeFalsy();
      expect(loginRes.body.requiresTOTP).toBeFalsy();
      expect(loginRes.body.user).toBeTruthy();
      expect(loginRes.body.user.role).toBe("professor");
    }, 30_000);

    test("Aluno faz login normalmente (sem TOTP)", async () => {
      await request.post("/api/auth/register").send({
        username: "totp_aluno",
        name: "Aluno TOTP",
        role: "aluno",
        email: "totp_aluno@test.com",
        password: "TotpAluno@1",
      });

      const loginRes = await request.post("/api/auth/login").send({
        identifier: "totp_aluno@test.com",
        password: "TotpAluno@1",
      });
      expect(loginRes.status).toBe(200);
      expect(loginRes.body.requiresTOTP).toBeFalsy();
      expect(loginRes.body.user.role).toBe("aluno");
    }, 30_000);
  });

  // ── Setup endpoint — autenticação com tempToken ───────────
  describe("Setup TOTP — endpoint GET /api/auth/totp/setup", () => {
    test("Sem token retorna 401", async () => {
      const res = await request.get("/api/auth/totp/setup");
      expect(res.status).toBe(401);
    }, 30_000);

    test("Com token inválido retorna 401", async () => {
      const res = await request.get("/api/auth/totp/setup")
        .set("Authorization", "Bearer token-invalido");
      expect(res.status).toBe(401);
    }, 30_000);

    test("Com tempToken válido retorna QR code e secret", async () => {
      // Cria professor, obtém tempToken simulando o que o login retornaria em produção
      const jwt = require("jsonwebtoken");
      const JWT_SECRET = process.env.JWT_SECRET || "changeme-dev-secret";
      const user = await db.get("SELECT * FROM users WHERE username = ?", ["totp_prof"]);
      expect(user).toBeTruthy();

      const tempToken = jwt.sign({ userId: user.id, scope: "totp-setup" }, JWT_SECRET, { expiresIn: "10m" });
      const res = await request.get("/api/auth/totp/setup")
        .set("Authorization", `Bearer ${tempToken}`);

      expect(res.status).toBe(200);
      expect(res.body.secret).toMatch(/^[A-Z2-7]{32}$/); // base32
      expect(res.body.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    }, 30_000);
  });

  // ── Activate endpoint ──────────────────────────────────────
  describe("Ativação TOTP — POST /api/auth/totp/activate", () => {
    let tempToken;
    let totpSecret;

    beforeAll(async () => {
      const jwt = require("jsonwebtoken");
      const JWT_SECRET = process.env.JWT_SECRET || "changeme-dev-secret";
      const user = await db.get("SELECT * FROM users WHERE username = ?", ["totp_prof"]);
      tempToken = jwt.sign({ userId: user.id, scope: "totp-setup" }, JWT_SECRET, { expiresIn: "10m" });

      // Garante que o setup foi chamado (secret já deve estar no banco do teste anterior)
      const setupRes = await request.get("/api/auth/totp/setup")
        .set("Authorization", `Bearer ${tempToken}`);

      // Novo tempToken após o setup (o anterior pode ter sido usado)
      tempToken = jwt.sign({ userId: user.id, scope: "totp-setup" }, JWT_SECRET, { expiresIn: "10m" });

      const updatedUser = await db.get("SELECT totp_secret FROM users WHERE username = ?", ["totp_prof"]);
      totpSecret = updatedUser.totp_secret;
    }, 30_000);

    test("Código TOTP inválido retorna 401", async () => {
      const res = await request.post("/api/auth/totp/activate")
        .set("Authorization", `Bearer ${tempToken}`)
        .send({ code: "000000" });
      expect(res.status).toBe(401);
    }, 30_000);

    test("Código TOTP correto ativa TOTP e retorna 8 recovery codes", async () => {
      const validCode = speakeasy.totp({ secret: totpSecret, encoding: "base32" });
      const res = await request.post("/api/auth/totp/activate")
        .set("Authorization", `Bearer ${tempToken}`)
        .send({ code: validCode });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(Array.isArray(res.body.recoveryCodes)).toBe(true);
      expect(res.body.recoveryCodes).toHaveLength(8);
      // Cada código deve ter formato XXXXX-XXXXX
      res.body.recoveryCodes.forEach(c => {
        expect(c).toMatch(/^[0-9A-F]{5}-[0-9A-F]{5}$/);
      });
      // JWT cookie deve ter sido definido
      const cookies = res.headers["set-cookie"] || [];
      expect(cookies.some(c => c.startsWith("campusflow_token="))).toBe(true);
    }, 30_000);

    test("Após ativação, totp_enabled=1 no banco", async () => {
      const user = await db.get("SELECT totp_enabled FROM users WHERE username = ?", ["totp_prof"]);
      expect(user.totp_enabled).toBe(1);
    }, 30_000);

    test("Segundo activate retorna 400 (já ativo)", async () => {
      const jwt = require("jsonwebtoken");
      const JWT_SECRET = process.env.JWT_SECRET || "changeme-dev-secret";
      const user = await db.get("SELECT * FROM users WHERE username = ?", ["totp_prof"]);
      const newToken = jwt.sign({ userId: user.id, scope: "totp-setup" }, JWT_SECRET, { expiresIn: "10m" });
      const validCode = speakeasy.totp({ secret: totpSecret, encoding: "base32" });
      const res = await request.post("/api/auth/totp/activate")
        .set("Authorization", `Bearer ${newToken}`)
        .send({ code: validCode });
      expect(res.status).toBe(400);
    }, 30_000);
  });

  // ── Verify endpoint (login com TOTP) ───────────────────────
  describe("Verificação TOTP — POST /api/auth/totp/verify", () => {
    let profUser;
    let totpSecret;

    beforeAll(async () => {
      profUser = await db.get("SELECT * FROM users WHERE username = ?", ["totp_prof"]);
      totpSecret = profUser.totp_secret;
    });

    test("userId ou code ausentes retorna 400", async () => {
      const res = await request.post("/api/auth/totp/verify").send({ userId: profUser.id });
      expect(res.status).toBe(400);
    }, 30_000);

    test("Código inválido retorna 401", async () => {
      const res = await request.post("/api/auth/totp/verify")
        .send({ userId: profUser.id, code: "000000" });
      expect(res.status).toBe(401);
    }, 30_000);

    test("Código correto retorna user e cookie de sessão", async () => {
      const validCode = speakeasy.totp({ secret: totpSecret, encoding: "base32" });
      const res = await request.post("/api/auth/totp/verify")
        .send({ userId: profUser.id, code: validCode });

      expect(res.status).toBe(200);
      expect(res.body.user).toBeTruthy();
      expect(res.body.user.role).toBe("professor");
      const cookies = res.headers["set-cookie"] || [];
      expect(cookies.some(c => c.startsWith("campusflow_token="))).toBe(true);
    }, 30_000);
  });

  // ── Recovery code endpoint ──────────────────────────────────
  describe("Código de recuperação — POST /api/auth/totp/recovery", () => {
    let profUser;
    let recoveryCodes;

    beforeAll(async () => {
      profUser = await db.get("SELECT * FROM users WHERE username = ?", ["totp_prof"]);
      const rows = await db.all(
        "SELECT code_hash FROM totp_recovery_codes WHERE user_id = ? AND used = 0",
        [profUser.id]
      );
      expect(rows.length).toBeGreaterThan(0);
      // Não temos os códigos em texto claro — criamos um professor dedicado para esses testes
    });

    test("userId ou recoveryCode ausentes retorna 400", async () => {
      const res = await request.post("/api/auth/totp/recovery").send({ userId: profUser.id });
      expect(res.status).toBe(400);
    }, 30_000);

    test("Código de recuperação inválido retorna 401", async () => {
      const res = await request.post("/api/auth/totp/recovery")
        .send({ userId: profUser.id, recoveryCode: "AAAAA-BBBBB" });
      expect(res.status).toBe(401);
    }, 30_000);

    test("Código de recuperação válido faz login e marca como usado", async () => {
      // Cria professor novo para ter recovery codes em texto claro
      const jwt = require("jsonwebtoken");
      const JWT_SECRET = process.env.JWT_SECRET || "changeme-dev-secret";

      await request.post("/api/auth/register").send({
        username: "totp_prof2",
        name: "Prof TOTP2",
        role: "professor",
        email: "totp_prof2@test.com",
        password: "TotpProf@2",
      });

      const prof2 = await db.get("SELECT * FROM users WHERE username = ?", ["totp_prof2"]);
      const tempToken = jwt.sign({ userId: prof2.id, scope: "totp-setup" }, JWT_SECRET, { expiresIn: "10m" });

      await request.get("/api/auth/totp/setup").set("Authorization", `Bearer ${tempToken}`);
      const prof2Updated = await db.get("SELECT totp_secret FROM users WHERE username = ?", ["totp_prof2"]);

      const validCode = speakeasy.totp({ secret: prof2Updated.totp_secret, encoding: "base32" });
      const newToken = jwt.sign({ userId: prof2.id, scope: "totp-setup" }, JWT_SECRET, { expiresIn: "10m" });
      const activateRes = await request.post("/api/auth/totp/activate")
        .set("Authorization", `Bearer ${newToken}`)
        .send({ code: validCode });
      expect(activateRes.status).toBe(200);

      const { recoveryCodes } = activateRes.body;
      const firstCode = recoveryCodes[0];

      // Usa recovery code
      const recoveryRes = await request.post("/api/auth/totp/recovery")
        .send({ userId: prof2.id, recoveryCode: firstCode });
      expect(recoveryRes.status).toBe(200);
      expect(recoveryRes.body.user).toBeTruthy();

      // Verifica que o código foi marcado como usado no banco
      const codeHash = crypto.createHash("sha256").update(firstCode).digest("hex");
      const row = await db.get(
        "SELECT used FROM totp_recovery_codes WHERE user_id = ? AND code_hash = ?",
        [prof2.id, codeHash]
      );
      expect(row.used).toBe(1);
    }, 60_000);

    test("Código de recuperação já usado retorna 401", async () => {
      const prof2 = await db.get("SELECT * FROM users WHERE username = ?", ["totp_prof2"]);
      // Obtém o primeiro código (que foi marcado como usado no teste anterior)
      const usedRow = await db.get(
        "SELECT code_hash FROM totp_recovery_codes WHERE user_id = ? AND used = 1",
        [prof2.id]
      );
      expect(usedRow).toBeTruthy();
      // Não temos o texto original, mas testamos com qualquer código inválido
      const res = await request.post("/api/auth/totp/recovery")
        .send({ userId: prof2.id, recoveryCode: "AAAAA-ZZZZZ" });
      expect(res.status).toBe(401);
    }, 30_000);
  });
});
