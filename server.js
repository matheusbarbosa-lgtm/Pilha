require("dotenv").config();
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const helmet = require("helmet");
const http = require("http");
const { Server: SocketServer } = require("socket.io");
const multer = require("multer");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcryptjs");
const argon2 = require("argon2");
const speakeasy = require("speakeasy");
const QRCode = require("qrcode");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
let initDb, initEvalDb;
try {
  ({ initDb, initEvalDb } = process.env.DATABASE_URL
    ? require("./db-pg")
    : require("./db"));
} catch (_dbLoadErr) {
  // driver de banco falhou ao carregar — createApp() vai rejeitar e o servidor de diagnóstico irá capturar
  initDb = initEvalDb = () => { throw _dbLoadErr; };
}

// ── Upload dir ────────────────────────────────────────────
const UPLOAD_DIR = path.join(__dirname, "uploads", "tasks");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const _storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).slice(0, 10);
    cb(null, `${Date.now()}-${crypto.randomUUID().slice(0,8)}${ext}`);
  }
});
const upload = multer({
  storage: _storage,
  limits: { fileSize: 80 * 1024 * 1024 }, // 80MB
  fileFilter: (_req, file, cb) => {
    const allowed = ["application/pdf","application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "image/png","image/jpeg","image/gif","text/plain"];
    cb(null, allowed.includes(file.mimetype));
  }
});


const PORT = process.env.PORT || 3000;

async function hashPassword(password) {
  return argon2.hash(String(password), { type: argon2.argon2id });
}

async function verifyPassword(password, hash) {
  const pw = String(password);
  if (hash && hash.startsWith("$argon2")) {
    const valid = await argon2.verify(hash, pw);
    return { valid, needsRehash: false };
  }
  const valid = bcrypt.compareSync(pw, hash);
  return { valid, needsRehash: valid };
}

function sanitize(str, maxLen = 300) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/<[^>]*>/g, "")           // strip HTML tags
    .replace(/javascript\s*:/gi, "")   // block JS URIs
    .replace(/on\w+\s*=/gi, "")        // strip event handlers
    .replace(/data\s*:/gi, "")         // block data URIs
    .trim()
    .slice(0, maxLen);
}
function sanitizeUsername(str) {
  return String(str || "").replace(/[^a-zA-Z0-9._@\-]/g, "").trim().slice(0, 50).toLowerCase();
}
function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}
// Returns null if password meets the strong policy, or an error string if it doesn't.
// Policy: ≥8 chars, uppercase, lowercase, digit, special character.
function validatePasswordStrength(password) {
  const pw = String(password || "");
  if (pw.length < 8)            return "Senha deve ter pelo menos 8 caracteres";
  if (!/[A-Z]/.test(pw))        return "Senha deve conter pelo menos uma letra maiúscula";
  if (!/[a-z]/.test(pw))        return "Senha deve conter pelo menos uma letra minúscula";
  if (!/[0-9]/.test(pw))        return "Senha deve conter pelo menos um número";
  if (!/[^A-Za-z0-9]/.test(pw)) return "Senha deve conter pelo menos um caractere especial (!@#$%...)";
  return null;
}
function readCookieValue(cookieHeader, cookieName) {
  const prefix = `${cookieName}=`;
  const match = String(cookieHeader || "")
    .split(/;\s*/)
    .find((part) => part.startsWith(prefix));
  return match ? decodeURIComponent(match.slice(prefix.length)) : null;
}
if (!process.env.JWT_SECRET && process.env.NODE_ENV === "production") {
  console.error("[SECURITY] JWT_SECRET não definido em produção. Encerrando.");
  process.exit(1);
}
const JWT_SECRET = process.env.JWT_SECRET || (process.env.NODE_ENV === "test" ? "test_secret_only" : (() => {
  console.warn("[SECURITY] JWT_SECRET não definido. Usando secret padrão inseguro. Defina JWT_SECRET em produção.");
  return "campusflow_dev_secret_change_me";
})());

// ── Simple in-memory rate limiter ─────────────────────────────────────────────
function makeRateLimiter(maxAttempts, windowMs, errorMsg) {
  const store = new Map(); // key -> { count, resetAt }
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [k, entry] of store) {
      if (now > entry.resetAt) store.delete(k);
    }
  }, 5 * 60 * 1000);
  // Evita que esse timer mantenha o processo ativo quando nao ha mais trabalho.
  if (typeof cleanupInterval.unref === "function") cleanupInterval.unref();

  return function rateLimitMiddleware(req, res, next) {
    const key = req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();
    let entry = store.get(key);
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      store.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > maxAttempts) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.set("Retry-After", String(retryAfter));
      return res.status(429).json({ error: errorMsg });
    }
    return next();
  };
}

// Login: 10 tentativas / 15 min por IP
const loginRateLimit = makeRateLimiter(10, 15 * 60 * 1000, "Muitas tentativas de login. Tente novamente em alguns minutos.");
// OTP verify: 5 tentativas / 15 min por IP (brute-force protection)
const otpVerifyRateLimit = makeRateLimiter(5, 15 * 60 * 1000, "Muitas tentativas de código. Tente novamente em alguns minutos.");
// OTP request: 3 envios / 15 min por IP (anti email-bombing)
const otpRequestRateLimit = makeRateLimiter(3, 15 * 60 * 1000, "Muitas solicitações de código. Aguarde antes de tentar novamente.");
const TOKEN_COOKIE = "campusflow_token";
const CSRF_COOKIE  = "csrf_token";
const VALID_STATUS = ["todo", "doing", "done", "backlog", "nao_iniciado", "em_progresso", "concluido"];
const VALID_PRIORITY = ["baixa", "normal", "alta", "urgente", "media"];
const VALID_URGENCY = ["low", "medium", "high"];
const VALID_SCRUM_ROLES = ["Product Owner", "Scrum Master", "Development Team"];
const APP_BASE_URL = process.env.APP_BASE_URL || `http://127.0.0.1:${PORT}`;

let mailTransporter = null;
if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
  mailTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || "false").toLowerCase() === "true",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
}

function normalizeTask(row) {
  let checklist = [];
  let tags = [];
  try { checklist = JSON.parse(row.checklist || "[]"); } catch (_) {}
  try { tags = JSON.parse(row.tags || "[]"); } catch (_) {}
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    title: row.title,
    assignee: row.assignee,
    dueDate: row.due_date,
    startDate: row.start_date || "",
    sprintId: String(row.sprint_id),
    status: row.status,
    priority: row.priority,
    points: row.points,
    description: row.description || "",
    checklist,
    tags,
    urgency: row.urgency || "medium",
    parentTaskId: row.parent_task_id ? String(row.parent_task_id) : null,
    githubRepo: row.github_repo || "",
    githubNote: row.github_note || "",
    customValues: row.customValues || {}
  };
}

function cleanStatus(value) {
  return String(value || "").toLowerCase();
}

// Registra um evento no histórico de atividade da tarefa (best-effort).
async function logTaskAudit(db, taskId, userName, field, oldVal, newVal) {
  try {
    await db.run(
      "INSERT INTO task_audit (task_id, user_name, field, old_val, new_val) VALUES (?,?,?,?,?)",
      [taskId, userName || "Sistema", field, oldVal == null ? null : String(oldVal), newVal == null ? null : String(newVal)]
    );
  } catch (_) { /* histórico é best-effort, nunca quebra a ação principal */ }
}

// ── GitHub: autenticação do App + API (para estatísticas de contribuição) ──
// Aceita a private key em 3 formatos: PEM puro, PEM com \n literal, ou base64.
function normalizeGithubPrivateKey(raw) {
  let key = String(raw || "").trim();
  if (!key) return "";
  if (key.includes("\\n")) key = key.replace(/\\n/g, "\n");
  if (!key.startsWith("-----BEGIN")) {
    try {
      const decoded = Buffer.from(key, "base64").toString("utf8");
      if (decoded.includes("-----BEGIN")) key = decoded;
    } catch (_) { /* não é base64 */ }
  }
  return key;
}

function githubAppJwt() {
  const appId = process.env.GITHUB_APP_ID;
  const pem = normalizeGithubPrivateKey(process.env.GITHUB_PRIVATE_KEY);
  if (!appId || !pem) return null;
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign({ iat: now - 60, exp: now + 540, iss: String(appId) }, pem, { algorithm: "RS256" });
}

const _ghTokenCache = new Map(); // installationId -> { token, exp(ms) }
async function githubInstallationToken(installationId) {
  if (!installationId) return null;
  const cached = _ghTokenCache.get(String(installationId));
  if (cached && cached.exp > Date.now() + 60000) return cached.token;
  const appJwt = githubAppJwt();
  if (!appJwt) return null;
  const res = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
    method: "POST",
    headers: { Authorization: `Bearer ${appJwt}`, Accept: "application/vnd.github+json", "User-Agent": "PILHA" },
  });
  if (!res.ok) { const e = new Error(`GitHub token HTTP ${res.status}`); e.status = res.status; throw e; }
  const j = await res.json();
  _ghTokenCache.set(String(installationId), { token: j.token, exp: new Date(j.expires_at).getTime() });
  return j.token;
}

async function githubApi(token, path) {
  const url = path.startsWith("http") ? path : `https://api.github.com${path}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "PILHA" } });
  if (!res.ok) { const e = new Error(`GitHub API ${res.status} ${path}`); e.status = res.status; throw e; }
  return res.json();
}

// Início do mês atual (UTC) + rótulo do período
function currentMonthRange() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return { since: start.toISOString(), period: `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}` };
}

// Agrega detalhes de commits (função pura — testável sem rede)
function aggregateCommitDetails(commitDetails) {
  let additions = 0, deletions = 0;
  const files = new Set();
  for (const c of commitDetails) {
    if (c && c.stats) { additions += c.stats.additions || 0; deletions += c.stats.deletions || 0; }
    for (const f of (c && c.files) || []) if (f && f.filename) files.add(f.filename);
  }
  return { commits: commitDetails.length, linesAdded: additions, linesRemoved: deletions, filesChanged: files.size };
}

function sanitizePhotoDataUrl(photo) {
  if (photo === undefined || photo === null || photo === "") return null;
  const raw = String(photo).trim();
  if (!raw) return null;
  if (raw.length > 400000) return { error: "Foto muito grande para salvar" };

  const validDataUrl = /^data:image\/(jpeg|jpg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(raw);
  if (!validDataUrl) return { error: "Formato de foto invalido" };
  return raw;
}

function buildAuthPayload(user) {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    isAdmin: Boolean(user.is_admin),
    isSuperAdmin: user.is_admin >= 2,
    email: user.email || null,
    turma: user.turma || null,
    periodo: user.periodo || null,
    curso: user.curso || null,
    turmaId: user.turma_id || null,
    profileComplete: Boolean(user.profile_complete),
    onboardingDone: Boolean(user.onboarding_done)
  };
}

function setAuthCookie(res, payload) {
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "12h" });
  const cookieOpts = { sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 12 * 60 * 60 * 1000 };
  res.cookie(TOKEN_COOKIE, token, { ...cookieOpts, httpOnly: true });
  res.setHeader("X-Auth-Token", token);
  // CSRF token — não-HttpOnly para que o JS do frontend possa ler e enviar no header
  const csrfToken = crypto.randomBytes(32).toString("hex");
  res.cookie(CSRF_COOKIE, csrfToken, { ...cookieOpts, httpOnly: false });
}

// Middleware de proteção CSRF para requisições mutáveis autenticadas.
// Estratégia double-submit cookie: compara X-CSRF-Token header com csrf_token cookie.
// Rotas públicas (sem cookie de sessão) são isentas — authRequired as rejeitará se necessário.
// Rotas públicas com proteção própria (token de convite) isentas de CSRF
const CSRF_EXEMPT_PATHS = new Set(["/api/auth/register-by-invite"]);

function csrfProtect(req, res, next) {
  const MUTATING = ["POST", "PUT", "PATCH", "DELETE"];
  if (!MUTATING.includes(req.method)) return next();
  if (CSRF_EXEMPT_PATHS.has(req.path)) return next();
  const sessionToken = req.cookies[TOKEN_COOKIE];
  if (!sessionToken) return next();
  // Cookie presente mas inválido/expirado → trata como não autenticado (isento de CSRF)
  try { jwt.verify(sessionToken, JWT_SECRET); } catch (_) { return next(); }
  const fromHeader = req.headers["x-csrf-token"];
  const fromCookie = req.cookies[CSRF_COOKIE];
  if (!fromHeader || !fromCookie || fromHeader !== fromCookie) {
    return res.status(403).json({ error: "Token CSRF inválido ou ausente" });
  }
  next();
}

async function getProjectsWithMembers(db, where = "", params = []) {
  const rows = await db.all(
    `SELECT p.id, p.name, p.team, p.deadline, p.description, p.discipline, p.start_date,
            p.docs_unlocked, p.name_confirmed, p.turma_id,
            pm.member_name, pm.scrum_role
     FROM projects p
     LEFT JOIN project_members pm ON pm.project_id = p.id
     ${where}
     ORDER BY p.id DESC`,
    params
  );

  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.id)) {
      map.set(row.id, {
        id: String(row.id),
        name: row.name,
        team: row.team,
        deadline: row.deadline,
        description: row.description || "",
        discipline: row.discipline || "",
        startDate: row.start_date || "",
        docsUnlocked: row.docs_unlocked === 1,
        nameConfirmed: row.name_confirmed === 1,
        turma_id: row.turma_id || null,
        members: [],
        memberProfiles: []
      });
    }
    if (row.member_name) {
      map.get(row.id).members.push(row.member_name);
      map.get(row.id).memberProfiles.push({
        name: row.member_name,
        role: row.scrum_role || null
      });
    }
  }
  return Array.from(map.values());
}

async function buildVisibleScope(db, user) {
  if (user.isAdmin) {
    const projects = await getProjectsWithMembers(db);
    return { projects, projectIds: new Set(projects.map((p) => Number(p.id))), tasksFilter: "" };
  }
  if (user.role === "professor") {
    // Usa turma_id (FK direta) — fallback SOMENTE para projetos sem turma_id (legado já backfillado)
    const myTurmaIds = await db.all("SELECT id FROM turmas WHERE professor_id = ?", [user.id]);
    if (myTurmaIds.length === 0) return { projects: [], projectIds: new Set(), tasksFilter: "" };
    const ph = myTurmaIds.map(() => "?").join(",");
    const ids = myTurmaIds.map(t => t.id);
    const projects = await getProjectsWithMembers(db, `WHERE p.turma_id IN (${ph})`, ids);
    return { projects, projectIds: new Set(projects.map((p) => Number(p.id))), tasksFilter: "" };
  }
  // Usa user_id FK primeiro; fallback apenas para linhas legadas com nome único
  const projects = await getProjectsWithMembers(
    db,
    `WHERE p.id IN (
      SELECT project_id FROM project_members WHERE user_id = ?
      UNION
      SELECT pm.project_id FROM project_members pm
      WHERE pm.user_id IS NULL AND pm.member_name = ?
      AND (SELECT COUNT(*) FROM users u2 WHERE u2.name = pm.member_name) = 1
    )`,
    [user.id, user.name]
  );
  return { projects, projectIds: new Set(projects.map((p) => Number(p.id))), tasksFilter: "" };
}

// Verifica se um professor é dono do projeto via turma_id (FK direta).
// Falha fechado (false) se o projeto não tiver turma_id definido.
async function professorOwnsProject(db, professorId, projectId) {
  const row = await db.get(
    `SELECT 1 FROM projects p
     INNER JOIN turmas t ON p.turma_id = t.id
     WHERE p.id = ? AND t.professor_id = ?`,
    [projectId, professorId]
  );
  return !!row;
}

// Verifica se um usuário é Product Owner do projeto por user_id (FK segura).
// Fallback apenas para linhas legadas com nome único no sistema (sem homônimos).
// Falha fechado (null) se houver ambiguidade.
async function isProjectPO(db, projectId, userId, userName) {
  return await db.get(
    `SELECT 1 FROM project_members WHERE project_id = ? AND scrum_role = 'Product Owner'
     AND (user_id = ? OR (user_id IS NULL AND member_name = ?
     AND (SELECT COUNT(*) FROM users u2 WHERE u2.name = member_name) = 1))`,
    [projectId, userId, userName]
  );
}

async function getProjectMembersSet(db, projectId) {
  const rows = await db.all("SELECT member_name FROM project_members WHERE project_id = ?", [projectId]);
  return new Set(rows.map((row) => row.member_name));
}

async function createAndSendInvites(db, { projectId, inviterUserId, inviteEmails }) {
  const cleanEmails = Array.from(new Set(
    (inviteEmails || []).map((e) => String(e || "").trim().toLowerCase()).filter(Boolean)
  ));
  const inviter = await db.get("SELECT name FROM users WHERE id = ?", [inviterUserId]);
  const poName = sanitize(inviter?.name || "seu colega");
  let created = 0;
  for (const email of cleanEmails) {
    const token = crypto.randomUUID();
    await db.run(
      "INSERT INTO project_invites (project_id, inviter_user_id, invite_email, invite_token, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)",
      [projectId, inviterUserId, email, token, new Date().toISOString()]
    );
    created += 1;
    const inviteLink = `${APP_BASE_URL}/cadastro?invite=${token}`;
    const recipientName = sanitize(email.split("@")[0]);
    if (mailTransporter) {
      try {
        const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Convite para o Projeto de PI | PILHA</title>
  <style>
    body{margin:0;padding:0;background-color:#f0f4f9;font-family:Arial,Helvetica,sans-serif;color:#0d2137}
    table{border-spacing:0;border-collapse:collapse}
    img{border:0;display:block;max-width:100%}
    .container{width:100%;max-width:600px;margin:0 auto;background-color:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 10px 28px rgba(13,33,55,.12)}
    .header{background:linear-gradient(135deg,#071433 0%,#0d1e4a 35%,#1a237e 70%,#0d47a1 100%);padding:36px 24px;text-align:center;color:#fff}
    .logo{font-size:30px;font-weight:800;letter-spacing:1px;margin:0}
    .subtitle{margin:10px 0 0;font-size:14px;color:#dbeafe;line-height:1.5}
    .content{padding:36px 40px 28px}
    h1{margin:0 0 20px;font-size:24px;line-height:1.35;color:#0d2137}
    p{margin:0 0 18px;font-size:15px;line-height:1.7;color:#344563}
    .highlight{background-color:#dbeafe;border-left:5px solid #1565C0;border-radius:10px;padding:20px 22px;margin:26px 0}
    .highlight p{margin:0;color:#0d2137;font-size:15px;line-height:1.7}
    .orange-box{background-color:#fff3e0;border:1px solid #F47920;border-radius:12px;padding:22px;margin:28px 0}
    .orange-box h2{margin:0 0 14px;font-size:17px;color:#0d2137}
    .benefit{padding:12px 0;border-bottom:1px solid #dde3ec;font-size:14px;line-height:1.6;color:#344563}
    .benefit:last-child{border-bottom:none}
    .benefit strong{color:#0d2137}
    .cta-wrap{text-align:center;padding:10px 0 30px}
    .cta-button{display:inline-block;background-color:#F47920;color:#ffffff!important;text-decoration:none;font-size:16px;font-weight:bold;padding:16px 34px;border-radius:9px;box-shadow:0 8px 18px rgba(244,121,32,.28)}
    .support{background-color:#f5f8fd;border-radius:12px;padding:22px;text-align:center;margin-top:10px}
    .support p{margin:0;font-size:14px;color:#6b778c}
    .support a{color:#1565C0;font-weight:bold;text-decoration:none}
    .footer{background-color:#0D1E3E;padding:30px 24px;text-align:center;color:#8fa4c8}
    .footer p{margin:0 0 10px;font-size:13px;line-height:1.6;color:#8fa4c8}
    .footer strong{color:#fff}
    .footer-line{background-color:#F47920;height:7px;line-height:7px;font-size:0}
    @media only screen and (max-width:620px){.container{width:100%!important;border-radius:0!important}.content{padding:30px 22px 24px!important}h1{font-size:21px!important}p{font-size:14px!important}.cta-button{display:block!important;width:auto!important;padding:15px 20px!important}.header{padding:32px 18px!important}}
  </style>
</head>
<body>
  <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#f0f4f9;padding:28px 14px;">
    <tr><td align="center">
      <table class="container" width="600" border="0" cellpadding="0" cellspacing="0" role="presentation">
        <tr><td class="header">
          <p class="logo">📚 PILHA</p>
          <p class="subtitle">Gestão Ágil Acadêmica • Projetos Integradores</p>
        </td></tr>
        <tr><td class="content">
          <h1>Olá ${recipientName}! 🚀</h1>
          <p>Fico feliz em saber que foi convidado para o projeto de PI usando nossa plataforma PILHA !!!</p>
          <p>Você foi convidado pelo <strong>${poName}</strong> para participar do PI. Segue o link abaixo para participar do projeto:</p>
          <div class="cta-wrap">
            <a href="${inviteLink}" target="_blank" class="cta-button">🚀 Participar do projeto no PILHA</a>
          </div>
          <div class="highlight">
            <p>O <strong>PILHA</strong> é uma plataforma de gestão ágil acadêmica criada para facilitar a organização dos Projetos Integradores, conectando alunos, professores e equipes em um ambiente simples, visual e colaborativo.</p>
          </div>
          <div class="orange-box">
            <h2>🎯 O que você pode fazer como aluno no PILHA:</h2>
            <div class="benefit">📌 <strong>Acompanhar o projeto</strong> — visualize as etapas, atividades e o andamento do PI em tempo real.</div>
            <div class="benefit">✅ <strong>Organizar suas tarefas</strong> — acompanhe o que precisa ser feito e ajude sua equipe a manter tudo no caminho certo.</div>
            <div class="benefit">💬 <strong>Comunicar-se com a equipe</strong> — mantenha a troca de informações centralizada dentro da plataforma.</div>
            <div class="benefit">📊 <strong>Ver o progresso do grupo</strong> — acompanhe o Kanban, os sprints e a evolução das entregas.</div>
            <div class="benefit">🎓 <strong>Participar melhor do PI</strong> — tenha mais clareza sobre prazos, responsabilidades e próximos passos.</div>
          </div>
          <p>Depois de acessar o convite, entre na plataforma, confira as informações do projeto e participe junto com sua equipe.</p>
          <div class="support">
            <p>Precisa de ajuda? Entre em contato com o suporte pelo e-mail:<br>
              <a href="mailto:joaovitorcesario@hotmail.com">joaovitorcesario@hotmail.com</a>
            </p>
          </div>
        </td></tr>
        <tr><td class="footer">
          <p><strong>📚 PILHA</strong> — Gestão Ágil Acadêmica</p>
          <p>© 2026 PILHA · UNIPAM. Todos os direitos reservados.</p>
          <p>Este é um e-mail automático. Por favor, não responda diretamente a esta mensagem.</p>
        </td></tr>
        <tr><td class="footer-line">&nbsp;</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
        await mailTransporter.sendMail({
          from: process.env.SMTP_FROM || "PILHA <no-reply@eusford.com>",
          to: email,
          subject: `${poName} te convidou para um projeto no PILHA 🚀`,
          html,
          text: `Olá ${recipientName}! ${poName} te convidou para participar de um projeto no PILHA.\nAcesse e participe: ${inviteLink}`
        });
      } catch (err) {
        console.error(`[MAIL_ERROR] ${email}: ${err.message}`);
      }
    } else {
      console.log(`[INVITE_LINK] ${email} -> ${inviteLink}`);
    }
  }
  return created;
}

// Envolve handlers async para encaminhar erros ao handler global de erros
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function authRequired(req, res, next) {
  // Aceita token via Authorization header (sessionStorage por aba) ou cookie
  const authHeader = req.headers["authorization"] || "";
  const legacyHeaderToken = req.headers["x-auth-token"] || "";
  const token = (authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null)
    || legacyHeaderToken
    || req.cookies[TOKEN_COOKIE];
  if (!token) return res.status(401).json({ error: "Não autenticado" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    // Sessão legada sem cookie CSRF — gera um (mantém GET funcional; próximas mutações terão CSRF válido)
    if (!req.cookies[CSRF_COOKIE]) {
      const csrfToken = crypto.randomBytes(32).toString("hex");
      const cookieOpts = { sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 12 * 60 * 60 * 1000, httpOnly: false };
      res.cookie(CSRF_COOKIE, csrfToken, cookieOpts);
    }
    return next();
  } catch (_) {
    return res.status(401).json({ error: "Sessão inválida" });
  }
}

function professorOnly(req, res, next) {
  if (req.user.role !== "professor" && req.user.role !== "superadmin" && !req.user.isAdmin) {
    return res.status(403).json({ error: "Acesso permitido apenas para professor" });
  }
  return next();
}

function adminOnly(req, res, next) {
  if (!req.user.isAdmin) return res.status(403).json({ error: "Acesso permitido apenas para ADM" });
  return next();
}

function superAdminOnly(req, res, next) {
  if (!req.user.isSuperAdmin) return res.status(403).json({ error: "Acesso restrito ao Super ADM" });
  return next();
}


async function createApp(dbOverride, evalDbOverride) {
  const db = dbOverride || await initDb();
  const evalDb = evalDbOverride || await initEvalDb();
  const app = express();

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc:     ["'self'"],
        scriptSrc:      ["'self'"],
        styleSrc:       ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc:        ["'self'", "https://fonts.gstatic.com"],
        imgSrc:         ["'self'", "data:"],
        connectSrc:     ["'self'", "ws:", "wss:"],
        objectSrc:      ["'none'"],
        frameAncestors: ["'none'"],
        baseUri:        ["'self'"],
        formAction:     ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }));
  // Captura o corpo bruto (necessário para validar a assinatura HMAC do webhook GitHub)
  app.use(express.json({ limit: "5mb", verify: (req, _res, buf) => { req.rawBody = buf; } }));
  app.use(cookieParser());
  app.disable("x-powered-by");
  app.use(csrfProtect);

  const HTML_PARTS = ['shell-top','nav','dashboard','projects','scrum','kanban','documents','turmas','chat','equipes','avaliacao','admin','integracoes','modals','shell-bottom'];
  const _fs = require("fs");
  const _path = require("path");
  // Versão de assets para cache-busting. Em produção, fixa por execução;
  // em dev, muda a cada request para sempre servir JS/CSS atualizados.
  const ASSET_VERSION_BASE = Date.now();
  function serveApp(res) {
    try {
      let html = HTML_PARTS.map(p => _fs.readFileSync(_path.join(__dirname, 'views', p + '.html'), 'utf8')).join('\n');
      const v = process.env.NODE_ENV === 'production' ? ASSET_VERSION_BASE : Date.now();
      html = html.replace(/\?v=\d+/g, `?v=${v}`);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    } catch (e) {
      res.status(500).send(`Erro ao carregar HTML: ${e.message}`);
    }
  }
  // Whitelist de assets públicos — apenas os diretórios/arquivos necessários.
  // uploads/ são servidos via endpoint autenticado, nunca diretamente.
  app.use("/js", express.static(path.join(__dirname, "js"), { index: false }));
  app.use("/assets", express.static(path.join(__dirname, "assets"), { index: false }));
  app.get("/styles.css", (_req, res) => res.sendFile(path.join(__dirname, "styles.css")));
  app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "landing.html")));

  // Auto-encaminha erros de handlers async ao handler global de erros
  ["get", "post", "patch", "put", "delete"].forEach((method) => {
    const orig = app[method].bind(app);
    app[method] = (routePath, ...handlers) => orig(routePath, ...handlers.map((h) =>
      h.constructor.name === "AsyncFunction"
        ? (req, res, next) => h(req, res, next).catch(next)
        : h
    ));
  });

  // ── Auth ─────────────────────────────────────────────────────────────────

  app.post("/api/auth/login", async (req, res) => {
    const { identifier, username, email, password } = req.body || {};
    const loginIdentifier = String(identifier || email || username || "").trim();
    if (!loginIdentifier || !password) return res.status(400).json({ error: "Login e senha são obrigatórios" });
    let user = null;
    if (isValidEmail(loginIdentifier)) {
      user = await db.get("SELECT * FROM users WHERE LOWER(email) = ?", [loginIdentifier.toLowerCase()]);
    } else {
      // Username login — only permitted for admin accounts
      user = await db.get("SELECT * FROM users WHERE UPPER(username) = ?", [loginIdentifier.toUpperCase()]);
      if (user && user.is_admin < 1) {
        return res.status(403).json({ error: "Login por nome de usuário permitido apenas para administradores." });
      }
    }
    if (!user) return res.status(401).json({ error: "Credenciais inválidas" });
    const { valid: _loginValid, needsRehash: _loginNeedsRehash } = await verifyPassword(password, user.password_hash);
    if (!_loginValid) return res.status(401).json({ error: "Credenciais inválidas" });
    if (_loginNeedsRehash) await db.run("UPDATE users SET password_hash = ? WHERE id = ?", [await hashPassword(password), user.id]);
    // Usuários dispensados de 2FA/TOTP — somente via variável de ambiente
    // (NO_2FA_USERNAMES). Vazio por padrão → produção mantém 2FA/TOTP intactos.
    const _no2fa = (process.env.NO_2FA_USERNAMES || "").split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
    // TOTP for professors — send requiresTOTP/requiresTotpSetup, don't issue JWT yet
    if (user.role === "professor" && user.is_admin === 0 && process.env.NODE_ENV !== "test" && !_no2fa.includes(user.username.toUpperCase())) {
      if (user.totp_enabled) {
        return res.json({ requiresTOTP: true, userId: user.id });
      } else {
        const tempToken = jwt.sign({ userId: user.id, scope: "totp-setup" }, JWT_SECRET, { expiresIn: "10m" });
        return res.json({ requiresTotpSetup: true, userId: user.id, tempToken });
      }
    }
    // 2FA for ADM (is_admin=1) and SUPER (is_admin>=2) — send OTP email, don't issue JWT yet
    if (user.is_admin >= 1 && process.env.NODE_ENV !== "test" && !_no2fa.includes(user.username.toUpperCase())) {
      const otpEmail = user.is_admin >= 2
        ? (process.env.SUPER_OTP_EMAIL || user.email)
        : user.email;
      if (otpEmail) {
        const code = String(Math.floor(100000 + Math.random() * 900000));
        const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
        await db.run("DELETE FROM otp_codes WHERE user_id = ?", [user.id]);
        await db.run("INSERT INTO otp_codes (user_id, code, expires_at) VALUES (?, ?, ?)", [user.id, code, expires]);
        if (mailTransporter) {
          await mailTransporter.sendMail({
            from: process.env.SMTP_FROM || process.env.EMAIL_FROM || "PILHA <no-reply@eusford.com>",
            to: otpEmail,
            subject: "Código de verificação — PILHA",
            html: `<div style="font-family:sans-serif;max-width:400px;margin:auto;">
              <h2 style="color:#1565C0;">Verificação em dois fatores</h2>
              <p>Olá, <b>${sanitize(user.name)}</b>. Seu código:</p>
              <div style="font-size:2.5rem;font-weight:700;letter-spacing:0.2em;color:#1565C0;margin:16px 0;">${code}</div>
              <p style="color:#888;font-size:12px;">Válido por 10 minutos. Não compartilhe.</p>
            </div>`
          }).catch(err => console.error("[OTP] Falha ao enviar email:", err.message));
        }
        if (process.env.NODE_ENV !== "production") {
          console.log(`[OTP] código gerado para ${user.username} → ${otpEmail}`);
        }
        return res.json({ requires2FA: true, userId: user.id, maskedEmail: otpEmail.replace(/(.{2})(.*)(@.*)/, "$1***$3") });
      }
    }
    // Log access (non-admin users)
    const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "desconhecido";
    await db.run(
      "INSERT INTO access_logs (user_id, username, name, role, is_admin, ip) VALUES (?, ?, ?, ?, ?, ?)",
      [user.id, user.username, user.name, user.role, user.is_admin, String(ip).split(",")[0].trim()]
    );
    const payload = buildAuthPayload(user);
    setAuthCookie(res, payload);
    return res.json({
      user: payload,
      requiresOnboarding: payload.role === "aluno" && !payload.onboardingDone,
      mustChangePassword: !!user.must_change_password
    });
  });

  app.post("/api/auth/register", async (req, res) => {
    const { username, name, role, password, email, turma, periodo, curso } = req.body || {};
    const cleanUsername = sanitizeUsername(username);
    const cleanName = sanitize(name);
    const cleanRole = sanitize(role).toLowerCase();
    const cleanEmail = sanitize(email).toLowerCase() || null;
    const cleanTurma = sanitize(turma) || null;
    const cleanPeriodo = sanitize(periodo) || null;
    const cleanCurso = String(curso || "").trim() || null;

    if (!cleanUsername || !cleanName || !password) return res.status(400).json({ error: "Nome, usuário e senha são obrigatórios" });
    if (!["aluno", "professor"].includes(cleanRole)) return res.status(400).json({ error: "Perfil inválido" });
    const _pwErrRegister = validatePasswordStrength(password);
    if (_pwErrRegister) return res.status(400).json({ error: _pwErrRegister });

    if (await db.get("SELECT id FROM users WHERE username = ?", [cleanUsername])) {
      return res.status(409).json({ error: "Usuário já existe" });
    }
    if (cleanEmail && await db.get("SELECT id FROM users WHERE email = ?", [cleanEmail])) {
      return res.status(409).json({ error: "E-mail já cadastrado" });
    }

    const passwordHash = await hashPassword(password);
    const onboardingDone = cleanRole === "aluno" ? 0 : 1;
    const result = await db.run(
      "INSERT INTO users (username, name, role, email, turma, periodo, curso, onboarding_done, password_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [cleanUsername, cleanName, cleanRole, cleanEmail, cleanTurma, cleanPeriodo, cleanCurso, onboardingDone, passwordHash]
    );
    return res.status(201).json({ ok: true });
  });

  // ── FORGOT PASSWORD ─────────────────────────────────────
  app.post("/api/auth/forgot-password", async (req, res) => {
    const { username } = req.body || {};
    if (!username) return res.status(400).json({ error: "Informe o usuário ou e-mail" });
    const user = await db.get(
      "SELECT * FROM users WHERE username = ? OR email = ?",
      [String(username).trim().toLowerCase(), String(username).trim().toLowerCase()]
    );
    // Always return ok to not reveal if user exists
    if (!user || !user.email) return res.json({ ok: true });
    const token = crypto.randomUUID();
    const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour
    await db.run("DELETE FROM password_reset_tokens WHERE user_id = ?", [user.id]);
    await db.run(
      "INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES (?, ?, ?)",
      [user.id, token, expires]
    );
    const resetUrl = `${process.env.APP_URL || "https://eusford.com"}/?reset=${token}`;
    if (mailTransporter) {
      await mailTransporter.sendMail({
        from: process.env.SMTP_FROM || process.env.EMAIL_FROM || "PILHA <no-reply@eusford.com>",
        to: user.email,
        subject: "Recuperação de senha — PILHA",
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:auto;">
            <h2 style="color:#1565C0;">Recuperação de senha</h2>
            <p>Olá, <b>${sanitize(user.name)}</b>.</p>
            <p>Clique no botão abaixo para criar uma nova senha. O link é válido por <b>1 hora</b>.</p>
            <a href="${resetUrl}" style="display:inline-block;background:#1565C0;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;margin:16px 0;">Redefinir senha</a>
            <p style="color:#888;font-size:12px;">Se não foi você, ignore este e-mail.</p>
          </div>
        `
      }).catch(() => {});
    }
    res.json({ ok: true });
  });

  app.post("/api/auth/reset-password", async (req, res) => {
    const { token, newPassword } = req.body || {};
    const _pwErrReset = validatePasswordStrength(newPassword);
    if (!token || !newPassword) return res.status(400).json({ error: "Token e nova senha são obrigatórios" });
    if (_pwErrReset) return res.status(400).json({ error: _pwErrReset });
    const record = await db.get(
      "SELECT * FROM password_reset_tokens WHERE token = ? AND used = 0 AND expires_at > datetime('now')",
      [token]
    );
    if (!record) return res.status(400).json({ error: "Link inválido ou expirado" });
    const hash = await hashPassword(newPassword);
    await db.run("UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?", [hash, record.user_id]);
    await db.run("UPDATE password_reset_tokens SET used = 1 WHERE id = ?", [record.id]);
    res.json({ ok: true });
  });

  // ── 2FA — OTP POR EMAIL (ADM e SUPER) ───────────────────
  app.post("/api/auth/request-otp", otpRequestRateLimit, async (req, res) => {
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ error: "userId obrigatório" });
    const user = await db.get("SELECT * FROM users WHERE id = ?", [Number(userId)]);
    if (!user || user.is_admin < 1) return res.status(403).json({ error: "Sem permissão" });
    if (!user.email) return res.status(400).json({ error: "Usuário sem e-mail cadastrado. Contate o administrador." });
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min
    await db.run("DELETE FROM otp_codes WHERE user_id = ?", [user.id]);
    await db.run("INSERT INTO otp_codes (user_id, code, expires_at) VALUES (?, ?, ?)", [user.id, code, expires]);
    if (mailTransporter) {
      await mailTransporter.sendMail({
        from: process.env.SMTP_FROM || process.env.EMAIL_FROM || "PILHA <no-reply@eusford.com>",
        to: user.email,
        subject: "Código de verificação — PILHA",
        html: `
          <div style="font-family:sans-serif;max-width:400px;margin:auto;">
            <h2 style="color:#1565C0;">Verificação em dois fatores</h2>
            <p>Olá, <b>${sanitize(user.name)}</b>.</p>
            <p>Seu código de acesso é:</p>
            <div style="font-size:2.5rem;font-weight:700;letter-spacing:0.2em;color:#1565C0;margin:16px 0;">${code}</div>
            <p style="color:#888;font-size:12px;">Válido por 10 minutos. Não compartilhe com ninguém.</p>
          </div>
        `
      }).catch(() => {});
    }
    res.json({ ok: true, email: user.email.replace(/(.{2})(.*)(@.*)/, "$1***$3") });
  });

  app.post("/api/auth/verify-otp", otpVerifyRateLimit, async (req, res) => {
    const { userId, code } = req.body || {};
    if (!userId || !code) return res.status(400).json({ error: "userId e code obrigatórios" });
    const record = await db.get(
      "SELECT * FROM otp_codes WHERE user_id = ? AND code = ? AND used = 0 AND expires_at > datetime('now')",
      [Number(userId), String(code).trim()]
    );
    if (!record) return res.status(401).json({ error: "Código inválido ou expirado" });
    await db.run("UPDATE otp_codes SET used = 1 WHERE id = ?", [record.id]);
    const user = await db.get("SELECT * FROM users WHERE id = ?", [Number(userId)]);
    const payload = buildAuthPayload(user);
    setAuthCookie(res, payload);
    // Log access
    const ip = "2FA-verified";
    await db.run(
      "INSERT INTO access_logs (user_id, username, name, role, is_admin, ip) VALUES (?, ?, ?, ?, ?, ?)",
      [user.id, user.username, user.name, user.role, user.is_admin, ip]
    );
    res.json({ user: payload });
  });

  // ── TOTP — Google Authenticator para professores ────────
  function totpSetupAuth(req, res, next) {
    const header = req.headers["authorization"] || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Token de configuração ausente" });
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      if (payload.scope !== "totp-setup") throw new Error("scope inválido");
      req.totpUserId = payload.userId;
      next();
    } catch (_) {
      return res.status(401).json({ error: "Token de configuração inválido ou expirado" });
    }
  }

  app.get("/api/auth/totp/setup", totpSetupAuth, async (req, res) => {
    const user = await db.get("SELECT * FROM users WHERE id = ?", [req.totpUserId]);
    if (!user) return res.status(404).json({ error: "Usuário não encontrado" });
    if (user.totp_enabled) return res.status(400).json({ error: "TOTP já está ativo" });

    const secret = speakeasy.generateSecret({ name: `PILHA (${sanitize(user.email || user.username)})`, length: 20 });
    await db.run("UPDATE users SET totp_secret = ? WHERE id = ?", [secret.base32, user.id]);

    const qrDataUrl = await QRCode.toDataURL(secret.otpauth_url);
    return res.json({ secret: secret.base32, qrDataUrl });
  });

  app.post("/api/auth/totp/activate", totpSetupAuth, async (req, res) => {
    const { code } = req.body || {};
    if (!code) return res.status(400).json({ error: "Código obrigatório" });
    const user = await db.get("SELECT * FROM users WHERE id = ?", [req.totpUserId]);
    if (!user || !user.totp_secret) return res.status(400).json({ error: "Configure o TOTP primeiro" });
    if (user.totp_enabled) return res.status(400).json({ error: "TOTP já está ativo" });

    const valid = speakeasy.totp.verify({ secret: user.totp_secret, encoding: "base32", token: String(code).trim(), window: 1 });
    if (!valid) return res.status(401).json({ error: "Código inválido" });

    // Gera 8 recovery codes, hasheia e salva
    const recoveryCodes = Array.from({ length: 8 }, () => crypto.randomBytes(5).toString("hex").toUpperCase().match(/.{1,5}/g).join("-"));
    await db.run("DELETE FROM totp_recovery_codes WHERE user_id = ?", [user.id]);
    for (const code of recoveryCodes) {
      const codeHash = crypto.createHash("sha256").update(code).digest("hex");
      await db.run("INSERT INTO totp_recovery_codes (user_id, code_hash) VALUES (?, ?)", [user.id, codeHash]);
    }

    await db.run("UPDATE users SET totp_enabled = 1 WHERE id = ?", [user.id]);
    const updatedUser = await db.get("SELECT * FROM users WHERE id = ?", [user.id]);
    const payload = buildAuthPayload(updatedUser);
    setAuthCookie(res, payload);
    await db.run(
      "INSERT INTO access_logs (user_id, username, name, role, is_admin, ip) VALUES (?, ?, ?, ?, ?, ?)",
      [user.id, user.username, user.name, user.role, user.is_admin, "TOTP-setup"]
    );
    return res.json({ ok: true, user: payload, recoveryCodes });
  });

  app.post("/api/auth/totp/verify", async (req, res) => {
    const { userId, code } = req.body || {};
    if (!userId || !code) return res.status(400).json({ error: "userId e code obrigatórios" });
    const user = await db.get("SELECT * FROM users WHERE id = ?", [Number(userId)]);
    if (!user || !user.totp_enabled || !user.totp_secret) return res.status(401).json({ error: "TOTP não configurado" });

    const valid = speakeasy.totp.verify({ secret: user.totp_secret, encoding: "base32", token: String(code).trim(), window: 1 });
    if (!valid) return res.status(401).json({ error: "Código inválido ou expirado" });

    const payload = buildAuthPayload(user);
    setAuthCookie(res, payload);
    await db.run(
      "INSERT INTO access_logs (user_id, username, name, role, is_admin, ip) VALUES (?, ?, ?, ?, ?, ?)",
      [user.id, user.username, user.name, user.role, user.is_admin, "TOTP-verified"]
    );
    return res.json({ user: payload });
  });

  app.post("/api/auth/totp/recovery", async (req, res) => {
    const { userId, recoveryCode } = req.body || {};
    if (!userId || !recoveryCode) return res.status(400).json({ error: "userId e recoveryCode obrigatórios" });
    const user = await db.get("SELECT * FROM users WHERE id = ?", [Number(userId)]);
    if (!user || !user.totp_enabled) return res.status(401).json({ error: "TOTP não configurado" });

    const codeHash = crypto.createHash("sha256").update(String(recoveryCode).trim().toUpperCase()).digest("hex");
    const record = await db.get(
      "SELECT * FROM totp_recovery_codes WHERE user_id = ? AND code_hash = ? AND used = 0",
      [user.id, codeHash]
    );
    if (!record) return res.status(401).json({ error: "Código de recuperação inválido ou já utilizado" });

    await db.run("UPDATE totp_recovery_codes SET used = 1 WHERE id = ?", [record.id]);
    const payload = buildAuthPayload(user);
    setAuthCookie(res, payload);
    await db.run(
      "INSERT INTO access_logs (user_id, username, name, role, is_admin, ip) VALUES (?, ?, ?, ?, ?, ?)",
      [user.id, user.username, user.name, user.role, user.is_admin, "TOTP-recovery"]
    );
    return res.json({ user: payload });
  });

  app.post("/api/auth/change-password", authRequired, async (req, res) => {
    const { newPassword } = req.body || {};
    if (!newPassword) return res.status(400).json({ error: "Nova senha é obrigatória" });
    const _pwErrChange = validatePasswordStrength(newPassword);
    if (_pwErrChange) return res.status(400).json({ error: _pwErrChange });
    const hash = await hashPassword(newPassword);
    await db.run("UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?", [hash, req.user.id]);
    return res.json({ ok: true });
  });

  app.post("/api/auth/student-onboarding", authRequired, async (req, res) => {
    if (req.user.role !== "aluno") return res.status(403).json({ error: "Onboarding permitido apenas para aluno" });

    const { photo, mode, scrumRole, inviteEmails, inviteToken } = req.body || {};
    const dbUser = await db.get("SELECT * FROM users WHERE id = ?", [req.user.id]);
    const cleanTurma = dbUser?.turma || "";
    const cleanPeriodo = dbUser?.periodo || "";
    const cleanCurso = dbUser?.curso || null;
    const cleanMode = String(mode || "create");
    const cleanPhoto = sanitizePhotoDataUrl(photo);
    if (cleanPhoto && typeof cleanPhoto === "object" && cleanPhoto.error) {
      return res.status(400).json({ error: cleanPhoto.error });
    }

    let createdInvites = 0;

    if (cleanMode === "join") {
      const cleanToken = String(inviteToken || "").trim();
      if (!cleanToken) return res.status(400).json({ error: "Token de convite inválido" });
      const invite = await db.get("SELECT * FROM project_invites WHERE invite_token = ? AND status = 'pending'", [cleanToken]);
      if (!invite) return res.status(404).json({ error: "Convite não encontrado ou expirado" });
      if (dbUser?.email && String(invite.invite_email).toLowerCase() !== dbUser.email.toLowerCase()) {
        return res.status(403).json({ error: `Este convite foi enviado para: ${invite.invite_email}` });
      }
      // Validar turma_id do projeto
      const projectForJoin = await db.get("SELECT turma_id FROM projects WHERE id = ?", [invite.project_id]);
      if (!projectForJoin?.turma_id) return res.status(400).json({ error: "Projeto não vinculado a uma turma" });
      if (dbUser?.turma_id && dbUser.turma_id !== projectForJoin.turma_id) {
        return res.status(403).json({ error: "Este projeto pertence a outra turma" });
      }
      await db.run("INSERT OR IGNORE INTO project_members (project_id, member_name, scrum_role, user_id) VALUES (?, ?, 'Development Team', ?)", [invite.project_id, req.user.name, req.user.id]);
      await db.run("UPDATE project_invites SET status = 'accepted', accepted_at = ? WHERE id = ?", [new Date().toISOString(), invite.id]);
      // Preencher turma_id do aluno se ainda não tiver
      if (!dbUser?.turma_id) {
        await db.run("UPDATE users SET turma_id = ? WHERE id = ?", [projectForJoin.turma_id, req.user.id]);
      }
    } else {
      const cleanScrumRole = VALID_SCRUM_ROLES.includes(String(scrumRole || "")) ? String(scrumRole) : "Product Owner";
      // Exigir turma_id: sem turma, o projeto fica invisível para o professor
      if (!dbUser?.turma_id) {
        return res.status(400).json({ error: "Aluno deve estar vinculado a uma turma para criar projeto. Registre-se via link de turma." });
      }
      const turmaIdForProject = dbUser.turma_id;
      // Nome provisório — PO define o nome definitivo na aba de projetos
      const defaultName = `Projeto de ${sanitize(req.user.name || "Aluno")}`;
      // Prazo provisório — professor ajusta depois
      const defaultDeadline = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const created = await db.run("INSERT INTO projects (name, team, deadline, turma_id) VALUES (?, ?, ?, ?)", [defaultName, cleanTurma, defaultDeadline, turmaIdForProject]);
      await db.run("INSERT OR IGNORE INTO project_members (project_id, member_name, scrum_role, user_id) VALUES (?, ?, ?, ?)", [created.lastID, req.user.name, cleanScrumRole, req.user.id]);
      createdInvites = await createAndSendInvites(db, { projectId: created.lastID, inviterUserId: req.user.id, inviteEmails: Array.isArray(inviteEmails) ? inviteEmails : [] });
    }

    await db.run(
      "UPDATE users SET onboarding_done = 1, turma = ?, periodo = ?, curso = ?, photo = ? WHERE id = ?",
      [cleanTurma, cleanPeriodo, cleanCurso, cleanPhoto, req.user.id]
    );

    const updatedUser = await db.get("SELECT * FROM users WHERE id = ?", [req.user.id]);
    const payload = buildAuthPayload(updatedUser);
    setAuthCookie(res, payload);
    return res.json({ ok: true, user: payload, invitesSent: createdInvites });
  });

  // Endpoint /api/auth/recover removido: permitia troca de senha sem autenticação (account takeover).
  // Para redefinir senhas, use o painel admin (POST /api/admin/users/:id/reset-password).

  app.post("/api/auth/logout", (_req, res) => {
    res.clearCookie(TOKEN_COOKIE);
    res.clearCookie(CSRF_COOKIE);
    return res.json({ ok: true });
  });

  app.get("/api/auth/me", authRequired, (req, res) => res.json({ user: req.user }));

  // ── Invites ───────────────────────────────────────────────────────────────

  app.get("/api/invites/info", async (req, res) => {
    const token = String(req.query.token || "").trim();
    if (!token) return res.status(400).json({ error: "Token inválido" });
    const invite = await db.get(
      `SELECT i.invite_email, p.name AS project_name, u.name AS inviter_name
       FROM project_invites i
       JOIN projects p ON p.id = i.project_id
       JOIN users u ON u.id = i.inviter_user_id
       WHERE i.invite_token = ? AND i.status = 'pending'`,
      [token]
    );
    if (!invite) return res.status(404).json({ error: "Convite não encontrado ou expirado" });
    return res.json({ projectName: invite.project_name, inviterName: invite.inviter_name, email: invite.invite_email });
  });

  app.get("/api/invites/my", authRequired, async (req, res) => {
    if (!req.user.email) return res.json([]);
    const rows = await db.all(
      `SELECT i.id, i.project_id, i.invite_email, i.invite_token, i.status, p.name AS project_name
       FROM project_invites i JOIN projects p ON p.id = i.project_id
       WHERE i.invite_email = ? AND i.status = 'pending' ORDER BY i.id DESC`,
      [req.user.email]
    );
    return res.json(rows.map((r) => ({ id: String(r.id), projectId: String(r.project_id), projectName: r.project_name, token: r.invite_token, status: r.status })));
  });

  app.post("/api/invites/accept", authRequired, async (req, res) => {
    const token = String(req.body?.token || "").trim();
    if (!token) return res.status(400).json({ error: "Token inválido" });
    const invite = await db.get("SELECT * FROM project_invites WHERE invite_token = ? AND status = 'pending'", [token]);
    if (!invite) return res.status(404).json({ error: "Convite não encontrado" });
    if (!req.user.email || req.user.email.toLowerCase() !== String(invite.invite_email).toLowerCase()) {
      return res.status(403).json({ error: "Este convite pertence a outro e-mail" });
    }
    // Validar turma_id do projeto
    const projForAccept = await db.get("SELECT turma_id FROM projects WHERE id = ?", [invite.project_id]);
    if (!projForAccept?.turma_id) return res.status(400).json({ error: "Projeto não vinculado a uma turma" });
    const dbUserAccept = await db.get("SELECT turma_id FROM users WHERE id = ?", [req.user.id]);
    if (dbUserAccept?.turma_id && dbUserAccept.turma_id !== projForAccept.turma_id) {
      return res.status(403).json({ error: "Este projeto pertence a outra turma" });
    }
    await db.run("INSERT OR IGNORE INTO project_members (project_id, member_name, scrum_role, user_id) VALUES (?, ?, 'Development Team', ?)", [invite.project_id, req.user.name, req.user.id]);
    await db.run("UPDATE project_invites SET status = 'accepted', accepted_at = ? WHERE id = ?", [new Date().toISOString(), invite.id]);
    // Preencher turma_id do aluno se ainda não tiver
    if (!dbUserAccept?.turma_id) {
      await db.run("UPDATE users SET turma_id = ? WHERE id = ?", [projForAccept.turma_id, req.user.id]);
    }
    return res.json({ ok: true });
  });

  // ── Students / Profile ────────────────────────────────────────────────────

  app.get("/api/students", authRequired, async (req, res) => {
    if (req.user.role === "professor" && !req.user.isAdmin) {
      const myTurmas = await db.all("SELECT id FROM turmas WHERE professor_id = ?", [req.user.id]);
      if (myTurmas.length === 0) return res.json([]);
      const ids = myTurmas.map(t => t.id);
      const placeholders = ids.map(() => "?").join(",");
      const students = await db.all(
        `SELECT id, name, turma, periodo, photo FROM users WHERE role = 'aluno' AND turma_id IN (${placeholders}) ORDER BY name`,
        ids
      );
      return res.json(students);
    }
    const students = await db.all("SELECT id, name, turma, periodo, photo FROM users WHERE role = 'aluno' ORDER BY name");
    return res.json(students);
  });

  app.get("/api/profile", authRequired, async (req, res) => {
    const user = await db.get("SELECT id, username, name, role, email, turma, periodo, curso, photo, bio FROM users WHERE id = ?", [req.user.id]);
    if (!user) return res.status(404).json({ error: "Usuário não encontrado" });
    return res.json({ user });
  });

  app.patch("/api/profile", authRequired, async (req, res) => {
    const { photo, bio } = req.body || {};
    const updates = {};
    if (bio !== undefined) updates.bio = String(bio || "").trim();
    if (photo !== undefined) {
      const cleanPhoto = sanitizePhotoDataUrl(photo);
      if (cleanPhoto && typeof cleanPhoto === "object" && cleanPhoto.error) {
        return res.status(400).json({ error: cleanPhoto.error });
      }
      updates.photo = cleanPhoto;
    }
    if (Object.keys(updates).length > 0) {
      const setClauses = Object.keys(updates).map((k) => `${k} = ?`).join(", ");
      await db.run(`UPDATE users SET ${setClauses} WHERE id = ?`, [...Object.values(updates), req.user.id]);
    }
    const updatedUser = await db.get("SELECT * FROM users WHERE id = ?", [req.user.id]);
    const payload = buildAuthPayload(updatedUser);
    setAuthCookie(res, payload);
    return res.json({ ok: true, user: payload });
  });

  // ── Projects ──────────────────────────────────────────────────────────────

  app.get("/api/projects", authRequired, async (req, res) => {
    const scope = await buildVisibleScope(db, req.user);
    return res.json(scope.projects);
  });

  app.get("/api/projects/:id", authRequired, async (req, res) => {
    const scope = await buildVisibleScope(db, req.user);
    const projectId = Number(req.params.id);
    if (!scope.projectIds.has(projectId)) return res.status(403).json({ error: "Sem permissão" });
    const project = scope.projects.find((p) => Number(p.id) === projectId);
    if (!project) return res.status(404).json({ error: "Projeto não encontrado" });
    const tasks = await db.all(
      "SELECT id, title, assignee, due_date, status, priority, urgency FROM tasks WHERE project_id = ? ORDER BY due_date ASC",
      [projectId]
    );
    return res.json({ ...project, tasks });
  });

  app.post("/api/projects", authRequired, professorOnly, async (req, res) => {
    const { name, team, members, deadline, scrumRoles, description, discipline, startDate, turmaId } = req.body || {};
    if (!name || !team || !deadline || !Array.isArray(members) || members.length === 0) {
      return res.status(400).json({ error: "Dados inválidos para criar projeto" });
    }
    // Resolver turma_id: exigir turmaId explícito; professor deve ser dono
    let resolvedTurmaId = null;
    if (turmaId) {
      const owns = req.user.isAdmin
        ? await db.get("SELECT id FROM turmas WHERE id = ?", [Number(turmaId)])
        : await db.get("SELECT id FROM turmas WHERE id = ? AND professor_id = ?", [Number(turmaId), req.user.id]);
      if (!owns) return res.status(403).json({ error: "Turma não encontrada ou sem permissão" });
      resolvedTurmaId = Number(turmaId);
    } else if (!req.user.isAdmin) {
      // Professor deve informar turmaId explícito — resolução automática por nome é ambígua
      return res.status(400).json({ error: "turmaId é obrigatório para criar projeto vinculado à turma" });
    }
    // Admin pode criar projeto sem turmaId (projeto sem turma)
    const created = await db.run(
      "INSERT INTO projects (name, team, deadline, description, discipline, start_date, turma_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [name, team, deadline, String(description || "").trim(), String(discipline || "").trim(), String(startDate || "").trim(), resolvedTurmaId]
    );
    const cleanMembers = members.map((m) => String(m).trim()).filter(Boolean);
    for (const member of cleanMembers) {
      const roleFromPayload = scrumRoles && typeof scrumRoles === "object" ? scrumRoles[member] : null;
      const scrumRole = VALID_SCRUM_ROLES.includes(roleFromPayload) ? roleFromPayload : "Development Team";
      // Resolver user_id: apenas se houver exatamente um usuário com este nome (sem ambiguidade)
      const userForMember = await db.get(
        "SELECT id FROM users WHERE name = ? AND (SELECT COUNT(*) FROM users u2 WHERE u2.name = ?) = 1",
        [member, member]
      );
      await db.run(
        "INSERT OR IGNORE INTO project_members (project_id, member_name, scrum_role, user_id) VALUES (?, ?, ?, ?)",
        [created.lastID, member, scrumRole, userForMember?.id || null]
      );
    }
    return res.status(201).json({ id: String(created.lastID) });
  });

  // Atualiza nome/descrição do projeto (professor, admin ou PO — PO não pode alterar nome após confirmação)
  app.patch("/api/projects/:id", authRequired, async (req, res) => {
    const projectId = Number(req.params.id);
    if (!projectId) return res.status(400).json({ error: "ID inválido" });
    const isProfOrAdmin = req.user.isAdmin || req.user.role === "professor";
    if (!isProfOrAdmin) {
      const poRow = await db.get(
        `SELECT 1 FROM project_members WHERE project_id = ? AND scrum_role = 'Product Owner'
         AND (user_id = ? OR (user_id IS NULL AND member_name = ?
         AND (SELECT COUNT(*) FROM users u2 WHERE u2.name = member_name) = 1))`,
        [projectId, req.user.id, req.user.name]
      );
      if (!poRow) return res.status(403).json({ error: "Sem permissão" });
      // PO não pode alterar nome se já foi confirmado — somente professor pode
      const proj = await db.get("SELECT name_confirmed FROM projects WHERE id = ?", [projectId]);
      if (proj?.name_confirmed && req.body?.name !== undefined) {
        return res.status(403).json({ error: "Nome já confirmado. Somente o professor pode alterá-lo." });
      }
    }
    // Professor (não admin) só pode editar projetos da própria turma
    if (req.user.role === "professor" && !req.user.isAdmin) {
      if (!await professorOwnsProject(db, req.user.id, projectId))
        return res.status(403).json({ error: "Você não é o professor responsável por este projeto" });
    }
    const { name, description, deadline, startDate } = req.body || {};
    // Datas do projeto: SOMENTE professor/admin podem alterar
    if ((deadline !== undefined || startDate !== undefined) && !isProfOrAdmin) {
      return res.status(403).json({ error: "Apenas o professor pode alterar as datas do projeto." });
    }
    const updates = [];
    const vals = [];
    if (name !== undefined) { updates.push("name = ?"); vals.push(sanitize(String(name).trim())); }
    if (description !== undefined) { updates.push("description = ?"); vals.push(sanitize(String(description))); }
    if (deadline !== undefined) { updates.push("deadline = ?"); vals.push(String(deadline).trim()); }
    if (startDate !== undefined) { updates.push("start_date = ?"); vals.push(String(startDate).trim()); }
    if (!updates.length) return res.status(400).json({ error: "Nada para atualizar" });
    vals.push(projectId);
    await db.run(`UPDATE projects SET ${updates.join(", ")} WHERE id = ?`, vals);
    return res.json({ ok: true });
  });

  // PO confirma o nome definitivo do projeto (após isso só professor pode mudar)
  app.post("/api/projects/:id/confirm-name", authRequired, async (req, res) => {
    const projectId = Number(req.params.id);
    if (!projectId) return res.status(400).json({ error: "ID inválido" });
    // Verificar escopo: usuário deve ter acesso ao projeto
    const scope = await buildVisibleScope(db, req.user);
    if (!scope.projectIds.has(projectId)) return res.status(403).json({ error: "Sem permissão" });
    const isProfOrAdmin = req.user.isAdmin || req.user.role === "professor";
    if (!isProfOrAdmin) {
      const poRow = await isProjectPO(db, projectId, req.user.id, req.user.name);
      if (!poRow) return res.status(403).json({ error: "Apenas o Product Owner pode confirmar o nome" });
    }
    // Professor (não admin) só pode agir em projetos da própria turma
    if (req.user.role === "professor" && !req.user.isAdmin) {
      if (!await professorOwnsProject(db, req.user.id, projectId))
        return res.status(403).json({ error: "Você não é o professor responsável por este projeto" });
    }
    const name = sanitize(String(req.body?.name || "").trim());
    if (!name) return res.status(400).json({ error: "Nome inválido" });
    await db.run("UPDATE projects SET name = ?, name_confirmed = 1 WHERE id = ?", [name, projectId]);
    return res.json({ ok: true });
  });

  // Professor/admin alterna liberação de TAP/PI para alunos do projeto
  app.patch("/api/projects/:id/unlock-docs", authRequired, async (req, res) => {
    if (!req.user.isAdmin && req.user.role !== "professor")
      return res.status(403).json({ error: "Apenas professores podem liberar documentos" });
    const projectId = Number(req.params.id);
    if (!projectId) return res.status(400).json({ error: "ID inválido" });
    // Professor (não admin) só pode alterar projeto da própria turma
    if (req.user.role === "professor" && !req.user.isAdmin) {
      if (!await professorOwnsProject(db, req.user.id, projectId))
        return res.status(403).json({ error: "Você não é o professor responsável por este projeto" });
    }
    const proj = await db.get("SELECT docs_unlocked FROM projects WHERE id = ?", [projectId]);
    if (!proj) return res.status(404).json({ error: "Projeto não encontrado" });
    const newVal = proj.docs_unlocked ? 0 : 1;
    await db.run("UPDATE projects SET docs_unlocked = ? WHERE id = ?", [newVal, projectId]);
    return res.json({ ok: true, docsUnlocked: newVal === 1 });
  });

  // Update a member's Scrum role (professor, admin, or PO of the project)
  app.patch("/api/projects/:id/members/:memberName/role", authRequired, async (req, res) => {
    const projectId = Number(req.params.id);
    const isProfOrAdmin = req.user.isAdmin || req.user.role === "professor";
    if (!isProfOrAdmin) {
      // Verifica se é PO do projeto (por user_id, com fallback legado seguro)
      const poRow = await isProjectPO(db, projectId, req.user.id, req.user.name);
      if (!poRow) return res.status(403).json({ error: "Apenas o Product Owner, professores ou admin podem alterar papéis" });
    }
    // Professor (não admin) só pode alterar papéis de projetos da própria turma
    if (req.user.role === "professor" && !req.user.isAdmin) {
      if (!await professorOwnsProject(db, req.user.id, projectId))
        return res.status(403).json({ error: "Você não é o professor responsável por este projeto" });
    }
    const memberName = decodeURIComponent(req.params.memberName);
    const newRole = String(req.body?.role || "");
    const VALID_ROLES_WITH_NULL = [...VALID_SCRUM_ROLES, "sem_papel"];
    if (!VALID_ROLES_WITH_NULL.includes(newRole)) {
      return res.status(400).json({ error: "Papel inválido" });
    }
    const dbRole = newRole === "sem_papel" ? "Development Team" : newRole;
    const row = await db.get("SELECT * FROM project_members WHERE project_id = ? AND member_name = ?", [projectId, memberName]);
    if (!row) return res.status(404).json({ error: "Membro não encontrado neste projeto" });
    await db.run("UPDATE project_members SET scrum_role = ? WHERE project_id = ? AND member_name = ?", [dbRole, projectId, memberName]);
    res.json({ ok: true });
  });

  // Remover membro do projeto (PO, professor ou admin)
  app.delete("/api/projects/:id/members/:memberName", authRequired, async (req, res) => {
    const projectId = Number(req.params.id);
    const memberName = decodeURIComponent(req.params.memberName);
    const isProfOrAdmin = req.user.isAdmin || req.user.role === "professor";
    if (!isProfOrAdmin) {
      // Verifica se é PO do projeto (por user_id, com fallback legado seguro)
      const poRow = await isProjectPO(db, projectId, req.user.id, req.user.name);
      if (!poRow) return res.status(403).json({ error: "Apenas o Product Owner pode remover membros" });
    }
    // Professor (não admin) só pode alterar projeto da própria turma
    if (req.user.role === "professor" && !req.user.isAdmin) {
      if (!await professorOwnsProject(db, req.user.id, projectId))
        return res.status(403).json({ error: "Você não é o professor responsável por este projeto" });
    }
    // PO não pode se remover (verifica por user_id, não por nome)
    const selfMember = await db.get("SELECT user_id, member_name FROM project_members WHERE project_id = ? AND member_name = ?", [projectId, memberName]);
    const isSelf = selfMember?.user_id
      ? selfMember.user_id === req.user.id
      : memberName === req.user.name;
    if (isSelf && !isProfOrAdmin)
      return res.status(400).json({ error: "O PO não pode se remover do projeto" });
    await db.run("DELETE FROM project_members WHERE project_id = ? AND member_name = ?", [projectId, memberName]);
    res.json({ ok: true });
  });

  // Adicionar membro ao projeto por e-mail (PO, professor ou admin)
  app.post("/api/projects/:id/members", authRequired, async (req, res) => {
    const projectId = Number(req.params.id);
    const isProfOrAdmin = req.user.isAdmin || req.user.role === "professor";
    if (!isProfOrAdmin) {
      // Verifica se é PO do projeto (por user_id, com fallback legado seguro)
      const poRow = await isProjectPO(db, projectId, req.user.id, req.user.name);
      if (!poRow) return res.status(403).json({ error: "Apenas o Product Owner pode adicionar membros" });
    }
    // Professor (não admin) só pode alterar projeto da própria turma
    if (req.user.role === "professor" && !req.user.isAdmin) {
      if (!await professorOwnsProject(db, req.user.id, projectId))
        return res.status(403).json({ error: "Você não é o professor responsável por este projeto" });
    }
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ error: "E-mail obrigatório" });
    const user = await db.get("SELECT * FROM users WHERE email = ?", [email]);
    if (!user) return res.status(404).json({ error: "Nenhum aluno com esse e-mail encontrado" });
    if (user.role !== "aluno" && !isProfOrAdmin) return res.status(400).json({ error: "Usuário não é aluno" });
    const existing = await db.get("SELECT * FROM project_members WHERE project_id = ? AND member_name = ?", [projectId, user.name]);
    if (existing) return res.status(409).json({ error: `${user.name} já está no projeto` });
    await db.run(
      "INSERT INTO project_members (project_id, member_name, scrum_role, user_id) VALUES (?, ?, 'Development Team', ?)",
      [projectId, user.name, user.id]
    );
    res.status(201).json({ ok: true, name: user.name });
  });

  // ── EXPORT XLSX ─────────────────────────────────────────
  app.get("/api/projects/:id/export/xlsx", authRequired, async (req, res) => {
    const XLSX = require("xlsx");
    const scope = await buildVisibleScope(db, req.user);
    const projectId = Number(req.params.id);
    if (!scope.projectIds.has(projectId)) return res.status(403).json({ error: "Sem permissão" });
    const project = await db.get("SELECT * FROM projects WHERE id = ?", [projectId]);
    if (!project) return res.status(404).json({ error: "Projeto não encontrado" });
    const members = await db.all("SELECT * FROM project_members WHERE project_id = ?", [projectId]);
    const tasks   = await db.all("SELECT t.*, s.name as sprint_name FROM tasks t LEFT JOIN sprints s ON s.id = t.sprint_id WHERE t.project_id = ?", [projectId]);
    const wb = XLSX.utils.book_new();
    // Sheet 1: Informações do Projeto
    const infoRows = [
      ["Campo", "Valor"],
      ["Nome do Projeto", project.name],
      ["Equipe / Turma", project.team || ""],
      ["Disciplina", project.discipline || ""],
      ["Descrição", project.description || ""],
      ["Data de Início", project.start_date || ""],
      ["Prazo Final", project.deadline || ""],
    ];
    const wsInfo = XLSX.utils.aoa_to_sheet(infoRows);
    wsInfo["!cols"] = [{ wch: 20 }, { wch: 50 }];
    XLSX.utils.book_append_sheet(wb, wsInfo, "Projeto");
    // Sheet 2: Membros
    const memberRows = [["Nome", "Papel Scrum"]];
    members.forEach((m) => memberRows.push([m.member_name, m.scrum_role || ""]));
    const wsMembers = XLSX.utils.aoa_to_sheet(memberRows);
    wsMembers["!cols"] = [{ wch: 25 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, wsMembers, "Membros");
    // Sheet 3: Tarefas
    const taskRows = [["ID", "Título", "Responsável", "Sprint", "Status", "Prioridade", "Pontos", "Prazo", "Urgência", "Descrição"]];
    tasks.forEach((t) => taskRows.push([
      t.id, t.title, t.assignee || "", t.sprint_name || "",
      t.status || "", t.priority || "", t.points || 0,
      t.due_date || "", t.urgency || "", t.description || ""
    ]));
    const wsTasks = XLSX.utils.aoa_to_sheet(taskRows);
    wsTasks["!cols"] = [
      {wch:5},{wch:35},{wch:20},{wch:15},
      {wch:12},{wch:10},{wch:8},{wch:12},{wch:10},{wch:40}
    ];
    XLSX.utils.book_append_sheet(wb, wsTasks, "Tarefas");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    const filename = `${project.name.replace(/[^a-zA-Z0-9]/g,"_")}.xlsx`;
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.send(buf);
  });

  // Export geral de todos projetos (admin/professor)
  app.get("/api/export/projects/xlsx", authRequired, async (req, res) => {
    const XLSX = require("xlsx");
    if (!req.user.isAdmin && req.user.role !== "professor") return res.status(403).json({ error: "Sem permissão" });
    const scope = await buildVisibleScope(db, req.user);
    const projects = await db.all("SELECT * FROM projects WHERE id IN (" + [...scope.projectIds].join(",") + ") ORDER BY name");
    const allMembers = await db.all("SELECT * FROM project_members WHERE project_id IN (" + [...scope.projectIds].join(",") + ")");
    const allTasks   = await db.all("SELECT t.*, s.name as sprint_name FROM tasks t LEFT JOIN sprints s ON s.id = t.sprint_id WHERE t.project_id IN (" + [...scope.projectIds].join(",") + ")");
    const wb = XLSX.utils.book_new();
    // Sheet: Projetos
    const projRows = [["ID","Nome","Equipe","Disciplina","Início","Prazo","Integrantes","Membros Scrum"]];
    projects.forEach((p) => {
      const mems = allMembers.filter((m) => m.project_id === p.id);
      projRows.push([
        p.id, p.name, p.team || "", p.discipline || "",
        p.start_date || "", p.deadline || "",
        mems.length,
        mems.map((m) => `${m.member_name} (${m.scrum_role || "-"})`).join("; ")
      ]);
    });
    const wsP = XLSX.utils.aoa_to_sheet(projRows);
    wsP["!cols"] = [{wch:5},{wch:30},{wch:18},{wch:25},{wch:12},{wch:12},{wch:10},{wch:60}];
    XLSX.utils.book_append_sheet(wb, wsP, "Projetos");
    // Sheet: Tarefas
    const taskRows = [["Projeto","ID Tarefa","Título","Responsável","Sprint","Status","Prioridade","Pontos","Prazo"]];
    allTasks.forEach((t) => {
      const proj = projects.find((p) => p.id === t.project_id);
      taskRows.push([proj?.name||"", t.id, t.title, t.assignee||"", t.sprint_name||"", t.status||"", t.priority||"", t.points||0, t.due_date||""]);
    });
    const wsT = XLSX.utils.aoa_to_sheet(taskRows);
    wsT["!cols"] = [{wch:25},{wch:6},{wch:35},{wch:18},{wch:15},{wch:12},{wch:10},{wch:8},{wch:12}];
    XLSX.utils.book_append_sheet(wb, wsT, "Tarefas");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    res.setHeader("Content-Disposition", `attachment; filename="PILHA_Projetos.xlsx"`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.send(buf);
  });

  // ── EXPORT AVALIAÇÃO — por turma ou por grupo ─────────────
  // Uma linha por aluno com pontuação e observação individuais.
  async function buildGradingWorkbook(projects, evalDb, turmaLabel) {
    const ExcelJS = require("exceljs");
    const wb = new ExcelJS.Workbook();
    wb.creator = "PILHA";
    const ws = wb.addWorksheet(turmaLabel.slice(0, 31) || "Turma");

    const projectIds = projects.map(p => Number(p.id));
    if (!projectIds.length) return wb;
    const ph = projectIds.map(() => "?").join(",");

    // Atividades ordenadas por seção
    const allActs = await evalDb.all(
      `SELECT * FROM eval_activities WHERE project_id IN (${ph}) ORDER BY section, id`,
      projectIds
    );
    // Scores individuais por atividade (eval_activity_scores)
    const actScores = await evalDb.all(
      `SELECT eas.member_name, eas.score, ea.project_id, ea.id as activity_id, ea.name, ea.section
       FROM eval_activity_scores eas
       INNER JOIN eval_activities ea ON ea.id = eas.activity_id
       WHERE ea.project_id IN (${ph})`,
      projectIds
    );
    // Dados individuais por aluno (eval_individual)
    const indivRows = await evalDb.all(
      `SELECT project_id, member_name, score, entrega_score, observacao
       FROM eval_individual WHERE project_id IN (${ph})`,
      projectIds
    );

    // Colunas de atividades com suporte a nomes duplicados dentro do mesmo projeto
    // Atividades com mesmo nome na mesma seção recebem sufixo "(2)", "(3)", etc.
    // Colunas são compartilhadas entre projetos por (section, name, occurrenceIdx).
    function buildActCols(section) {
      const cols = [];
      const seen = new Set();
      for (const a of allActs) {
        if (a.section !== section) continue;
        const occIdx = allActs.filter(
          x => x.project_id === a.project_id && x.section === section && x.name === a.name && x.id < a.id
        ).length;
        const colKey = `${section}::${a.name}::${occIdx}`;
        if (!seen.has(colKey)) {
          seen.add(colKey);
          const displayName = occIdx > 0 ? `${a.name} (${occIdx + 1})` : a.name;
          cols.push({ name: a.name, display_name: displayName, max_pts: a.max_pts, occurrenceIdx: occIdx });
        }
      }
      return cols;
    }
    const planActs = buildActCols("planejamento");
    const devActs  = buildActCols("desenvolvimento");
    const planMax  = planActs.reduce((s, a) => s + (a.max_pts || 0), 0);
    const devMax   = devActs.reduce((s, a)  => s + (a.max_pts || 0), 0);

    // Índices de colunas (1-based)
    const COL_NUM        = 1;
    const COL_PROJ       = 2;
    const COL_ALUNO      = 3;
    const COL_PLAN_START = 4;
    const COL_PLAN_TOTAL = COL_PLAN_START + planActs.length;
    const COL_DEV_START  = COL_PLAN_TOTAL + 1;
    const COL_DEV_TOTAL  = COL_DEV_START + devActs.length;
    const COL_ENTREGA    = COL_DEV_TOTAL + 1;
    const COL_PTS_IND    = COL_ENTREGA + 1;
    const COL_NOTA       = COL_PTS_IND + 1;
    const COL_OBS        = COL_NOTA + 1;

    // ── Cores por seção ──────────────────────────────────────────
    const C_FIXED  = "FF7A010A"; // vermelho — fixas
    const C_PLAN_H = "FF1B5E20"; // verde escuro — PLANEJAMENTO
    const C_PLAN_M = "FFA5D6A7"; // verde médio
    const C_PLAN_R = "FFE8F5E9"; // verde claro
    const C_DEV_H  = "FF0D47A1"; // azul escuro — DESENVOLVIMENTO
    const C_DEV_M  = "FF90CAF9"; // azul médio
    const C_DEV_R  = "FFE3F2FD"; // azul claro
    const C_ENT_H  = "FFE65100"; // laranja — ENTREGA
    const C_ENT_R  = "FFFFF3E0";
    const C_IND_H  = "FF4A148C"; // roxo — INDIVIDUAL
    const C_IND_R  = "FFF3E5F5";
    const C_NOTA_H = "FF006064"; // petróleo — NOTA FINAL
    const C_OBS_H  = "FF37474F"; // cinza — OBS
    const C_OBS_R  = "FFECEFF1";
    const WHITE    = "FFFFFFFF";
    const BLACK    = "FF000000";

    const mkFill   = (argb) => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
    const mkFont   = (bold, color = BLACK, size = 10) => ({ bold, color: { argb: color }, size, name: "Calibri" });
    const mkBorder = () => {
      const s = { style: "thin", color: { argb: "FFCCCCCC" } };
      return { top: s, left: s, bottom: s, right: s };
    };

    function sc(cell, { bg, fg = BLACK, bold = false, h = "center", v = "middle", wrap = false, size = 10 } = {}) {
      if (bg) cell.fill = mkFill(bg);
      cell.font = mkFont(bold, fg, size);
      cell.alignment = { horizontal: h, vertical: v, wrapText: wrap };
      cell.border = mkBorder();
    }

    // ── ROW 1: Cabeçalhos de seção ──────────────────────────────
    ws.getRow(1).height = 30;
    ws.getRow(2).height = 38;
    ws.getRow(3).height = 18;

    // Colunas fixas: Nº, Projeto, Aluno — merge rows 1-3
    for (const [col, val] of [[COL_NUM, "Nº"], [COL_PROJ, "Projeto"], [COL_ALUNO, "Aluno"]]) {
      ws.getCell(1, col).value = val;
      sc(ws.getCell(1, col), { bg: C_FIXED, fg: WHITE, bold: true });
      ws.mergeCells(1, col, 3, col);
    }

    // PLANEJAMENTO — row 1 com colspan
    if (planActs.length > 0) {
      ws.getCell(1, COL_PLAN_START).value = "PLANEJAMENTO";
      sc(ws.getCell(1, COL_PLAN_START), { bg: C_PLAN_H, fg: WHITE, bold: true, size: 11 });
      ws.mergeCells(1, COL_PLAN_START, 1, COL_PLAN_TOTAL);
    }

    // DESENVOLVIMENTO — row 1 com colspan
    if (devActs.length > 0) {
      ws.getCell(1, COL_DEV_START).value = "DESENVOLVIMENTO";
      sc(ws.getCell(1, COL_DEV_START), { bg: C_DEV_H, fg: WHITE, bold: true, size: 11 });
      ws.mergeCells(1, COL_DEV_START, 1, COL_DEV_TOTAL);
    }

    // ENTREGA, INDIVIDUAL, NOTA FINAL, OBS — merge rows 1-3
    for (const [col, val, bg] of [
      [COL_ENTREGA, "ENTREGA\n7 PTS", C_ENT_H],
      [COL_PTS_IND, "INDIVIDUAL",     C_IND_H],
      [COL_NOTA,    "NOTA FINAL",     C_NOTA_H],
      [COL_OBS,     "OBS",            C_OBS_H],
    ]) {
      ws.getCell(1, col).value = val;
      sc(ws.getCell(1, col), { bg, fg: WHITE, bold: true, wrap: true });
      ws.mergeCells(1, col, 3, col);
    }

    // ── ROW 2: Nomes das atividades ──────────────────────────────
    planActs.forEach((a, i) => {
      ws.getCell(2, COL_PLAN_START + i).value = a.display_name;
      sc(ws.getCell(2, COL_PLAN_START + i), { bg: C_PLAN_M, bold: true, wrap: true, size: 9 });
    });
    if (planActs.length > 0) {
      ws.getCell(2, COL_PLAN_TOTAL).value = "Total";
      sc(ws.getCell(2, COL_PLAN_TOTAL), { bg: C_PLAN_M, bold: true });
    }

    devActs.forEach((a, i) => {
      ws.getCell(2, COL_DEV_START + i).value = a.display_name;
      sc(ws.getCell(2, COL_DEV_START + i), { bg: C_DEV_M, bold: true, wrap: true, size: 9 });
    });
    if (devActs.length > 0) {
      ws.getCell(2, COL_DEV_TOTAL).value = "Total";
      sc(ws.getCell(2, COL_DEV_TOTAL), { bg: C_DEV_M, bold: true });
    }

    // ── ROW 3: Pontos máximos ────────────────────────────────────
    planActs.forEach((a, i) => {
      ws.getCell(3, COL_PLAN_START + i).value = a.max_pts || 0;
      sc(ws.getCell(3, COL_PLAN_START + i), { bg: C_PLAN_R });
    });
    if (planActs.length > 0) {
      ws.getCell(3, COL_PLAN_TOTAL).value = planMax;
      sc(ws.getCell(3, COL_PLAN_TOTAL), { bg: C_PLAN_M, bold: true });
    }

    devActs.forEach((a, i) => {
      ws.getCell(3, COL_DEV_START + i).value = a.max_pts || 0;
      sc(ws.getCell(3, COL_DEV_START + i), { bg: C_DEV_R });
    });
    if (devActs.length > 0) {
      ws.getCell(3, COL_DEV_TOTAL).value = devMax;
      sc(ws.getCell(3, COL_DEV_TOTAL), { bg: C_DEV_M, bold: true });
    }

    // ── DADOS: Uma linha por aluno ───────────────────────────────
    let rowN = 4;

    for (const proj of projects) {
      const projId  = Number(proj.id);
      const members = proj.members || [];

      for (const memberName of members) {
        ws.getRow(rowN).height = 20;

        // Nº / Projeto / Aluno
        ws.getCell(rowN, COL_NUM).value = rowN - 3;
        sc(ws.getCell(rowN, COL_NUM), { bold: true });
        ws.getCell(rowN, COL_PROJ).value = proj.name;
        sc(ws.getCell(rowN, COL_PROJ), { h: "left" });
        ws.getCell(rowN, COL_ALUNO).value = memberName;
        sc(ws.getCell(rowN, COL_ALUNO), { h: "left" });

        // Atividades de planejamento — usa occurrenceIdx para lidar com nomes duplicados
        let planTotal = 0;
        planActs.forEach((actCol, i) => {
          const matches = allActs
            .filter(a => a.project_id === projId && a.section === "planejamento" && a.name === actCol.name)
            .sort((a, b) => a.id - b.id);
          const actRec = matches[actCol.occurrenceIdx] || null;
          const scoreRec = actRec
            ? actScores.find(s => s.activity_id === actRec.id && s.member_name === memberName)
            : null;
          const val = scoreRec ? scoreRec.score : null;
          ws.getCell(rowN, COL_PLAN_START + i).value = val;
          sc(ws.getCell(rowN, COL_PLAN_START + i), { bg: C_PLAN_R, h: "center" });
          if (val != null) planTotal = Math.round((planTotal + val) * 10) / 10;
        });
        if (planActs.length > 0) {
          ws.getCell(rowN, COL_PLAN_TOTAL).value = planTotal || null;
          sc(ws.getCell(rowN, COL_PLAN_TOTAL), { bg: C_PLAN_M, bold: true });
        }

        // Atividades de desenvolvimento
        let devTotal = 0;
        devActs.forEach((actCol, i) => {
          const matches = allActs
            .filter(a => a.project_id === projId && a.section === "desenvolvimento" && a.name === actCol.name)
            .sort((a, b) => a.id - b.id);
          const actRec = matches[actCol.occurrenceIdx] || null;
          const scoreRec = actRec
            ? actScores.find(s => s.activity_id === actRec.id && s.member_name === memberName)
            : null;
          const val = scoreRec ? scoreRec.score : null;
          ws.getCell(rowN, COL_DEV_START + i).value = val;
          sc(ws.getCell(rowN, COL_DEV_START + i), { bg: C_DEV_R, h: "center" });
          if (val != null) devTotal = Math.round((devTotal + val) * 10) / 10;
        });
        if (devActs.length > 0) {
          ws.getCell(rowN, COL_DEV_TOTAL).value = devTotal || null;
          sc(ws.getCell(rowN, COL_DEV_TOTAL), { bg: C_DEV_M, bold: true });
        }

        // Dados individuais (entrega_score é per-member)
        const indiv = indivRows.find(r => r.project_id === projId && r.member_name === memberName) || {};

        const entrega = (indiv.entrega_score != null && indiv.entrega_score !== 0) ? indiv.entrega_score : null;
        ws.getCell(rowN, COL_ENTREGA).value = entrega;
        sc(ws.getCell(rowN, COL_ENTREGA), { bg: C_ENT_R, h: "center" });

        const ptsInd = (indiv.score != null && indiv.score !== 0) ? indiv.score : null;
        ws.getCell(rowN, COL_PTS_IND).value = ptsInd;
        sc(ws.getCell(rowN, COL_PTS_IND), { bg: C_IND_R, bold: true });

        // Nota Final = plan + dev + entrega individual + pontos individuais
        const notaFinal = Math.round((planTotal + devTotal + (entrega || 0) + (ptsInd || 0)) * 10) / 10;
        ws.getCell(rowN, COL_NOTA).value = notaFinal || null;
        sc(ws.getCell(rowN, COL_NOTA), { bg: C_NOTA_H, fg: WHITE, bold: true, size: 11 });

        ws.getCell(rowN, COL_OBS).value = indiv.observacao || null;
        sc(ws.getCell(rowN, COL_OBS), { bg: C_OBS_R, h: "left", wrap: true });

        rowN++;
      }
    }

    // Larguras
    ws.getColumn(COL_NUM).width   = 5;
    ws.getColumn(COL_PROJ).width  = 28;
    ws.getColumn(COL_ALUNO).width = 28;
    for (let i = 0; i < planActs.length; i++) ws.getColumn(COL_PLAN_START + i).width = 14;
    if (planActs.length > 0) ws.getColumn(COL_PLAN_TOTAL).width = 10;
    for (let i = 0; i < devActs.length; i++) ws.getColumn(COL_DEV_START + i).width = 14;
    if (devActs.length > 0) ws.getColumn(COL_DEV_TOTAL).width = 10;
    ws.getColumn(COL_ENTREGA).width  = 12;
    ws.getColumn(COL_PTS_IND).width  = 14;
    ws.getColumn(COL_NOTA).width     = 14;
    ws.getColumn(COL_OBS).width      = 35;

    // Freeze: 3 linhas de header + 3 colunas fixas
    ws.views = [{ state: "frozen", ySplit: 3, xSplit: 3 }];

    return wb;
  }

  // Export por turma (todos os grupos da turma) — parâmetro é turmaId numérico
  app.get("/api/export/grading/turma/:turmaId", authRequired, professorOnly, async (req, res) => {
    const turmaId = Number(req.params.turmaId);
    if (!turmaId) return res.status(400).json({ error: "ID de turma inválido" });
    const turmaRow = await db.get("SELECT * FROM turmas WHERE id = ?", [turmaId]);
    if (!turmaRow) return res.status(404).json({ error: "Turma não encontrada" });
    if (!req.user.isAdmin && turmaRow.professor_id !== req.user.id)
      return res.status(403).json({ error: "Você não é o professor responsável por esta turma" });
    const projects = await getProjectsWithMembers(db, "WHERE p.turma_id = ?", [turmaId]);
    if (!projects.length) return res.status(404).json({ error: "Nenhum projeto encontrado para esta turma" });
    const wb = await buildGradingWorkbook(projects, evalDb, turmaRow.turma);
    const fname = `Avaliacao_${turmaRow.turma.replace(/[^a-zA-Z0-9]/g, "_")}.xlsx`;
    res.setHeader("Content-Disposition", `attachment; filename="${fname}"`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    await wb.xlsx.write(res);
    res.end();
  });

  // Export por grupo (um projeto específico) — vedado para aluno
  app.get("/api/export/grading/project/:id", authRequired, async (req, res) => {
    if (req.user.role === "aluno" && !req.user.isAdmin)
      return res.status(403).json({ error: "Aluno não pode exportar planilha de avaliação" });
    const scope = await buildVisibleScope(db, req.user);
    const projectId = Number(req.params.id);
    if (!scope.projectIds.has(projectId)) return res.status(403).json({ error: "Sem permissão" });
    const projects = await getProjectsWithMembers(db, "WHERE p.id = ?", [projectId]);
    if (!projects.length) return res.status(404).json({ error: "Projeto não encontrado" });
    const proj = projects[0];
    const wb = await buildGradingWorkbook(projects, evalDb, proj.name);
    const fname = `Avaliacao_${proj.name.replace(/[^a-zA-Z0-9]/g, "_")}.xlsx`;
    res.setHeader("Content-Disposition", `attachment; filename="${fname}"`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    await wb.xlsx.write(res);
    res.end();
  });

  // Lista de turmas (para o select de exportação) — retorna IDs, não texto
  app.get("/api/export/turmas", authRequired, professorOnly, async (req, res) => {
    const rows = req.user.isAdmin
      ? await db.all("SELECT id, turma, curso, periodo FROM turmas ORDER BY turma")
      : await db.all("SELECT id, turma, curso, periodo FROM turmas WHERE professor_id = ? ORDER BY turma", [req.user.id]);
    res.json(rows.map(r => ({ id: r.id, turma: r.turma, label: `${r.turma} · ${r.periodo} · ${r.curso}` })));
  });

  app.post("/api/projects/:id/invites", authRequired, async (req, res) => {
    const scope = await buildVisibleScope(db, req.user);
    const projectId = Number(req.params.id);
    if (!scope.projectIds.has(projectId)) return res.status(403).json({ error: "Sem permissão para convidar neste projeto" });
    const inviteEmails = Array.isArray(req.body?.emails) ? req.body.emails : [];
    const created = await createAndSendInvites(db, { projectId, inviterUserId: req.user.id, inviteEmails });
    return res.json({ ok: true, invitesSent: created });
  });

  // ── Documentos do projeto (TAP / PI) ─────────────────────────────────────

  app.get("/api/projects/:id/docs/:type", authRequired, async (req, res) => {
    const type = req.params.type;
    if (!["tap","pi"].includes(type)) return res.status(400).json({ error: "Tipo inválido" });
    const scope = await buildVisibleScope(db, req.user);
    if (!scope.projectIds.has(Number(req.params.id))) return res.status(403).json({ error: "Sem permissão" });
    const doc = await db.get(
      "SELECT content, approval_status, approved_by, approved_at, rejected_reason FROM project_docs WHERE project_id = ? AND doc_type = ?",
      [req.params.id, type]
    );
    return res.json({
      content: doc ? JSON.parse(doc.content || "{}") : {},
      approvalStatus: doc?.approval_status || "draft",
      approval_status: doc?.approval_status || "draft",
      approvedBy: doc?.approved_by || null,
      approved_by: doc?.approved_by || null,
      approvedAt: doc?.approved_at || null,
      approved_at: doc?.approved_at || null,
      rejectedReason: doc?.rejected_reason || null,
      rejected_reason: doc?.rejected_reason || null
    });
  });

  app.put("/api/projects/:id/docs/:type", authRequired, async (req, res) => {
    const type = req.params.type;
    if (!["tap","pi"].includes(type)) return res.status(400).json({ error: "Tipo inválido" });
    const scope = await buildVisibleScope(db, req.user);
    if (!scope.projectIds.has(Number(req.params.id))) return res.status(403).json({ error: "Sem permissão" });
    const content = JSON.stringify(req.body?.content || {});
    await db.run(
      `INSERT INTO project_docs (project_id, doc_type, content, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(project_id, doc_type) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`,
      [req.params.id, type, content]
    );
    return res.json({ ok: true });
  });

  // ── Sprints ───────────────────────────────────────────────────────────────

  app.get("/api/sprints", authRequired, async (_req, res) => {
    const sprints = await db.all("SELECT id, name, goal, start, end FROM sprints ORDER BY id DESC");
    return res.json(sprints.map((s) => ({ ...s, id: String(s.id) })));
  });

  app.post("/api/sprints", authRequired, professorOnly, async (req, res) => {
    const { name, goal, start, end } = req.body || {};
    if (!name || !goal || !start || !end) return res.status(400).json({ error: "Dados inválidos para sprint" });
    const created = await db.run("INSERT INTO sprints (name, goal, start, end) VALUES (?, ?, ?, ?)", [name, goal, start, end]);
    return res.status(201).json({ id: String(created.lastID) });
  });

  // ── Tasks ─────────────────────────────────────────────────────────────────

  app.get("/api/tasks", authRequired, async (req, res) => {
    const scope = await buildVisibleScope(db, req.user);
    const ids = Array.from(scope.projectIds);
    if (ids.length === 0) return res.json([]);
    const placeholders = ids.map(() => "?").join(",");
    const tasks = await db.all(
      `SELECT t.id, t.project_id, t.title, t.assignee, t.due_date, t.start_date, t.sprint_id,
              t.status, t.priority, t.points, t.description, t.checklist, t.tags, t.urgency, t.parent_task_id,
              (SELECT g.repo FROM task_github g WHERE g.task_id = t.id) AS github_repo,
              (SELECT g.note FROM task_github g WHERE g.task_id = t.id) AS github_note
       FROM tasks t WHERE t.project_id IN (${placeholders}) ORDER BY t.id DESC`,
      ids
    );
    for (const task of tasks) {
      const vals = await db.all("SELECT field_id, value FROM custom_field_values WHERE task_id = ?", [task.id]);
      task.customValues = Object.fromEntries(vals.map((v) => [String(v.field_id), v.value]));
    }
    return res.json(tasks.map(normalizeTask));
  });

  app.get("/api/tasks/:id", authRequired, async (req, res) => {
    const task = await db.get(
      `SELECT t.id, t.project_id, t.title, t.assignee, t.due_date, t.start_date, t.sprint_id,
              t.status, t.priority, t.points, t.description, t.checklist, t.tags, t.urgency, t.parent_task_id,
              (SELECT g.repo FROM task_github g WHERE g.task_id = t.id) AS github_repo,
              (SELECT g.note FROM task_github g WHERE g.task_id = t.id) AS github_note
       FROM tasks t WHERE t.id = ?`,
      [req.params.id]
    );
    if (!task) return res.status(404).json({ error: "Tarefa não encontrada" });
    const scope = await buildVisibleScope(db, req.user);
    if (!scope.projectIds.has(task.project_id)) return res.status(403).json({ error: "Sem permissão" });
    const vals = await db.all("SELECT field_id, value FROM custom_field_values WHERE task_id = ?", [task.id]);
    task.customValues = Object.fromEntries(vals.map((v) => [String(v.field_id), v.value]));
    // subtasks
    task.subtasks = await db.all(
      `SELECT id, title, status FROM tasks WHERE parent_task_id = ? ORDER BY id`,
      [task.id]
    );
    return res.json(normalizeTask(task));
  });

  app.post("/api/tasks", authRequired, async (req, res) => {
    const { projectId, title, assignee, dueDate, startDate, sprintId, points, priority, customValues, description, tags, urgency, parentTaskId } = req.body || {};
    const normalizedPriority = VALID_PRIORITY.includes(String(priority || "")) ? String(priority) : "normal";
    const normalizedUrgency = VALID_URGENCY.includes(String(urgency || "")) ? String(urgency) : "medium";

    if (!projectId || !title || !assignee || !dueDate) {
      return res.status(400).json({ error: "Dados inválidos para tarefa" });
    }

    const scope = await buildVisibleScope(db, req.user);
    if (!scope.projectIds.has(Number(projectId))) return res.status(403).json({ error: "Projeto fora do seu escopo" });

    const memberSet = await getProjectMembersSet(db, Number(projectId));
    if (assignee !== "Todos" && !memberSet.has(assignee)) return res.status(403).json({ error: "Responsável deve ser integrante do projeto" });

    const tagsJson = Array.isArray(tags) ? JSON.stringify(tags) : "[]";
    const parentId = parentTaskId ? Number(parentTaskId) : null;
    const created = await db.run(
      "INSERT INTO tasks (project_id, title, assignee, due_date, start_date, sprint_id, status, priority, points, description, tags, urgency, parent_task_id) VALUES (?, ?, ?, ?, ?, ?, 'nao_iniciado', ?, ?, ?, ?, ?, ?)",
      [projectId, title, assignee, dueDate, String(startDate || ""), sprintId, normalizedPriority, Number(points) || 1, String(description || "").trim(), tagsJson, normalizedUrgency, parentId]
    );

    if (customValues && typeof customValues === "object") {
      for (const [fieldId, value] of Object.entries(customValues)) {
        await db.run("INSERT INTO custom_field_values (task_id, field_id, value) VALUES (?, ?, ?) ON CONFLICT (task_id, field_id) DO UPDATE SET value = EXCLUDED.value", [created.lastID, fieldId, String(value)]);
      }
    }

    return res.status(201).json({ id: String(created.lastID) });
  });

  app.patch("/api/tasks/:id", authRequired, async (req, res) => {
    const { title, assignee, dueDate, startDate, sprintId, points, priority, customValues, description, tags, urgency, status } = req.body || {};
    const normalizedPriority = VALID_PRIORITY.includes(String(priority || "")) ? String(priority) : "normal";
    const normalizedUrgency = VALID_URGENCY.includes(String(urgency || "")) ? String(urgency) : "medium";

    if (!title || !assignee || !dueDate) return res.status(400).json({ error: "Dados inválidos para atualizar tarefa" });

    const task = await db.get("SELECT * FROM tasks WHERE id = ?", [req.params.id]);
    if (!task) return res.status(404).json({ error: "Tarefa não encontrada" });

    const scope = await buildVisibleScope(db, req.user);
    if (!scope.projectIds.has(task.project_id)) return res.status(403).json({ error: "Sem permissão" });

    const memberSet = await getProjectMembersSet(db, task.project_id);
    if (assignee !== "Todos" && !memberSet.has(assignee)) return res.status(403).json({ error: "Responsável deve ser integrante do projeto" });

    const tagsJson = Array.isArray(tags) ? JSON.stringify(tags) : "[]";
    const statusVal = VALID_STATUS.includes(cleanStatus(status)) ? cleanStatus(status) : null;

    // Audit log
    const auditFields = [
      ["title", task.title, title],
      ["assignee", task.assignee, assignee],
      ["due_date", task.due_date, dueDate],
      ["status", task.status, statusVal || task.status],
      ["priority", task.priority, normalizedPriority],
      ["urgency", task.urgency, normalizedUrgency],
    ];
    for (const [field, oldVal, newVal] of auditFields) {
      if (oldVal !== newVal && newVal !== undefined && newVal !== null) {
        await db.run("INSERT INTO task_audit (task_id,user_name,field,old_val,new_val) VALUES (?,?,?,?,?)",
          [task.id, req.user.name, field, String(oldVal), String(newVal)]);
      }
    }

    if (statusVal) {
      await db.run(
        "UPDATE tasks SET title=?, assignee=?, due_date=?, start_date=?, priority=?, description=?, tags=?, urgency=?, status=? WHERE id=?",
        [title, assignee, dueDate, String(startDate || ""), normalizedPriority, String(description || "").trim(), tagsJson, normalizedUrgency, statusVal, req.params.id]
      );
    } else {
      await db.run(
        "UPDATE tasks SET title=?, assignee=?, due_date=?, start_date=?, priority=?, description=?, tags=?, urgency=? WHERE id=?",
        [title, assignee, dueDate, String(startDate || ""), normalizedPriority, String(description || "").trim(), tagsJson, normalizedUrgency, req.params.id]
      );
    }

    if (customValues && typeof customValues === "object") {
      for (const [fieldId, value] of Object.entries(customValues)) {
        await db.run("INSERT OR REPLACE INTO custom_field_values (task_id, field_id, value) VALUES (?, ?, ?)", [req.params.id, fieldId, String(value)]);
      }
    }
    if (app._io) app._io.to(`project:${task.project_id}`).emit("task-updated", { taskId: Number(req.params.id), projectId: task.project_id });
    return res.json({ ok: true });
  });

  app.patch("/api/tasks/:id/status", authRequired, async (req, res) => {
    const normalizedStatus = cleanStatus(req.body?.status);
    if (!VALID_STATUS.includes(normalizedStatus)) return res.status(400).json({ error: "Status inválido" });
    const task = await db.get("SELECT id, project_id, status FROM tasks WHERE id = ?", [req.params.id]);
    if (!task) return res.status(404).json({ error: "Tarefa não encontrada" });
    const scope = await buildVisibleScope(db, req.user);
    if (!scope.projectIds.has(task.project_id)) return res.status(403).json({ error: "Sem permissão" });
    const taskId = Number(req.params.id);
    await db.run("UPDATE tasks SET status = ? WHERE id = ?", [normalizedStatus, taskId]);
    if (task.status !== normalizedStatus) {
      await logTaskAudit(db, task.id, req.user.name, "status", task.status, normalizedStatus);
      if (app._io) {
        app._io.to(`project:${task.project_id}`).emit("task-updated", { taskId, status: normalizedStatus });
      }
      // Persistir notificações e emitir socket por membro (sempre, independente de _io)
      try {
        const members = await db.all(
          `SELECT DISTINCT u.id FROM users u
           JOIN project_members pm ON (
             (pm.user_id IS NOT NULL AND pm.user_id = u.id)
             OR (pm.user_id IS NULL AND pm.member_name = u.name
                 AND (SELECT COUNT(*) FROM users u2 WHERE u2.name = u.name) = 1)
           )
           WHERE pm.project_id = ?`,
          [task.project_id]
        );
        for (const m of members) {
          const notifMsg = `Tarefa movida para ${normalizedStatus}`;
          const notifLink = `/kanban?task=${taskId}`;
          // Persistir no banco (sempre)
          try {
            await db.run(
              "INSERT INTO notifications (user_id, type, message, link) VALUES (?, 'task_moved', ?, ?)",
              [m.id, notifMsg, notifLink]
            );
          } catch (_) {}
          if (app._io) {
            app._io.to(`user:${m.id}`).emit("notification", {
              type: "task_moved",
              message: notifMsg,
              link: notifLink,
              taskId,
              projectId: task.project_id
            });
          }
        }
      } catch (_) {}
    }
    return res.json({ ok: true });
  });

  app.patch("/api/tasks/:id/checklist", authRequired, async (req, res) => {
    const { checklist } = req.body || {};
    if (!Array.isArray(checklist)) return res.status(400).json({ error: "Checklist deve ser um array" });
    const task = await db.get("SELECT id, project_id, checklist FROM tasks WHERE id = ?", [req.params.id]);
    if (!task) return res.status(404).json({ error: "Tarefa não encontrada" });
    const scope = await buildVisibleScope(db, req.user);
    if (!scope.projectIds.has(task.project_id)) return res.status(403).json({ error: "Sem permissão" });
    await db.run("UPDATE tasks SET checklist = ? WHERE id = ?", [JSON.stringify(checklist), req.params.id]);
    // Detecta itens recém-concluídos para um histórico mais útil
    try {
      const flat = (arr) => (Array.isArray(arr) ? arr.flatMap(g => Array.isArray(g.items) ? g.items : []) : []);
      const before = flat(JSON.parse(task.checklist || "[]"));
      const after = flat(checklist);
      const beforeDone = new Set(before.filter(i => i.done).map(i => String(i.id)));
      const newlyDone = after.filter(i => i.done && !beforeDone.has(String(i.id)));
      if (newlyDone.length === 1) await logTaskAudit(db, task.id, req.user.name, "checklist_item_done", null, newlyDone[0].title);
      else await logTaskAudit(db, task.id, req.user.name, "checklist", null, null);
    } catch (_) { await logTaskAudit(db, task.id, req.user.name, "checklist", null, null); }
    return res.json({ ok: true });
  });

  app.patch("/api/tasks/:id/urgency", authRequired, async (req, res) => {
    const urgency = String(req.body?.urgency || "").toLowerCase();
    if (!VALID_URGENCY.includes(urgency)) return res.status(400).json({ error: "Urgência inválida" });
    const task = await db.get("SELECT id, project_id FROM tasks WHERE id = ?", [req.params.id]);
    if (!task) return res.status(404).json({ error: "Tarefa não encontrada" });
    const scope = await buildVisibleScope(db, req.user);
    if (!scope.projectIds.has(task.project_id)) return res.status(403).json({ error: "Sem permissão" });
    await db.run("UPDATE tasks SET urgency = ? WHERE id = ?", [urgency, req.params.id]);
    return res.json({ ok: true });
  });

  app.patch("/api/tasks/:id/tags", authRequired, async (req, res) => {
    const { tags } = req.body || {};
    if (!Array.isArray(tags)) return res.status(400).json({ error: "Tags devem ser um array" });
    const task = await db.get("SELECT id, project_id FROM tasks WHERE id = ?", [req.params.id]);
    if (!task) return res.status(404).json({ error: "Tarefa não encontrada" });
    const scope = await buildVisibleScope(db, req.user);
    if (!scope.projectIds.has(task.project_id)) return res.status(403).json({ error: "Sem permissão" });
    await db.run("UPDATE tasks SET tags = ? WHERE id = ?", [JSON.stringify(tags), req.params.id]);
    const tagNames = tags.map((t) => (t && typeof t === "object" ? t.name : t)).filter(Boolean).join(", ");
    await logTaskAudit(db, task.id, req.user.name, "tags", null, tagNames);
    return res.json({ ok: true });
  });

  // ── GitHub por tarefa (repositório + nota "o que estou fazendo") ──────────
  app.patch("/api/tasks/:id/github", authRequired, async (req, res) => {
    const repo = String(req.body?.repo || "").trim().slice(0, 300);
    const note = String(req.body?.note || "").trim().slice(0, 2000);
    const task = await db.get("SELECT id, project_id FROM tasks WHERE id = ?", [req.params.id]);
    if (!task) return res.status(404).json({ error: "Tarefa não encontrada" });
    const scope = await buildVisibleScope(db, req.user);
    if (!scope.projectIds.has(task.project_id)) return res.status(403).json({ error: "Sem permissão" });
    const prev = await db.get("SELECT repo FROM task_github WHERE task_id = ?", [task.id]);
    await db.run(
      `INSERT INTO task_github (task_id, repo, note, updated_by, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(task_id) DO UPDATE SET repo = excluded.repo, note = excluded.note,
         updated_by = excluded.updated_by, updated_at = datetime('now')`,
      [task.id, repo, note, req.user.name]
    );
    if ((prev?.repo || "") !== repo && repo) await logTaskAudit(db, task.id, req.user.name, "github_repo", null, repo);
    return res.json({ ok: true, repo, note });
  });

  app.delete("/api/tasks/:id", authRequired, async (req, res) => {
    const task = await db.get("SELECT id, project_id FROM tasks WHERE id = ?", [req.params.id]);
    if (!task) return res.status(404).json({ error: "Tarefa não encontrada" });
    const scope = await buildVisibleScope(db, req.user);
    if (!scope.projectIds.has(task.project_id)) return res.status(403).json({ error: "Sem permissão" });
    await db.run("DELETE FROM tasks WHERE id = ?", [req.params.id]);
    return res.json({ ok: true });
  });

  // ── Task Comments ─────────────────────────────────────────────────────────

  app.get("/api/tasks/:id/comments", authRequired, async (req, res) => {
    const task = await db.get("SELECT id, project_id FROM tasks WHERE id = ?", [req.params.id]);
    if (!task) return res.status(404).json({ error: "Tarefa não encontrada" });
    const scope = await buildVisibleScope(db, req.user);
    if (!scope.projectIds.has(task.project_id)) return res.status(403).json({ error: "Sem permissão" });
    const comments = await db.all(
      `SELECT c.id, c.task_id, c.content, c.created_at, u.name AS author_name, u.photo AS author_photo
       FROM task_comments c JOIN users u ON u.id = c.user_id
       WHERE c.task_id = ? ORDER BY c.id ASC`,
      [req.params.id]
    );
    return res.json(comments.map(c => ({ id: String(c.id), taskId: String(c.task_id), content: c.content, createdAt: c.created_at, authorName: c.author_name, authorPhoto: c.author_photo })));
  });

  app.post("/api/tasks/:id/comments", authRequired, async (req, res) => {
    const { content } = req.body || {};
    if (!content || !String(content).trim()) return res.status(400).json({ error: "Comentário não pode ser vazio" });
    const task = await db.get("SELECT id, project_id FROM tasks WHERE id = ?", [req.params.id]);
    if (!task) return res.status(404).json({ error: "Tarefa não encontrada" });
    const scope = await buildVisibleScope(db, req.user);
    if (!scope.projectIds.has(task.project_id)) return res.status(403).json({ error: "Sem permissão" });
    const created = await db.run(
      "INSERT INTO task_comments (task_id, user_id, content) VALUES (?, ?, ?)",
      [req.params.id, req.user.id, String(content).trim()]
    );
    await logTaskAudit(db, task.id, req.user.name, "comentario", null, null);
    return res.status(201).json({ id: String(created.lastID) });
  });

  app.delete("/api/tasks/:id/comments/:cid", authRequired, async (req, res) => {
    const comment = await db.get("SELECT id, user_id, task_id FROM task_comments WHERE id = ? AND task_id = ?", [req.params.cid, req.params.id]);
    if (!comment) return res.status(404).json({ error: "Comentário não encontrado" });
    if (comment.user_id !== req.user.id && !req.user.isAdmin) return res.status(403).json({ error: "Sem permissão para deletar este comentário" });
    await db.run("DELETE FROM task_comments WHERE id = ?", [req.params.cid]);
    return res.json({ ok: true });
  });

  // ── Custom Fields ─────────────────────────────────────────────────────────

  app.get("/api/projects/:id/fields", authRequired, async (req, res) => {
    const scope = await buildVisibleScope(db, req.user);
    if (!scope.projectIds.has(Number(req.params.id))) return res.status(403).json({ error: "Sem permissão" });
    const fields = await db.all("SELECT id, project_id, name, field_type, options FROM custom_field_definitions WHERE project_id = ? ORDER BY id ASC", [req.params.id]);
    return res.json(fields.map((f) => ({ id: String(f.id), projectId: String(f.project_id), name: f.name, fieldType: f.field_type, options: f.options ? JSON.parse(f.options) : [] })));
  });

  app.post("/api/projects/:id/fields", authRequired, professorOnly, async (req, res) => {
    const scope = await buildVisibleScope(db, req.user);
    if (!scope.projectIds.has(Number(req.params.id))) return res.status(403).json({ error: "Sem permissão" });
    const { name, fieldType, options } = req.body || {};
    const validTypes = ["text", "number", "select", "date", "checkbox"];
    const cleanType = String(fieldType || "text").toLowerCase();
    if (!name || !validTypes.includes(cleanType)) return res.status(400).json({ error: "Dados inválidos para campo" });
    const optionsJson = cleanType === "select" && Array.isArray(options) ? JSON.stringify(options.map((o) => String(o).trim()).filter(Boolean)) : null;
    const created = await db.run("INSERT INTO custom_field_definitions (project_id, name, field_type, options) VALUES (?, ?, ?, ?)", [req.params.id, String(name).trim(), cleanType, optionsJson]);
    return res.status(201).json({ id: String(created.lastID) });
  });

  app.delete("/api/projects/:id/fields/:fieldId", authRequired, professorOnly, async (req, res) => {
    const scope = await buildVisibleScope(db, req.user);
    if (!scope.projectIds.has(Number(req.params.id))) return res.status(403).json({ error: "Sem permissão" });
    await db.run("DELETE FROM custom_field_definitions WHERE id = ? AND project_id = ?", [req.params.fieldId, req.params.id]);
    return res.json({ ok: true });
  });

  // ── Turmas (professor cria/lista; aluno entra via token) ─────────────────

  app.post("/api/turmas", authRequired, professorOnly, async (req, res) => {
    const { curso, periodo, turma } = req.body || {};
    const cleanCurso   = sanitize(curso);
    const cleanPeriodo = sanitize(periodo);
    const cleanTurma   = sanitize(turma);
    if (!cleanCurso || !cleanPeriodo || !cleanTurma) return res.status(400).json({ error: "Curso, período e turma são obrigatórios" });
    const token = crypto.randomUUID();
    const result = await db.run(
      "INSERT INTO turmas (professor_id, curso, periodo, turma, invite_token) VALUES (?, ?, ?, ?, ?)",
      [req.user.id, cleanCurso, cleanPeriodo, cleanTurma, token]
    );
    const link = `${APP_BASE_URL}/app?turma=${token}`;
    return res.status(201).json({ id: result.lastID, token, link, curso: cleanCurso, periodo: cleanPeriodo, turma: cleanTurma });
  });

  app.get("/api/turmas", authRequired, professorOnly, async (req, res) => {
    const rows = await db.all(
      "SELECT t.*, u.name as professor_name FROM turmas t JOIN users u ON u.id = t.professor_id WHERE t.professor_id = ? ORDER BY t.id DESC",
      [req.user.id]
    );
    return res.json(rows.map(r => ({ ...r, link: `${APP_BASE_URL}/app?turma=${r.invite_token}` })));
  });

  app.get("/api/turmas/resolve/:token", async (req, res) => {
    const row = await db.get(
      "SELECT t.id, t.curso, t.periodo, t.turma, u.name as professor_name FROM turmas t JOIN users u ON u.id = t.professor_id WHERE t.invite_token = ?",
      [req.params.token]
    );
    if (!row) return res.status(404).json({ error: "Link inválido" });
    return res.json(row);
  });

  // Aluno se registra via link de turma (sem precisar de conta prévia)
  app.post("/api/auth/register-by-turma", async (req, res) => {
    const { turmaToken, name, email, password } = req.body || {};
    if (!turmaToken || !name || !email || !password)
      return res.status(400).json({ error: "Todos os campos são obrigatórios" });
    const _pwErrTurma = validatePasswordStrength(password);
    if (_pwErrTurma) return res.status(400).json({ error: _pwErrTurma });

    const turmaRow = await db.get("SELECT * FROM turmas WHERE invite_token = ?", [turmaToken]);
    if (!turmaRow) return res.status(404).json({ error: "Link de turma inválido" });

    const cleanEmail = String(email).trim().toLowerCase();
    const cleanName  = sanitize(name);
    const username   = sanitizeUsername(cleanEmail.split("@")[0] + "_" + Math.floor(Math.random() * 999));

    if (await db.get("SELECT id FROM users WHERE email = ?", [cleanEmail]))
      return res.status(409).json({ error: "E-mail já cadastrado" });

    const hash = await hashPassword(password);
    const result = await db.run(
      "INSERT INTO users (username, name, role, email, turma, periodo, curso, turma_id, onboarding_done, password_hash) VALUES (?, ?, 'aluno', ?, ?, ?, ?, ?, 0, ?)",
      [username, cleanName, cleanEmail, turmaRow.turma, turmaRow.periodo, turmaRow.curso, turmaRow.id, hash]
    );
    const user = await db.get("SELECT * FROM users WHERE id = ?", [result.lastID]);
    const payload = buildAuthPayload(user);
    setAuthCookie(res, payload);
    return res.status(201).json({ ok: true, user: payload, requiresOnboarding: true });
  });

  // Registro via convite de projeto (sem conta prévia)
  app.post("/api/auth/register-by-invite", async (req, res) => {
    const { inviteToken, name, email, password, confirmPassword } = req.body || {};
    if (!inviteToken || !name || !email || !password)
      return res.status(400).json({ error: "Todos os campos são obrigatórios" });
    if (String(password) !== String(confirmPassword || ""))
      return res.status(400).json({ error: "As senhas não coincidem" });
    const _pwErrInvite = validatePasswordStrength(password);
    if (_pwErrInvite) return res.status(400).json({ error: _pwErrInvite });

    const invite = await db.get("SELECT * FROM project_invites WHERE invite_token = ? AND status = 'pending'", [inviteToken]);
    if (!invite) return res.status(404).json({ error: "Convite inválido ou já utilizado" });

    const cleanEmail = String(email).trim().toLowerCase();
    if (String(invite.invite_email).toLowerCase() !== cleanEmail)
      return res.status(403).json({ error: `Este convite foi enviado para: ${invite.invite_email}` });

    if (await db.get("SELECT id FROM users WHERE email = ?", [cleanEmail]))
      return res.status(409).json({ error: "E-mail já cadastrado — faça login e acesse o link novamente" });

    const cleanName = sanitize(name);
    const username  = sanitizeUsername(cleanEmail.split("@")[0] + "_" + Math.floor(Math.random() * 999));
    const hash      = await hashPassword(password);

    const projForInvite = await db.get("SELECT turma_id FROM projects WHERE id = ?", [invite.project_id]);
    if (!projForInvite?.turma_id) {
      return res.status(400).json({ error: "O projeto do convite não está vinculado a uma turma. Contacte o professor." });
    }
    const inviteTurmaId = projForInvite.turma_id;
    const result = await db.run(
      "INSERT INTO users (username, name, role, email, onboarding_done, turma_id, password_hash) VALUES (?, ?, 'aluno', ?, 1, ?, ?)",
      [username, cleanName, cleanEmail, inviteTurmaId, hash]
    );
    await db.run("INSERT OR IGNORE INTO project_members (project_id, member_name, scrum_role, user_id) VALUES (?, ?, 'Development Team', ?)", [invite.project_id, cleanName, result.lastID]);
    await db.run("UPDATE project_invites SET status = 'accepted', accepted_at = ? WHERE id = ?", [new Date().toISOString(), invite.id]);

    const user = await db.get("SELECT * FROM users WHERE id = ?", [result.lastID]);
    const payload = buildAuthPayload(user);
    setAuthCookie(res, payload);
    return res.status(201).json({ ok: true, user: payload });
  });

  // Login por e-mail (além de username)
  app.post("/api/auth/login-email", async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "E-mail e senha são obrigatórios" });
    const user = await db.get("SELECT * FROM users WHERE email = ?", [String(email).trim().toLowerCase()]);
    if (!user) return res.status(401).json({ error: "Credenciais inválidas" });
    const { valid: _leValid, needsRehash: _leNeedsRehash } = await verifyPassword(password, user.password_hash);
    if (!_leValid) return res.status(401).json({ error: "Credenciais inválidas" });
    if (_leNeedsRehash) await db.run("UPDATE users SET password_hash = ? WHERE id = ?", [await hashPassword(password), user.id]);
    if (user.must_change_password)
      return res.json({ mustChangePassword: true, userId: user.id });
    const payload = buildAuthPayload(user);
    setAuthCookie(res, payload);
    return res.json({ user: payload, requiresOnboarding: !user.onboarding_done });
  });

  // ── Chat ─────────────────────────────────────────────────────────────────

  app.get("/api/chat/:turmaId", authRequired, async (req, res) => {
    const turmaId = Number(req.params.turmaId);
    const turma = await db.get("SELECT * FROM turmas WHERE id = ?", [turmaId]);
    if (!turma) return res.status(404).json({ error: "Turma não encontrada" });
    // Admin: acesso irrestrito
    if (!req.user.isAdmin) {
      if (req.user.role === "professor") {
        // Professor só acessa chat da própria turma
        if (turma.professor_id !== req.user.id)
          return res.status(403).json({ error: "Sem permissão para este chat" });
      } else {
        // Aluno só acessa chat da turma vinculada (users.turma_id)
        const userRow = await db.get("SELECT turma_id FROM users WHERE id = ?", [req.user.id]);
        if (!userRow || userRow.turma_id !== turmaId)
          return res.status(403).json({ error: "Sem permissão para este chat" });
      }
    }
    const msgs = await db.all(
      `SELECT cm.id, cm.content, cm.created_at, u.name as sender_name, u.role as sender_role, u.photo as sender_photo
       FROM chat_messages cm JOIN users u ON u.id = cm.sender_id
       WHERE cm.turma_id = ? ORDER BY cm.created_at ASC LIMIT 200`,
      [turmaId]
    );
    return res.json(msgs);
  });

  app.post("/api/chat/:turmaId", authRequired, async (req, res) => {
    const turmaId = Number(req.params.turmaId);
    const turma = await db.get("SELECT * FROM turmas WHERE id = ?", [turmaId]);
    if (!turma) return res.status(404).json({ error: "Turma não encontrada" });
    if (!req.user.isAdmin) {
      if (req.user.role === "professor") {
        if (turma.professor_id !== req.user.id)
          return res.status(403).json({ error: "Sem permissão para este chat" });
      } else {
        const userRow = await db.get("SELECT turma_id FROM users WHERE id = ?", [req.user.id]);
        if (!userRow || userRow.turma_id !== turmaId)
          return res.status(403).json({ error: "Sem permissão para este chat" });
      }
    }
    const content = sanitize(String(req.body?.content || ""), 2000);
    if (!content) return res.status(400).json({ error: "Mensagem vazia" });
    const result = await db.run(
      "INSERT INTO chat_messages (turma_id, sender_id, content) VALUES (?, ?, ?)",
      [turmaId, req.user.id, content]
    );
    return res.status(201).json({ id: result.lastID, ok: true });
  });

  // ── Perfil expandido ─────────────────────────────────────────────────────

  app.patch("/api/profile/extended", authRequired, async (req, res) => {
    const { bio, skills, graduations, specialty, experience_years } = req.body || {};
    const updates = {};
    if (bio !== undefined) updates.bio = sanitize(String(bio || ""), 1000);
    if (skills !== undefined) updates.skills = JSON.stringify(Array.isArray(skills) ? skills.map(s => sanitize(String(s), 100)) : []);
    if (graduations !== undefined) updates.graduations = sanitize(String(graduations || ""), 500);
    if (specialty !== undefined) updates.specialty = sanitize(String(specialty || ""), 300);
    if (experience_years !== undefined) updates.experience_years = Math.max(0, Number(experience_years) || 0);
    updates.profile_complete = 1;
    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(", ");
    await db.run(`UPDATE users SET ${setClauses} WHERE id = ?`, [...Object.values(updates), req.user.id]);
    return res.json({ ok: true });
  });

  app.get("/api/team/members/:turmaId", authRequired, async (req, res) => {
    const turmaId = Number(req.params.turmaId);
    const turma = await db.get("SELECT * FROM turmas WHERE id = ?", [turmaId]);
    if (!turma) return res.status(404).json({ error: "Turma não encontrada" });
    if (!req.user.isAdmin) {
      if (req.user.role === "professor") {
        if (turma.professor_id !== req.user.id)
          return res.status(403).json({ error: "Sem permissão" });
      } else {
        // Aluno só acessa membros da turma onde está vinculado
        const userRow = await db.get("SELECT turma_id FROM users WHERE id = ?", [req.user.id]);
        if (!userRow || userRow.turma_id !== turmaId)
          return res.status(403).json({ error: "Sem permissão" });
      }
    }
    const members = await db.all(
      `SELECT u.id, u.name, u.role, u.email, u.turma, u.periodo, u.curso, u.photo,
              u.bio, u.skills, u.graduations, u.specialty, u.experience_years, u.profile_complete,
              p.name as project_name
       FROM users u
       LEFT JOIN project_members pm ON pm.member_name = u.name
       LEFT JOIN projects p ON p.id = pm.project_id
       WHERE u.turma_id = ? OR (u.role = 'professor' AND u.id = ?)
       ORDER BY u.role DESC, u.name ASC`,
      [turmaId, turma.professor_id]
    );
    return res.json(members.map(m => ({
      ...m,
      skills: (() => { try { return JSON.parse(m.skills || "[]"); } catch(_) { return []; } })()
    })));
  });

  // Avaliação: atividades criadas por turma inteira (não por projeto específico)
  app.post("/api/eval/turma/:turmaId/activities", authRequired, professorOnly, async (req, res) => {
    const turmaId = Number(req.params.turmaId);
    const { section, name, max_pts } = req.body || {};
    if (!["planejamento", "desenvolvimento"].includes(section) || !name)
      return res.status(400).json({ error: "Dados inválidos" });
    const turma = await db.get("SELECT * FROM turmas WHERE id = ?", [turmaId]);
    if (!turma) return res.status(404).json({ error: "Turma não encontrada" });
    if (!req.user.isAdmin && turma.professor_id !== req.user.id)
      return res.status(403).json({ error: "Sem permissão" });
    const projects = await db.all("SELECT id FROM projects WHERE turma_id = ?", [turmaId]);
    const ids = [];
    for (const proj of projects) {
      const r = await evalDb.run(
        "INSERT INTO eval_activities (project_id, section, name, max_pts) VALUES (?, ?, ?, ?)",
        [proj.id, section, sanitize(name, 200), Number(max_pts) || 1]
      );
      ids.push(r.lastID);
    }
    return res.status(201).json({ ok: true, created: ids.length });
  });

  // ── Admin ─────────────────────────────────────────────────────────────────

  app.get("/api/admin/users", authRequired, async (req, res) => {
    if (!req.user.isAdmin && req.user.role !== "professor")
      return res.status(403).json({ error: "Sem permissão" });
    const users = await db.all(
      "SELECT id, username, name, role, email, turma, periodo, is_admin, onboarding_done FROM users ORDER BY role, name"
    );
    res.json(users.map(u => ({
      id: u.id,
      username: u.username,
      name: u.name,
      role: u.role,
      email: u.email || null,
      turma: u.turma || null,
      periodo: u.periodo || null,
      isAdmin: u.is_admin || 0,
      onboardingDone: Boolean(u.onboarding_done)
    })));
  });

  app.post("/api/admin/professor", authRequired, adminOnly, async (req, res) => {
    const { name, email, password } = req.body || {};
    const cleanEmail = String(email || "").trim().toLowerCase();
    const cleanName = sanitize(name);
    const cleanPassword = String(password || "");
    if (!cleanEmail || !cleanName || !cleanPassword) return res.status(400).json({ error: "Nome, e-mail e senha são obrigatórios" });
    if (!isValidEmail(cleanEmail)) return res.status(400).json({ error: "E-mail inválido" });
    const _pwErrProf = validatePasswordStrength(cleanPassword);
    if (_pwErrProf) return res.status(400).json({ error: _pwErrProf });
    if (await db.get("SELECT id FROM users WHERE email = ?", [cleanEmail])) {
      return res.status(409).json({ error: "E-mail já cadastrado" });
    }
    const baseUsername = sanitizeUsername(cleanEmail.split("@")[0]) || "professor";
    let username = baseUsername;
    let usernameSuffix = 2;
    while (await db.get("SELECT id FROM users WHERE username = ?", [username])) {
      const suffix = String(usernameSuffix++);
      const prefixLength = Math.max(1, 49 - suffix.length);
      username = sanitizeUsername(`${baseUsername.slice(0, prefixLength)}.${suffix}`);
    }
    const passwordHash = await hashPassword(cleanPassword);
    const created = await db.run(
      "INSERT INTO users (username, name, role, email, is_admin, onboarding_done, must_change_password, password_hash) VALUES (?, ?, 'professor', ?, 0, 1, 1, ?)",
      [username, cleanName, cleanEmail, passwordHash]
    );
    if (mailTransporter) {
      const welcomeHtml = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Bem-vindo ao PILHA</title></head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:40px 0;"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.08);">
<tr><td style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:40px 40px 30px;text-align:center;">
<h1 style="color:#ffffff;font-size:28px;margin:0 0 5px;">📚 PILHA</h1>
<p style="color:#e0d4ff;font-size:14px;margin:0;">Gestão Ágil Acadêmica · UNIPAM</p></td></tr>
<tr><td style="padding:35px 40px 10px;">
<h2 style="color:#1e1b4b;font-size:22px;margin:0 0 15px;">Olá, Professor(a) ${cleanName}! 🎓</h2>
<p style="color:#4b5563;font-size:15px;line-height:1.7;margin:0 0 15px;">É com grande satisfação que damos as boas-vindas a você na plataforma <strong>PILHA</strong> — a ferramenta de gestão ágil acadêmica desenvolvida especialmente para professores e alunos da <strong>UNIPAM</strong>.</p>
<p style="color:#4b5563;font-size:15px;line-height:1.7;margin:0 0 15px;">Agradecemos imensamente por escolher o PILHA como sua plataforma de apoio na condução de projetos acadêmicos. Sua presença fortalece nossa comunidade e nos motiva a continuar evoluindo!</p></td></tr>
<tr><td style="padding:10px 40px;"><table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f0fdf4;border-left:4px solid #22c55e;border-radius:8px;">
<tr><td style="padding:20px;"><h3 style="color:#166534;font-size:16px;margin:0 0 10px;">✅ Cadastro Confirmado com Sucesso</h3>
<p style="color:#4b5563;font-size:14px;line-height:1.6;margin:0;">Seu perfil de <strong>Professor</strong> foi criado e ativado na plataforma PILHA. Você já pode acessar todas as funcionalidades exclusivas para docentes.</p></td></tr></table></td></tr>
<tr><td style="padding:20px 40px;"><table width="100%" cellpadding="0" cellspacing="0" style="background-color:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;">
<tr><td style="padding:25px;"><h3 style="color:#1e40af;font-size:16px;margin:0 0 15px;">🔐 Seus Dados de Acesso</h3>
<table width="100%" cellpadding="0" cellspacing="0">
<tr><td style="padding:8px 0;color:#6b7280;font-size:14px;width:140px;">🌐 Plataforma:</td><td style="padding:8px 0;"><a href="https://eusford.com/app" style="color:#6366f1;font-size:14px;font-weight:bold;text-decoration:none;">https://eusford.com/app</a></td></tr>
<tr><td style="padding:8px 0;color:#6b7280;font-size:14px;">👤 Login (E-mail):</td><td style="padding:8px 0;color:#1f2937;font-size:14px;font-weight:bold;">${cleanEmail}</td></tr>
<tr><td style="padding:8px 0;color:#6b7280;font-size:14px;">🔑 Senha Temporária:</td><td style="padding:8px 0;"><span style="background-color:#fef3c7;color:#92400e;font-size:14px;font-weight:bold;padding:4px 12px;border-radius:6px;letter-spacing:1px;">${cleanPassword}</span></td></tr>
</table>
<p style="color:#dc2626;font-size:13px;margin:15px 0 0;line-height:1.5;">⚠️ <strong>Importante:</strong> Recomendamos que você altere sua senha temporária no primeiro acesso para garantir a segurança da sua conta.</p></td></tr></table></td></tr>
<tr><td style="padding:10px 40px 25px;text-align:center;"><a href="https://eusford.com/app" style="display:inline-block;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#ffffff;font-size:16px;font-weight:bold;padding:14px 40px;border-radius:8px;text-decoration:none;">🚀 Acessar o PILHA Agora</a></td></tr>
<tr><td style="padding:10px 40px 20px;"><h3 style="color:#1e1b4b;font-size:17px;margin:0 0 15px;">🎯 O que você pode fazer como Professor no PILHA:</h3>
<table width="100%" cellpadding="0" cellspacing="0">
<tr><td style="padding:10px 0;border-bottom:1px solid #f3f4f6;"><table cellpadding="0" cellspacing="0"><tr><td style="width:35px;vertical-align:top;font-size:18px;">🏫</td><td style="color:#4b5563;font-size:14px;line-height:1.6;"><strong>Criar Turmas</strong> — Crie turmas com período e curso, e gere um link de convite único para compartilhar com seus alunos.</td></tr></table></td></tr>
<tr><td style="padding:10px 0;border-bottom:1px solid #f3f4f6;"><table cellpadding="0" cellspacing="0"><tr><td style="width:35px;vertical-align:top;font-size:18px;">📊</td><td style="color:#4b5563;font-size:14px;line-height:1.6;"><strong>Avaliar e Lançar Notas</strong> — Crie atividades de planejamento e desenvolvimento, atribua notas individuais e acompanhe cada grupo.</td></tr></table></td></tr>
<tr><td style="padding:10px 0;border-bottom:1px solid #f3f4f6;"><table cellpadding="0" cellspacing="0"><tr><td style="width:35px;vertical-align:top;font-size:18px;">💬</td><td style="color:#4b5563;font-size:14px;line-height:1.6;"><strong>Chat Direto com Alunos</strong> — Comunique-se diretamente com seus alunos dentro da plataforma, organizado por turma.</td></tr></table></td></tr>
<tr><td style="padding:10px 0;border-bottom:1px solid #f3f4f6;"><table cellpadding="0" cellspacing="0"><tr><td style="width:35px;vertical-align:top;font-size:18px;">👁️</td><td style="color:#4b5563;font-size:14px;line-height:1.6;"><strong>Acompanhar Projetos</strong> — Acesse qualquer projeto dos seus alunos, visualize o Kanban, sprints e o progresso em tempo real.</td></tr></table></td></tr>
<tr><td style="padding:10px 0;"><table cellpadding="0" cellspacing="0"><tr><td style="width:35px;vertical-align:top;font-size:18px;">📥</td><td style="color:#4b5563;font-size:14px;line-height:1.6;"><strong>Exportar Notas em Excel</strong> — Exporte relatórios completos de avaliação por turma ou grupo em planilha Excel estilizada com um clique.</td></tr></table></td></tr>
</table></td></tr>
<tr><td style="padding:10px 40px 20px;"><table width="100%" cellpadding="0" cellspacing="0" style="background-color:#faf5ff;border:1px solid #e9d5ff;border-radius:10px;">
<tr><td style="padding:25px;"><h3 style="color:#7c3aed;font-size:16px;margin:0 0 12px;">🗺️ Primeiros Passos</h3>
<p style="color:#4b5563;font-size:14px;line-height:1.7;margin:0;"><strong>1.</strong> Acesse a plataforma com seus dados de login acima<br><strong>2.</strong> Altere sua senha temporária<br><strong>3.</strong> Complete seu perfil (foto, bio e informações acadêmicas)<br><strong>4.</strong> Crie sua primeira turma e gere o link de convite<br><strong>5.</strong> Compartilhe o link com seus alunos e comece a gerenciar!</p></td></tr></table></td></tr>
<tr><td style="padding:10px 40px 30px;"><table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f9fafb;border-radius:10px;">
<tr><td style="padding:20px;text-align:center;"><p style="color:#6b7280;font-size:14px;line-height:1.6;margin:0;">Precisa de ajuda? Entre em contato conosco:<br>📧 <a href="mailto:joaovitorcesario@hotmail.com" style="color:#6366f1;text-decoration:none;font-weight:bold;">joaovitorcesario@hotmail.com</a></p></td></tr></table></td></tr>
<tr><td style="background-color:#1e1b4b;padding:25px 40px;text-align:center;">
<p style="color:#a5b4fc;font-size:13px;margin:0 0 5px;">📚 PILHA — Gestão Ágil Acadêmica</p>
<p style="color:#6366f1;font-size:12px;margin:0 0 8px;">© 2026 PILHA · UNIPAM. Todos os direitos reservados.</p>
<p style="color:#9ca3af;font-size:11px;margin:0;">Este é um e-mail automático. Por favor, não responda diretamente a esta mensagem.</p></td></tr>
</table></td></tr></table>
</body></html>`;
      mailTransporter.sendMail({
        from: process.env.SMTP_FROM || process.env.EMAIL_FROM || "PILHA <no-reply@eusford.com>",
        to: cleanEmail,
        subject: "Bem-vindo ao PILHA — Seus dados de acesso",
        html: welcomeHtml
      }).catch(err => console.error("[EMAIL] Erro ao enviar boas-vindas professor:", err));
    }
    return res.status(201).json({ id: String(created.lastID), username, email: cleanEmail });
  });

  app.post("/api/admin/cmd", authRequired, adminOnly, async (req, res) => {
    const cmd = String(req.body?.cmd || "").trim().toLowerCase();
    if (!cmd) return res.status(400).json({ error: "Comando vazio" });

    if (cmd === "/clear alunos") {
      const students = await db.all("SELECT id, name FROM users WHERE role = 'aluno' AND is_admin = 0");
      const names = students.map((s) => s.name);
      if (names.length) {
        const placeholders = names.map(() => "?").join(",");
        await db.run(`UPDATE tasks SET assignee = 'Todos' WHERE assignee IN (${placeholders})`, names);
        await db.run(`DELETE FROM project_members WHERE member_name IN (${placeholders})`, names);
      }
      await db.run("DELETE FROM users WHERE role = 'aluno' AND is_admin = 0");
      return res.json({ ok: true, output: `Alunos removidos: ${students.length}` });
    }

    if (cmd === "/clear professores" || cmd === "/clear professor") {
      const profs = await db.all("SELECT id, name FROM users WHERE role = 'professor' AND is_admin = 0");
      const names = profs.map((p) => p.name);
      if (names.length) {
        const placeholders = names.map(() => "?").join(",");
        await db.run(`DELETE FROM project_members WHERE member_name IN (${placeholders})`, names);
      }
      await db.run("DELETE FROM users WHERE role = 'professor' AND is_admin = 0");
      return res.json({ ok: true, output: `Professores removidos: ${profs.length}` });
    }

    // /clear aluno <id>
    const matchAluno = cmd.match(/^\/clear aluno (\d+)$/);
    if (matchAluno) {
      const userId = Number(matchAluno[1]);
      const user = await db.get("SELECT id, name, role FROM users WHERE id = ? AND role = 'aluno' AND is_admin = 0", [userId]);
      if (!user) return res.status(404).json({ error: `Aluno ID ${userId} não encontrado` });
      await db.run("UPDATE tasks SET assignee = 'Todos' WHERE assignee = ?", [user.name]);
      await db.run("DELETE FROM project_members WHERE member_name = ?", [user.name]);
      await db.run("DELETE FROM users WHERE id = ?", [userId]);
      return res.json({ ok: true, output: `Aluno #${userId} (${user.name}) removido.` });
    }

    // /clear professor <id>
    const matchProf = cmd.match(/^\/clear professor (\d+)$/);
    if (matchProf) {
      const userId = Number(matchProf[1]);
      const user = await db.get("SELECT id, name, role FROM users WHERE id = ? AND role = 'professor' AND is_admin = 0", [userId]);
      if (!user) return res.status(404).json({ error: `Professor ID ${userId} não encontrado` });
      await db.run("DELETE FROM project_members WHERE member_name = ?", [user.name]);
      await db.run("DELETE FROM users WHERE id = ?", [userId]);
      return res.json({ ok: true, output: `Professor #${userId} (${user.name}) removido.` });
    }

    if (cmd === "/clear projeto" || cmd === "/clear projetos") {
      await db.exec(`
        DELETE FROM project_invites;
        DELETE FROM custom_field_values;
        DELETE FROM custom_field_definitions;
        DELETE FROM task_comments;
        DELETE FROM kanban_columns;
        DELETE FROM kanban_boards;
        DELETE FROM tasks;
        DELETE FROM project_members;
        DELETE FROM projects;
        DELETE FROM sprints;
      `);
      return res.json({ ok: true, output: "Projetos, tarefas, quadros, sprints e campos removidos." });
    }

    if (cmd === "/help") {
      return res.json({ ok: true, output: "Comandos:\n/clear alunos\n/clear professores\n/clear aluno <id>\n/clear professor <id>\n/clear projeto\n/help" });
    }

    return res.status(400).json({ error: "Comando desconhecido. Use /help" });
  });

  // ── Evaluation (professor only) ───────────────────────────────────────────

  app.get("/api/eval", authRequired, professorOnly, async (req, res) => {
    const scope = await buildVisibleScope(db, req.user);
    const ids = [...scope.projectIds];
    if (ids.length === 0) return res.json({ activities: [], activityScores: [], individual: [], meta: [], memberPhotos: {} });
    const ph = ids.map(() => "?").join(",");
    const activities    = await evalDb.all(`SELECT * FROM eval_activities WHERE project_id IN (${ph}) ORDER BY project_id, section, id`, ids);
    const actIds        = activities.map(a => a.id);
    const activityScores = actIds.length
      ? await evalDb.all(`SELECT * FROM eval_activity_scores WHERE activity_id IN (${actIds.map(() => "?").join(",")})`, actIds)
      : [];
    const individual = await evalDb.all(`SELECT * FROM eval_individual WHERE project_id IN (${ph})`, ids);
    const meta       = await evalDb.all(`SELECT * FROM eval_meta WHERE project_id IN (${ph})`, ids);
    const photoRows  = await db.all("SELECT name, photo FROM users WHERE photo IS NOT NULL AND photo != ''");
    const memberPhotos = {};
    for (const row of photoRows) memberPhotos[row.name] = row.photo;
    return res.json({ activities, activityScores, individual, meta, memberPhotos });
  });

  app.post("/api/eval/:projectId/activities", authRequired, professorOnly, async (req, res) => {
    const projectId = Number(req.params.projectId);
    const { section, name, max_pts } = req.body || {};
    if (!["planejamento", "desenvolvimento"].includes(section)) return res.status(400).json({ error: "Seção inválida" });
    if (!name || !String(name).trim()) return res.status(400).json({ error: "Nome obrigatório" });
    if (!req.user.isAdmin && !await professorOwnsProject(db, req.user.id, projectId))
      return res.status(403).json({ error: "Sem permissão" });
    const maxPts = Math.max(0, Number(max_pts) || 0);
    const created = await evalDb.run(
      "INSERT INTO eval_activities (project_id, section, name, max_pts, score) VALUES (?, ?, ?, ?, 0)",
      [projectId, section, String(name).trim(), maxPts]
    );
    return res.status(201).json({ id: String(created.lastID) });
  });

  app.patch("/api/eval/activities/:actId", authRequired, professorOnly, async (req, res) => {
    const { name, max_pts } = req.body || {};
    const act = await evalDb.get("SELECT id, project_id FROM eval_activities WHERE id = ?", [req.params.actId]);
    if (!act) return res.status(404).json({ error: "Atividade não encontrada" });
    if (!req.user.isAdmin && !await professorOwnsProject(db, req.user.id, act.project_id))
      return res.status(403).json({ error: "Sem permissão" });
    if (name !== undefined) await evalDb.run("UPDATE eval_activities SET name = ? WHERE id = ?", [String(name).trim(), req.params.actId]);
    if (max_pts !== undefined) await evalDb.run("UPDATE eval_activities SET max_pts = ? WHERE id = ?", [Math.max(0, Number(max_pts) || 0), req.params.actId]);
    return res.json({ ok: true });
  });

  app.patch("/api/eval/activities/:actId/scores", authRequired, professorOnly, async (req, res) => {
    const { member_name, score } = req.body || {};
    if (!member_name) return res.status(400).json({ error: "member_name obrigatório" });
    const actId = Number(req.params.actId);
    const _actOwn = await evalDb.get("SELECT project_id FROM eval_activities WHERE id = ?", [actId]);
    if (!_actOwn) return res.status(404).json({ error: "Atividade não encontrada" });
    if (!req.user.isAdmin && !await professorOwnsProject(db, req.user.id, _actOwn.project_id))
      return res.status(403).json({ error: "Sem permissão" });
    const cleanScore = Math.max(0, Number(score) || 0);
    const existing = await evalDb.get("SELECT activity_id FROM eval_activity_scores WHERE activity_id = ? AND member_name = ?", [actId, member_name]);
    if (!existing) {
      await evalDb.run("INSERT INTO eval_activity_scores (activity_id, member_name, score) VALUES (?, ?, ?)", [actId, member_name, cleanScore]);
    } else {
      await evalDb.run("UPDATE eval_activity_scores SET score = ? WHERE activity_id = ? AND member_name = ?", [cleanScore, actId, member_name]);
    }
    return res.json({ ok: true });
  });

  app.delete("/api/eval/activities/:actId", authRequired, professorOnly, async (req, res) => {
    const _actDel = await evalDb.get("SELECT project_id FROM eval_activities WHERE id = ?", [req.params.actId]);
    if (!_actDel) return res.status(404).json({ error: "Atividade não encontrada" });
    if (!req.user.isAdmin && !await professorOwnsProject(db, req.user.id, _actDel.project_id))
      return res.status(403).json({ error: "Sem permissão" });
    await evalDb.run("DELETE FROM eval_activities WHERE id = ?", [req.params.actId]);
    return res.json({ ok: true });
  });

  app.patch("/api/eval/:projectId/meta", authRequired, professorOnly, async (req, res) => {
    const projectId = Number(req.params.projectId);
    if (!req.user.isAdmin && !await professorOwnsProject(db, req.user.id, projectId))
      return res.status(403).json({ error: "Sem permissão" });
    const { entrega_score, observacoes } = req.body || {};
    const existing = await evalDb.get("SELECT project_id FROM eval_meta WHERE project_id = ?", [projectId]);
    if (!existing) {
      await evalDb.run("INSERT INTO eval_meta (project_id, entrega_score, observacoes) VALUES (?, ?, ?)",
        [projectId, Number(entrega_score) || 0, String(observacoes || "")]);
    } else {
      const updates = [];
      const params = [];
      if (entrega_score !== undefined) { updates.push("entrega_score = ?"); params.push(Math.min(7, Math.max(0, Number(entrega_score) || 0))); }
      if (observacoes !== undefined) { updates.push("observacoes = ?"); params.push(String(observacoes)); }
      if (updates.length) {
        params.push(projectId);
        await evalDb.run(`UPDATE eval_meta SET ${updates.join(", ")} WHERE project_id = ?`, params);
      }
    }
    return res.json({ ok: true });
  });

  app.patch("/api/eval/:projectId/individual", authRequired, professorOnly, async (req, res) => {
    const projectId = Number(req.params.projectId);
    // Checar ownership ANTES de qualquer escrita
    if (!req.user.isAdmin && !await professorOwnsProject(db, req.user.id, projectId))
      return res.status(403).json({ error: "Você não é o professor responsável por este projeto" });
    const { member_name, score, entrega_score, observacao } = req.body || {};
    if (!member_name) return res.status(400).json({ error: "member_name obrigatório" });
    // garante a linha
    const existing = await evalDb.get("SELECT project_id FROM eval_individual WHERE project_id = ? AND member_name = ?", [projectId, member_name]);
    if (!existing) {
      await evalDb.run("INSERT INTO eval_individual (project_id, member_name, score) VALUES (?, ?, 0)", [projectId, member_name]);
    }
    const sets = [];
    const params = [];
    if (score !== undefined) { sets.push("score = ?"); params.push(Math.max(0, Number(score) || 0)); }
    if (entrega_score !== undefined) { sets.push("entrega_score = ?"); params.push(Math.min(7, Math.max(0, Number(entrega_score) || 0))); }
    if (observacao !== undefined) { sets.push("observacao = ?"); params.push(String(observacao)); }
    if (sets.length) {
      params.push(projectId, member_name);
      await evalDb.run(`UPDATE eval_individual SET ${sets.join(", ")} WHERE project_id = ? AND member_name = ?`, params);
    }
    return res.json({ ok: true });
  });

  // ── Routing ───────────────────────────────────────────────────────────────

  // ── Super Admin: visualizador de código e banco ──────────────────────────
  const fsAsync = require("fs").promises;
  const SUPERADM_FILES = [
    "server.js", "app.js", "index.html", "styles.css",
    "db.js", "package.json", ".env.example", "landing.html"
  ];

  app.get("/api/superadmin/files", authRequired, superAdminOnly, async (_req, res) => {
    const results = [];
    for (const filename of SUPERADM_FILES) {
      try {
        const content = await fsAsync.readFile(path.join(__dirname, filename), "utf8");
        results.push({ name: filename, content, lines: content.split("\n").length });
      } catch (_) {
        results.push({ name: filename, content: "(arquivo não encontrado)", lines: 0 });
      }
    }
    res.json({ files: results });
  });

  app.get("/api/superadmin/db", authRequired, superAdminOnly, async (_req, res) => {
    const tables = await db.all(
      "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name"
    );
    const result = [];
    for (const t of tables) {
      const count = await db.get(`SELECT COUNT(*) as n FROM "${t.name}"`);
      result.push({ name: t.name, count: count.n });
    }
    res.json({ tables: result });
  });

  app.get("/api/superadmin/logs", authRequired, superAdminOnly, async (_req, res) => {
    const logs = await db.all(
      "SELECT * FROM access_logs ORDER BY logged_at DESC LIMIT 500"
    );
    res.json({ logs });
  });

  app.get("/api/superadmin/db/:table", authRequired, superAdminOnly, async (req, res) => {
    const tableName = req.params.table.replace(/[^a-zA-Z0-9_]/g, "");
    const exists = await db.get(
      "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name = ?", [tableName]
    );
    if (!exists) return res.status(404).json({ error: "Tabela não encontrada" });
    const rows = await db.all(`SELECT * FROM "${tableName}" LIMIT 500`);
    res.json({ rows });
  });

  app.get("/landing-page", (_req, res) => res.redirect("/"));
  app.get("/cadastro", (_req, res) => res.sendFile(path.join(__dirname, "cadastro.html")));
  app.get("/app", (_req, res) => serveApp(res));

  // ── Anexos de tarefa ─────────────────────────────────────────────────────
  app.post("/api/tasks/:id/attachments", authRequired, upload.single("file"), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Arquivo inválido ou muito grande (máx 80MB)" });
    const taskId = Number(req.params.id);
    const scope = await buildVisibleScope(db, req.user);
    const task = await db.get("SELECT project_id FROM tasks WHERE id = ?", [taskId]);
    if (!task || !scope.projectIds.has(task.project_id)) {
      // Remover arquivo órfão salvo pelo multer antes da verificação de permissão
      fs.unlink(req.file.path, () => {});
      return res.status(403).json({ error: "Sem permissão" });
    }
    const r = await db.run(
      "INSERT INTO task_attachments (task_id, filename, original_name, mime_type, size, uploaded_by, uploaded_by_user_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [taskId, req.file.filename, req.file.originalname, req.file.mimetype, req.file.size, req.user.name, req.user.id]
    );
    await logTaskAudit(db, taskId, req.user.name, "anexo", null, req.file.originalname);
    return res.status(201).json({ id: r.lastID, filename: req.file.filename, originalName: req.file.originalname, mimeType: req.file.mimetype, size: req.file.size, uploadedBy: req.user.name });
  });

  app.get("/api/tasks/:id/attachments", authRequired, async (req, res) => {
    const taskId = Number(req.params.id);
    const scope = await buildVisibleScope(db, req.user);
    const task = await db.get("SELECT project_id FROM tasks WHERE id = ?", [taskId]);
    if (!task || !scope.projectIds.has(task.project_id)) return res.status(403).json({ error: "Sem permissão" });
    const rows = await db.all("SELECT * FROM task_attachments WHERE task_id = ? ORDER BY created_at ASC", [taskId]);
    return res.json(rows);
  });

  app.get("/api/tasks/:id/attachments/:aid/download", authRequired, async (req, res) => {
    const taskId = Number(req.params.id);
    const scope = await buildVisibleScope(db, req.user);
    const task = await db.get("SELECT project_id FROM tasks WHERE id = ?", [taskId]);
    if (!task || !scope.projectIds.has(task.project_id)) return res.status(403).json({ error: "Sem permissão" });
    const att = await db.get("SELECT * FROM task_attachments WHERE id = ? AND task_id = ?", [req.params.aid, taskId]);
    if (!att) return res.status(404).json({ error: "Arquivo não encontrado" });
    if (path.basename(att.filename) !== att.filename) {
      return res.status(400).json({ error: "Nome de arquivo inválido" });
    }
    const filePath = path.join(UPLOAD_DIR, att.filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Arquivo removido do servidor" });
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(att.original_name)}"`);
    res.setHeader("Content-Type", att.mime_type);
    const stream = fs.createReadStream(filePath);
    stream.on("error", (streamErr) => {
      if (!res.headersSent) {
        console.error("[DOWNLOAD] stream error", streamErr.code, att.filename);
        res.status(streamErr.code === "ENOENT" ? 404 : 500).json({ error: "Erro ao baixar arquivo" });
      }
    });
    stream.pipe(res);
  });

  app.delete("/api/tasks/:id/attachments/:aid", authRequired, async (req, res) => {
    const taskId = Number(req.params.id);
    const scope = await buildVisibleScope(db, req.user);
    const task = await db.get("SELECT project_id FROM tasks WHERE id = ?", [taskId]);
    if (!task || !scope.projectIds.has(task.project_id)) return res.status(403).json({ error: "Sem permissão" });
    const att = await db.get("SELECT * FROM task_attachments WHERE id = ? AND task_id = ?", [req.params.aid, taskId]);
    if (!att) return res.status(404).json({ error: "Não encontrado" });
    const filePath = path.join(UPLOAD_DIR, att.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    await db.run("DELETE FROM task_attachments WHERE id = ?", [att.id]);
    await logTaskAudit(db, taskId, req.user.name, "anexo_removido", att.original_name, null);
    return res.json({ ok: true });
  });

  // ── Auditoria de tarefa ───────────────────────────────────────────────────
  app.get("/api/tasks/:id/audit", authRequired, async (req, res) => {
    const taskId = Number(req.params.id);
    const scope = await buildVisibleScope(db, req.user);
    const task = await db.get("SELECT project_id FROM tasks WHERE id = ?", [taskId]);
    if (!task || !scope.projectIds.has(task.project_id)) return res.status(403).json({ error: "Sem permissão" });
    const rows = await db.all("SELECT * FROM task_audit WHERE task_id = ? ORDER BY created_at ASC", [taskId]);
    return res.json(rows);
  });

  // ── Chat do documento (TAP/PI) ────────────────────────────────────────────
  app.get("/api/projects/:id/docs/:type/comments", authRequired, async (req, res) => {
    const type = req.params.type;
    if (!["tap","pi"].includes(type)) return res.status(400).json({ error: "Tipo inválido" });
    const scope = await buildVisibleScope(db, req.user);
    if (!scope.projectIds.has(Number(req.params.id))) return res.status(403).json({ error: "Sem permissão" });
    const rows = await db.all(
      "SELECT * FROM doc_comments WHERE project_id = ? AND doc_type = ? ORDER BY created_at ASC",
      [req.params.id, type]
    );
    return res.json(rows);
  });

  app.post("/api/projects/:id/docs/:type/comments", authRequired, async (req, res) => {
    const type = req.params.type;
    if (!["tap","pi"].includes(type)) return res.status(400).json({ error: "Tipo inválido" });
    const scope = await buildVisibleScope(db, req.user);
    const projectId = Number(req.params.id);
    if (!scope.projectIds.has(projectId)) return res.status(403).json({ error: "Sem permissão" });
    const content = sanitize(String(req.body?.content || "").trim(), 1000);
    if (!content) return res.status(400).json({ error: "Conteúdo obrigatório" });
    const r = await db.run(
      "INSERT INTO doc_comments (project_id, doc_type, user_id, user_name, content) VALUES (?,?,?,?,?)",
      [projectId, type, req.user.id, req.user.name, content]
    );
    const msg = { id: r.lastID, project_id: projectId, doc_type: type, user_id: req.user.id, user_name: req.user.name, content, created_at: new Date().toISOString() };
    // Emite via socket.io para todos conectados ao projeto
    if (app._io) app._io.to(`project:${projectId}`).emit("doc-comment", msg);
    return res.status(201).json(msg);
  });

  app.delete("/api/projects/:id/docs/:type/comments/:cid", authRequired, async (req, res) => {
    const scope = await buildVisibleScope(db, req.user);
    if (!scope.projectIds.has(Number(req.params.id))) return res.status(403).json({ error: "Sem permissão" });
    const row = await db.get("SELECT * FROM doc_comments WHERE id = ?", [req.params.cid]);
    if (!row) return res.status(404).json({ error: "Não encontrado" });
    const isProf = req.user.isAdmin || req.user.role === "professor";
    if (row.user_id !== req.user.id && !isProf) return res.status(403).json({ error: "Sem permissão" });
    await db.run("DELETE FROM doc_comments WHERE id = ?", [req.params.cid]);
    return res.json({ ok: true });
  });

  // ── Aprovação de documentos (submit / approve / reject) ───────────────────
  app.post("/api/projects/:id/docs/:type/submit", authRequired, async (req, res) => {
    const type = req.params.type;
    if (!["tap","pi"].includes(type)) return res.status(400).json({ error: "Tipo inválido" });
    const projectId = Number(req.params.id);
    const scope = await buildVisibleScope(db, req.user);
    if (!scope.projectIds.has(projectId)) return res.status(403).json({ error: "Sem permissão" });
    // Somente PO ou professor pode submeter
    const isPO = await db.get(
      `SELECT 1 FROM project_members WHERE project_id = ? AND scrum_role = 'Product Owner'
       AND (user_id = ? OR (user_id IS NULL AND member_name = ?
       AND (SELECT COUNT(*) FROM users u2 WHERE u2.name = member_name) = 1))`,
      [projectId, req.user.id, req.user.name]
    );
    if (!isPO && req.user.role !== "professor" && !req.user.isAdmin) return res.status(403).json({ error: "Somente o Product Owner pode submeter o documento" });
    await db.run(
      "INSERT INTO project_docs (project_id,doc_type,content,approval_status) VALUES (?,?,?,?) ON CONFLICT(project_id,doc_type) DO UPDATE SET approval_status='submitted', rejected_reason=NULL, approved_by=NULL, approved_at=NULL",
      [projectId, type, "{}", "submitted"]
    );
    if (app._io) app._io.to(`project:${projectId}`).emit("doc-status", { projectId, type, status: "submitted" });
    return res.json({ ok: true, status: "submitted" });
  });

  app.post("/api/projects/:id/docs/:type/approve", authRequired, async (req, res) => {
    const type = req.params.type;
    if (!["tap","pi"].includes(type)) return res.status(400).json({ error: "Tipo inválido" });
    if (req.user.role !== "professor" && !req.user.isAdmin) return res.status(403).json({ error: "Somente professor pode aprovar" });
    const projectId = Number(req.params.id);
    if (!req.user.isAdmin && !await professorOwnsProject(db, req.user.id, projectId))
      return res.status(403).json({ error: "Você não é o professor responsável por este projeto" });
    await db.run(
      "UPDATE project_docs SET approval_status='approved', approved_by=?, approved_at=?, rejected_reason=NULL WHERE project_id=? AND doc_type=?",
      [req.user.name, new Date().toISOString(), projectId, type]
    );
    if (app._io) app._io.to(`project:${projectId}`).emit("doc-status", { projectId, type, status: "approved", approvedBy: req.user.name });
    return res.json({ ok: true, status: "approved" });
  });

  app.post("/api/projects/:id/docs/:type/reject", authRequired, async (req, res) => {
    const type = req.params.type;
    if (!["tap","pi"].includes(type)) return res.status(400).json({ error: "Tipo inválido" });
    if (req.user.role !== "professor" && !req.user.isAdmin) return res.status(403).json({ error: "Somente professor pode rejeitar" });
    const projectId = Number(req.params.id);
    if (!req.user.isAdmin && !await professorOwnsProject(db, req.user.id, projectId))
      return res.status(403).json({ error: "Você não é o professor responsável por este projeto" });
    const reason = sanitize(String(req.body?.reason || "").trim(), 500);
    await db.run(
      "UPDATE project_docs SET approval_status='rejected', rejected_reason=?, approved_by=NULL, approved_at=NULL WHERE project_id=? AND doc_type=?",
      [reason || "Sem justificativa", projectId, type]
    );
    if (app._io) app._io.to(`project:${projectId}`).emit("doc-status", { projectId, type, status: "rejected", reason });
    return res.json({ ok: true, status: "rejected" });
  });

  // ── Permissões de documento por turma ────────────────────────────────────
  app.get("/api/docs/permissions", authRequired, async (req, res) => {
    // Admin: vê tudo. Professor: vê apenas suas turmas. Aluno: 403.
    if (!req.user.isAdmin && req.user.role !== "professor")
      return res.status(403).json({ error: "Sem permissão" });
    let rows;
    if (req.user.isAdmin) {
      rows = await db.all("SELECT dp.*, t.turma, t.curso, t.periodo FROM doc_permissions dp JOIN turmas t ON t.id = dp.turma_id");
    } else {
      rows = await db.all(
        "SELECT dp.*, t.turma, t.curso, t.periodo FROM doc_permissions dp JOIN turmas t ON t.id = dp.turma_id WHERE t.professor_id = ?",
        [req.user.id]
      );
    }
    return res.json(rows);
  });

  app.post("/api/docs/permissions/:turmaId/:type", authRequired, async (req, res) => {
    if (req.user.role !== "professor" && !req.user.isAdmin) return res.status(403).json({ error: "Sem permissão" });
    const type = req.params.type;
    if (!["tap","pi"].includes(type)) return res.status(400).json({ error: "Tipo inválido" });
    const turmaId = Number(req.params.turmaId);
    // Professor só pode liberar turmas que ele mesmo criou
    if (!req.user.isAdmin) {
      const ownsTurma = await db.get("SELECT 1 FROM turmas WHERE id = ? AND professor_id = ?", [turmaId, req.user.id]);
      if (!ownsTurma) return res.status(403).json({ error: "Você não é responsável por esta turma" });
    }
    await db.run("INSERT OR IGNORE INTO doc_permissions (turma_id,doc_type,released_by) VALUES (?,?,?)", [turmaId, type, req.user.id]);
    return res.json({ ok: true });
  });

  app.delete("/api/docs/permissions/:turmaId/:type", authRequired, async (req, res) => {
    if (req.user.role !== "professor" && !req.user.isAdmin) return res.status(403).json({ error: "Sem permissão" });
    const type = req.params.type;
    if (!["tap","pi"].includes(type)) return res.status(400).json({ error: "Tipo inválido" });
    const turmaId = Number(req.params.turmaId);
    // Professor só pode bloquear turmas que ele mesmo criou
    if (!req.user.isAdmin) {
      const ownsTurma = await db.get("SELECT 1 FROM turmas WHERE id = ? AND professor_id = ?", [turmaId, req.user.id]);
      if (!ownsTurma) return res.status(403).json({ error: "Você não é responsável por esta turma" });
    }
    await db.run("DELETE FROM doc_permissions WHERE turma_id=? AND doc_type=?", [turmaId, type]);
    return res.json({ ok: true });
  });

  // ── Chat do projeto (privado) ─────────────────────────────────────────────
  app.get("/api/projects/:id/messages", authRequired, async (req, res) => {
    const projectId = Number(req.params.id);
    const scope = await buildVisibleScope(db, req.user);
    if (!scope.projectIds.has(projectId)) return res.status(403).json({ error: "Sem permissão" });
    const rows = await db.all(
      "SELECT id, sender_name, content, created_at FROM project_messages WHERE project_id = ? ORDER BY created_at ASC LIMIT 200",
      [projectId]
    );
    return res.json(rows);
  });

  app.post("/api/projects/:id/messages", authRequired, async (req, res) => {
    const projectId = Number(req.params.id);
    const scope = await buildVisibleScope(db, req.user);
    if (!scope.projectIds.has(projectId)) return res.status(403).json({ error: "Sem permissão" });
    const content = sanitize(String(req.body?.content || "").trim(), 2000);
    if (!content) return res.status(400).json({ error: "Mensagem vazia" });
    const r = await db.run(
      "INSERT INTO project_messages (project_id, sender_id, sender_name, content) VALUES (?,?,?,?)",
      [projectId, req.user.id, req.user.name, content]
    );
    const msg = { id: r.lastID, sender_name: req.user.name, content, created_at: new Date().toISOString() };
    if (app._io) app._io.to(`project:${projectId}`).emit("project-message", { projectId, msg });
    return res.status(201).json(msg);
  });

  // ════════════════════════════════════════════════════════════════════════
  //  INTEGRAÇÃO GITHUB (primeira versão — base segura)
  // ════════════════════════════════════════════════════════════════════════

  // Processa eventos relevantes para popular integração/repos (best-effort)
  async function _processGithubEvent(eventType, body) {
    if (eventType !== "installation" && eventType !== "installation_repositories") return;
    const inst = body.installation;
    if (!inst || !inst.id) return;
    const acct = inst.account || {};
    const status = body.action === "deleted" ? "removed" : (body.action === "suspend" ? "suspended" : "active");
    await db.run(
      `INSERT INTO github_integrations (installation_id, github_account_login, github_account_id, status, updated_at)
       VALUES (?,?,?,?,datetime('now'))
       ON CONFLICT(installation_id) DO UPDATE SET github_account_login=excluded.github_account_login,
         github_account_id=excluded.github_account_id, status=excluded.status, updated_at=datetime('now')`,
      [inst.id, acct.login || null, acct.id || null, status]
    );
    const integ = await db.get("SELECT id, user_id FROM github_integrations WHERE installation_id = ?", [inst.id]);
    if (!integ) return;
    // Se a integração já está vinculada a um usuário, registra o login do GitHub dele
    if (integ.user_id && acct.login) {
      await db.run("UPDATE users SET github_login = ? WHERE id = ? AND (github_login IS NULL OR github_login = '')",
        [acct.login, integ.user_id]);
    }
    const reposAdd = body.repositories || body.repositories_added || [];
    for (const r of reposAdd) {
      const [owner, name] = String(r.full_name || "/").split("/");
      await db.run(
        `INSERT INTO github_repositories (integration_id, github_repo_id, owner, name, full_name, private, html_url, updated_at)
         VALUES (?,?,?,?,?,?,?,datetime('now'))
         ON CONFLICT(integration_id, github_repo_id) DO UPDATE SET full_name=excluded.full_name,
           private=excluded.private, updated_at=datetime('now')`,
        [integ.id, r.id || null, owner || null, name || null, r.full_name || null, r.private ? 1 : 0,
         r.html_url || (r.full_name ? `https://github.com/${r.full_name}` : null)]
      );
    }
    for (const r of (body.repositories_removed || [])) {
      await db.run("DELETE FROM github_repositories WHERE integration_id = ? AND github_repo_id = ?", [integ.id, r.id]);
    }
  }

  // Webhook — recebe eventos do GitHub (SEM auth; validado por assinatura HMAC)
  app.post("/api/integrations/github/webhook", async (req, res) => {
    const secret = process.env.GITHUB_WEBHOOK_SECRET;
    if (!secret) return res.status(503).json({ error: "Webhook GitHub não configurado" });
    const signature = req.headers["x-hub-signature-256"];
    const delivery = req.headers["x-github-delivery"];
    const eventType = req.headers["x-github-event"];
    const raw = req.rawBody;
    if (!signature || !raw || !Buffer.isBuffer(raw)) return res.status(401).json({ error: "Assinatura ou corpo ausente" });
    const expected = "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");
    const sigBuf = Buffer.from(String(signature));
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return res.status(401).json({ error: "Assinatura inválida" });
    }
    // Dedup por X-GitHub-Delivery
    if (delivery) {
      const dup = await db.get("SELECT id FROM github_webhook_events WHERE github_delivery_id = ?", [delivery]);
      if (dup) return res.status(200).json({ ok: true, duplicate: true });
    }
    const body = req.body || {};
    const action = body.action || null;
    const repoFull = (body.repository && body.repository.full_name) || null;
    try {
      await db.run(
        `INSERT INTO github_webhook_events (github_delivery_id, event_type, action, repository_full_name, payload_json, processed, processed_at)
         VALUES (?,?,?,?,?,1,datetime('now'))`,
        [delivery || null, eventType || null, action, repoFull, JSON.stringify(body)]
      );
    } catch (e) {
      if (String(e.message).includes("UNIQUE")) return res.status(200).json({ ok: true, duplicate: true });
      throw e;
    }
    try { await _processGithubEvent(eventType, body); } catch (e) { console.warn("[github webhook] process:", e.message); }
    return res.status(200).json({ ok: true });
  });

  // Iniciar conexão — retorna a URL de instalação do GitHub App
  app.get("/api/integrations/github/connect", authRequired, async (req, res) => {
    const slug = process.env.GITHUB_APP_SLUG;
    if (!slug) return res.status(503).json({ error: "GitHub App não configurado (defina GITHUB_APP_SLUG no .env)" });
    const state = jwt.sign({ uid: req.user.id, t: "gh-connect" }, JWT_SECRET, { expiresIn: "15m" });
    return res.json({ installUrl: `https://github.com/apps/${encodeURIComponent(slug)}/installations/new?state=${state}` });
  });

  // Callback da instalação (redirect do GitHub no navegador)
  app.get("/integrations/github/callback", async (req, res) => {
    const installationId = req.query.installation_id;
    let userId = null;
    try { const d = jwt.verify(String(req.query.state || ""), JWT_SECRET); if (d.t === "gh-connect") userId = d.uid; } catch (_) {}
    if (!userId) { try { const tok = req.cookies[TOKEN_COOKIE]; if (tok) userId = jwt.verify(tok, JWT_SECRET).id; } catch (_) {} }
    if (installationId && userId) {
      await db.run(
        `INSERT INTO github_integrations (installation_id, user_id, status, updated_at)
         VALUES (?,?, 'active', datetime('now'))
         ON CONFLICT(installation_id) DO UPDATE SET user_id=excluded.user_id, status='active', updated_at=datetime('now')`,
        [installationId, userId]
      );
      // Vincula o login do GitHub ao usuário (para atribuir as estatísticas)
      const integ = await db.get("SELECT github_account_login FROM github_integrations WHERE installation_id = ?", [installationId]);
      if (integ && integ.github_account_login) {
        await db.run("UPDATE users SET github_login = ? WHERE id = ? AND (github_login IS NULL OR github_login = '')",
          [integ.github_account_login, userId]);
      }
      return res.redirect("/integracoes?connected=1");
    }
    return res.redirect("/integracoes?error=callback");
  });

  // Status da integração do usuário logado
  app.get("/api/integrations/github", authRequired, async (req, res) => {
    const integ = await db.get(
      "SELECT id, github_account_login, installation_id, status, created_at FROM github_integrations WHERE user_id = ? ORDER BY id DESC LIMIT 1",
      [req.user.id]
    );
    const configured = Boolean(process.env.GITHUB_APP_SLUG && process.env.GITHUB_WEBHOOK_SECRET);
    if (!integ) return res.json({ connected: false, configured });
    return res.json({ connected: integ.status === "active", configured, account: integ.github_account_login, installationId: integ.installation_id, status: integ.status });
  });

  // Repositórios disponíveis na integração do usuário
  app.get("/api/integrations/github/repositories", authRequired, async (req, res) => {
    const integ = await db.get("SELECT id FROM github_integrations WHERE user_id = ? ORDER BY id DESC LIMIT 1", [req.user.id]);
    if (!integ) return res.json([]);
    const repos = await db.all(
      "SELECT id, github_repo_id, owner, name, full_name, private, default_branch, html_url FROM github_repositories WHERE integration_id = ? ORDER BY full_name",
      [integ.id]
    );
    return res.json(repos.map((r) => ({ ...r, private: !!r.private })));
  });

  // Vincular um repositório a um projeto
  app.post("/api/integrations/github/projects/:projectId/link", authRequired, async (req, res) => {
    const projectId = Number(req.params.projectId);
    const { githubRepositoryId } = req.body || {};
    const scope = await buildVisibleScope(db, req.user);
    if (!scope.projectIds.has(projectId)) return res.status(403).json({ error: "Sem permissão neste projeto" });
    const repo = await db.get("SELECT id FROM github_repositories WHERE id = ?", [githubRepositoryId]);
    if (!repo) return res.status(404).json({ error: "Repositório não encontrado" });

    const isStaff = req.user.role === "professor" || req.user.isAdmin;
    // Aluno só pode vincular UMA vez por projeto — depois é necessário o professor desvincular
    if (!isStaff) {
      const existing = await db.get(
        "SELECT id FROM project_github_repositories WHERE project_id = ? AND linked_by_user_id = ? AND is_active = 1",
        [projectId, req.user.id]
      );
      if (existing) {
        return res.status(409).json({ error: "Você já vinculou um repositório a este projeto. Para alterar, peça ao professor para desvincular." });
      }
    }
    await db.run(
      `INSERT INTO project_github_repositories (project_id, github_repository_id, linked_by_user_id, is_active, updated_at)
       VALUES (?,?,?,1,datetime('now'))
       ON CONFLICT(project_id, github_repository_id) DO UPDATE SET is_active=1, linked_by_user_id=excluded.linked_by_user_id, updated_at=datetime('now')`,
      [projectId, githubRepositoryId, req.user.id]
    );
    return res.json({ ok: true });
  });

  // Lista os vínculos repo↔projeto (com quem vinculou) — para a UI saber o estado
  app.get("/api/integrations/github/links", authRequired, async (req, res) => {
    const scope = await buildVisibleScope(db, req.user);
    const ids = Array.from(scope.projectIds);
    if (!ids.length) return res.json([]);
    const ph = ids.map(() => "?").join(",");
    const rows = await db.all(
      `SELECT pgr.id, pgr.project_id, pgr.linked_by_user_id, pgr.is_active,
              r.full_name AS repo_full_name, p.name AS project_name, u.name AS linked_by_name
         FROM project_github_repositories pgr
         JOIN github_repositories r ON r.id = pgr.github_repository_id
         JOIN projects p ON p.id = pgr.project_id
         LEFT JOIN users u ON u.id = pgr.linked_by_user_id
        WHERE pgr.is_active = 1 AND pgr.project_id IN (${ph})
        ORDER BY p.name`,
      ids
    );
    return res.json(rows.map(r => ({
      id: r.id, projectId: r.project_id, projectName: r.project_name,
      repoFullName: r.repo_full_name, linkedByUserId: r.linked_by_user_id, linkedByName: r.linked_by_name,
      isMine: r.linked_by_user_id === req.user.id,
    })));
  });

  // Desvincular repo↔projeto — APENAS professor/ADM
  app.delete("/api/integrations/github/links/:linkId", authRequired, async (req, res) => {
    if (req.user.role !== "professor" && !req.user.isAdmin) {
      return res.status(403).json({ error: "Apenas professores e administradores podem desvincular." });
    }
    const link = await db.get("SELECT pgr.id, pgr.project_id FROM project_github_repositories pgr WHERE pgr.id = ?", [req.params.linkId]);
    if (!link) return res.status(404).json({ error: "Vínculo não encontrado" });
    const scope = await buildVisibleScope(db, req.user);
    if (!scope.projectIds.has(link.project_id)) return res.status(403).json({ error: "Sem permissão neste projeto" });
    await db.run("DELETE FROM project_github_repositories WHERE id = ?", [req.params.linkId]);
    return res.json({ ok: true });
  });

  // Últimos eventos recebidos (admin vê todos; usuário vê os dos seus repositórios)
  app.get("/api/integrations/github/events", authRequired, async (req, res) => {
    let rows;
    if (req.user.isAdmin) {
      rows = await db.all("SELECT id, github_delivery_id, event_type, action, repository_full_name, processed, created_at FROM github_webhook_events ORDER BY id DESC LIMIT 30");
    } else {
      const integ = await db.get("SELECT id FROM github_integrations WHERE user_id = ? ORDER BY id DESC LIMIT 1", [req.user.id]);
      if (!integ) return res.json([]);
      rows = await db.all(
        `SELECT id, github_delivery_id, event_type, action, repository_full_name, processed, created_at
         FROM github_webhook_events
         WHERE repository_full_name IN (SELECT full_name FROM github_repositories WHERE integration_id = ?)
         ORDER BY id DESC LIMIT 30`,
        [integ.id]
      );
    }
    return res.json(rows);
  });

  // Agrega commits e PRs a partir dos eventos de webhook armazenados (fallback sem GitHub App)
  async function _statsFromWebhookEvents(login, since) {
    const loginLower = login.toLowerCase();
    const events = await db.all(
      `SELECT event_type, payload_json FROM github_webhook_events
       WHERE event_type IN ('push','pull_request') AND datetime(created_at) >= datetime(?)`,
      [since]
    );
    let commits = 0, prsOpened = 0, prsMerged = 0;
    for (const ev of events) {
      let body;
      try { body = JSON.parse(ev.payload_json); } catch (_) { continue; }
      if (ev.event_type === "push") {
        const sender = (body.sender?.login || body.pusher?.name || "").toLowerCase();
        if (sender !== loginLower) continue;
        commits += (Array.isArray(body.commits) ? body.commits : []).length;
      } else if (ev.event_type === "pull_request") {
        const prLogin = (body.pull_request?.user?.login || "").toLowerCase();
        if (prLogin !== loginLower) continue;
        if (body.action === "opened") prsOpened += 1;
        if (body.action === "closed" && body.pull_request?.merged === true) prsMerged += 1;
      }
    }
    return { commits, prsOpened, prsMerged };
  }

  // Calcula as contribuições GitHub de um usuário (mês atual) somando todos os
  // repositórios vinculados aos projetos onde ele participa.
  async function computeUserGithubStats(user) {
    const { since, period } = currentMonthRange();
    const login = user.github_login;
    const monthStart = new Date(since).getTime();

    // Tarefas concluídas no PILHA (sempre disponível, independe do GitHub)
    const taskRow = await db.get(
      "SELECT COUNT(*) AS n FROM tasks WHERE assignee = ? AND status IN ('concluido','done')",
      [user.name]
    );

    const result = {
      period, githubLogin: login || null, userName: user.name,
      commits: 0, prsOpened: 0, prsMerged: 0, reviews: 0,
      tasksDone: taskRow ? taskRow.n : 0, filesChanged: 0, linesAdded: 0, linesRemoved: 0,
      repos: [], githubError: null,
      githubConfigured: Boolean(process.env.GITHUB_APP_ID && process.env.GITHUB_PRIVATE_KEY),
    };
    if (!login) { result.githubError = "sem_login"; return result; }
    if (!result.githubConfigured) {
      result.githubError = "app_nao_configurado";
      try {
        const wh = await _statsFromWebhookEvents(login, since);
        result.commits = wh.commits;
        result.prsOpened = wh.prsOpened;
        result.prsMerged = wh.prsMerged;
        result.githubSource = "webhook_events";
      } catch (_) {}
      return result;
    }

    // Repositórios vinculados a projetos onde o usuário é membro OU que ele mesmo vinculou
    const repos = await db.all(
      `SELECT DISTINCT r.owner, r.name, r.full_name, gi.installation_id
         FROM project_github_repositories pgr
         JOIN github_repositories r ON r.id = pgr.github_repository_id
         JOIN github_integrations gi ON gi.id = r.integration_id
        WHERE pgr.is_active = 1
          AND (
            pgr.linked_by_user_id = ?
            OR pgr.project_id IN (
              SELECT project_id FROM project_members
               WHERE user_id = ? OR (user_id IS NULL AND member_name = ?)
            )
          )`,
      [user.id, user.id, user.name]
    );
    if (!repos.length) { result.githubError = result.githubError || "sem_repo_vinculado"; return result; }

    const filesGlobal = new Set();
    for (const repo of repos) {
      if (!repo.owner || !repo.name || !repo.installation_id) continue;
      try {
        const token = await githubInstallationToken(repo.installation_id);
        if (!token) { result.githubError = "sem_token"; continue; }
        const base = `/repos/${repo.owner}/${repo.name}`;

        // Commits do autor no mês — contagem vem da LISTA (não depende do detalhe)
        const commits = await githubApi(token, `${base}/commits?author=${encodeURIComponent(login)}&since=${since}&per_page=100`);
        const list = Array.isArray(commits) ? commits : [];
        result.commits += list.length;
        // Detalhes (linhas + arquivos) — best-effort, não afeta a contagem de commits
        for (const c of list.slice(0, 100)) {
          try {
            const det = await githubApi(token, `${base}/commits/${c.sha}`);
            if (det.stats) { result.linesAdded += det.stats.additions || 0; result.linesRemoved += det.stats.deletions || 0; }
            for (const f of det.files || []) if (f.filename) filesGlobal.add(`${repo.full_name}:${f.filename}`);
          } catch (_) { /* ignora commit individual que falhar */ }
        }

        // Pull requests (lista) → abertos/mergeados no mês pelo autor
        const pulls = await githubApi(token, `${base}/pulls?state=all&per_page=100&sort=created&direction=desc`);
        for (const pr of pulls || []) {
          if (!pr.user || pr.user.login !== login) continue;
          if (pr.created_at && new Date(pr.created_at).getTime() >= monthStart) result.prsOpened += 1;
          if (pr.merged_at && new Date(pr.merged_at).getTime() >= monthStart) result.prsMerged += 1;
        }

        // Reviews feitas pelo login (em PRs atualizados no mês)
        const recent = (pulls || []).filter((pr) => pr.updated_at && new Date(pr.updated_at).getTime() >= monthStart).slice(0, 30);
        for (const pr of recent) {
          try {
            const reviews = await githubApi(token, `${base}/pulls/${pr.number}/reviews`);
            result.reviews += (reviews || []).filter((rv) => rv.user && rv.user.login === login && rv.submitted_at && new Date(rv.submitted_at).getTime() >= monthStart).length;
          } catch (_) {}
        }
        result.repos.push(repo.full_name);
      } catch (e) {
        // só marca erro se nenhum repo teve sucesso (não mascara dados válidos)
        if (!result.repos.length) result.githubError = e.status === 403 ? "limite_ou_permissao" : "erro_api";
      }
    }
    result.filesChanged = filesGlobal.size;
    result.reposConsidered = result.repos.length;
    if (result.repos.length) result.githubError = null; // pelo menos um repo OK
    return result;
  }

  function _ghStatsFromRow(row, user, period) {
    return {
      period, githubLogin: user.github_login || null, userName: user.name,
      commits: row.commits, prsOpened: row.prs_opened, prsMerged: row.prs_merged, reviews: row.reviews,
      tasksDone: row.tasks_done, filesChanged: row.files_changed, linesAdded: row.lines_added, linesRemoved: row.lines_removed,
      cached: true, computedAt: row.computed_at,
      githubConfigured: Boolean(process.env.GITHUB_APP_ID && process.env.GITHUB_PRIVATE_KEY),
    };
  }

  // Estatísticas de contribuição de um usuário (com cache/TTL)
  app.get("/api/users/:id/contributions", authRequired, async (req, res) => {
    const targetId = Number(req.params.id);
    const target = await db.get("SELECT id, name, role, github_login FROM users WHERE id = ?", [targetId]);
    if (!target) return res.status(404).json({ error: "Usuário não encontrado" });
    if (req.user.id !== targetId && req.user.role !== "professor" && !req.user.isAdmin) {
      return res.status(403).json({ error: "Sem permissão" });
    }
    const { period } = currentMonthRange();
    const refresh = req.query.refresh === "1";
    const cached = await db.get("SELECT * FROM github_user_stats WHERE user_id = ? AND period = ?", [targetId, period]);
    const TTL = 10 * 60 * 1000;
    if (cached && !refresh) {
      const age = Date.now() - new Date(String(cached.computed_at).replace(" ", "T") + "Z").getTime();
      if (age < TTL) return res.json(_ghStatsFromRow(cached, target, period));
    }
    let stats;
    try { stats = await computeUserGithubStats(target); }
    catch (e) { return res.json({ period, githubLogin: target.github_login, userName: target.name, error: "falha_calculo", message: e.message }); }
    await db.run(
      `INSERT INTO github_user_stats (user_id, period, commits, prs_opened, prs_merged, reviews, tasks_done, files_changed, lines_added, lines_removed, computed_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now'))
       ON CONFLICT(user_id, period) DO UPDATE SET commits=excluded.commits, prs_opened=excluded.prs_opened, prs_merged=excluded.prs_merged,
         reviews=excluded.reviews, tasks_done=excluded.tasks_done, files_changed=excluded.files_changed,
         lines_added=excluded.lines_added, lines_removed=excluded.lines_removed, computed_at=datetime('now')`,
      [targetId, period, stats.commits, stats.prsOpened, stats.prsMerged, stats.reviews, stats.tasksDone, stats.filesChanged, stats.linesAdded, stats.linesRemoved]
    );
    return res.json(stats);
  });

  // Define manualmente o usuário do GitHub (próprio, ou professor/admin para outros)
  app.patch("/api/users/:id/github-login", authRequired, async (req, res) => {
    const targetId = Number(req.params.id);
    if (req.user.id !== targetId && req.user.role !== "professor" && !req.user.isAdmin) {
      return res.status(403).json({ error: "Sem permissão" });
    }
    const login = String((req.body && req.body.githubLogin) || "").trim().replace(/^@/, "").slice(0, 100);
    await db.run("UPDATE users SET github_login = ? WHERE id = ?", [login || null, targetId]);
    return res.json({ ok: true, githubLogin: login || null });
  });

  // ── Notificações persistentes ────────────────────────────────────────────────
  app.get("/api/notifications", authRequired, async (req, res) => {
    const rows = await db.all(
      "SELECT id, type, message, link, is_read, created_at FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50",
      [req.user.id]
    );
    return res.json(rows);
  });

  app.patch("/api/notifications/read-all", authRequired, async (req, res) => {
    await db.run("UPDATE notifications SET is_read = 1 WHERE user_id = ?", [req.user.id]);
    return res.json({ ok: true });
  });

  app.patch("/api/notifications/:id/read", authRequired, async (req, res) => {
    await db.run(
      "UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?",
      [req.params.id, req.user.id]
    );
    return res.json({ ok: true });
  });

  // Atividade recente — movimentações de status das tarefas (para o Dashboard)
  app.get("/api/activity/recent", authRequired, async (req, res) => {
    const scope = await buildVisibleScope(db, req.user);
    const ids = Array.from(scope.projectIds);
    if (!ids.length) return res.json([]);
    const ph = ids.map(() => "?").join(",");
    const rows = await db.all(
      `SELECT a.id, a.task_id, a.user_name, a.field, a.old_val, a.new_val, a.created_at, t.title
         FROM task_audit a JOIN tasks t ON t.id = a.task_id
        WHERE t.project_id IN (${ph}) AND a.field = 'status'
        ORDER BY a.id DESC LIMIT 15`,
      ids
    );
    return res.json(rows.map((r) => ({
      id: r.id, taskId: String(r.task_id), title: r.title,
      userName: r.user_name, oldVal: r.old_val, newVal: r.new_val, createdAt: r.created_at,
    })));
  });

  // ── SPA fallback — DEVE ficar após TODAS as rotas de API ────────────────
  const APP_ROUTES = new Set(["/dashboard","/projetos","/scrum","/kanban","/tap","/pi","/turmas","/chat","/equipes","/avaliacao","/admin","/superadmin","/integracoes"]);
  const APP_ROUTE_PATTERNS = [/^\/projetos\/\d+$/];
  app.get("*", (req, res) => {
    if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Rota não encontrada" });
    if (APP_ROUTES.has(req.path) || APP_ROUTE_PATTERNS.some((re) => re.test(req.path))) return serveApp(res);
    res.redirect("/landing-page");
  });

  // ── Global error handler ─────────────────────────────────────────────────
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "Arquivo muito grande (máx 80MB)" });
    console.error("[SERVER_ERROR]", err);
    res.status(500).json({ error: "Erro interno do servidor" });
  });

  if (require.main === module) {
    const httpServer = http.createServer(app);
    const io = new SocketServer(httpServer, {
      cors: { origin: false },
      transports: ["websocket", "polling"]
    });
    app._io = io;

    // Auth do socket via JWT cookie ou header
    io.use((socket, next) => {
      const cookie = socket.handshake.headers.cookie || "";
      const token = readCookieValue(cookie, TOKEN_COOKIE) || socket.handshake.auth?.token;
      if (!token) return next(new Error("Não autenticado"));
      try {
        socket.user = jwt.verify(token, JWT_SECRET);
        next();
      } catch (_) { next(new Error("Token inválido")); }
    });

    io.on("connection", (socket) => {
      const user = socket.user;

      // Toda conexão autenticada entra na sala pessoal user:{id}
      // Isso permite notificações individuais dirigidas por user_id
      socket.join(`user:${user.id}`);

      // Aluno entra nas salas dos projetos dos quais é membro (user_id FK, fallback nome único)
      if (user.role === "aluno") {
        db.all(
          `SELECT project_id FROM project_members WHERE user_id = ?
           UNION
           SELECT pm.project_id FROM project_members pm
           WHERE pm.user_id IS NULL AND pm.member_name = ?
           AND (SELECT COUNT(*) FROM users u2 WHERE u2.name = pm.member_name) = 1`,
          [user.id, user.name]
        ).then((rows) => {
          rows.forEach((r) => socket.join(`project:${r.project_id}`));
        }).catch(() => {});
      }

      // Professor entra SOMENTE nas salas de projetos das próprias turmas
      // Nunca entra em projetos de turmas alheias
      if (user.role === "professor" && !user.isAdmin) {
        db.all(
          "SELECT p.id FROM projects p INNER JOIN turmas t ON p.turma_id = t.id WHERE t.professor_id = ?",
          [user.id]
        ).then((rows) => {
          rows.forEach((r) => socket.join(`project:${r.id}`));
        }).catch(() => {});
      }

      // Admin entra em todos os projetos
      if (user.isAdmin) {
        db.all("SELECT id FROM projects").then((rows) => {
          rows.forEach((r) => socket.join(`project:${r.id}`));
        }).catch(() => {});
      }
    });

    httpServer.listen(PORT, () => {
      console.log(`PILHA rodando na porta ${PORT}`);
    });
  }

  return { app, db };
}

if (require.main === module) {
  const _diagHttp = require("http");
  const _diagPort = process.env.PORT || 3000;
  let _diagStarted = false;

  function _startDiagServer(msg) {
    if (_diagStarted) return;
    _diagStarted = true;
    console.error("[STARTUP FAILED]", msg);
    _diagHttp.createServer((_, res) => {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("STARTUP ERROR:\n" + msg);
    }).listen(_diagPort, () => console.error(`Erro exposto na porta ${_diagPort}`));
  }

  process.on("uncaughtException", (err) => _startDiagServer(String(err?.stack || err)));
  process.on("unhandledRejection", (err) => _startDiagServer(String(err?.stack || err)));

  createApp().catch((err) => _startDiagServer(String(err?.stack || err)));
}

module.exports = { createApp, normalizeGithubPrivateKey, aggregateCommitDetails, currentMonthRange };
