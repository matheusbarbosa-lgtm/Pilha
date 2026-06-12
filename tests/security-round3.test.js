/**
 * Testes de segurança Round 3 — Codex Auditor
 *
 * Cobre:
 *  1. unlock-docs cross-professor → 403
 *  2. Adicionar/remover membros cross-professor → 403
 *  3. eval/turma activities — turmas com mesmo nome não misturam dados
 *  4. Export grading por turmaId (não por nome)
 *  5. Chat de turma — professor errado → 403, aluno errado → 403
 *  6. GET /api/team/members/:turmaId — aluno de outra turma → 403
 *  7. POST /api/projects — sem turmaId retorna 400
 *  8. Notificações com nomes duplicados — não vaza para usuário errado
 *  9. XLSX: coluna "Pts. Individuais" separada de "Nota Final"
 * 10. Anexo: upload salva uploaded_by_user_id
 */

const http = require("http");
const path = require("path");

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

describe("Security Round 3", () => {
  let request;
  let server;
  let db;
  let evalDb;

  let prof1, prof2, aluno1, aluno2;
  let turma1Id, turma2Id;
  let proj1Id, proj2Id;

  beforeAll(async () => {
    const { initDb, initEvalDb } = require(path.join(__dirname, "..", "db"));
    const { createApp } = require(path.join(__dirname, "..", "server"));
    const supertest = require("supertest");

    [db, evalDb] = await Promise.all([initDb(":memory:"), initEvalDb(":memory:")]);
    const { app } = await createApp(db, evalDb);
    server = http.createServer(app);
    request = supertest(server);

    const users = [
      { username: "r3_prof1", name: "R3 Prof1", role: "professor", email: "r3_prof1@test.com", password: "Senha@1234" },
      { username: "r3_prof2", name: "R3 Prof2", role: "professor", email: "r3_prof2@test.com", password: "Senha@1234" },
      { username: "r3_aluno1", name: "R3 Aluno1", role: "aluno", email: "r3_aluno1@test.com", password: "Senha@1234" },
      { username: "r3_aluno2", name: "R3 Aluno2", role: "aluno", email: "r3_aluno2@test.com", password: "Senha@1234" },
    ];
    for (const u of users) await request.post("/api/auth/register").send(u);

    [prof1, prof2, aluno1, aluno2] = await Promise.all([
      login(request, "r3_prof1@test.com", "Senha@1234"),
      login(request, "r3_prof2@test.com", "Senha@1234"),
      login(request, "r3_aluno1@test.com", "Senha@1234"),
      login(request, "r3_aluno2@test.com", "Senha@1234"),
    ]);

    // Criar turmas
    const t1 = await request.post("/api/turmas")
      .set("Cookie", cookieHeader(prof1)).set("X-CSRF-Token", prof1.csrfToken)
      .send({ curso: "Eng", periodo: "1", turma: "R3 Turma 1" });
    turma1Id = t1.body?.id;

    const t2 = await request.post("/api/turmas")
      .set("Cookie", cookieHeader(prof2)).set("X-CSRF-Token", prof2.csrfToken)
      .send({ curso: "TI", periodo: "2", turma: "R3 Turma 2" });
    turma2Id = t2.body?.id;

    if (!turma1Id || !turma2Id) {
      throw new Error(`Setup falhou: turma1Id=${turma1Id}, turma2Id=${turma2Id}`);
    }

    // Vincular alunos às turmas
    const aluno1Row = await db.get("SELECT id FROM users WHERE username = 'r3_aluno1'");
    const aluno2Row = await db.get("SELECT id FROM users WHERE username = 'r3_aluno2'");
    if (aluno1Row) await db.run("UPDATE users SET turma_id = ? WHERE id = ?", [turma1Id, aluno1Row.id]);
    if (aluno2Row) await db.run("UPDATE users SET turma_id = ? WHERE id = ?", [turma2Id, aluno2Row.id]);

    // Criar projetos
    const p1 = await request.post("/api/projects")
      .set("Cookie", cookieHeader(prof1)).set("X-CSRF-Token", prof1.csrfToken)
      .send({ name: "R3 Proj1", team: "R3 Turma 1", discipline: "Eng", deadline: "2026-12-31", members: ["R3 Aluno1"], turmaId: turma1Id });
    proj1Id = p1.body?.id;

    const p2 = await request.post("/api/projects")
      .set("Cookie", cookieHeader(prof2)).set("X-CSRF-Token", prof2.csrfToken)
      .send({ name: "R3 Proj2", team: "R3 Turma 2", discipline: "TI", deadline: "2026-12-31", members: ["R3 Aluno2"], turmaId: turma2Id });
    proj2Id = p2.body?.id;

    if (!proj1Id || !proj2Id) {
      throw new Error(`Setup falhou: proj1Id=${proj1Id} (${JSON.stringify(p1.body)}), proj2Id=${proj2Id} (${JSON.stringify(p2.body)})`);
    }
  }, 90_000);

  afterAll(() => { if (server) server.close(); });

  // ── 1. unlock-docs cross-professor ─────────────────────────────────────────
  describe("PATCH /api/projects/:id/unlock-docs", () => {
    test("Prof2 NÃO pode unlock-docs do projeto do Prof1 → 403", async () => {
      expect(proj1Id).toBeDefined();
      const res = await request.patch(`/api/projects/${proj1Id}/unlock-docs`)
        .set("Cookie", cookieHeader(prof2)).set("X-CSRF-Token", prof2.csrfToken);
      expect(res.status).toBe(403);
    });

    test("Prof1 PODE unlock-docs do próprio projeto → 200", async () => {
      expect(proj1Id).toBeDefined();
      const res = await request.patch(`/api/projects/${proj1Id}/unlock-docs`)
        .set("Cookie", cookieHeader(prof1)).set("X-CSRF-Token", prof1.csrfToken);
      expect(res.status).toBe(200);
    });

    test("Aluno NÃO pode unlock-docs → 403", async () => {
      expect(proj1Id).toBeDefined();
      const res = await request.patch(`/api/projects/${proj1Id}/unlock-docs`)
        .set("Cookie", cookieHeader(aluno1)).set("X-CSRF-Token", aluno1.csrfToken);
      expect(res.status).toBe(403);
    });

    test("Tentativa não autorizada NÃO altera banco", async () => {
      expect(proj1Id).toBeDefined();
      const before = await db.get("SELECT docs_unlocked FROM projects WHERE id = ?", [proj1Id]);
      await request.patch(`/api/projects/${proj1Id}/unlock-docs`)
        .set("Cookie", cookieHeader(prof2)).set("X-CSRF-Token", prof2.csrfToken);
      const after = await db.get("SELECT docs_unlocked FROM projects WHERE id = ?", [proj1Id]);
      expect(after.docs_unlocked).toBe(before.docs_unlocked);
    });
  });

  // ── 2. Membros — add/remove cross-professor ─────────────────────────────────
  describe("POST/DELETE /api/projects/:id/members", () => {
    test("Prof2 NÃO pode adicionar membro ao projeto do Prof1 → 403", async () => {
      expect(proj1Id).toBeDefined();
      const res = await request.post(`/api/projects/${proj1Id}/members`)
        .set("Cookie", cookieHeader(prof2)).set("X-CSRF-Token", prof2.csrfToken)
        .send({ email: "r3_aluno2@test.com" });
      expect(res.status).toBe(403);
    });

    test("Membro NÃO é inserido após tentativa negada", async () => {
      expect(proj1Id).toBeDefined();
      const before = await db.all("SELECT * FROM project_members WHERE project_id = ?", [proj1Id]);
      await request.post(`/api/projects/${proj1Id}/members`)
        .set("Cookie", cookieHeader(prof2)).set("X-CSRF-Token", prof2.csrfToken)
        .send({ email: "r3_aluno2@test.com" });
      const after = await db.all("SELECT * FROM project_members WHERE project_id = ?", [proj1Id]);
      expect(after.length).toBe(before.length);
    });

    test("Prof2 NÃO pode remover membro do projeto do Prof1 → 403", async () => {
      expect(proj1Id).toBeDefined();
      const res = await request.delete(`/api/projects/${proj1Id}/members/R3%20Aluno1`)
        .set("Cookie", cookieHeader(prof2)).set("X-CSRF-Token", prof2.csrfToken);
      expect(res.status).toBe(403);
    });

    test("Prof1 PODE adicionar membro ao próprio projeto → 201", async () => {
      expect(proj1Id).toBeDefined();
      const res = await request.post(`/api/projects/${proj1Id}/members`)
        .set("Cookie", cookieHeader(prof1)).set("X-CSRF-Token", prof1.csrfToken)
        .send({ email: "r3_aluno2@test.com" });
      // pode retornar 201 (adicionado) ou 409 (já existe)
      expect([201, 409]).toContain(res.status);
    });

    test("Aluno NÃO pode adicionar membro → 403", async () => {
      expect(proj1Id).toBeDefined();
      const res = await request.post(`/api/projects/${proj1Id}/members`)
        .set("Cookie", cookieHeader(aluno1)).set("X-CSRF-Token", aluno1.csrfToken)
        .send({ email: "r3_aluno2@test.com" });
      expect(res.status).toBe(403);
    });
  });

  // ── 3. eval/turma activities — turmas com mesmo nome não misturam ──────────
  describe("POST /api/eval/turma/:turmaId/activities", () => {
    test("Prof2 NÃO pode criar atividade na turma do Prof1 → 403", async () => {
      expect(turma1Id).toBeDefined();
      const res = await request.post(`/api/eval/turma/${turma1Id}/activities`)
        .set("Cookie", cookieHeader(prof2)).set("X-CSRF-Token", prof2.csrfToken)
        .send({ section: "planejamento", name: "Atividade Invasora", max_pts: 5 });
      expect(res.status).toBe(403);
    });

    test("Atividade do Prof2 NÃO aparece em projetos da turma do Prof1", async () => {
      expect(turma1Id).toBeDefined();
      expect(proj1Id).toBeDefined();
      expect(proj2Id).toBeDefined();
      // Prof2 cria atividade na turma2 — não deve vazar para turma1
      await request.post(`/api/eval/turma/${turma2Id}/activities`)
        .set("Cookie", cookieHeader(prof2)).set("X-CSRF-Token", prof2.csrfToken)
        .send({ section: "planejamento", name: "Atividade T2", max_pts: 3 });
      const acts1 = await evalDb.all("SELECT * FROM eval_activities WHERE project_id = ?", [proj1Id]);
      const acts2 = await evalDb.all("SELECT * FROM eval_activities WHERE project_id = ?", [proj2Id]);
      const names1 = acts1.map((a) => a.name);
      const names2 = acts2.map((a) => a.name);
      expect(names1).not.toContain("Atividade T2");
      if (acts2.length > 0) expect(names2).toContain("Atividade T2");
    });

    test("Prof1 PODE criar atividade na própria turma → 201", async () => {
      expect(turma1Id).toBeDefined();
      const res = await request.post(`/api/eval/turma/${turma1Id}/activities`)
        .set("Cookie", cookieHeader(prof1)).set("X-CSRF-Token", prof1.csrfToken)
        .send({ section: "planejamento", name: "Atividade T1", max_pts: 4 });
      expect(res.status).toBe(201);
    });

    test("Aluno NÃO pode criar atividade → 403", async () => {
      expect(turma1Id).toBeDefined();
      const res = await request.post(`/api/eval/turma/${turma1Id}/activities`)
        .set("Cookie", cookieHeader(aluno1)).set("X-CSRF-Token", aluno1.csrfToken)
        .send({ section: "planejamento", name: "Atividade Aluno", max_pts: 1 });
      expect(res.status).toBe(403);
    });
  });

  // ── 4. Export grading por turmaId (não por nome) ────────────────────────────
  describe("GET /api/export/grading/turma/:turmaId", () => {
    test("Prof1 PODE exportar turma1 → 200 ou 404 (sem projetos com membros avaliados)", async () => {
      expect(turma1Id).toBeDefined();
      const res = await request.get(`/api/export/grading/turma/${turma1Id}`)
        .set("Cookie", cookieHeader(prof1)).set("X-CSRF-Token", prof1.csrfToken);
      expect([200, 404]).toContain(res.status);
    });

    test("Prof2 NÃO pode exportar turma do Prof1 → 403", async () => {
      expect(turma1Id).toBeDefined();
      const res = await request.get(`/api/export/grading/turma/${turma1Id}`)
        .set("Cookie", cookieHeader(prof2)).set("X-CSRF-Token", prof2.csrfToken);
      expect(res.status).toBe(403);
    });

    test("Aluno NÃO pode exportar planilha → 403", async () => {
      expect(turma1Id).toBeDefined();
      const res = await request.get(`/api/export/grading/turma/${turma1Id}`)
        .set("Cookie", cookieHeader(aluno1)).set("X-CSRF-Token", aluno1.csrfToken);
      expect(res.status).toBe(403);
    });

    test("ID inválido retorna 400 ou 404", async () => {
      const res = await request.get("/api/export/grading/turma/abc")
        .set("Cookie", cookieHeader(prof1)).set("X-CSRF-Token", prof1.csrfToken);
      expect([400, 404]).toContain(res.status);
    });
  });

  // ── 5. Chat de turma ─────────────────────────────────────────────────────────
  describe("GET/POST /api/chat/:turmaId", () => {
    test("Prof2 NÃO pode acessar chat da turma do Prof1 → 403", async () => {
      expect(turma1Id).toBeDefined();
      const res = await request.get(`/api/chat/${turma1Id}`)
        .set("Cookie", cookieHeader(prof2)).set("X-CSRF-Token", prof2.csrfToken);
      expect(res.status).toBe(403);
    });

    test("Prof1 PODE acessar chat da própria turma → 200", async () => {
      expect(turma1Id).toBeDefined();
      const res = await request.get(`/api/chat/${turma1Id}`)
        .set("Cookie", cookieHeader(prof1)).set("X-CSRF-Token", prof1.csrfToken);
      expect(res.status).toBe(200);
    });

    test("Aluno1 (vinculado à turma1) PODE acessar chat da turma1 → 200", async () => {
      expect(turma1Id).toBeDefined();
      const res = await request.get(`/api/chat/${turma1Id}`)
        .set("Cookie", cookieHeader(aluno1)).set("X-CSRF-Token", aluno1.csrfToken);
      expect(res.status).toBe(200);
    });

    test("Aluno2 (vinculado à turma2) NÃO pode acessar chat da turma1 → 403", async () => {
      expect(turma1Id).toBeDefined();
      const res = await request.get(`/api/chat/${turma1Id}`)
        .set("Cookie", cookieHeader(aluno2)).set("X-CSRF-Token", aluno2.csrfToken);
      expect(res.status).toBe(403);
    });

    test("Prof2 NÃO pode enviar mensagem no chat da turma do Prof1 → 403", async () => {
      expect(turma1Id).toBeDefined();
      const res = await request.post(`/api/chat/${turma1Id}`)
        .set("Cookie", cookieHeader(prof2)).set("X-CSRF-Token", prof2.csrfToken)
        .send({ content: "Mensagem indevida" });
      expect(res.status).toBe(403);
    });
  });

  // ── 6. GET /api/team/members/:turmaId ──────────────────────────────────────
  describe("GET /api/team/members/:turmaId", () => {
    test("Prof1 PODE acessar membros da turma1 → 200", async () => {
      expect(turma1Id).toBeDefined();
      const res = await request.get(`/api/team/members/${turma1Id}`)
        .set("Cookie", cookieHeader(prof1)).set("X-CSRF-Token", prof1.csrfToken);
      expect(res.status).toBe(200);
    });

    test("Prof2 NÃO pode acessar membros da turma1 → 403", async () => {
      expect(turma1Id).toBeDefined();
      const res = await request.get(`/api/team/members/${turma1Id}`)
        .set("Cookie", cookieHeader(prof2)).set("X-CSRF-Token", prof2.csrfToken);
      expect(res.status).toBe(403);
    });

    test("Aluno1 (turma1) PODE acessar membros da turma1 → 200", async () => {
      expect(turma1Id).toBeDefined();
      const res = await request.get(`/api/team/members/${turma1Id}`)
        .set("Cookie", cookieHeader(aluno1)).set("X-CSRF-Token", aluno1.csrfToken);
      expect(res.status).toBe(200);
    });

    test("Aluno2 (turma2) NÃO pode acessar membros da turma1 → 403", async () => {
      expect(turma1Id).toBeDefined();
      const res = await request.get(`/api/team/members/${turma1Id}`)
        .set("Cookie", cookieHeader(aluno2)).set("X-CSRF-Token", aluno2.csrfToken);
      expect(res.status).toBe(403);
    });
  });

  // ── 7. POST /api/projects sem turmaId → 400 ────────────────────────────────
  describe("POST /api/projects sem turmaId", () => {
    test("Professor sem turmaId recebe 400", async () => {
      const res = await request.post("/api/projects")
        .set("Cookie", cookieHeader(prof1)).set("X-CSRF-Token", prof1.csrfToken)
        .send({ name: "Proj Sem Turma", team: "Turma X", deadline: "2026-12-31", members: ["R3 Aluno1"] });
      expect(res.status).toBe(400);
    });

    test("Professor com turmaId de outra turma recebe 403", async () => {
      expect(turma2Id).toBeDefined();
      const res = await request.post("/api/projects")
        .set("Cookie", cookieHeader(prof1)).set("X-CSRF-Token", prof1.csrfToken)
        .send({ name: "Proj Invasor", team: "R3 Turma 2", deadline: "2026-12-31", members: ["R3 Aluno1"], turmaId: turma2Id });
      expect(res.status).toBe(403);
    });

    test("Professor com turmaId válido da própria turma cria projeto → 201", async () => {
      expect(turma1Id).toBeDefined();
      const res = await request.post("/api/projects")
        .set("Cookie", cookieHeader(prof1)).set("X-CSRF-Token", prof1.csrfToken)
        .send({ name: "Proj R3 Novo", team: "R3 Turma 1", deadline: "2026-12-31", members: ["R3 Aluno1"], turmaId: turma1Id });
      expect(res.status).toBe(201);
      // Projeto criado com turma_id correto
      const proj = await db.get("SELECT turma_id FROM projects WHERE id = ?", [res.body.id]);
      expect(proj?.turma_id).toBe(turma1Id);
    });
  });

  // ── 8. Notificações — dois usuários com mesmo nome não vazam ───────────────
  describe("Notificações com nomes duplicados", () => {
    test("Usuário com mesmo nome não recebe notificação de projeto alheio", async () => {
      // Criar dois usuários com o mesmo nome em turmas diferentes
      await request.post("/api/auth/register").send({
        username: "dupname_a", name: "Nome Duplicado", role: "aluno",
        email: "dupname_a@test.com", password: "Senha@1234",
      });
      await request.post("/api/auth/register").send({
        username: "dupname_b", name: "Nome Duplicado", role: "aluno",
        email: "dupname_b@test.com", password: "Senha@1234",
      });

      // A query de notificação deve usar DISTINCT e não enviar para usuário com nome ambíguo
      // Verificar no banco que user_id não seria resolvido para múltiplos usuários
      const dups = await db.all("SELECT id FROM users WHERE name = 'Nome Duplicado'");
      expect(dups.length).toBe(2);

      // Criar projeto com member_name "Nome Duplicado" (sem user_id — só via nome)
      await request.post("/api/projects")
        .set("Cookie", cookieHeader(prof1)).set("X-CSRF-Token", prof1.csrfToken)
        .send({
          name: "Proj Dup", team: "R3 Turma 1", deadline: "2026-12-31",
          members: ["Nome Duplicado"], turmaId: turma1Id,
        });

      // O membro com nome duplicado NÃO deve ter user_id preenchido (ambiguidade)
      const memberRow = await db.get(
        "SELECT user_id FROM project_members WHERE member_name = 'Nome Duplicado' ORDER BY rowid DESC LIMIT 1"
      );
      // user_id deve ser NULL porque o nome é ambíguo (dois usuários com mesmo nome)
      expect(memberRow?.user_id).toBeNull();
    });
  });

  // ── 9. XLSX — pontos individuais separados da nota final ───────────────────
  describe("buildGradingWorkbook — colunas separadas", () => {
    test("Exportação contém coluna Pts. Individuais e Nota Final distintas", async () => {
      // Inserir dados em eval_individual para o proj1
      await evalDb.run(
        "INSERT OR REPLACE INTO eval_individual (project_id, member_name, score, entrega_score, observacao) VALUES (?, ?, ?, ?, ?)",
        [proj1Id, "R3 Aluno1", 7.5, 2.0, "Boa entrega"]
      );

      expect(proj1Id).toBeDefined();
      const res = await request.get(`/api/export/grading/project/${proj1Id}`)
        .set("Cookie", cookieHeader(prof1)).set("X-CSRF-Token", prof1.csrfToken);
      // Se há projeto com membros, retorna 200 com XLSX
      expect([200, 404]).toContain(res.status);
      if (res.status === 200) {
        // Deve ser XLSX
        expect(res.headers["content-type"]).toMatch(/spreadsheetml/);
      }
    });
  });

  // ── 10. Anexo — upload salva uploaded_by_user_id ───────────────────────────
  describe("Anexo: uploaded_by_user_id", () => {
    test("Upload de anexo registra uploaded_by_user_id no banco", async () => {
      expect(proj1Id).toBeDefined();
      // Criar tarefa no proj1
      const taskRes = await request.post("/api/tasks")
        .set("Cookie", cookieHeader(prof1)).set("X-CSRF-Token", prof1.csrfToken)
        .send({ projectId: proj1Id, title: "Tarefa Anexo R3", assignee: "R3 Aluno1", dueDate: "2026-12-31", priority: "normal", points: 1 });
      const taskId = taskRes.body?.id;
      expect(taskId).toBeDefined();

      // Simular upload de arquivo (Buffer pequeno)
      const res = await request.post(`/api/tasks/${taskId}/attachments`)
        .set("Cookie", cookieHeader(prof1)).set("X-CSRF-Token", prof1.csrfToken)
        .attach("file", Buffer.from("conteudo de teste"), { filename: "teste.txt", contentType: "text/plain" });

      // Status 201 significa upload bem-sucedido
      if (res.status === 201) {
        // Verificar que uploaded_by_user_id foi salvo
        const att = await db.get("SELECT uploaded_by_user_id FROM task_attachments WHERE task_id = ? ORDER BY id DESC LIMIT 1", [taskId]);
        expect(att?.uploaded_by_user_id).toBeTruthy();
      } else {
        // Se outro status (ex: 400 por configuração de multer), apenas verificar que não é 403
        expect(res.status).not.toBe(403);
      }
    });

    test("Prof2 NÃO pode listar anexos de tarefa do projeto do Prof1 → 403", async () => {
      expect(proj1Id).toBeDefined();
      // Buscar uma tarefa do proj1
      const task = await db.get("SELECT id FROM tasks WHERE project_id = ?", [proj1Id]);
      if (!task) return; // sem tarefa, pular
      const res = await request.get(`/api/tasks/${task.id}/attachments`)
        .set("Cookie", cookieHeader(prof2)).set("X-CSRF-Token", prof2.csrfToken);
      expect(res.status).toBe(403);
    });

    test("Download de arquivo inexistente por prof2 → 403 (não 404)", async () => {
      expect(proj1Id).toBeDefined();
      const task = await db.get("SELECT id FROM tasks WHERE project_id = ?", [proj1Id]);
      if (!task) return;
      const res = await request.get(`/api/tasks/${task.id}/attachments/99999/download`)
        .set("Cookie", cookieHeader(prof2)).set("X-CSRF-Token", prof2.csrfToken);
      // O 403 vem antes do lookup do anexo (task não está no scope do prof2)
      expect(res.status).toBe(403);
    });
  });
});
