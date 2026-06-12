-- ============================================================
--  PILHA — Schema PostgreSQL para Supabase
--  Combina campusflow.db + grading.db em um único banco
--  Execute no SQL Editor do Supabase
-- ============================================================

-- ── Users ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id               BIGSERIAL PRIMARY KEY,
  username         TEXT NOT NULL UNIQUE,
  name             TEXT NOT NULL,
  role             TEXT NOT NULL CHECK (role IN ('aluno', 'professor')),
  is_admin         INTEGER NOT NULL DEFAULT 0,
  email            TEXT UNIQUE,
  turma            TEXT,
  periodo          TEXT,
  curso            TEXT,
  photo            TEXT,
  bio              TEXT DEFAULT '',
  skills           TEXT DEFAULT '[]',
  graduations      TEXT DEFAULT '',
  specialty        TEXT DEFAULT '',
  experience_years INTEGER DEFAULT 0,
  onboarding_done  INTEGER NOT NULL DEFAULT 0,
  profile_complete INTEGER NOT NULL DEFAULT 0,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  password_hash    TEXT NOT NULL,
  turma_id         INTEGER,
  github_login     TEXT,
  totp_secret      TEXT,
  totp_enabled     INTEGER NOT NULL DEFAULT 0
);

-- ── Turmas ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS turmas (
  id           BIGSERIAL PRIMARY KEY,
  professor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  curso        TEXT NOT NULL,
  periodo      TEXT NOT NULL,
  turma        TEXT NOT NULL,
  invite_token TEXT NOT NULL UNIQUE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── Projects ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projects (
  id             BIGSERIAL PRIMARY KEY,
  name           TEXT NOT NULL,
  team           TEXT NOT NULL,
  deadline       TEXT NOT NULL,
  description    TEXT DEFAULT '',
  discipline     TEXT DEFAULT '',
  start_date     TEXT DEFAULT '',
  docs_unlocked  INTEGER NOT NULL DEFAULT 0,
  name_confirmed INTEGER NOT NULL DEFAULT 0,
  turma_id       INTEGER REFERENCES turmas(id)
);

-- ── Project Members ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_members (
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  member_name TEXT NOT NULL,
  scrum_role  TEXT NOT NULL DEFAULT 'Development Team'
    CHECK (scrum_role IN ('Product Owner', 'Scrum Master', 'Development Team')),
  user_id     INTEGER REFERENCES users(id),
  PRIMARY KEY (project_id, member_name)
);

-- ── Sprints ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sprints (
  id    BIGSERIAL PRIMARY KEY,
  name  TEXT NOT NULL,
  goal  TEXT NOT NULL,
  start TEXT NOT NULL,
  "end" TEXT NOT NULL
);

-- ── Tasks ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tasks (
  id             BIGSERIAL PRIMARY KEY,
  project_id     INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  assignee       TEXT NOT NULL,
  due_date       TEXT NOT NULL,
  start_date     TEXT DEFAULT '',
  sprint_id      INTEGER REFERENCES sprints(id) ON DELETE SET NULL,
  status         TEXT NOT NULL DEFAULT 'todo',
  priority       TEXT NOT NULL DEFAULT 'media'
    CHECK (priority IN ('baixa', 'media', 'alta')),
  points         INTEGER NOT NULL DEFAULT 1,
  description    TEXT DEFAULT '',
  checklist      TEXT DEFAULT '[]',
  tags           TEXT DEFAULT '[]',
  urgency        TEXT NOT NULL DEFAULT 'medium'
    CHECK (urgency IN ('low', 'medium', 'high')),
  parent_task_id INTEGER,
  kanban_col_id  INTEGER
);

-- ── Task Comments ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS task_comments (
  id         BIGSERIAL PRIMARY KEY,
  task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content    TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Kanban Boards ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS kanban_boards (
  id         BIGSERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id)
);

-- ── Kanban Columns ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS kanban_columns (
  id        BIGSERIAL PRIMARY KEY,
  board_id  INTEGER NOT NULL REFERENCES kanban_boards(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  col_order INTEGER NOT NULL DEFAULT 0,
  color     TEXT DEFAULT '#e2e8f0'
);

-- ── Custom Field Definitions ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS custom_field_definitions (
  id         BIGSERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  field_type TEXT NOT NULL DEFAULT 'text'
    CHECK (field_type IN ('text','number','select','date','checkbox')),
  options    TEXT
);

-- ── Custom Field Values ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS custom_field_values (
  task_id  INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  field_id INTEGER NOT NULL REFERENCES custom_field_definitions(id) ON DELETE CASCADE,
  value    TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (task_id, field_id)
);

-- ── Project Invites ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_invites (
  id              BIGSERIAL PRIMARY KEY,
  project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  inviter_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invite_email    TEXT NOT NULL,
  invite_token    TEXT NOT NULL UNIQUE,
  status          TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','accepted','expired','canceled')),
  created_at      TEXT NOT NULL,
  accepted_at     TEXT
);

-- ── Chat Messages ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_messages (
  id         BIGSERIAL PRIMARY KEY,
  turma_id   INTEGER NOT NULL REFERENCES turmas(id) ON DELETE CASCADE,
  sender_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content    TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Notifications ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id         BIGSERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL DEFAULT 'info',
  message    TEXT NOT NULL,
  link       TEXT,
  is_read    INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── TOTP Recovery Codes ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS totp_recovery_codes (
  id         BIGSERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash  TEXT NOT NULL,
  used       INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Password Reset Tokens ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id         BIGSERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used       INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── OTP Codes ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS otp_codes (
  id         BIGSERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code       TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used       INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Project Docs ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_docs (
  id              BIGSERIAL PRIMARY KEY,
  project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  doc_type        TEXT NOT NULL CHECK (doc_type IN ('tap','pi')),
  content         TEXT NOT NULL DEFAULT '{}',
  approval_status TEXT NOT NULL DEFAULT 'draft'
    CHECK (approval_status IN ('draft','submitted','approved','rejected')),
  approved_by     TEXT,
  approved_at     TEXT,
  rejected_reason TEXT,
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, doc_type)
);

-- ── Access Logs ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS access_logs (
  id        BIGSERIAL PRIMARY KEY,
  user_id   INTEGER,
  username  TEXT NOT NULL,
  name      TEXT NOT NULL,
  role      TEXT NOT NULL DEFAULT 'aluno',
  is_admin  INTEGER NOT NULL DEFAULT 0,
  ip        TEXT,
  logged_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Task Attachments ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS task_attachments (
  id                  BIGSERIAL PRIMARY KEY,
  task_id             INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  filename            TEXT NOT NULL,
  original_name       TEXT NOT NULL,
  mime_type           TEXT NOT NULL DEFAULT 'application/octet-stream',
  size                INTEGER NOT NULL DEFAULT 0,
  uploaded_by         TEXT NOT NULL,
  uploaded_by_user_id INTEGER REFERENCES users(id),
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ── Task Audit ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS task_audit (
  id         BIGSERIAL PRIMARY KEY,
  task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_name  TEXT NOT NULL,
  field      TEXT NOT NULL,
  old_val    TEXT,
  new_val    TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Task GitHub ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS task_github (
  task_id    INTEGER PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  repo       TEXT NOT NULL DEFAULT '',
  note       TEXT NOT NULL DEFAULT '',
  updated_by TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── GitHub Integrations ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS github_integrations (
  id                   BIGSERIAL PRIMARY KEY,
  user_id              INTEGER REFERENCES users(id) ON DELETE SET NULL,
  github_account_login TEXT,
  github_account_id    INTEGER,
  installation_id      INTEGER UNIQUE,
  status               TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','active','suspended','removed')),
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

-- ── GitHub Repositories ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS github_repositories (
  id             BIGSERIAL PRIMARY KEY,
  integration_id INTEGER NOT NULL REFERENCES github_integrations(id) ON DELETE CASCADE,
  github_repo_id INTEGER,
  owner          TEXT,
  name           TEXT,
  full_name      TEXT,
  private        INTEGER NOT NULL DEFAULT 0,
  default_branch TEXT DEFAULT 'main',
  html_url       TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (integration_id, github_repo_id)
);

-- ── Project GitHub Repositories ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_github_repositories (
  id                   BIGSERIAL PRIMARY KEY,
  project_id           INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  github_repository_id INTEGER NOT NULL REFERENCES github_repositories(id) ON DELETE CASCADE,
  linked_by_user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  is_active            INTEGER NOT NULL DEFAULT 1,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (project_id, github_repository_id)
);

-- ── GitHub Webhook Events ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS github_webhook_events (
  id                   BIGSERIAL PRIMARY KEY,
  github_delivery_id   TEXT UNIQUE,
  event_type           TEXT,
  action               TEXT,
  repository_full_name TEXT,
  payload_json         TEXT,
  processed            INTEGER NOT NULL DEFAULT 0,
  processed_at         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ DEFAULT NOW()
);

-- ── GitHub User Stats ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS github_user_stats (
  id            BIGSERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period        TEXT NOT NULL,
  commits       INTEGER NOT NULL DEFAULT 0,
  prs_opened    INTEGER NOT NULL DEFAULT 0,
  prs_merged    INTEGER NOT NULL DEFAULT 0,
  reviews       INTEGER NOT NULL DEFAULT 0,
  tasks_done    INTEGER NOT NULL DEFAULT 0,
  files_changed INTEGER NOT NULL DEFAULT 0,
  lines_added   INTEGER NOT NULL DEFAULT 0,
  lines_removed INTEGER NOT NULL DEFAULT 0,
  computed_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, period)
);

-- ── Doc Comments ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS doc_comments (
  id         BIGSERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  doc_type   TEXT NOT NULL CHECK (doc_type IN ('tap','pi')),
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_name  TEXT NOT NULL,
  content    TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Doc Permissions ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS doc_permissions (
  id          BIGSERIAL PRIMARY KEY,
  turma_id    INTEGER NOT NULL REFERENCES turmas(id) ON DELETE CASCADE,
  doc_type    TEXT NOT NULL CHECK (doc_type IN ('tap','pi')),
  released_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  released_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(turma_id, doc_type)
);

-- ── Project Messages ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_messages (
  id          BIGSERIAL PRIMARY KEY,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sender_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_name TEXT NOT NULL,
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ══════════════════════════════════════════════════════════════════════════════
--  AVALIAÇÃO (grading.db) — mesclado no mesmo banco
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS eval_activities (
  id         BIGSERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL,
  section    TEXT NOT NULL CHECK (section IN ('planejamento', 'desenvolvimento')),
  name       TEXT NOT NULL,
  max_pts    DOUBLE PRECISION NOT NULL DEFAULT 1,
  score      DOUBLE PRECISION NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS eval_individual (
  project_id     INTEGER NOT NULL,
  member_name    TEXT NOT NULL,
  score          DOUBLE PRECISION NOT NULL DEFAULT 0,
  entrega_score  DOUBLE PRECISION NOT NULL DEFAULT 0,
  observacao     TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (project_id, member_name)
);

CREATE TABLE IF NOT EXISTS eval_meta (
  project_id    INTEGER PRIMARY KEY,
  entrega_score DOUBLE PRECISION NOT NULL DEFAULT 0,
  observacoes   TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS eval_activity_scores (
  activity_id INTEGER NOT NULL REFERENCES eval_activities(id) ON DELETE CASCADE,
  member_name TEXT NOT NULL,
  score       DOUBLE PRECISION NOT NULL DEFAULT 0,
  PRIMARY KEY (activity_id, member_name)
);
