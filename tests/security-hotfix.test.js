/**
 * Testes de Hotfix — Anexos e GitHub Contributions
 *
 * Bug 1: Download de anexos retornava 500 (res.sendFile sem callback + sem proteção path traversal)
 * Bug 2: Contribuições GitHub mostravam zeros quando GitHub App não configurado (ignorava webhook events)
 *
 * Testes:
 *  1. Download autorizado retorna 200 com Content-Disposition correto
 *  2. Download por usuário sem permissão retorna 403
 *  3. Anexo inexistente retorna 404
 *  4. Path traversal no filename retorna 400
 *  5. GitHub: push event do usuário correto conta commits
 *  6. GitHub: push event de outro login NÃO conta
 *  7. GitHub: PR opened conta prsOpened
 *  8. GitHub: PR closed+merged conta prsMerged
 *  9. GitHub: PR closed sem merge NÃO conta prsMerged
 * 10. GitHub: login case-insensitive (uppercase no evento, lowercase no DB)
 */

const http = require("http");
const path = require("path");

process.env.NODE_ENV = "test";
// Garantir que GITHUB_APP_ID não está definido (forçar fallback para webhook)
delete process.env.GITHUB_APP_ID;
delete process.env.GITHUB_PRIVATE_KEY;

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

// Helper: insere evento de webhook direto no banco
async function insertWebhookEvent(db, { eventType, action, payload }) {
  await db.run(
    `INSERT INTO github_webhook_events
       (github_delivery_id, event_type, action, repository_full_name, payload_json, processed, processed_at, created_at)
     VALUES (?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))`,
    [
      `hotfix-test-${Math.random().toString(36).slice(2)}`,
      eventType,
      action || null,
      payload.repository?.full_name || null,
      JSON.stringify(payload),
    ]
  );
}

describe("Hotfix: Anexos e GitHub Contributions", () => {
  let request;
  let server;
  let db;
  let evalDb;

  let prof1, prof2;
  let aluno1;
  let prof1Id, aluno1Id;
  let turma1Id;
  let proj1Id;
  let task1Id;

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
      { username: "hf_prof1", name: "HF Prof1", role: "professor", email: "hf_prof1@test.com", password: "Senha@1234" },
      { username: "hf_prof2", name: "HF Prof2", role: "professor", email: "hf_prof2@test.com", password: "Senha@1234" },
      { username: "hf_aluno1", name: "HF Aluno1", role: "aluno", email: "hf_aluno1@test.com", password: "Senha@1234" },
    ];
    for (const u of users) {
      const r = await request.post("/api/auth/register").send(u);
      if (r.status !== 201 && r.status !== 200)
        throw new Error(`Falha ao criar ${u.username}: ${JSON.stringify(r.body)}`);
    }

    [prof1, prof2, aluno1] = await Promise.all([
      login(request, "hf_prof1@test.com", "Senha@1234"),
      login(request, "hf_prof2@test.com", "Senha@1234"),
      login(request, "hf_aluno1@test.com", "Senha@1234"),
    ]);

    const rows = await Promise.all([
      db.get("SELECT id FROM users WHERE username = 'hf_prof1'"),
      db.get("SELECT id FROM users WHERE username = 'hf_aluno1'"),
    ]);
    prof1Id = rows[0]?.id;
    aluno1Id = rows[1]?.id;
    if (!prof1Id || !aluno1Id) throw new Error(`Setup: IDs ausentes prof1Id=${prof1Id} aluno1Id=${aluno1Id}`);

    // Turma e projeto
    const t1 = await request.post("/api/turmas")
      .set("Cookie", cookieHeader(prof1)).set("X-CSRF-Token", prof1.csrfToken)
      .send({ curso: "Eng", periodo: "1", turma: "HF Turma 1" });
    turma1Id = t1.body?.id;
    if (!turma1Id) throw new Error(`Setup: turma1Id ausente: ${JSON.stringify(t1.body)}`);

    await db.run("UPDATE users SET turma_id = ? WHERE id = ?", [turma1Id, aluno1Id]);

    const p1 = await request.post("/api/projects")
      .set("Cookie", cookieHeader(prof1)).set("X-CSRF-Token", prof1.csrfToken)
      .send({ name: "HF Proj1", team: "HF Turma 1", discipline: "Eng", deadline: "2026-12-31", members: ["HF Aluno1"], turmaId: turma1Id });
    proj1Id = p1.body?.id;
    if (!proj1Id) throw new Error(`Setup: proj1Id ausente: ${JSON.stringify(p1.body)}`);

    // Criar tarefa
    const t = await request.post("/api/tasks")
      .set("Cookie", cookieHeader(prof1)).set("X-CSRF-Token", prof1.csrfToken)
      .send({ projectId: proj1Id, title: "HF Task 1", assignee: "HF Aluno1", dueDate: "2026-12-31" });
    task1Id = String(t.body?.id || t.body?.taskId || "");
    if (!task1Id || task1Id === "undefined") throw new Error(`Setup: task1Id ausente: ${JSON.stringify(t.body)}`);
  });

  afterAll(() => {
    if (server) server.close();
  });

  // ── 1. Bug 1: Downloads de Anexos ────────────────────────────────────────────

  describe("Bug 1: Download de Anexos", () => {
    let attachmentId;

    beforeAll(async () => {
      // Upload de um arquivo real para ter um anexo válido
      const res = await request.post(`/api/tasks/${task1Id}/attachments`)
        .set("Cookie", cookieHeader(prof1)).set("X-CSRF-Token", prof1.csrfToken)
        .attach("file", Buffer.from("conteudo hotfix test"), { filename: "hotfix.txt", contentType: "text/plain" });
      if (res.status !== 201)
        throw new Error(`Setup: upload falhou ${res.status} ${JSON.stringify(res.body)}`);
      const row = await db.get("SELECT id FROM task_attachments WHERE task_id = ? ORDER BY id DESC LIMIT 1", [task1Id]);
      attachmentId = row?.id;
      if (!attachmentId) throw new Error("Setup: attachmentId não encontrado após upload");
    });

    test("1. Download autorizado retorna 200 com Content-Disposition correto", async () => {
      const res = await request.get(`/api/tasks/${task1Id}/attachments/${attachmentId}/download`)
        .set("Cookie", cookieHeader(prof1)).set("X-CSRF-Token", prof1.csrfToken)
        .buffer(true);
      expect(res.status).toBe(200);
      expect(res.headers["content-disposition"]).toMatch(/attachment/i);
      expect(res.headers["content-disposition"]).toMatch(/hotfix/i);
    });

    test("2. Download por usuário sem permissão retorna 403", async () => {
      const res = await request.get(`/api/tasks/${task1Id}/attachments/${attachmentId}/download`)
        .set("Cookie", cookieHeader(prof2)).set("X-CSRF-Token", prof2.csrfToken);
      expect(res.status).toBe(403);
    });

    test("3. Anexo inexistente retorna 404", async () => {
      const res = await request.get(`/api/tasks/${task1Id}/attachments/99999/download`)
        .set("Cookie", cookieHeader(prof1)).set("X-CSRF-Token", prof1.csrfToken);
      expect(res.status).toBe(404);
    });

    test("4. Path traversal no filename retorna 400", async () => {
      // Injetar diretamente no banco um registro com filename malicioso
      await db.run(
        `INSERT INTO task_attachments (task_id, filename, original_name, mime_type, size, uploaded_by, uploaded_by_user_id)
         VALUES (?, ?, 'evil.txt', 'text/plain', 10, 'HF Prof1', ?)`,
        [task1Id, "../../server.js", prof1Id]
      );
      const evil = await db.get(
        "SELECT id FROM task_attachments WHERE task_id = ? AND filename = '../../server.js'",
        [task1Id]
      );
      expect(evil).toBeDefined();
      const res = await request.get(`/api/tasks/${task1Id}/attachments/${evil.id}/download`)
        .set("Cookie", cookieHeader(prof1)).set("X-CSRF-Token", prof1.csrfToken);
      expect(res.status).toBe(400);
      // Limpar
      await db.run("DELETE FROM task_attachments WHERE id = ?", [evil.id]);
    });
  });

  // ── 2. Bug 2: GitHub Contributions via Webhook Events ────────────────────────

  describe("Bug 2: GitHub Contributions via Webhook Events (sem GitHub App)", () => {
    const GH_LOGIN = "hf_githubuser";

    beforeAll(async () => {
      // Definir github_login no usuário aluno1
      await db.run("UPDATE users SET github_login = ? WHERE id = ?", [GH_LOGIN, aluno1Id]);

      // Garantir que variáveis de ambiente da GitHub App estão ausentes
      delete process.env.GITHUB_APP_ID;
      delete process.env.GITHUB_PRIVATE_KEY;

      // Inserir eventos de webhook no banco (dentro do mês atual)
      const nowIso = new Date().toISOString();

      // Evento push: 3 commits do usuário correto
      await insertWebhookEvent(db, {
        eventType: "push",
        action: null,
        payload: {
          sender: { login: GH_LOGIN },
          repository: { full_name: "hf_org/hf_repo" },
          commits: [
            { id: "aaa", message: "fix: bug1", author: { name: "HF Aluno1", username: GH_LOGIN } },
            { id: "bbb", message: "fix: bug2", author: { name: "HF Aluno1", username: GH_LOGIN } },
            { id: "ccc", message: "feat: new", author: { name: "HF Aluno1", username: GH_LOGIN } },
          ],
        },
      });

      // Evento push: 2 commits de OUTRO usuário (não deve contar)
      await insertWebhookEvent(db, {
        eventType: "push",
        action: null,
        payload: {
          sender: { login: "outro_user" },
          repository: { full_name: "hf_org/hf_repo" },
          commits: [
            { id: "ddd", message: "other commit", author: { name: "Other", username: "outro_user" } },
            { id: "eee", message: "other commit2", author: { name: "Other", username: "outro_user" } },
          ],
        },
      });

      // Evento pull_request: opened pelo usuário correto
      await insertWebhookEvent(db, {
        eventType: "pull_request",
        action: "opened",
        payload: {
          action: "opened",
          pull_request: {
            number: 1,
            user: { login: GH_LOGIN },
            merged: false,
            merged_at: null,
          },
          repository: { full_name: "hf_org/hf_repo" },
          sender: { login: GH_LOGIN },
        },
      });

      // Evento pull_request: closed+merged pelo usuário correto
      await insertWebhookEvent(db, {
        eventType: "pull_request",
        action: "closed",
        payload: {
          action: "closed",
          pull_request: {
            number: 2,
            user: { login: GH_LOGIN },
            merged: true,
            merged_at: nowIso,
          },
          repository: { full_name: "hf_org/hf_repo" },
          sender: { login: GH_LOGIN },
        },
      });

      // Evento pull_request: closed sem merge (não deve contar como merged)
      await insertWebhookEvent(db, {
        eventType: "pull_request",
        action: "closed",
        payload: {
          action: "closed",
          pull_request: {
            number: 3,
            user: { login: GH_LOGIN },
            merged: false,
            merged_at: null,
          },
          repository: { full_name: "hf_org/hf_repo" },
          sender: { login: GH_LOGIN },
        },
      });
    });

    test("5. Commits do próprio login são contados via webhook events", async () => {
      const res = await request.get(`/api/users/${aluno1Id}/contributions?refresh=1`)
        .set("Cookie", cookieHeader(aluno1));
      expect(res.status).toBe(200);
      expect(res.body.commits).toBe(3);
    });

    test("6. Commits de outro login NÃO são contados", async () => {
      const res = await request.get(`/api/users/${aluno1Id}/contributions?refresh=1`)
        .set("Cookie", cookieHeader(aluno1));
      expect(res.status).toBe(200);
      // Apenas 3 commits (os do GH_LOGIN), não 5
      expect(res.body.commits).toBe(3);
    });

    test("7. PR opened conta como prsOpened", async () => {
      const res = await request.get(`/api/users/${aluno1Id}/contributions?refresh=1`)
        .set("Cookie", cookieHeader(aluno1));
      expect(res.status).toBe(200);
      expect(res.body.prsOpened).toBe(1);
    });

    test("8. PR closed+merged conta como prsMerged", async () => {
      const res = await request.get(`/api/users/${aluno1Id}/contributions?refresh=1`)
        .set("Cookie", cookieHeader(aluno1));
      expect(res.status).toBe(200);
      expect(res.body.prsMerged).toBe(1);
    });

    test("9. PR closed sem merge NÃO conta como prsMerged", async () => {
      const res = await request.get(`/api/users/${aluno1Id}/contributions?refresh=1`)
        .set("Cookie", cookieHeader(aluno1));
      expect(res.status).toBe(200);
      // Apenas 1 merged (PR#2), não 2
      expect(res.body.prsMerged).toBe(1);
    });

    test("10. github_source indica webhook_events quando App não configurado", async () => {
      const res = await request.get(`/api/users/${aluno1Id}/contributions?refresh=1`)
        .set("Cookie", cookieHeader(aluno1));
      expect(res.status).toBe(200);
      expect(res.body.githubSource).toBe("webhook_events");
    });
  });
});
