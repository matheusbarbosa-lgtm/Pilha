/**
 * Testes de segurança Round 5 — Codex Auditor
 *
 * Cobre os 20 testes obrigatórios:
 *  1.  PO homônimo NÃO consegue confirm-name
 *  2.  PO correto consegue confirm-name
 *  3.  PO homônimo NÃO consegue alterar role
 *  4.  PO correto consegue alterar role
 *  5.  PO homônimo NÃO consegue remover membro
 *  6.  PO correto consegue remover membro
 *  7.  PO homônimo NÃO consegue adicionar membro
 *  8.  PO correto consegue adicionar membro
 *  9.  POST /api/projects salva user_id dos membros iniciais
 * 10.  POST /api/projects não cria vínculo perigoso com nome duplicado
 * 11.  student-onboarding create falha se usuário não tem turma_id
 * 12.  student-onboarding create preenche project.turma_id e project_members.user_id
 * 13.  student-onboarding join preenche users.turma_id quando NULL
 * 14.  student-onboarding join bloqueia turma diferente
 * 15.  invites/accept preenche users.turma_id quando NULL
 * 16.  invites/accept bloqueia turma diferente
 * 17.  register-by-invite falha se projeto não tem turma_id
 * 18.  register-by-invite cria usuário com turma_id e project_members.user_id
 * 19.  homônimos não ganham acesso por member_name legado
 * 20.  tentativa não autorizada não altera o banco
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

describe("Security Round 5", () => {
  let request;
  let server;
  let db;
  let evalDb;

  // Usuários principais
  let prof1, prof2;
  let poCorreto, poHononimo, alunoExtra;
  let poCorretoId, poHononimoId, alunoExtraId;
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

    // Registrar usuários
    const usersToCreate = [
      { username: "r5_prof1", name: "R5 Prof1", role: "professor", email: "r5_prof1@test.com", password: "Senha@1234" },
      { username: "r5_prof2", name: "R5 Prof2", role: "professor", email: "r5_prof2@test.com", password: "Senha@1234" },
      // PO correto e seu homônimo têm o MESMO name
      { username: "r5_po_correto", name: "PO Homonimotest", role: "aluno", email: "r5_po_correto@test.com", password: "Senha@1234" },
      { username: "r5_po_homonimo", name: "PO Homonimotest", role: "aluno", email: "r5_po_homonimo@test.com", password: "Senha@1234" },
      { username: "r5_extra", name: "R5 Extra Aluno", role: "aluno", email: "r5_extra@test.com", password: "Senha@1234" },
    ];
    for (const u of usersToCreate) {
      const r = await request.post("/api/auth/register").send(u);
      if (r.status !== 201 && r.status !== 200) throw new Error(`Falha ao criar ${u.username}: ${JSON.stringify(r.body)}`);
    }

    [prof1, prof2, poCorreto, poHononimo, alunoExtra] = await Promise.all([
      login(request, "r5_prof1@test.com", "Senha@1234"),
      login(request, "r5_prof2@test.com", "Senha@1234"),
      login(request, "r5_po_correto@test.com", "Senha@1234"),
      login(request, "r5_po_homonimo@test.com", "Senha@1234"),
      login(request, "r5_extra@test.com", "Senha@1234"),
    ]);

    // Buscar IDs dos usuários
    const rows = await Promise.all([
      db.get("SELECT id FROM users WHERE username = 'r5_po_correto'"),
      db.get("SELECT id FROM users WHERE username = 'r5_po_homonimo'"),
      db.get("SELECT id FROM users WHERE username = 'r5_extra'"),
    ]);
    poCorretoId  = rows[0]?.id;
    poHononimoId = rows[1]?.id;
    alunoExtraId = rows[2]?.id;

    if (!poCorretoId || !poHononimoId || !alunoExtraId)
      throw new Error(`Setup falhou — IDs: poCorretoId=${poCorretoId}, poHononimoId=${poHononimoId}, alunoExtraId=${alunoExtraId}`);

    // Criar turmas
    const t1 = await request.post("/api/turmas")
      .set("Cookie", cookieHeader(prof1)).set("X-CSRF-Token", prof1.csrfToken)
      .send({ curso: "Eng", periodo: "1", turma: "R5 Turma 1" });
    turma1Id = t1.body?.id;

    const t2 = await request.post("/api/turmas")
      .set("Cookie", cookieHeader(prof2)).set("X-CSRF-Token", prof2.csrfToken)
      .send({ curso: "TI", periodo: "2", turma: "R5 Turma 2" });
    turma2Id = t2.body?.id;

    if (!turma1Id || !turma2Id)
      throw new Error(`Setup falhou — turmas: turma1Id=${turma1Id}, turma2Id=${turma2Id}`);

    // Vincular alunos às turmas via DB direto
    await db.run("UPDATE users SET turma_id = ? WHERE id = ?", [turma1Id, poCorretoId]);
    await db.run("UPDATE users SET turma_id = ? WHERE id = ?", [turma2Id, poHononimoId]);
    await db.run("UPDATE users SET turma_id = ? WHERE id = ?", [turma1Id, alunoExtraId]);

    // Criar projeto para o PO correto — inserir com user_id explícito para garantir vínculo seguro
    const p1 = await request.post("/api/projects")
      .set("Cookie", cookieHeader(prof1)).set("X-CSRF-Token", prof1.csrfToken)
      .send({
        name: "R5 Proj1", team: "R5 Turma 1", discipline: "Eng",
        deadline: "2026-12-31", members: ["R5 Extra Aluno"], turmaId: turma1Id,
      });
    proj1Id = p1.body?.id;
    if (!proj1Id) throw new Error(`Setup falhou — proj1Id=${proj1Id} (${JSON.stringify(p1.body)})`);

    // Adicionar PO correto com user_id diretamente no banco (evitar ambiguidade de nome)
    await db.run(
      "INSERT OR IGNORE INTO project_members (project_id, member_name, scrum_role, user_id) VALUES (?, ?, 'Product Owner', ?)",
      [proj1Id, "PO Homonimotest", poCorretoId]
    );

    // Criar projeto para a turma 2 (do prof2)
    const p2 = await request.post("/api/projects")
      .set("Cookie", cookieHeader(prof2)).set("X-CSRF-Token", prof2.csrfToken)
      .send({
        name: "R5 Proj2", team: "R5 Turma 2", discipline: "TI",
        deadline: "2026-12-31", members: ["PO Homonimotest"], turmaId: turma2Id,
      });
    proj2Id = p2.body?.id;
    if (!proj2Id) throw new Error(`Setup falhou — proj2Id=${proj2Id} (${JSON.stringify(p2.body)})`);
  }, 90_000);

  afterAll(() => { if (server) server.close(); });

  // ── 1 & 2. confirm-name ──────────────────────────────────────────────────────
  describe("POST /api/projects/:id/confirm-name", () => {
    test("1. PO homônimo NÃO consegue confirm-name no projeto do PO correto → 403", async () => {
      expect(proj1Id).toBeDefined();
      const res = await request.post(`/api/projects/${proj1Id}/confirm-name`)
        .set("Cookie", cookieHeader(poHononimo)).set("X-CSRF-Token", poHononimo.csrfToken)
        .send({ name: "Alterado por homonimo" });
      expect(res.status).toBe(403);
    });

    test("1a. Tentativa do homônimo não altera o banco", async () => {
      expect(proj1Id).toBeDefined();
      const before = await db.get("SELECT name FROM projects WHERE id = ?", [proj1Id]);
      await request.post(`/api/projects/${proj1Id}/confirm-name`)
        .set("Cookie", cookieHeader(poHononimo)).set("X-CSRF-Token", poHononimo.csrfToken)
        .send({ name: "Alterado por homonimo" });
      const after = await db.get("SELECT name FROM projects WHERE id = ?", [proj1Id]);
      expect(after.name).toBe(before.name);
    });

    test("2. PO correto consegue confirm-name → 200", async () => {
      expect(proj1Id).toBeDefined();
      const res = await request.post(`/api/projects/${proj1Id}/confirm-name`)
        .set("Cookie", cookieHeader(poCorreto)).set("X-CSRF-Token", poCorreto.csrfToken)
        .send({ name: "R5 Proj1 Confirmado" });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      const proj = await db.get("SELECT name, name_confirmed FROM projects WHERE id = ?", [proj1Id]);
      expect(proj.name_confirmed).toBe(1);
      expect(proj.name).toBe("R5 Proj1 Confirmado");
    });
  });

  // ── 3 & 4. PATCH role ────────────────────────────────────────────────────────
  describe("PATCH /api/projects/:id/members/:memberName/role", () => {
    test("3. PO homônimo NÃO consegue alterar role de membro no projeto do PO correto → 403", async () => {
      expect(proj1Id).toBeDefined();
      const res = await request.patch(`/api/projects/${proj1Id}/members/R5%20Extra%20Aluno/role`)
        .set("Cookie", cookieHeader(poHononimo)).set("X-CSRF-Token", poHononimo.csrfToken)
        .send({ role: "Scrum Master" });
      expect(res.status).toBe(403);
    });

    test("3a. Tentativa do homônimo não altera role no banco", async () => {
      expect(proj1Id).toBeDefined();
      const before = await db.get("SELECT scrum_role FROM project_members WHERE project_id = ? AND member_name = 'R5 Extra Aluno'", [proj1Id]);
      await request.patch(`/api/projects/${proj1Id}/members/R5%20Extra%20Aluno/role`)
        .set("Cookie", cookieHeader(poHononimo)).set("X-CSRF-Token", poHononimo.csrfToken)
        .send({ role: "Scrum Master" });
      const after = await db.get("SELECT scrum_role FROM project_members WHERE project_id = ? AND member_name = 'R5 Extra Aluno'", [proj1Id]);
      expect(after.scrum_role).toBe(before.scrum_role);
    });

    test("4. PO correto consegue alterar role → 200", async () => {
      expect(proj1Id).toBeDefined();
      const res = await request.patch(`/api/projects/${proj1Id}/members/R5%20Extra%20Aluno/role`)
        .set("Cookie", cookieHeader(poCorreto)).set("X-CSRF-Token", poCorreto.csrfToken)
        .send({ role: "Scrum Master" });
      expect(res.status).toBe(200);
    });
  });

  // ── 5 & 6. DELETE member ─────────────────────────────────────────────────────
  describe("DELETE /api/projects/:id/members/:memberName", () => {
    let tempMemberName;

    beforeAll(async () => {
      // Adicionar membro temporário para ser removido pelo PO correto
      await db.run(
        "INSERT OR IGNORE INTO project_members (project_id, member_name, scrum_role) VALUES (?, 'R5 Temp Member', 'Development Team')",
        [proj1Id]
      );
      tempMemberName = "R5 Temp Member";
    });

    test("5. PO homônimo NÃO consegue remover membro do projeto do PO correto → 403", async () => {
      expect(proj1Id).toBeDefined();
      const res = await request.delete(`/api/projects/${proj1Id}/members/${encodeURIComponent(tempMemberName)}`)
        .set("Cookie", cookieHeader(poHononimo)).set("X-CSRF-Token", poHononimo.csrfToken);
      expect(res.status).toBe(403);
    });

    test("5a. Tentativa do homônimo não remove membro do banco", async () => {
      expect(proj1Id).toBeDefined();
      const before = await db.all("SELECT * FROM project_members WHERE project_id = ?", [proj1Id]);
      await request.delete(`/api/projects/${proj1Id}/members/${encodeURIComponent(tempMemberName)}`)
        .set("Cookie", cookieHeader(poHononimo)).set("X-CSRF-Token", poHononimo.csrfToken);
      const after = await db.all("SELECT * FROM project_members WHERE project_id = ?", [proj1Id]);
      expect(after.length).toBe(before.length);
    });

    test("6. PO correto consegue remover membro → 200", async () => {
      expect(proj1Id).toBeDefined();
      const res = await request.delete(`/api/projects/${proj1Id}/members/${encodeURIComponent(tempMemberName)}`)
        .set("Cookie", cookieHeader(poCorreto)).set("X-CSRF-Token", poCorreto.csrfToken);
      expect(res.status).toBe(200);
      const row = await db.get("SELECT * FROM project_members WHERE project_id = ? AND member_name = ?", [proj1Id, tempMemberName]);
      expect(row).toBeUndefined();
    });
  });

  // ── 7 & 8. POST /api/projects/:id/members ────────────────────────────────────
  describe("POST /api/projects/:id/members", () => {
    test("7. PO homônimo NÃO consegue adicionar membro ao projeto do PO correto → 403", async () => {
      expect(proj1Id).toBeDefined();
      const res = await request.post(`/api/projects/${proj1Id}/members`)
        .set("Cookie", cookieHeader(poHononimo)).set("X-CSRF-Token", poHononimo.csrfToken)
        .send({ email: "r5_po_homonimo@test.com" });
      expect(res.status).toBe(403);
    });

    test("7a. Tentativa do homônimo não insere membro no banco", async () => {
      expect(proj1Id).toBeDefined();
      const before = await db.all("SELECT * FROM project_members WHERE project_id = ?", [proj1Id]);
      await request.post(`/api/projects/${proj1Id}/members`)
        .set("Cookie", cookieHeader(poHononimo)).set("X-CSRF-Token", poHononimo.csrfToken)
        .send({ email: "r5_po_homonimo@test.com" });
      const after = await db.all("SELECT * FROM project_members WHERE project_id = ?", [proj1Id]);
      expect(after.length).toBe(before.length);
    });

    test("8. PO correto consegue adicionar membro → 201 ou 409", async () => {
      expect(proj1Id).toBeDefined();
      const res = await request.post(`/api/projects/${proj1Id}/members`)
        .set("Cookie", cookieHeader(poCorreto)).set("X-CSRF-Token", poCorreto.csrfToken)
        .send({ email: "r5_extra@test.com" });
      // 201 = adicionado, 409 = já existe
      expect([201, 409]).toContain(res.status);
    });
  });

  // ── 9 & 10. POST /api/projects — user_id dos membros iniciais ───────────────
  describe("POST /api/projects — user_id dos membros iniciais", () => {
    test("9. Projeto criado com membro de nome único salva user_id", async () => {
      expect(turma1Id).toBeDefined();
      const res = await request.post("/api/projects")
        .set("Cookie", cookieHeader(prof1)).set("X-CSRF-Token", prof1.csrfToken)
        .send({
          name: "R5 Proj UserID Test",
          team: "R5 Turma 1",
          discipline: "Eng",
          deadline: "2026-12-31",
          members: ["R5 Extra Aluno"],
          turmaId: turma1Id,
        });
      expect(res.status).toBe(201);
      const projId = Number(res.body.id);

      const member = await db.get(
        "SELECT user_id FROM project_members WHERE project_id = ? AND member_name = 'R5 Extra Aluno'",
        [projId]
      );
      expect(member).toBeDefined();
      expect(member.user_id).toBe(alunoExtraId);
    });

    test("10. Projeto com membro de nome duplicado NÃO grava user_id ambíguo", async () => {
      expect(turma1Id).toBeDefined();
      // Ambos "PO Homonimotest" existem com user_ids diferentes
      const res = await request.post("/api/projects")
        .set("Cookie", cookieHeader(prof1)).set("X-CSRF-Token", prof1.csrfToken)
        .send({
          name: "R5 Proj Dup Test",
          team: "R5 Turma 1",
          discipline: "Eng",
          deadline: "2026-12-31",
          members: ["PO Homonimotest"],
          turmaId: turma1Id,
        });
      expect(res.status).toBe(201);
      const projId = Number(res.body.id);

      const member = await db.get(
        "SELECT user_id FROM project_members WHERE project_id = ? AND member_name = 'PO Homonimotest'",
        [projId]
      );
      // user_id deve ser NULL — nome é ambíguo (dois usuários com mesmo nome)
      expect(member).toBeDefined();
      expect(member.user_id).toBeNull();
    });
  });

  // ── 11 & 12. student-onboarding create ───────────────────────────────────────
  describe("student-onboarding mode=create", () => {
    let alunoSemTurma, alunoComTurma;
    let alunoComTurmaId;

    beforeAll(async () => {
      // Aluno SEM turma_id
      await request.post("/api/auth/register").send({
        username: "r5_sem_turma", name: "R5 Sem Turma",
        role: "aluno", email: "r5_sem_turma@test.com", password: "Senha@1234",
      });
      alunoSemTurma = await login(request, "r5_sem_turma@test.com", "Senha@1234");

      // Aluno COM turma_id
      await request.post("/api/auth/register").send({
        username: "r5_com_turma", name: "R5 Com Turma",
        role: "aluno", email: "r5_com_turma@test.com", password: "Senha@1234",
      });
      alunoComTurma = await login(request, "r5_com_turma@test.com", "Senha@1234");
      const row = await db.get("SELECT id FROM users WHERE username = 'r5_com_turma'");
      alunoComTurmaId = row?.id;
      if (!alunoComTurmaId) throw new Error("Setup falhou — alunoComTurmaId");
      await db.run("UPDATE users SET turma_id = ?, onboarding_done = 0 WHERE id = ?", [turma1Id, alunoComTurmaId]);
    });

    test("11. Aluno sem turma_id recebe 400 ao tentar create → projeto não criado", async () => {
      const countBefore = (await db.get("SELECT COUNT(*) as c FROM projects")).c;
      const res = await request.post("/api/auth/student-onboarding")
        .set("Cookie", cookieHeader(alunoSemTurma)).set("X-CSRF-Token", alunoSemTurma.csrfToken)
        .send({ mode: "create", scrumRole: "Product Owner" });
      expect(res.status).toBe(400);
      const countAfter = (await db.get("SELECT COUNT(*) as c FROM projects")).c;
      expect(countAfter).toBe(countBefore);
    });

    test("12. Aluno com turma_id cria projeto com turma_id e user_id preenchidos", async () => {
      expect(alunoComTurmaId).toBeDefined();
      const res = await request.post("/api/auth/student-onboarding")
        .set("Cookie", cookieHeader(alunoComTurma)).set("X-CSRF-Token", alunoComTurma.csrfToken)
        .send({ mode: "create", scrumRole: "Product Owner" });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);

      const proj = await db.get(
        "SELECT turma_id FROM projects WHERE name LIKE 'Projeto de R5 Com Turma%' ORDER BY id DESC LIMIT 1"
      );
      expect(proj).toBeDefined();
      expect(proj.turma_id).toBe(turma1Id);

      const member = await db.get(
        "SELECT user_id FROM project_members WHERE user_id = ? ORDER BY rowid DESC LIMIT 1",
        [alunoComTurmaId]
      );
      expect(member).toBeDefined();
      expect(member.user_id).toBe(alunoComTurmaId);
    });
  });

  // ── 13 & 14. student-onboarding join ─────────────────────────────────────────
  describe("student-onboarding mode=join", () => {
    let alunoJoinNullTurma, alunoJoinNullTurmaId;
    let alunoJoinWrongTurma;
    let inviteTokenForJoinNull, inviteTokenForJoinWrong;

    beforeAll(async () => {
      // Aluno que vai entrar com turma_id NULL → deve ser preenchido
      await request.post("/api/auth/register").send({
        username: "r5_join_null", name: "R5 Join Null",
        role: "aluno", email: "r5_join_null@test.com", password: "Senha@1234",
      });
      alunoJoinNullTurma = await login(request, "r5_join_null@test.com", "Senha@1234");
      const row1 = await db.get("SELECT id FROM users WHERE username = 'r5_join_null'");
      alunoJoinNullTurmaId = row1?.id;
      if (!alunoJoinNullTurmaId) throw new Error("Setup falhou — alunoJoinNullTurmaId");
      await db.run("UPDATE users SET turma_id = NULL, onboarding_done = 0, email = 'r5_join_null@test.com' WHERE id = ?", [alunoJoinNullTurmaId]);

      // Aluno de turma ERRADA tentando entrar
      await request.post("/api/auth/register").send({
        username: "r5_join_wrong", name: "R5 Join Wrong",
        role: "aluno", email: "r5_join_wrong@test.com", password: "Senha@1234",
      });
      alunoJoinWrongTurma = await login(request, "r5_join_wrong@test.com", "Senha@1234");
      const row2 = await db.get("SELECT id FROM users WHERE username = 'r5_join_wrong'");
      if (row2?.id) await db.run("UPDATE users SET turma_id = ?, onboarding_done = 0, email = 'r5_join_wrong@test.com' WHERE id = ?", [turma2Id, row2.id]);

      // Criar convites para o proj1 (turma1)
      const inv1 = await request.post(`/api/projects/${proj1Id}/invites`)
        .set("Cookie", cookieHeader(prof1)).set("X-CSRF-Token", prof1.csrfToken)
        .send({ emails: ["r5_join_null@test.com"] });
      expect(inv1.status).toBe(200);

      const inv2 = await request.post(`/api/projects/${proj1Id}/invites`)
        .set("Cookie", cookieHeader(prof1)).set("X-CSRF-Token", prof1.csrfToken)
        .send({ emails: ["r5_join_wrong@test.com"] });
      expect(inv2.status).toBe(200);

      const row3 = await db.get("SELECT invite_token FROM project_invites WHERE invite_email = 'r5_join_null@test.com' AND status = 'pending' ORDER BY id DESC LIMIT 1");
      inviteTokenForJoinNull = row3?.invite_token;

      const row4 = await db.get("SELECT invite_token FROM project_invites WHERE invite_email = 'r5_join_wrong@test.com' AND status = 'pending' ORDER BY id DESC LIMIT 1");
      inviteTokenForJoinWrong = row4?.invite_token;

      if (!inviteTokenForJoinNull || !inviteTokenForJoinWrong)
        throw new Error(`Setup falhou — tokens: null=${inviteTokenForJoinNull}, wrong=${inviteTokenForJoinWrong}`);
    });

    test("13. Aluno com turma_id NULL entra no projeto e recebe turma_id correto", async () => {
      expect(alunoJoinNullTurmaId).toBeDefined();
      expect(inviteTokenForJoinNull).toBeDefined();

      const res = await request.post("/api/auth/student-onboarding")
        .set("Cookie", cookieHeader(alunoJoinNullTurma)).set("X-CSRF-Token", alunoJoinNullTurma.csrfToken)
        .send({ mode: "join", inviteToken: inviteTokenForJoinNull });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);

      const updatedUser = await db.get("SELECT turma_id FROM users WHERE id = ?", [alunoJoinNullTurmaId]);
      expect(updatedUser.turma_id).toBe(turma1Id);

      const member = await db.get("SELECT user_id FROM project_members WHERE project_id = ? AND user_id = ?", [proj1Id, alunoJoinNullTurmaId]);
      expect(member?.user_id).toBe(alunoJoinNullTurmaId);
    });

    test("14. Aluno com turma_id diferente recebe 403 ao tentar join", async () => {
      expect(inviteTokenForJoinWrong).toBeDefined();
      const res = await request.post("/api/auth/student-onboarding")
        .set("Cookie", cookieHeader(alunoJoinWrongTurma)).set("X-CSRF-Token", alunoJoinWrongTurma.csrfToken)
        .send({ mode: "join", inviteToken: inviteTokenForJoinWrong });
      expect(res.status).toBe(403);
    });
  });

  // ── 15 & 16. invites/accept ──────────────────────────────────────────────────
  describe("POST /api/invites/accept", () => {
    let alunoAcceptNull, alunoAcceptNullId;
    let alunoAcceptWrong;
    let tokenForNull, tokenForWrong;

    beforeAll(async () => {
      // Aluno com turma_id NULL
      await request.post("/api/auth/register").send({
        username: "r5_accept_null", name: "R5 Accept Null",
        role: "aluno", email: "r5_accept_null@test.com", password: "Senha@1234",
      });
      alunoAcceptNull = await login(request, "r5_accept_null@test.com", "Senha@1234");
      const row1 = await db.get("SELECT id FROM users WHERE username = 'r5_accept_null'");
      alunoAcceptNullId = row1?.id;
      if (!alunoAcceptNullId) throw new Error("Setup falhou — alunoAcceptNullId");
      await db.run("UPDATE users SET turma_id = NULL, email = 'r5_accept_null@test.com' WHERE id = ?", [alunoAcceptNullId]);

      // Aluno com turma errada
      await request.post("/api/auth/register").send({
        username: "r5_accept_wrong", name: "R5 Accept Wrong",
        role: "aluno", email: "r5_accept_wrong@test.com", password: "Senha@1234",
      });
      alunoAcceptWrong = await login(request, "r5_accept_wrong@test.com", "Senha@1234");
      const row2 = await db.get("SELECT id FROM users WHERE username = 'r5_accept_wrong'");
      if (row2?.id) await db.run("UPDATE users SET turma_id = ?, email = 'r5_accept_wrong@test.com' WHERE id = ?", [turma2Id, row2.id]);

      // Criar convites
      const inv1 = await request.post(`/api/projects/${proj1Id}/invites`)
        .set("Cookie", cookieHeader(prof1)).set("X-CSRF-Token", prof1.csrfToken)
        .send({ emails: ["r5_accept_null@test.com"] });
      expect(inv1.status).toBe(200);

      const inv2 = await request.post(`/api/projects/${proj1Id}/invites`)
        .set("Cookie", cookieHeader(prof1)).set("X-CSRF-Token", prof1.csrfToken)
        .send({ emails: ["r5_accept_wrong@test.com"] });
      expect(inv2.status).toBe(200);

      const r3 = await db.get("SELECT invite_token FROM project_invites WHERE invite_email = 'r5_accept_null@test.com' AND status = 'pending' ORDER BY id DESC LIMIT 1");
      tokenForNull = r3?.invite_token;
      const r4 = await db.get("SELECT invite_token FROM project_invites WHERE invite_email = 'r5_accept_wrong@test.com' AND status = 'pending' ORDER BY id DESC LIMIT 1");
      tokenForWrong = r4?.invite_token;

      if (!tokenForNull || !tokenForWrong)
        throw new Error(`Setup falhou — tokens: null=${tokenForNull}, wrong=${tokenForWrong}`);
    });

    test("15. Aluno com turma_id NULL aceita convite e recebe turma_id correto", async () => {
      expect(alunoAcceptNullId).toBeDefined();
      expect(tokenForNull).toBeDefined();

      const res = await request.post("/api/invites/accept")
        .set("Cookie", cookieHeader(alunoAcceptNull)).set("X-CSRF-Token", alunoAcceptNull.csrfToken)
        .send({ token: tokenForNull });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);

      const updatedUser = await db.get("SELECT turma_id FROM users WHERE id = ?", [alunoAcceptNullId]);
      expect(updatedUser.turma_id).toBe(turma1Id);

      const member = await db.get("SELECT user_id FROM project_members WHERE project_id = ? AND user_id = ?", [proj1Id, alunoAcceptNullId]);
      expect(member?.user_id).toBe(alunoAcceptNullId);
    });

    test("16. Aluno com turma_id diferente recebe 403", async () => {
      expect(tokenForWrong).toBeDefined();
      const res = await request.post("/api/invites/accept")
        .set("Cookie", cookieHeader(alunoAcceptWrong)).set("X-CSRF-Token", alunoAcceptWrong.csrfToken)
        .send({ token: tokenForWrong });
      expect(res.status).toBe(403);
    });
  });

  // ── 17 & 18. register-by-invite ──────────────────────────────────────────────
  describe("POST /api/auth/register-by-invite", () => {
    let inviteTokenSemTurma;
    let inviteTokenComTurma;
    let projSemTurmaId;

    beforeAll(async () => {
      // Criar projeto sem turma_id (via admin direto no banco)
      const r = await db.run(
        "INSERT INTO projects (name, team, deadline, turma_id) VALUES ('Proj Sem Turma', 'Sem Turma', '2026-12-31', NULL)"
      );
      projSemTurmaId = r.lastID;

      // Precisamos do user_id de prof1 para satisfazer NOT NULL em inviter_user_id
      const prof1Row = await db.get("SELECT id FROM users WHERE username = 'r5_prof1'");
      const inviterUserId = prof1Row?.id || 1;

      // Criar convite para projeto sem turma_id (direto no banco)
      const tokenST = require("crypto").randomUUID();
      await db.run(
        "INSERT INTO project_invites (project_id, inviter_user_id, invite_email, invite_token, status, created_at) VALUES (?, ?, 'r5_st_invite@test.com', ?, 'pending', ?)",
        [projSemTurmaId, inviterUserId, tokenST, new Date().toISOString()]
      );
      inviteTokenSemTurma = tokenST;

      // Criar convite para proj1 (com turma_id)
      const inv = await request.post(`/api/projects/${proj1Id}/invites`)
        .set("Cookie", cookieHeader(prof1)).set("X-CSRF-Token", prof1.csrfToken)
        .send({ emails: ["r5_newreg@test.com"] });
      expect(inv.status).toBe(200);

      const row = await db.get("SELECT invite_token FROM project_invites WHERE invite_email = 'r5_newreg@test.com' AND status = 'pending' ORDER BY id DESC LIMIT 1");
      inviteTokenComTurma = row?.invite_token;
      if (!inviteTokenComTurma) throw new Error("Setup falhou — inviteTokenComTurma");
    });

    test("17. register-by-invite com projeto sem turma_id falha → 400, nenhum usuário criado", async () => {
      expect(inviteTokenSemTurma).toBeDefined();
      const countBefore = (await db.get("SELECT COUNT(*) as c FROM users")).c;
      const res = await request.post("/api/auth/register-by-invite").send({
        inviteToken: inviteTokenSemTurma,
        name: "R5 ST User",
        email: "r5_st_invite@test.com",
        password: "Senha@1234",
        confirmPassword: "Senha@1234",
      });
      expect(res.status).toBe(400);
      const countAfter = (await db.get("SELECT COUNT(*) as c FROM users")).c;
      expect(countAfter).toBe(countBefore);
    });

    test("18. register-by-invite cria usuário com turma_id e project_members.user_id", async () => {
      expect(inviteTokenComTurma).toBeDefined();
      const res = await request.post("/api/auth/register-by-invite").send({
        inviteToken: inviteTokenComTurma,
        name: "R5 New Reg",
        email: "r5_newreg@test.com",
        password: "Senha@1234",
        confirmPassword: "Senha@1234",
      });
      expect(res.status).toBe(201);
      expect(res.body.ok).toBe(true);

      const newUser = await db.get("SELECT id, turma_id FROM users WHERE email = 'r5_newreg@test.com'");
      expect(newUser).toBeDefined();
      expect(newUser.turma_id).toBe(turma1Id);

      const member = await db.get("SELECT user_id FROM project_members WHERE project_id = ? AND user_id = ?", [proj1Id, newUser.id]);
      expect(member?.user_id).toBe(newUser.id);
    });
  });

  // ── 19. Homônimos não ganham acesso por member_name legado ────────────────────
  describe("19. Homônimos não ganham acesso via member_name legado", () => {
    test("buildVisibleScope não expõe projeto do PO correto para o homônimo", async () => {
      // O homônimo tem turma_id diferente e não tem user_id vinculado ao proj1
      const res = await request.get("/api/projects")
        .set("Cookie", cookieHeader(poHononimo)).set("X-CSRF-Token", poHononimo.csrfToken);
      expect(res.status).toBe(200);
      const ids = res.body.map((p) => String(p.id));
      expect(ids).not.toContain(String(proj1Id));
    });

    test("Homônimo não acessa diretamente o projeto → 403", async () => {
      const res = await request.get(`/api/projects/${proj1Id}`)
        .set("Cookie", cookieHeader(poHononimo)).set("X-CSRF-Token", poHononimo.csrfToken);
      expect(res.status).toBe(403);
    });
  });

  // ── 20. Tentativa não autorizada não altera o banco ──────────────────────────
  describe("20. Tentativas não autorizadas não alteram o banco", () => {
    test("confirm-name por homônimo não altera projects", async () => {
      expect(proj1Id).toBeDefined();
      const before = await db.get("SELECT name, name_confirmed FROM projects WHERE id = ?", [proj1Id]);
      await request.post(`/api/projects/${proj1Id}/confirm-name`)
        .set("Cookie", cookieHeader(poHononimo)).set("X-CSRF-Token", poHononimo.csrfToken)
        .send({ name: "Invasão" });
      const after = await db.get("SELECT name, name_confirmed FROM projects WHERE id = ?", [proj1Id]);
      expect(after.name).toBe(before.name);
      expect(after.name_confirmed).toBe(before.name_confirmed);
    });

    test("role PATCH por homônimo não altera project_members", async () => {
      expect(proj1Id).toBeDefined();
      const members = await db.all("SELECT member_name, scrum_role FROM project_members WHERE project_id = ?", [proj1Id]);
      await request.patch(`/api/projects/${proj1Id}/members/R5%20Extra%20Aluno/role`)
        .set("Cookie", cookieHeader(poHononimo)).set("X-CSRF-Token", poHononimo.csrfToken)
        .send({ role: "Product Owner" });
      const membersAfter = await db.all("SELECT member_name, scrum_role FROM project_members WHERE project_id = ?", [proj1Id]);
      // Nenhuma role deve ter mudado
      for (const m of membersAfter) {
        const orig = members.find((o) => o.member_name === m.member_name);
        if (orig) expect(m.scrum_role).toBe(orig.scrum_role);
      }
    });
  });
});
