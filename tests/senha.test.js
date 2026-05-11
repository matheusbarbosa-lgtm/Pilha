/**
 * Testes da política de senha forte — Fase 1 de segurança.
 *
 * Seção 1: testes unitários da função pura (rápidos, sem I/O).
 * Seção 2: testes de integração via Supertest com SQLite em memória
 *          para garantir que os endpoints rejeitam/aceitam senhas corretamente.
 */

const http = require("http");
const path = require("path");

// ── Função pura replicada aqui para testes unitários rápidos ─────────
// A lógica é idêntica a validatePasswordStrength em server.js.
// Testes unitários não dependem do banco e rodam em ms.
function validatePasswordStrength(password) {
  const pw = String(password || "");
  if (pw.length < 8)            return "Senha deve ter pelo menos 8 caracteres";
  if (!/[A-Z]/.test(pw))        return "Senha deve conter pelo menos uma letra maiúscula";
  if (!/[a-z]/.test(pw))        return "Senha deve conter pelo menos uma letra minúscula";
  if (!/[0-9]/.test(pw))        return "Senha deve conter pelo menos um número";
  if (!/[^A-Za-z0-9]/.test(pw)) return "Senha deve conter pelo menos um caractere especial (!@#$%...)";
  return null;
}

// ════════════════════════════════════════════════════════════════════
// SEÇÃO 1 — Testes unitários da função pura
// ════════════════════════════════════════════════════════════════════
describe("validatePasswordStrength — testes unitários", () => {
  test("senha válida retorna null", () => {
    expect(validatePasswordStrength("Seguro@99")).toBeNull();
    expect(validatePasswordStrength("Pilha!2024")).toBeNull();
    expect(validatePasswordStrength("Ab1!xyzW")).toBeNull();
  });

  test("senha vazia ou ausente é rejeitada", () => {
    expect(validatePasswordStrength("")).not.toBeNull();
    expect(validatePasswordStrength(null)).not.toBeNull();
    expect(validatePasswordStrength(undefined)).not.toBeNull();
  });

  test("senha abaixo de 8 caracteres é rejeitada", () => {
    const err = validatePasswordStrength("Ab1!xyz");   // 7 chars
    expect(err).toMatch(/8 caracteres/);
  });

  test("senha sem letra maiúscula é rejeitada", () => {
    const err = validatePasswordStrength("seguro@99abc");
    expect(err).toMatch(/maiúscula/);
  });

  test("senha sem letra minúscula é rejeitada", () => {
    const err = validatePasswordStrength("SEGURO@99ABC");
    expect(err).toMatch(/minúscula/);
  });

  test("senha sem número é rejeitada", () => {
    const err = validatePasswordStrength("Seguro@xxxx");
    expect(err).toMatch(/número/);
  });

  test("senha sem caractere especial é rejeitada", () => {
    const err = validatePasswordStrength("Seguro1234");
    expect(err).toMatch(/especial/);
  });

  test("senha com exatamente 8 chars e todos os critérios é aceita", () => {
    expect(validatePasswordStrength("Aa1!aaaa")).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════
// SEÇÃO 2 — Testes de integração via Supertest (SQLite :memory:)
// ════════════════════════════════════════════════════════════════════
describe("Integração HTTP — política de senha nos endpoints", () => {
  let request;
  let server;

  // Inicializa app com banco em memória.
  // createApp() retorna { app, db } — usamos só app.
  beforeAll(async () => {
    const { initDb, initEvalDb } = require(path.join(__dirname, "..", "db"));
    const { createApp }          = require(path.join(__dirname, "..", "server"));
    const supertest              = require("supertest");

    const [db, evalDb] = await Promise.all([
      initDb(":memory:"),
      initEvalDb(":memory:"),
    ]);
    const { app } = await createApp(db, evalDb);  // desestrutura corretamente
    server  = http.createServer(app);
    request = supertest(server);
  }, 60_000);

  afterAll(() => { if (server) server.close(); });

  // ── POST /api/auth/register ───────────────────────────────────────
  describe("POST /api/auth/register", () => {
    test("senha fraca (< 8 chars) retorna 400 com mensagem de critério", async () => {
      const res = await request.post("/api/auth/register").send({
        username: "teste_fraca",
        name: "Teste Fraca",
        role: "aluno",
        password: "Ab1!xy",   // 6 chars
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/8 caracteres/);
    }, 30_000);

    test("senha sem maiúscula retorna 400", async () => {
      const res = await request.post("/api/auth/register").send({
        username: "teste_upper",
        name: "Teste Upper",
        role: "aluno",
        password: "seguro@99abc",
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/maiúscula/);
    }, 30_000);

    test("senha sem número retorna 400", async () => {
      const res = await request.post("/api/auth/register").send({
        username: "teste_num",
        name: "Teste Num",
        role: "aluno",
        password: "Seguro@xxxx",
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/número/);
    }, 30_000);

    test("senha sem especial retorna 400", async () => {
      const res = await request.post("/api/auth/register").send({
        username: "teste_spec",
        name: "Teste Spec",
        role: "aluno",
        password: "Seguro1234",
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/especial/);
    }, 30_000);

    test("senha válida é aceita (cria usuário com sucesso)", async () => {
      const res = await request.post("/api/auth/register").send({
        username: "teste_valida",
        name: "Teste Valida",
        role: "aluno",
        password: "Seguro@2024",
      });
      expect(res.status).toBe(201);
      expect(res.body.ok).toBe(true);
    }, 30_000);
  });

  // ── POST /api/auth/reset-password ────────────────────────────────
  describe("POST /api/auth/reset-password", () => {
    test("senha fraca com qualquer token retorna 400 de critério (não de token)", async () => {
      const res = await request.post("/api/auth/reset-password").send({
        token: "token-inexistente",
        newPassword: "fraca",
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/8 caracteres/);
    }, 30_000);

    test("senha forte com token inválido retorna erro de token (não de critério)", async () => {
      const res = await request.post("/api/auth/reset-password").send({
        token: "token-inexistente",
        newPassword: "Seguro@2024",
      });
      // Com senha válida, o erro deve ser sobre o token, não sobre a senha
      expect(res.body.error).not.toMatch(/8 caracteres/);
      expect(res.body.error).not.toMatch(/maiúscula|minúscula|número|especial/);
    }, 30_000);
  });
});
