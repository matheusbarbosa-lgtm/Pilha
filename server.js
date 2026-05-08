require("dotenv").config();
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const http = require("http");
const { Server: SocketServer } = require("socket.io");
const multer = require("multer");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
let initDb, initEvalDb;
try {
  ({ initDb, initEvalDb } = require("./db"));
} catch (_dbLoadErr) {
  // sqlite3 falhou ao carregar — createApp() vai rejeitar e o servidor de diagnóstico irá capturar
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
  limits: { fileSize: 300 * 1024 }, // 300KB
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
function readCookieValue(cookieHeader, cookieName) {
  const prefix = `${cookieName}=`;
  const match = String(cookieHeader || "")
    .split(/;\s*/)
    .find((part) => part.startsWith(prefix));
  return match ? decodeURIComponent(match.slice(prefix.length)) : null;
}
const JWT_SECRET = process.env.JWT_SECRET || "campusflow_dev_secret_change_me";
if (!process.env.JWT_SECRET) {
  console.warn("[SECURITY] JWT_SECRET não definido. Usando secret padrão inseguro. Defina JWT_SECRET em produção.");
}

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
    customValues: row.customValues || {}
  };
}

function cleanStatus(value) {
  return String(value || "").toLowerCase();
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
  res.cookie(TOKEN_COOKIE, token, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
    maxAge: 12 * 60 * 60 * 1000
  });
  // também expõe no header para o frontend guardar em sessionStorage (isolamento por aba)
  res.setHeader("X-Auth-Token", token);
}

async function getProjectsWithMembers(db, where = "", params = []) {
  const rows = await db.all(
    `SELECT p.id, p.name, p.team, p.deadline, p.description, p.discipline, p.start_date,
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
  if (user.role === "professor" || user.isAdmin) {
    const projects = await getProjectsWithMembers(db);
    return { projects, projectIds: new Set(projects.map((p) => Number(p.id))), tasksFilter: "" };
  }
  const projects = await getProjectsWithMembers(
    db,
    "WHERE p.id IN (SELECT project_id FROM project_members WHERE member_name = ?)",
    [user.name]
  );
  return { projects, projectIds: new Set(projects.map((p) => Number(p.id))), tasksFilter: "" };
}

async function getProjectMembersSet(db, projectId) {
  const rows = await db.all("SELECT member_name FROM project_members WHERE project_id = ?", [projectId]);
  return new Set(rows.map((row) => row.member_name));
}

async function createAndSendInvites(db, { projectId, inviterUserId, inviteEmails }) {
  const cleanEmails = Array.from(new Set(
    (inviteEmails || []).map((e) => String(e || "").trim().toLowerCase()).filter(Boolean)
  ));
  let created = 0;
  for (const email of cleanEmails) {
    const token = crypto.randomUUID();
    await db.run(
      "INSERT INTO project_invites (project_id, inviter_user_id, invite_email, invite_token, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)",
      [projectId, inviterUserId, email, token, new Date().toISOString()]
    );
    created += 1;
    const inviteLink = `${APP_BASE_URL}/cadastro?invite=${token}`;
    if (mailTransporter) {
      try {
        await mailTransporter.sendMail({
          from: process.env.SMTP_FROM || "PILHA <no-reply@pilha.local>",
          to: email,
          subject: "Convite para participar de projeto no PILHA",
          text: `Você foi convidado para um projeto no PILHA.\nAcesse e aceite: ${inviteLink}`
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
    return next();
  } catch (_) {
    return res.status(401).json({ error: "Sessão inválida" });
  }
}

function professorOnly(req, res, next) {
  if (req.user.role !== "professor" && !req.user.isAdmin) {
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

  app.use(express.json({ limit: "5mb" }));
  app.use(cookieParser());
  app.disable("x-powered-by");

  const HTML_PARTS = ['shell-top','nav','dashboard','projects','scrum','kanban','documents','turmas','chat','equipes','avaliacao','admin','modals','shell-bottom'];
  const _fs = require("fs");
  const _path = require("path");
  function serveApp(res) {
    try {
      const html = HTML_PARTS.map(p => _fs.readFileSync(_path.join(__dirname, 'views', p + '.html'), 'utf8')).join('\n');
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
    if (!bcrypt.compareSync(String(password), user.password_hash)) return res.status(401).json({ error: "Credenciais inválidas" });
    // 2FA for ADM (is_admin=1) and SUPER (is_admin>=2) — send OTP email, don't issue JWT yet
    const _no2fa = (process.env.NO_2FA_USERNAMES || "").split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
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
        console.log(`[OTP] código para ${user.username} → ${otpEmail}: ${code}`);
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
    if (String(password).length < 6) return res.status(400).json({ error: "Senha deve ter pelo menos 6 caracteres" });

    if (await db.get("SELECT id FROM users WHERE username = ?", [cleanUsername])) {
      return res.status(409).json({ error: "Usuário já existe" });
    }
    if (cleanEmail && await db.get("SELECT id FROM users WHERE email = ?", [cleanEmail])) {
      return res.status(409).json({ error: "E-mail já cadastrado" });
    }

    const passwordHash = bcrypt.hashSync(String(password), 10);
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
        from: process.env.EMAIL_FROM || "PILHA <noreply@eusford.com>",
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
    if (!token || !newPassword || String(newPassword).length < 6)
      return res.status(400).json({ error: "Token e nova senha (mín. 6 caracteres) são obrigatórios" });
    const record = await db.get(
      "SELECT * FROM password_reset_tokens WHERE token = ? AND used = 0 AND expires_at > datetime('now')",
      [token]
    );
    if (!record) return res.status(400).json({ error: "Link inválido ou expirado" });
    const hash = bcrypt.hashSync(String(newPassword), 10);
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
        from: process.env.EMAIL_FROM || "PILHA <noreply@eusford.com>",
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

  app.post("/api/auth/change-password", authRequired, async (req, res) => {
    const { newPassword } = req.body || {};
    if (!newPassword || String(newPassword).length < 6)
      return res.status(400).json({ error: "A senha deve ter pelo menos 6 caracteres" });
    const hash = bcrypt.hashSync(String(newPassword), 10);
    await db.run("UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?", [hash, req.user.id]);
    return res.json({ ok: true });
  });

  app.post("/api/auth/student-onboarding", authRequired, async (req, res) => {
    if (req.user.role !== "aluno") return res.status(403).json({ error: "Onboarding permitido apenas para aluno" });

    const { email, password, confirmPassword, photo, turma, periodo, curso, mode, projectName, projectDeadline, scrumRole, inviteEmails, inviteToken } = req.body || {};
    const cleanEmail = String(email || "").trim().toLowerCase();
    const cleanPassword = String(password || "");
    const cleanConfirm = String(confirmPassword || "");
    // turma/período/curso podem vir do body ou já estar no user (cadastro via link)
    const dbUser = await db.get("SELECT * FROM users WHERE id = ?", [req.user.id]);
    const cleanTurma = String(turma || dbUser?.turma || "").trim();
    const cleanPeriodo = String(periodo || dbUser?.periodo || "").trim();
    const cleanCurso = String(curso || dbUser?.curso || "").trim() || null;
    const cleanMode = String(mode || "create");
    const cleanPhoto = sanitizePhotoDataUrl(photo);
    if (cleanPhoto && typeof cleanPhoto === "object" && cleanPhoto.error) {
      return res.status(400).json({ error: cleanPhoto.error });
    }

    if (!cleanEmail || !cleanPassword || !cleanConfirm) return res.status(400).json({ error: "E-mail e senha são obrigatórios" });
    if (cleanPassword !== cleanConfirm) return res.status(400).json({ error: "As senhas não coincidem" });
    if (cleanPassword.length < 6) return res.status(400).json({ error: "Senha deve ter pelo menos 6 caracteres" });

    if (await db.get("SELECT id FROM users WHERE email = ? AND id <> ?", [cleanEmail, req.user.id])) {
      return res.status(409).json({ error: "E-mail já está em uso" });
    }

    const newHash = bcrypt.hashSync(cleanPassword, 10);
    let createdInvites = 0;

    if (cleanMode === "join") {
      const cleanToken = String(inviteToken || "").trim();
      if (!cleanToken) return res.status(400).json({ error: "Token de convite inválido" });
      const invite = await db.get("SELECT * FROM project_invites WHERE invite_token = ? AND status = 'pending'", [cleanToken]);
      if (!invite) return res.status(404).json({ error: "Convite não encontrado ou expirado" });
      if (String(invite.invite_email).toLowerCase() !== cleanEmail) {
        return res.status(403).json({ error: `Este convite foi enviado para: ${invite.invite_email}` });
      }
      await db.run("INSERT OR IGNORE INTO project_members (project_id, member_name, scrum_role) VALUES (?, ?, NULL)", [invite.project_id, req.user.name]);
      await db.run("UPDATE project_invites SET status = 'accepted', accepted_at = ? WHERE id = ?", [new Date().toISOString(), invite.id]);
    } else {
      const cleanProjectName = String(projectName || "").trim();
      const cleanDeadline = String(projectDeadline || "").trim();
      const cleanScrumRole = VALID_SCRUM_ROLES.includes(String(scrumRole || "")) ? String(scrumRole) : "Development Team";
      if (!cleanProjectName || !cleanDeadline) return res.status(400).json({ error: "Nome do projeto e prazo são obrigatórios" });
      const created = await db.run("INSERT INTO projects (name, team, deadline) VALUES (?, ?, ?)", [cleanProjectName, cleanTurma, cleanDeadline]);
      await db.run("INSERT OR IGNORE INTO project_members (project_id, member_name, scrum_role) VALUES (?, ?, ?)", [created.lastID, req.user.name, cleanScrumRole]);
      createdInvites = await createAndSendInvites(db, { projectId: created.lastID, inviterUserId: req.user.id, inviteEmails: Array.isArray(inviteEmails) ? inviteEmails : [] });
    }

    await db.run(
      "UPDATE users SET email = ?, onboarding_done = 1, password_hash = ?, turma = ?, periodo = ?, curso = ?, photo = ? WHERE id = ?",
      [cleanEmail, newHash, cleanTurma, cleanPeriodo, cleanCurso, cleanPhoto, req.user.id]
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
    await db.run("INSERT OR IGNORE INTO project_members (project_id, member_name, scrum_role) VALUES (?, ?, NULL)", [invite.project_id, req.user.name]);
    await db.run("UPDATE project_invites SET status = 'accepted', accepted_at = ? WHERE id = ?", [new Date().toISOString(), invite.id]);
    return res.json({ ok: true });
  });

  // ── Students / Profile ────────────────────────────────────────────────────

  app.get("/api/students", authRequired, async (_req, res) => {
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
    const { name, team, members, deadline, scrumRoles, description, discipline, startDate } = req.body || {};
    if (!name || !team || !deadline || !Array.isArray(members) || members.length === 0) {
      return res.status(400).json({ error: "Dados inválidos para criar projeto" });
    }
    const created = await db.run(
      "INSERT INTO projects (name, team, deadline, description, discipline, start_date) VALUES (?, ?, ?, ?, ?, ?)",
      [name, team, deadline, String(description || "").trim(), String(discipline || "").trim(), String(startDate || "").trim()]
    );
    const cleanMembers = members.map((m) => String(m).trim()).filter(Boolean);
    for (const member of cleanMembers) {
      const roleFromPayload = scrumRoles && typeof scrumRoles === "object" ? scrumRoles[member] : null;
      const scrumRole = VALID_SCRUM_ROLES.includes(roleFromPayload) ? roleFromPayload : "Development Team";
      await db.run("INSERT OR IGNORE INTO project_members (project_id, member_name, scrum_role) VALUES (?, ?, ?)", [created.lastID, member, scrumRole]);
    }
    return res.status(201).json({ id: String(created.lastID) });
  });

  // Atualiza nome/descrição do projeto (professor, admin ou PO do projeto)
  app.patch("/api/projects/:id", authRequired, async (req, res) => {
    const projectId = Number(req.params.id);
    if (!projectId) return res.status(400).json({ error: "ID inválido" });
    const isProfOrAdmin = req.user.isAdmin || req.user.role === "professor";
    if (!isProfOrAdmin) {
      const poRow = await db.get(
        "SELECT * FROM project_members WHERE project_id = ? AND member_name = ? AND scrum_role = 'Product Owner'",
        [projectId, req.user.name]
      );
      if (!poRow) return res.status(403).json({ error: "Sem permissão" });
    }
    const { name, description } = req.body || {};
    const updates = [];
    const vals = [];
    if (name !== undefined) { updates.push("name = ?"); vals.push(sanitize(String(name).trim())); }
    if (description !== undefined) { updates.push("description = ?"); vals.push(sanitize(String(description))); }
    if (!updates.length) return res.status(400).json({ error: "Nada para atualizar" });
    vals.push(projectId);
    await db.run(`UPDATE projects SET ${updates.join(", ")} WHERE id = ?`, vals);
    return res.json({ ok: true });
  });

  // Update a member's Scrum role (professor, admin, or PO of the project)
  app.patch("/api/projects/:id/members/:memberName/role", authRequired, async (req, res) => {
    const projectId = Number(req.params.id);
    const isProfOrAdmin = req.user.isAdmin || req.user.role === "professor";
    if (!isProfOrAdmin) {
      // verifica se é PO do projeto
      const poRow = await db.get(
        "SELECT * FROM project_members WHERE project_id = ? AND member_name = ? AND scrum_role = 'Product Owner'",
        [projectId, req.user.name]
      );
      if (!poRow) return res.status(403).json({ error: "Apenas o Product Owner, professores ou admin podem alterar papéis" });
    }
    const memberName = decodeURIComponent(req.params.memberName);
    const newRole = String(req.body?.role || "");
    const VALID_ROLES_WITH_NULL = [...VALID_SCRUM_ROLES, "sem_papel"];
    if (!VALID_ROLES_WITH_NULL.includes(newRole)) {
      return res.status(400).json({ error: "Papel inválido" });
    }
    const dbRole = newRole === "sem_papel" ? null : newRole;
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
      const poRow = await db.get(
        "SELECT * FROM project_members WHERE project_id = ? AND member_name = ? AND scrum_role = 'Product Owner'",
        [projectId, req.user.name]
      );
      if (!poRow) return res.status(403).json({ error: "Apenas o Product Owner pode remover membros" });
    }
    // PO não pode se remover
    if (memberName === req.user.name && !isProfOrAdmin)
      return res.status(400).json({ error: "O PO não pode se remover do projeto" });
    await db.run("DELETE FROM project_members WHERE project_id = ? AND member_name = ?", [projectId, memberName]);
    res.json({ ok: true });
  });

  // Adicionar membro ao projeto por e-mail (PO, professor ou admin)
  app.post("/api/projects/:id/members", authRequired, async (req, res) => {
    const projectId = Number(req.params.id);
    const isProfOrAdmin = req.user.isAdmin || req.user.role === "professor";
    if (!isProfOrAdmin) {
      const poRow = await db.get(
        "SELECT * FROM project_members WHERE project_id = ? AND member_name = ? AND scrum_role = 'Product Owner'",
        [projectId, req.user.name]
      );
      if (!poRow) return res.status(403).json({ error: "Apenas o Product Owner pode adicionar membros" });
    }
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ error: "E-mail obrigatório" });
    const user = await db.get("SELECT * FROM users WHERE email = ?", [email]);
    if (!user) return res.status(404).json({ error: "Nenhum aluno com esse e-mail encontrado" });
    if (user.role !== "aluno" && !isProfOrAdmin) return res.status(400).json({ error: "Usuário não é aluno" });
    const existing = await db.get("SELECT * FROM project_members WHERE project_id = ? AND member_name = ?", [projectId, user.name]);
    if (existing) return res.status(409).json({ error: `${user.name} já está no projeto` });
    await db.run("INSERT INTO project_members (project_id, member_name, scrum_role) VALUES (?, ?, NULL)", [projectId, user.name]);
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
  async function buildGradingWorkbook(projects, evalDb, turmaLabel) {
    const ExcelJS = require("exceljs");
    const wb = new ExcelJS.Workbook();
    wb.creator = "PILHA";
    const ws = wb.addWorksheet(turmaLabel.slice(0, 31) || "Turma");

    const projectIds = projects.map(p => Number(p.id));
    if (!projectIds.length) return wb;
    const ph = projectIds.map(() => "?").join(",");

    // Atividades únicas ordenadas por seção
    const allActs = await evalDb.all(
      `SELECT * FROM eval_activities WHERE project_id IN (${ph}) ORDER BY section, id`,
      projectIds
    );
    // Scores por atividade (média dos membros do grupo)
    const actAvgs = await evalDb.all(
      `SELECT ea.project_id, ea.id as activity_id, ea.name, ea.section, ea.max_pts,
              ROUND(AVG(COALESCE(eas.score, 0)), 1) as avg_score
       FROM eval_activities ea
       LEFT JOIN eval_activity_scores eas ON eas.activity_id = ea.id
       WHERE ea.project_id IN (${ph})
       GROUP BY ea.id`,
      projectIds
    );
    const metas = await evalDb.all(
      `SELECT * FROM eval_meta WHERE project_id IN (${ph})`,
      projectIds
    );

    // Colunas dinâmicas únicas por seção
    const seen = new Set();
    const planActs = [];
    const devActs  = [];
    for (const a of allActs) {
      const key = a.section + "::" + a.name;
      if (!seen.has(key)) {
        seen.add(key);
        if (a.section === "planejamento") planActs.push({ name: a.name, max_pts: a.max_pts });
        else devActs.push({ name: a.name, max_pts: a.max_pts });
      }
    }
    const planMax = planActs.reduce((s, a) => s + (a.max_pts || 0), 0);
    const devMax  = devActs.reduce((s, a)  => s + (a.max_pts || 0), 0);

    // Índices de colunas (1-based)
    const COL_NUM        = 1;
    const COL_PROJ       = 2;
    const COL_MEMB       = 3;
    const COL_PLAN_START = 4;
    const COL_PLAN_TOTAL = COL_PLAN_START + planActs.length;
    const COL_DEV_START  = COL_PLAN_TOTAL + 1;
    const COL_DEV_TOTAL  = COL_DEV_START + devActs.length;
    const COL_ENTREGA    = COL_DEV_TOTAL + 1;
    const COL_NOTA       = COL_ENTREGA + 1;
    const COL_OBS        = COL_NOTA + 1;
    const TOTAL_COLS     = COL_OBS;

    // ── Helpers ──────────────────────────────────────────────────
    const RED   = "FF7A010A";
    const PINK  = "FFF3D7DA";
    const VPINK = "FFFFF3F4";
    const WHITE = "FFFFFFFF";
    const BLACK = "FF000000";
    const GRAY  = "FFD9D9D9";

    const mkFill   = (argb) => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
    const mkFont   = (bold, color = BLACK, size = 10) => ({ bold, color: { argb: color }, size, name: "Calibri" });
    const mkBorder = (color = "FFCCCCCC") => {
      const s = { style: "thin", color: { argb: color } };
      return { top: s, left: s, bottom: s, right: s };
    };

    function sc(cell, { bg, fg = BLACK, bold = false, h = "center", v = "middle", wrap = false, size = 10 } = {}) {
      if (bg) cell.fill = mkFill(bg);
      cell.font = mkFont(bold, fg, size);
      cell.alignment = { horizontal: h, vertical: v, wrapText: wrap };
      cell.border = mkBorder();
    }

    // ── ROW 1: Cabeçalhos de seção (merge vertical para fixas) ──
    ws.getRow(1).height = 30;
    ws.getRow(2).height = 38;
    ws.getRow(3).height = 18;

    // Colunas fixas: Nº, Trabalho, Integrantes — merge rows 1-3
    const fixed = [
      { col: COL_NUM,  val: "Nº" },
      { col: COL_PROJ, val: "Trabalho" },
      { col: COL_MEMB, val: "Integrantes" },
    ];
    for (const { col, val } of fixed) {
      const c = ws.getCell(1, col);
      c.value = val;
      sc(c, { bg: RED, fg: WHITE, bold: true });
      ws.mergeCells(1, col, 3, col);
    }

    // PLANEJAMENTO — row 1 com colspan (atividades + Total)
    if (planActs.length >= 0) {
      const planColEnd = COL_PLAN_TOTAL;
      const cP = ws.getCell(1, COL_PLAN_START);
      cP.value = "PLANEJAMENTO";
      sc(cP, { bg: RED, fg: WHITE, bold: true, size: 11 });
      if (planColEnd > COL_PLAN_START) ws.mergeCells(1, COL_PLAN_START, 1, planColEnd);
    }

    // DESENVOLVIMENTO — row 1 com colspan (atividades + Total)
    if (devActs.length >= 0) {
      const devColEnd = COL_DEV_TOTAL;
      const cD = ws.getCell(1, COL_DEV_START);
      cD.value = "DESENVOLVIMENTO";
      sc(cD, { bg: RED, fg: WHITE, bold: true, size: 11 });
      if (devColEnd > COL_DEV_START) ws.mergeCells(1, COL_DEV_START, 1, devColEnd);
    }

    // Entrega, Nota Final, Observações — merge rows 1-3
    for (const [col, val] of [[COL_ENTREGA, "Entrega"], [COL_NOTA, "Nota Final"], [COL_OBS, "Observações"]]) {
      const c = ws.getCell(1, col);
      c.value = val;
      sc(c, { bg: RED, fg: WHITE, bold: true });
      ws.mergeCells(1, col, 3, col);
    }

    // ── ROW 2: Nomes das atividades ──────────────────────────────
    planActs.forEach((a, i) => {
      const c = ws.getCell(2, COL_PLAN_START + i);
      c.value = a.name;
      sc(c, { bg: PINK, bold: true, wrap: true, size: 9 });
    });
    const cPlanTotH = ws.getCell(2, COL_PLAN_TOTAL);
    cPlanTotH.value = "Total";
    sc(cPlanTotH, { bg: PINK, bold: true });

    devActs.forEach((a, i) => {
      const c = ws.getCell(2, COL_DEV_START + i);
      c.value = a.name;
      sc(c, { bg: PINK, bold: true, wrap: true, size: 9 });
    });
    const cDevTotH = ws.getCell(2, COL_DEV_TOTAL);
    cDevTotH.value = "Total";
    sc(cDevTotH, { bg: PINK, bold: true });

    // ── ROW 3: Pontos máximos ────────────────────────────────────
    planActs.forEach((a, i) => {
      const c = ws.getCell(3, COL_PLAN_START + i);
      c.value = a.max_pts || 0;
      sc(c, { bg: VPINK });
    });
    const cPlanMaxH = ws.getCell(3, COL_PLAN_TOTAL);
    cPlanMaxH.value = planMax;
    sc(cPlanMaxH, { bg: VPINK, bold: true });

    devActs.forEach((a, i) => {
      const c = ws.getCell(3, COL_DEV_START + i);
      c.value = a.max_pts || 0;
      sc(c, { bg: VPINK });
    });
    const cDevMaxH = ws.getCell(3, COL_DEV_TOTAL);
    cDevMaxH.value = devMax;
    sc(cDevMaxH, { bg: VPINK, bold: true });

    // ── DADOS: Uma linha por projeto ─────────────────────────────
    const ROW_BGAS = ["FFFFFFFF", "FFFFF5F5"];

    projects.forEach((proj, idx) => {
      const rowN   = 4 + idx;
      const members = proj.members || [];
      const meta    = metas.find(m => m.project_id === Number(proj.id)) || {};
      const bg      = ROW_BGAS[idx % 2];

      // Altura dinâmica para acomodar membros
      ws.getRow(rowN).height = Math.max(20, members.length * 16);

      // Nº
      const cN = ws.getCell(rowN, COL_NUM);
      cN.value = idx + 1;
      sc(cN, { bg, bold: true });

      // Trabalho
      const cP = ws.getCell(rowN, COL_PROJ);
      cP.value = proj.name + (proj.team ? `\n${proj.team}` : "");
      sc(cP, { bg, h: "left", wrap: true });

      // Integrantes (todos empilhados)
      const cM = ws.getCell(rowN, COL_MEMB);
      cM.value = members.join("\n");
      sc(cM, { bg, h: "left", v: "top", wrap: true });

      // Planejamento: avg por atividade
      let planTotal = 0;
      planActs.forEach((act, i) => {
        const rec = actAvgs.find(s => s.project_id === Number(proj.id) && s.section === "planejamento" && s.name === act.name);
        const val = rec ? rec.avg_score : null;
        const c = ws.getCell(rowN, COL_PLAN_START + i);
        c.value = val;
        sc(c, { bg: "FFFDF5F5", h: "center" });
        if (val != null) planTotal = Math.round((planTotal + val) * 10) / 10;
      });
      const cPT = ws.getCell(rowN, COL_PLAN_TOTAL);
      cPT.value = planTotal || null;
      sc(cPT, { bg: PINK, bold: true });

      // Desenvolvimento: avg por atividade
      let devTotal = 0;
      devActs.forEach((act, i) => {
        const rec = actAvgs.find(s => s.project_id === Number(proj.id) && s.section === "desenvolvimento" && s.name === act.name);
        const val = rec ? rec.avg_score : null;
        const c = ws.getCell(rowN, COL_DEV_START + i);
        c.value = val;
        sc(c, { bg: "FFFDF5F5", h: "center" });
        if (val != null) devTotal = Math.round((devTotal + val) * 10) / 10;
      });
      const cDT = ws.getCell(rowN, COL_DEV_TOTAL);
      cDT.value = devTotal || null;
      sc(cDT, { bg: PINK, bold: true });

      // Entrega
      const entrega = meta.entrega_score ?? null;
      const cE = ws.getCell(rowN, COL_ENTREGA);
      cE.value = entrega;
      sc(cE, { bg, h: "center" });

      // Nota Final = planTotal + devTotal + entrega (badge vermelho)
      const notaFinal = Math.round((planTotal + devTotal + (entrega || 0)) * 10) / 10;
      const cNF = ws.getCell(rowN, COL_NOTA);
      cNF.value = notaFinal || null;
      sc(cNF, { bg: RED, fg: WHITE, bold: true, size: 11 });

      // Observações
      const cO = ws.getCell(rowN, COL_OBS);
      cO.value = meta.observacoes || null;
      sc(cO, { bg, h: "left", wrap: true });
    });

    // Larguras
    ws.getColumn(COL_NUM).width  = 5;
    ws.getColumn(COL_PROJ).width = 30;
    ws.getColumn(COL_MEMB).width = 32;
    for (let i = 0; i < planActs.length; i++) ws.getColumn(COL_PLAN_START + i).width = 14;
    ws.getColumn(COL_PLAN_TOTAL).width = 10;
    for (let i = 0; i < devActs.length; i++) ws.getColumn(COL_DEV_START + i).width = 14;
    ws.getColumn(COL_DEV_TOTAL).width = 10;
    ws.getColumn(COL_ENTREGA).width = 10;
    ws.getColumn(COL_NOTA).width = 12;
    ws.getColumn(COL_OBS).width = 35;

    // Freeze: 3 linhas de header + 3 colunas fixas
    ws.views = [{ state: "frozen", ySplit: 3, xSplit: 3 }];

    return wb;
  }

  // Export por turma (todos os grupos da turma)
  app.get("/api/export/grading/turma/:turma", authRequired, professorOnly, async (req, res) => {
    const turma = decodeURIComponent(req.params.turma);
    const projects = await getProjectsWithMembers(db, "WHERE p.team = ?", [turma]);
    if (!projects.length) return res.status(404).json({ error: "Nenhum projeto encontrado para esta turma" });
    const wb = await buildGradingWorkbook(projects, evalDb, turma);
    const fname = `Avaliacao_${turma.replace(/[^a-zA-Z0-9]/g, "_")}.xlsx`;
    res.setHeader("Content-Disposition", `attachment; filename="${fname}"`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    await wb.xlsx.write(res);
    res.end();
  });

  // Export por grupo (um projeto específico)
  app.get("/api/export/grading/project/:id", authRequired, async (req, res) => {
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

  // Lista de turmas únicas (para o select de exportação)
  app.get("/api/export/turmas", authRequired, professorOnly, async (_req, res) => {
    const rows = await db.all("SELECT DISTINCT team FROM projects WHERE team IS NOT NULL AND team != '' ORDER BY team");
    res.json(rows.map(r => r.team));
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
              t.status, t.priority, t.points, t.description, t.checklist, t.tags, t.urgency, t.parent_task_id
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
              t.status, t.priority, t.points, t.description, t.checklist, t.tags, t.urgency, t.parent_task_id
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
        await db.run("INSERT OR REPLACE INTO custom_field_values (task_id, field_id, value) VALUES (?, ?, ?)", [created.lastID, fieldId, String(value)]);
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
    const task = await db.get("SELECT id, project_id FROM tasks WHERE id = ?", [req.params.id]);
    if (!task) return res.status(404).json({ error: "Tarefa não encontrada" });
    const scope = await buildVisibleScope(db, req.user);
    if (!scope.projectIds.has(task.project_id)) return res.status(403).json({ error: "Sem permissão" });
    await db.run("UPDATE tasks SET status = ? WHERE id = ?", [normalizedStatus, req.params.id]);
    return res.json({ ok: true });
  });

  app.patch("/api/tasks/:id/checklist", authRequired, async (req, res) => {
    const { checklist } = req.body || {};
    if (!Array.isArray(checklist)) return res.status(400).json({ error: "Checklist deve ser um array" });
    const task = await db.get("SELECT id, project_id FROM tasks WHERE id = ?", [req.params.id]);
    if (!task) return res.status(404).json({ error: "Tarefa não encontrada" });
    const scope = await buildVisibleScope(db, req.user);
    if (!scope.projectIds.has(task.project_id)) return res.status(403).json({ error: "Sem permissão" });
    await db.run("UPDATE tasks SET checklist = ? WHERE id = ?", [JSON.stringify(checklist), req.params.id]);
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
    return res.json({ ok: true });
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
    if (String(password).length < 6)
      return res.status(400).json({ error: "Senha deve ter pelo menos 6 caracteres" });

    const turmaRow = await db.get("SELECT * FROM turmas WHERE invite_token = ?", [turmaToken]);
    if (!turmaRow) return res.status(404).json({ error: "Link de turma inválido" });

    const cleanEmail = String(email).trim().toLowerCase();
    const cleanName  = sanitize(name);
    const username   = sanitizeUsername(cleanEmail.split("@")[0] + "_" + Math.floor(Math.random() * 999));

    if (await db.get("SELECT id FROM users WHERE email = ?", [cleanEmail]))
      return res.status(409).json({ error: "E-mail já cadastrado" });

    const hash = bcrypt.hashSync(String(password), 10);
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
    if (String(password).length < 6)
      return res.status(400).json({ error: "Senha deve ter pelo menos 6 caracteres" });

    const invite = await db.get("SELECT * FROM project_invites WHERE invite_token = ? AND status = 'pending'", [inviteToken]);
    if (!invite) return res.status(404).json({ error: "Convite inválido ou já utilizado" });

    const cleanEmail = String(email).trim().toLowerCase();
    if (String(invite.invite_email).toLowerCase() !== cleanEmail)
      return res.status(403).json({ error: `Este convite foi enviado para: ${invite.invite_email}` });

    if (await db.get("SELECT id FROM users WHERE email = ?", [cleanEmail]))
      return res.status(409).json({ error: "E-mail já cadastrado — faça login e acesse o link novamente" });

    const cleanName = sanitize(name);
    const username  = sanitizeUsername(cleanEmail.split("@")[0] + "_" + Math.floor(Math.random() * 999));
    const hash      = bcrypt.hashSync(String(password), 10);

    const result = await db.run(
      "INSERT INTO users (username, name, role, email, onboarding_done, password_hash) VALUES (?, ?, 'aluno', ?, 1, ?)",
      [username, cleanName, cleanEmail, hash]
    );
    await db.run("INSERT OR IGNORE INTO project_members (project_id, member_name, scrum_role) VALUES (?, ?, NULL)", [invite.project_id, cleanName]);
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
    if (!user || !bcrypt.compareSync(String(password), user.password_hash))
      return res.status(401).json({ error: "Credenciais inválidas" });
    if (user.must_change_password)
      return res.json({ mustChangePassword: true, userId: user.id });
    const payload = buildAuthPayload(user);
    setAuthCookie(res, payload);
    return res.json({ user: payload, requiresOnboarding: !user.onboarding_done });
  });

  // ── Chat ─────────────────────────────────────────────────────────────────

  app.get("/api/chat/:turmaId", authRequired, async (req, res) => {
    const turmaId = Number(req.params.turmaId);
    // verifica acesso: professor da turma ou aluno da turma
    const turma = await db.get("SELECT * FROM turmas WHERE id = ?", [turmaId]);
    if (!turma) return res.status(404).json({ error: "Turma não encontrada" });
    const isProf = req.user.role === "professor";
    const isStudent = req.user.turma_id === turmaId || req.user.turma === turma.turma;
    if (!isProf && !isStudent) return res.status(403).json({ error: "Sem permissão" });
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
    const isProf = req.user.role === "professor";
    const isStudent = req.user.turma_id === turmaId || req.user.turma === turma.turma;
    if (!isProf && !isStudent) return res.status(403).json({ error: "Sem permissão" });
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
    // Busca todos projetos da turma
    const turma = await db.get("SELECT turma FROM turmas WHERE id = ?", [turmaId]);
    if (!turma) return res.status(404).json({ error: "Turma não encontrada" });
    const projects = await db.all("SELECT id FROM projects WHERE team LIKE ?", [`%${turma.turma}%`]);
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
    if (cleanPassword.length < 6) return res.status(400).json({ error: "Senha deve ter pelo menos 6 caracteres" });
    if (await db.get("SELECT id FROM users WHERE email = ?", [cleanEmail])) {
      return res.status(409).json({ error: "E-mail já cadastrado" });
    }
    const username = sanitizeUsername(cleanEmail.split("@")[0] + "_" + Math.floor(Math.random() * 999));
    const passwordHash = bcrypt.hashSync(cleanPassword, 10);
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
        from: process.env.EMAIL_FROM || "PILHA <noreply@eusford.com>",
        to: cleanEmail,
        subject: "Bem-vindo ao PILHA — Seus dados de acesso",
        html: welcomeHtml
      }).catch(err => console.error("[EMAIL] Erro ao enviar boas-vindas professor:", err));
    }
    return res.status(201).json({ id: String(created.lastID), email: cleanEmail });
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

  app.get("/api/eval", authRequired, professorOnly, async (_req, res) => {
    const activities = await evalDb.all("SELECT * FROM eval_activities ORDER BY project_id, section, id");
    const activityScores = await evalDb.all("SELECT * FROM eval_activity_scores");
    const individual = await evalDb.all("SELECT * FROM eval_individual");
    const meta = await evalDb.all("SELECT * FROM eval_meta");
    const photoRows = await db.all("SELECT name, photo FROM users WHERE photo IS NOT NULL AND photo != ''");
    const memberPhotos = {};
    for (const row of photoRows) memberPhotos[row.name] = row.photo;
    return res.json({ activities, activityScores, individual, meta, memberPhotos });
  });

  app.post("/api/eval/:projectId/activities", authRequired, professorOnly, async (req, res) => {
    const projectId = Number(req.params.projectId);
    const { section, name, max_pts } = req.body || {};
    if (!["planejamento", "desenvolvimento"].includes(section)) return res.status(400).json({ error: "Seção inválida" });
    if (!name || !String(name).trim()) return res.status(400).json({ error: "Nome obrigatório" });
    const maxPts = Math.max(0, Number(max_pts) || 0);
    const created = await evalDb.run(
      "INSERT INTO eval_activities (project_id, section, name, max_pts, score) VALUES (?, ?, ?, ?, 0)",
      [projectId, section, String(name).trim(), maxPts]
    );
    return res.status(201).json({ id: String(created.lastID) });
  });

  app.patch("/api/eval/activities/:actId", authRequired, professorOnly, async (req, res) => {
    const { name, max_pts } = req.body || {};
    const act = await evalDb.get("SELECT id FROM eval_activities WHERE id = ?", [req.params.actId]);
    if (!act) return res.status(404).json({ error: "Atividade não encontrada" });
    if (name !== undefined) await evalDb.run("UPDATE eval_activities SET name = ? WHERE id = ?", [String(name).trim(), req.params.actId]);
    if (max_pts !== undefined) await evalDb.run("UPDATE eval_activities SET max_pts = ? WHERE id = ?", [Math.max(0, Number(max_pts) || 0), req.params.actId]);
    return res.json({ ok: true });
  });

  app.patch("/api/eval/activities/:actId/scores", authRequired, professorOnly, async (req, res) => {
    const { member_name, score } = req.body || {};
    if (!member_name) return res.status(400).json({ error: "member_name obrigatório" });
    const actId = Number(req.params.actId);
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
    await evalDb.run("DELETE FROM eval_activities WHERE id = ?", [req.params.actId]);
    return res.json({ ok: true });
  });

  app.patch("/api/eval/:projectId/meta", authRequired, professorOnly, async (req, res) => {
    const projectId = Number(req.params.projectId);
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
    const { member_name, score } = req.body || {};
    if (!member_name) return res.status(400).json({ error: "member_name obrigatório" });
    const cleanScore = Math.max(0, Number(score) || 0);
    const existing = await evalDb.get("SELECT project_id FROM eval_individual WHERE project_id = ? AND member_name = ?", [projectId, member_name]);
    if (!existing) {
      await evalDb.run("INSERT INTO eval_individual (project_id, member_name, score) VALUES (?, ?, ?)", [projectId, member_name, cleanScore]);
    } else {
      await evalDb.run("UPDATE eval_individual SET score = ? WHERE project_id = ? AND member_name = ?", [cleanScore, projectId, member_name]);
    }
    return res.json({ ok: true });
  });

  // ── Routing ───────────────────────────────────────────────────────────────

  // ── Super Admin: visualizador de código e banco ──────────────────────────
  const fs = require("fs").promises;
  const SUPERADM_FILES = [
    "server.js", "app.js", "index.html", "styles.css",
    "db.js", "package.json", ".env.example", "landing.html"
  ];

  app.get("/api/superadmin/files", authRequired, superAdminOnly, async (_req, res) => {
    const results = [];
    for (const filename of SUPERADM_FILES) {
      try {
        const content = await fs.readFile(path.join(__dirname, filename), "utf8");
        results.push({ name: filename, content, lines: content.split("\n").length });
      } catch (_) {
        results.push({ name: filename, content: "(arquivo não encontrado)", lines: 0 });
      }
    }
    res.json({ files: results });
  });

  app.get("/api/superadmin/db", authRequired, superAdminOnly, async (_req, res) => {
    const tables = await db.all(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
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
      "SELECT name FROM sqlite_master WHERE type='table' AND name = ?", [tableName]
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
    if (!req.file) return res.status(400).json({ error: "Arquivo inválido ou muito grande (máx 300KB)" });
    const taskId = Number(req.params.id);
    const scope = await buildVisibleScope(db, req.user);
    const task = await db.get("SELECT project_id FROM tasks WHERE id = ?", [taskId]);
    if (!task || !scope.projectIds.has(task.project_id)) {
      // Remover arquivo órfão salvo pelo multer antes da verificação de permissão
      fs.unlink(req.file.path, () => {});
      return res.status(403).json({ error: "Sem permissão" });
    }
    const r = await db.run(
      "INSERT INTO task_attachments (task_id, filename, original_name, mime_type, size, uploaded_by) VALUES (?,?,?,?,?,?)",
      [taskId, req.file.filename, req.file.originalname, req.file.mimetype, req.file.size, req.user.name]
    );
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
    const filePath = path.join(UPLOAD_DIR, att.filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Arquivo removido do servidor" });
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(att.original_name)}"`);
    res.setHeader("Content-Type", att.mime_type);
    res.sendFile(filePath);
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
    const isPO = (await db.get("SELECT 1 FROM project_members WHERE project_id=? AND member_name=? AND scrum_role='Product Owner'", [projectId, req.user.name]));
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
    const rows = await db.all("SELECT dp.*, t.turma, t.curso, t.periodo FROM doc_permissions dp JOIN turmas t ON t.id = dp.turma_id");
    return res.json(rows);
  });

  app.post("/api/docs/permissions/:turmaId/:type", authRequired, async (req, res) => {
    if (req.user.role !== "professor" && !req.user.isAdmin) return res.status(403).json({ error: "Sem permissão" });
    const type = req.params.type;
    if (!["tap","pi"].includes(type)) return res.status(400).json({ error: "Tipo inválido" });
    const turmaId = Number(req.params.turmaId);
    await db.run("INSERT OR IGNORE INTO doc_permissions (turma_id,doc_type,released_by) VALUES (?,?,?)", [turmaId, type, req.user.id]);
    return res.json({ ok: true });
  });

  app.delete("/api/docs/permissions/:turmaId/:type", authRequired, async (req, res) => {
    if (req.user.role !== "professor" && !req.user.isAdmin) return res.status(403).json({ error: "Sem permissão" });
    const type = req.params.type;
    if (!["tap","pi"].includes(type)) return res.status(400).json({ error: "Tipo inválido" });
    await db.run("DELETE FROM doc_permissions WHERE turma_id=? AND doc_type=?", [req.params.turmaId, type]);
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

  // ── SPA fallback — DEVE ficar após TODAS as rotas de API ────────────────
  const APP_ROUTES = new Set(["/dashboard","/projetos","/scrum","/kanban","/tap","/pi","/turmas","/chat","/equipes","/avaliacao","/admin","/superadmin"]);
  const APP_ROUTE_PATTERNS = [/^\/projetos\/\d+$/];
  app.get("*", (req, res) => {
    if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Rota não encontrada" });
    if (APP_ROUTES.has(req.path) || APP_ROUTE_PATTERNS.some((re) => re.test(req.path))) return serveApp(res);
    res.redirect("/landing-page");
  });

  // ── Global error handler ─────────────────────────────────────────────────
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "Arquivo muito grande (máx 300KB)" });
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
      // Aluno/professor entra nas salas dos seus projetos
      db.all(
        "SELECT project_id FROM project_members WHERE member_name = ?", [user.name]
      ).then((rows) => {
        rows.forEach((r) => socket.join(`project:${r.project_id}`));
      }).catch(() => {});
      // Professor entra em todas as salas de projetos
      if (user.role === "professor" || user.isAdmin) {
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

module.exports = { createApp };
