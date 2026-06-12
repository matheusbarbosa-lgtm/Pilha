const path = require("path");
const fs = require("fs");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const bcrypt = require("bcryptjs");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "campusflow.db");
const EVAL_DB_PATH = process.env.EVAL_DB_PATH || path.join(__dirname, "grading.db");

async function initDb(dbPath) {
  const resolvedPath = dbPath || DB_PATH;
  if (resolvedPath !== ":memory:" && !fs.existsSync(resolvedPath)) {
    fs.writeFileSync(resolvedPath, "");
  }

  const db = await open({
    filename: resolvedPath,
    driver: sqlite3.Database
  });

  await db.exec(`PRAGMA foreign_keys = ON;`);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('aluno', 'professor', 'superadmin')),
      is_admin INTEGER NOT NULL DEFAULT 0,
      email TEXT UNIQUE,
      turma TEXT,
      periodo TEXT,
      photo TEXT,
      onboarding_done INTEGER NOT NULL DEFAULT 0 CHECK (onboarding_done IN (0,1)),
      password_hash TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      team TEXT NOT NULL,
      deadline TEXT NOT NULL,
      description TEXT DEFAULT '',
      discipline TEXT DEFAULT '',
      start_date TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS project_members (
      project_id INTEGER NOT NULL,
      member_name TEXT NOT NULL,
      scrum_role TEXT NOT NULL DEFAULT 'Development Team' CHECK (scrum_role IN ('Product Owner', 'Scrum Master', 'Development Team')),
      PRIMARY KEY (project_id, member_name),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS sprints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      goal TEXT NOT NULL,
      start TEXT NOT NULL,
      end TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      assignee TEXT NOT NULL,
      due_date TEXT NOT NULL,
      sprint_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'todo',
      priority TEXT NOT NULL DEFAULT 'media' CHECK (priority IN ('baixa', 'media', 'alta')),
      points INTEGER NOT NULL DEFAULT 1,
      description TEXT DEFAULT '',
      checklist TEXT DEFAULT '[]',
      tags TEXT DEFAULT '[]',
      urgency TEXT NOT NULL DEFAULT 'medium' CHECK (urgency IN ('low', 'medium', 'high')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (sprint_id) REFERENCES sprints(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS task_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS kanban_boards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      created_by INTEGER,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS kanban_columns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      board_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      col_order INTEGER NOT NULL DEFAULT 0,
      color TEXT DEFAULT '#e2e8f0',
      FOREIGN KEY (board_id) REFERENCES kanban_boards(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS custom_field_definitions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      field_type TEXT NOT NULL DEFAULT 'text'
        CHECK (field_type IN ('text','number','select','date','checkbox')),
      options TEXT DEFAULT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS custom_field_values (
      task_id INTEGER NOT NULL,
      field_id INTEGER NOT NULL,
      value TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (task_id, field_id),
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (field_id) REFERENCES custom_field_definitions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS project_invites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      inviter_user_id INTEGER NOT NULL,
      invite_email TEXT NOT NULL,
      invite_token TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','expired','canceled')),
      created_at TEXT NOT NULL,
      accepted_at TEXT,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (inviter_user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS turmas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      professor_id INTEGER NOT NULL,
      curso TEXT NOT NULL,
      periodo TEXT NOT NULL,
      turma TEXT NOT NULL,
      invite_token TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (professor_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      turma_id INTEGER NOT NULL,
      sender_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (turma_id) REFERENCES turmas(id) ON DELETE CASCADE,
      FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL DEFAULT 'info',
      message TEXT NOT NULL,
      link TEXT,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // ── Migrations for existing databases ──────────────────────────────────────

  const taskCols = await db.all("PRAGMA table_info(tasks)");
  const taskColNames = taskCols.map(c => c.name);
  if (!taskColNames.includes("description"))
    await db.exec("ALTER TABLE tasks ADD COLUMN description TEXT DEFAULT ''");
  if (!taskColNames.includes("checklist"))
    await db.exec("ALTER TABLE tasks ADD COLUMN checklist TEXT DEFAULT '[]'");
  if (!taskColNames.includes("tags"))
    await db.exec("ALTER TABLE tasks ADD COLUMN tags TEXT DEFAULT '[]'");
  if (!taskColNames.includes("urgency"))
    await db.exec("ALTER TABLE tasks ADD COLUMN urgency TEXT NOT NULL DEFAULT 'medium'");
  if (!taskColNames.includes("priority"))
    await db.exec("ALTER TABLE tasks ADD COLUMN priority TEXT NOT NULL DEFAULT 'media'");
  if (!taskColNames.includes("start_date"))
    await db.exec("ALTER TABLE tasks ADD COLUMN start_date TEXT DEFAULT ''");
  if (!taskColNames.includes("parent_task_id"))
    await db.exec("ALTER TABLE tasks ADD COLUMN parent_task_id INTEGER DEFAULT NULL");

  // Migrate old status values: review → doing
  await db.exec("UPDATE tasks SET status = 'doing' WHERE status = 'review'");

  // Remove NOT NULL de sprint_id (SQLite exige recrear a tabela)
  // NOTA: inclui kanban_col_id para preservar valores existentes
  const sprintIdCol = taskCols.find(c => c.name === "sprint_id");
  if (sprintIdCol && sprintIdCol.notnull === 1) {
    // Se kanban_col_id já existia na tabela antiga, preserva; senão usa NULL
    const srcKanban = taskCols.some(c => c.name === "kanban_col_id") ? "kanban_col_id" : "NULL";
    await db.exec(`
      PRAGMA foreign_keys = OFF;
      BEGIN;
      CREATE TABLE IF NOT EXISTS tasks_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        assignee TEXT NOT NULL,
        due_date TEXT NOT NULL,
        start_date TEXT DEFAULT '',
        sprint_id INTEGER DEFAULT NULL,
        status TEXT NOT NULL DEFAULT 'todo',
        priority TEXT NOT NULL DEFAULT 'normal',
        points INTEGER NOT NULL DEFAULT 1,
        description TEXT DEFAULT '',
        checklist TEXT DEFAULT '[]',
        tags TEXT DEFAULT '[]',
        urgency TEXT NOT NULL DEFAULT 'medium',
        parent_task_id INTEGER DEFAULT NULL,
        kanban_col_id INTEGER DEFAULT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
      INSERT INTO tasks_new SELECT id,project_id,title,assignee,due_date,start_date,sprint_id,status,priority,points,description,checklist,tags,urgency,parent_task_id,${srcKanban} FROM tasks;
      DROP TABLE tasks;
      ALTER TABLE tasks_new RENAME TO tasks;
      COMMIT;
      PRAGMA foreign_keys = ON;
    `);
  }

  // kanban_col_id: adicionar APÓS o bloco tasks_new para não ser perdida
  {
    const taskColsNow = await db.all("PRAGMA table_info(tasks)");
    if (!taskColsNow.some(c => c.name === "kanban_col_id"))
      await db.exec("ALTER TABLE tasks ADD COLUMN kanban_col_id INTEGER DEFAULT NULL");
  }

  const projCols = await db.all("PRAGMA table_info(projects)");
  const projColNames = projCols.map(c => c.name);
  if (!projColNames.includes("description"))
    await db.exec("ALTER TABLE projects ADD COLUMN description TEXT DEFAULT ''");
  if (!projColNames.includes("discipline"))
    await db.exec("ALTER TABLE projects ADD COLUMN discipline TEXT DEFAULT ''");
  if (!projColNames.includes("start_date"))
    await db.exec("ALTER TABLE projects ADD COLUMN start_date TEXT DEFAULT ''");
  if (!projColNames.includes("docs_unlocked"))
    await db.exec("ALTER TABLE projects ADD COLUMN docs_unlocked INTEGER NOT NULL DEFAULT 0");
  if (!projColNames.includes("name_confirmed"))
    await db.exec("ALTER TABLE projects ADD COLUMN name_confirmed INTEGER NOT NULL DEFAULT 0");
  if (!projColNames.includes("turma_id"))
    await db.exec("ALTER TABLE projects ADD COLUMN turma_id INTEGER DEFAULT NULL");

  // Backfill turma_id para projetos existentes sem vínculo direto.
  // Apenas quando existe exatamente UMA turma correspondente (sem ambiguidade).
  try {
    await db.exec(`
      UPDATE projects
      SET turma_id = (
        SELECT t.id FROM turmas t
        WHERE projects.team LIKE '%' || t.turma || '%'
        AND (SELECT COUNT(*) FROM turmas t2 WHERE projects.team LIKE '%' || t2.turma || '%') = 1
        LIMIT 1
      )
      WHERE turma_id IS NULL
        AND (SELECT COUNT(*) FROM turmas t WHERE projects.team LIKE '%' || t.turma || '%') = 1
    `);
  } catch (_backfillErr) { /* turmas pode não existir ainda em bases vazias */ }

  const memberCols = await db.all("PRAGMA table_info(project_members)");
  if (!memberCols.some(c => c.name === "scrum_role"))
    await db.exec("ALTER TABLE project_members ADD COLUMN scrum_role TEXT NOT NULL DEFAULT 'Development Team'");
  if (!memberCols.some(c => c.name === "user_id")) {
    await db.exec("ALTER TABLE project_members ADD COLUMN user_id INTEGER REFERENCES users(id)");
    // Backfill: vincular user_id onde nome é único na tabela users
    await db.exec(`
      UPDATE project_members SET user_id = (
        SELECT u.id FROM users u WHERE u.name = project_members.member_name
        AND (SELECT COUNT(*) FROM users u2 WHERE u2.name = project_members.member_name) = 1
      ) WHERE user_id IS NULL
    `);
  }

  const userCols = await db.all("PRAGMA table_info(users)");
  const userColNames = userCols.map(c => c.name);
  if (!userColNames.includes("is_admin"))
    await db.exec("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0");
  if (!userColNames.includes("email"))
    await db.exec("ALTER TABLE users ADD COLUMN email TEXT");
  if (!userColNames.includes("onboarding_done"))
    await db.exec("ALTER TABLE users ADD COLUMN onboarding_done INTEGER NOT NULL DEFAULT 0");
  if (!userColNames.includes("turma"))
    await db.exec("ALTER TABLE users ADD COLUMN turma TEXT");
  if (!userColNames.includes("periodo"))
    await db.exec("ALTER TABLE users ADD COLUMN periodo TEXT");
  if (!userColNames.includes("photo"))
    await db.exec("ALTER TABLE users ADD COLUMN photo TEXT");
  if (!userColNames.includes("curso"))
    await db.exec("ALTER TABLE users ADD COLUMN curso TEXT");
  if (!userColNames.includes("must_change_password"))
    await db.exec("ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0");
  if (!userColNames.includes("bio"))
    await db.exec("ALTER TABLE users ADD COLUMN bio TEXT DEFAULT ''");
  if (!userColNames.includes("skills"))
    await db.exec("ALTER TABLE users ADD COLUMN skills TEXT DEFAULT '[]'");
  if (!userColNames.includes("graduations"))
    await db.exec("ALTER TABLE users ADD COLUMN graduations TEXT DEFAULT ''");
  if (!userColNames.includes("specialty"))
    await db.exec("ALTER TABLE users ADD COLUMN specialty TEXT DEFAULT ''");
  if (!userColNames.includes("experience_years"))
    await db.exec("ALTER TABLE users ADD COLUMN experience_years INTEGER DEFAULT 0");
  if (!userColNames.includes("profile_complete"))
    await db.exec("ALTER TABLE users ADD COLUMN profile_complete INTEGER NOT NULL DEFAULT 0");
  if (!userColNames.includes("turma_id"))
    await db.exec("ALTER TABLE users ADD COLUMN turma_id INTEGER DEFAULT NULL");
  if (!userColNames.includes("totp_secret"))
    await db.exec("ALTER TABLE users ADD COLUMN totp_secret TEXT DEFAULT NULL");
  if (!userColNames.includes("totp_enabled"))
    await db.exec("ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0");
  if (!userColNames.includes("github_login"))
    await db.exec("ALTER TABLE users ADD COLUMN github_login TEXT DEFAULT NULL");

  // Migração: quem vinculou o repositório ao projeto
  try {
    const pgrCols = await db.all("PRAGMA table_info(project_github_repositories)");
    if (pgrCols.length && !pgrCols.some(c => c.name === "linked_by_user_id"))
      await db.exec("ALTER TABLE project_github_repositories ADD COLUMN linked_by_user_id INTEGER DEFAULT NULL");
  } catch (e) { console.warn("[DB] migration linked_by_user_id:", e.message); }

  await db.exec(`
    CREATE TABLE IF NOT EXISTS totp_recovery_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      code_hash TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS otp_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      code TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS project_docs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      doc_type TEXT NOT NULL CHECK (doc_type IN ('tap','pi')),
      content TEXT NOT NULL DEFAULT '{}',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(project_id, doc_type),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS access_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      username TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'aluno',
      is_admin INTEGER NOT NULL DEFAULT 0,
      ip TEXT,
      logged_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS task_attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
      size INTEGER NOT NULL DEFAULT 0,
      uploaded_by TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS task_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      user_name TEXT NOT NULL,
      field TEXT NOT NULL,
      old_val TEXT,
      new_val TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS task_github (
      task_id INTEGER PRIMARY KEY,
      repo TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      updated_by TEXT,
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );

    -- ── Integração GitHub ──────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS github_integrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      github_account_login TEXT,
      github_account_id INTEGER,
      installation_id INTEGER UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','suspended','removed')),
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS github_repositories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      integration_id INTEGER NOT NULL,
      github_repo_id INTEGER,
      owner TEXT,
      name TEXT,
      full_name TEXT,
      private INTEGER NOT NULL DEFAULT 0,
      default_branch TEXT DEFAULT 'main',
      html_url TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE (integration_id, github_repo_id),
      FOREIGN KEY (integration_id) REFERENCES github_integrations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS project_github_repositories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      github_repository_id INTEGER NOT NULL,
      linked_by_user_id INTEGER,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE (project_id, github_repository_id),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (github_repository_id) REFERENCES github_repositories(id) ON DELETE CASCADE,
      FOREIGN KEY (linked_by_user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS github_webhook_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      github_delivery_id TEXT UNIQUE,
      event_type TEXT,
      action TEXT,
      repository_full_name TEXT,
      payload_json TEXT,
      processed INTEGER NOT NULL DEFAULT 0,
      processed_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Cache das estatísticas de contribuição por usuário/mês
    CREATE TABLE IF NOT EXISTS github_user_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      period TEXT NOT NULL,            -- ex: '2026-05' (mês) ou 'total'
      commits INTEGER NOT NULL DEFAULT 0,
      prs_opened INTEGER NOT NULL DEFAULT 0,
      prs_merged INTEGER NOT NULL DEFAULT 0,
      reviews INTEGER NOT NULL DEFAULT 0,
      tasks_done INTEGER NOT NULL DEFAULT 0,
      files_changed INTEGER NOT NULL DEFAULT 0,
      lines_added INTEGER NOT NULL DEFAULT 0,
      lines_removed INTEGER NOT NULL DEFAULT 0,
      computed_at TEXT DEFAULT (datetime('now')),
      UNIQUE (user_id, period),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS doc_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      doc_type TEXT NOT NULL CHECK (doc_type IN ('tap','pi')),
      user_id INTEGER NOT NULL,
      user_name TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS doc_permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      turma_id INTEGER NOT NULL,
      doc_type TEXT NOT NULL CHECK (doc_type IN ('tap','pi')),
      released_by INTEGER NOT NULL,
      released_at TEXT DEFAULT (datetime('now')),
      UNIQUE(turma_id, doc_type),
      FOREIGN KEY (turma_id) REFERENCES turmas(id) ON DELETE CASCADE,
      FOREIGN KEY (released_by) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS project_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      sender_id INTEGER NOT NULL,
      sender_name TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
    );

  `);

  // uploaded_by_user_id: identificação segura do uploader de anexo por FK
  {
    const attCols = await db.all("PRAGMA table_info(task_attachments)");
    if (!attCols.some(c => c.name === "uploaded_by_user_id"))
      await db.exec("ALTER TABLE task_attachments ADD COLUMN uploaded_by_user_id INTEGER REFERENCES users(id)");
  }

  // Migration: remove CHECK constraint on is_admin (already applied via fix script on VPS)
  // The migration was applied directly on the DB; this block is kept as a no-op guard.
  try {
    const tblInfo = await db.get("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'");
    if (tblInfo && tblInfo.sql && tblInfo.sql.includes("is_admin IN (0,1)")) {
      await db.run("PRAGMA foreign_keys = OFF");
      await db.exec(`
        CREATE TABLE users_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'aluno',
          is_admin INTEGER NOT NULL DEFAULT 0,
          email TEXT,
          turma TEXT,
          periodo TEXT,
          photo TEXT,
          curso TEXT,
          onboarding_done INTEGER NOT NULL DEFAULT 0,
          must_change_password INTEGER NOT NULL DEFAULT 0,
          password_hash TEXT NOT NULL DEFAULT ''
        );
      `);
      await db.run(`
        INSERT INTO users_new (id,username,name,role,is_admin,email,turma,periodo,photo,curso,onboarding_done,must_change_password,password_hash)
        SELECT id,username,name,role,COALESCE(is_admin,0),email,turma,periodo,photo,curso,
               COALESCE(onboarding_done,0),COALESCE(must_change_password,0),COALESCE(password_hash,'')
        FROM users
      `);
      await db.exec(`DROP TABLE users; ALTER TABLE users_new RENAME TO users;`);
      await db.run("PRAGMA foreign_keys = ON");
      console.log("[DB] Migration: is_admin CHECK constraint removido.");
    }
  } catch (migErr) {
    console.warn("[DB] Migration is_admin:", migErr.message);
  }

  // Migration: colunas de aprovação em project_docs
  try {
    const docCols = await db.all("PRAGMA table_info(project_docs)");
    const docColNames = docCols.map(c => c.name);
    if (!docColNames.includes("approval_status"))
      await db.exec("ALTER TABLE project_docs ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'draft' CHECK(approval_status IN ('draft','submitted','approved','rejected'))");
    if (!docColNames.includes("approved_by"))
      await db.exec("ALTER TABLE project_docs ADD COLUMN approved_by TEXT DEFAULT NULL");
    if (!docColNames.includes("approved_at"))
      await db.exec("ALTER TABLE project_docs ADD COLUMN approved_at TEXT DEFAULT NULL");
    if (!docColNames.includes("rejected_reason"))
      await db.exec("ALTER TABLE project_docs ADD COLUMN rejected_reason TEXT DEFAULT NULL");
  } catch (e) { console.warn("[DB] Migration project_docs approval:", e.message); }

  await seedIfEmpty(db);
  await ensureAdminAccounts(db);
  return db;
}

async function seedIfEmpty(db) {
  const row = await db.get("SELECT COUNT(*) AS total FROM users");
  if (row.total > 0) return;

  const defaultPasswordHash = bcrypt.hashSync("123456", 10);

  await db.run(
    "INSERT INTO users (username, name, role, is_admin, email, onboarding_done, password_hash) VALUES (?, ?, ?, 0, ?, 1, ?)",
    ["prof.maria", "Prof. Maria", "professor", "prof.maria@unipam.edu.br", defaultPasswordHash]
  );

  const students = [
    ["ana", "Ana Silva"],
    ["bruno", "Bruno Costa"],
    ["carla", "Carla Mendes"],
    ["diego", "Diego Rocha"]
  ];

  for (const [username, name] of students) {
    await db.run(
      "INSERT INTO users (username, name, role, is_admin, email, onboarding_done, turma, periodo, password_hash) VALUES (?, ?, 'aluno', 0, ?, 1, ?, ?, ?)",
      [username, name, `${username}@unipam.edu.br`, "Turma A", "1º", defaultPasswordHash]
    );
  }

  const p1 = await db.run(
    "INSERT INTO projects (name, team, deadline, description, discipline, start_date) VALUES (?, ?, ?, ?, ?, ?)",
    ["App de Biblioteca", "Turma A - Grupo 2", "2026-03-25",
     "Desenvolvimento de um aplicativo web para gestão de acervo bibliográfico.",
     "Engenharia de Software", "2026-02-10"]
  );

  const p2 = await db.run(
    "INSERT INTO projects (name, team, deadline, description, discipline, start_date) VALUES (?, ?, ?, ?, ?, ?)",
    ["Site de Feira de Ciências", "Turma B - Grupo 1", "2026-04-02",
     "Criação de site para divulgação dos projetos da Feira de Ciências do semestre.",
     "Programação Web", "2026-02-17"]
  );

  const projectMembers = [
    [p1.lastID, "Ana Silva", "Product Owner"],
    [p1.lastID, "Bruno Costa", "Scrum Master"],
    [p1.lastID, "Carla Mendes", "Development Team"],
    [p2.lastID, "Bruno Costa", "Product Owner"],
    [p2.lastID, "Diego Rocha", "Scrum Master"]
  ];

  for (const [projectId, member, scrumRole] of projectMembers) {
    await db.run(
      "INSERT INTO project_members (project_id, member_name, scrum_role) VALUES (?, ?, ?)",
      [projectId, member, scrumRole]
    );
  }

  const s1 = await db.run(
    "INSERT INTO sprints (name, goal, start, end) VALUES (?, ?, ?, ?)",
    ["Sprint 1", "Levantamento e protótipo", "2026-02-24", "2026-03-02"]
  );

  const s2 = await db.run(
    "INSERT INTO sprints (name, goal, start, end) VALUES (?, ?, ?, ?)",
    ["Sprint 2", "Implementação principal", "2026-03-03", "2026-03-10"]
  );

  await db.run(
    "INSERT INTO tasks (project_id, title, assignee, due_date, sprint_id, status, priority, points, urgency, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [p1.lastID, "Definir requisitos do sistema", "Todos", "2026-03-01", s1.lastID, "doing", "alta", 5, "high",
     "Levantar e documentar todos os requisitos funcionais e não funcionais do sistema."]
  );

  await db.run(
    "INSERT INTO tasks (project_id, title, assignee, due_date, sprint_id, status, priority, points, urgency, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [p1.lastID, "Criar tela de login", "Ana Silva", "2026-03-04", s2.lastID, "doing", "media", 3, "medium",
     "Implementar interface de autenticação com validação de campos."]
  );

  await db.run(
    "INSERT INTO tasks (project_id, title, assignee, due_date, sprint_id, status, priority, points, urgency, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [p2.lastID, "Montar cronograma da apresentação", "Todos", "2026-03-03", s1.lastID, "todo", "alta", 2, "high",
     "Definir datas e responsabilidades para cada etapa da apresentação."]
  );

  await db.run(
    "INSERT INTO tasks (project_id, title, assignee, due_date, sprint_id, status, priority, points, urgency, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [p2.lastID, "Criar identidade visual", "Bruno Costa", "2026-03-05", s2.lastID, "todo", "media", 3, "low",
     "Definir paleta de cores, tipografia e logo para o site da feira."]
  );
}

async function ensureAdminAccounts(db) {
  const isProd = process.env.NODE_ENV === "production";

  function requireEnvPassword(envVar, account) {
    if (!process.env[envVar]) {
      if (isProd) {
        console.error(`[SECURITY] ${envVar} não definido em produção (conta ${account}). Encerrando.`);
        process.exit(1);
      }
      console.warn(`[SECURITY] ${envVar} não definido. Usando senha padrão insegura para conta ${account}. Defina em produção.`);
    }
  }

  requireEnvPassword("ADMIN_PASSWORD", "ADM");
  const adminPassword = process.env.ADMIN_PASSWORD || (isProd ? "" : "Anna");
  const adminPasswordHash = bcrypt.hashSync(adminPassword, 10);

  const adm = await db.get("SELECT id FROM users WHERE username = ?", ["ADM"]);
  if (!adm) {
    await db.run(
      "INSERT INTO users (username, name, role, is_admin, email, onboarding_done, password_hash) VALUES (?, ?, ?, 1, ?, 1, ?)",
      ["ADM", "Administrador", "professor", "adm@unipam.edu.br", adminPasswordHash]
    );
  } else {
    await db.run("UPDATE users SET is_admin = 1 WHERE username = ?", ["ADM"]);
  }

  const superUser = await db.get("SELECT id FROM users WHERE username = ?", ["SUPER"]);
  if (superUser) {
    await db.run("UPDATE users SET is_admin = 2 WHERE username = ?", ["SUPER"]);
  } else {
    requireEnvPassword("SUPER_PASSWORD", "SUPER");
    const superPwd = await bcrypt.hash(process.env.SUPER_PASSWORD || (isProd ? "" : "Pilha@Super2025"), 10);
    await db.run(
      "INSERT INTO users (username, name, role, is_admin, email, onboarding_done, password_hash) VALUES (?, ?, ?, 2, ?, 1, ?)",
      ["SUPER", "Super Administrador", "superadmin", "super@pilha.app", superPwd]
    );
  }

  const piUser = await db.get("SELECT id FROM users WHERE username = ?", ["PI"]);
  if (!piUser) {
    requireEnvPassword("PI_PASSWORD", "PI");
    const piHash = await bcrypt.hash(process.env.PI_PASSWORD || (isProd ? "" : "PI3A"), 10);
    await db.run(
      "INSERT INTO users (username, name, role, is_admin, email, onboarding_done, password_hash) VALUES (?, ?, ?, 1, ?, 1, ?)",
      ["PI", "Administrador PI", "professor", "pi@pilha.app", piHash]
    );
  }
}

async function initEvalDb(dbPath) {
  const resolvedPath = dbPath || EVAL_DB_PATH;
  if (resolvedPath !== ":memory:" && !fs.existsSync(resolvedPath)) {
    fs.writeFileSync(resolvedPath, "");
  }
  const evalDb = await open({ filename: resolvedPath, driver: sqlite3.Database });
  await evalDb.exec(`PRAGMA foreign_keys = ON;`);
  await evalDb.exec(`
    CREATE TABLE IF NOT EXISTS eval_activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      section TEXT NOT NULL CHECK (section IN ('planejamento', 'desenvolvimento')),
      name TEXT NOT NULL,
      max_pts REAL NOT NULL DEFAULT 1,
      score REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS eval_individual (
      project_id INTEGER NOT NULL,
      member_name TEXT NOT NULL,
      score REAL NOT NULL DEFAULT 0,
      entrega_score REAL NOT NULL DEFAULT 0,
      observacao TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (project_id, member_name)
    );

    CREATE TABLE IF NOT EXISTS eval_meta (
      project_id INTEGER PRIMARY KEY,
      entrega_score REAL NOT NULL DEFAULT 0,
      observacoes TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS eval_activity_scores (
      activity_id INTEGER NOT NULL,
      member_name TEXT NOT NULL,
      score REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (activity_id, member_name),
      FOREIGN KEY (activity_id) REFERENCES eval_activities(id) ON DELETE CASCADE
    );
  `);

  // Migração: colunas individuais (entrega/observação por aluno) em bancos existentes
  try {
    const cols = await evalDb.all("PRAGMA table_info(eval_individual)");
    const names = cols.map(c => c.name);
    if (!names.includes("entrega_score"))
      await evalDb.exec("ALTER TABLE eval_individual ADD COLUMN entrega_score REAL NOT NULL DEFAULT 0");
    if (!names.includes("observacao"))
      await evalDb.exec("ALTER TABLE eval_individual ADD COLUMN observacao TEXT NOT NULL DEFAULT ''");
  } catch (e) { console.warn("[EVAL DB] migration individual:", e.message); }

  return evalDb;
}

module.exports = { initDb, initEvalDb };
