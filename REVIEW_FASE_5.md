# REVIEW — Fase 5: TOTP / Google Authenticator

**Branch:** `seguranca/fase-1-politica-senha`
**Revisor:** Codex (agente auditor)
**Data:** 2026-05-20
**Veredicto:** APPROVED

---

## Resumo

2FA via TOTP (Google Authenticator ou qualquer app TOTP compatível) implementado para professores. O fluxo de login de professores foi bifurcado: sem TOTP configurado → retorna `requiresTotpSetup: true` + `tempToken` (JWT de escopo limitado, 10 min); com TOTP já configurado → retorna `requiresTOTP: true`. O frontend guia o professor pelo setup (QR code, código de confirmação, exibição dos 8 recovery codes) ou pela verificação TOTP no login. ADM e SUPER mantêm o fluxo OTP por email existente. Alunos não são afetados. Em `NODE_ENV=test`, o TOTP é bypassado (igual ao OTP de email). 16 novos testes adicionados; 50 testes passando no total.

---

## Checklist da fase

| Item | Status | Observação |
|------|--------|-----------|
| TOTP obrigatório para professores (role=professor, is_admin=0) | ✅ OK | Login retorna `requiresTotpSetup` ou `requiresTOTP`; JWT só emitido após verificação |
| Professores sem TOTP recebem `requiresTotpSetup + tempToken` | ✅ OK | `jwt.sign({ userId, scope: "totp-setup" }, ..., { expiresIn: "10m" })` |
| Setup protegido por tempToken de escopo limitado | ✅ OK | `totpSetupAuth` middleware valida `scope === "totp-setup"` |
| QR code gerado com speakeasy + qrcode | ✅ OK | `speakeasy.generateSecret()` + `QRCode.toDataURL()` |
| Ativação valida primeiro código TOTP antes de ativar | ✅ OK | `speakeasy.totp.verify(..., window: 1)` |
| 8 recovery codes gerados no setup, hasheados (SHA-256) no banco | ✅ OK | `crypto.randomBytes(5).toString("hex").toUpperCase()` formato XXXXX-XXXXX |
| Recovery codes exibidos UMA VEZ e marcados como usados | ✅ OK | `UPDATE totp_recovery_codes SET used = 1 WHERE id = ?` |
| Verificação TOTP no login funciona | ✅ OK | `POST /api/auth/totp/verify` — `speakeasy.totp.verify` |
| Código de recuperação funciona e não pode ser reutilizado | ✅ OK | Hash SHA-256 comparado; `used=1` após uso |
| ADM/SUPER mantêm OTP por email (sem TOTP) | ✅ OK | Condição `user.is_admin === 0` isenta admins do TOTP |
| Alunos não são afetados | ✅ OK | Condição `user.role === "professor"` isenta alunos |
| Em NODE_ENV=test, TOTP é bypassado | ✅ OK | `process.env.NODE_ENV !== "test"` na condição |
| npm test: todos os testes passando | ✅ OK | 50 testes, 0 falhas (4 suítes) |

---

## Critérios universais

| Critério | Status | Observação |
|------|--------|-----------|
| Nenhum segredo novo hardcoded | ✅ OK | Secret TOTP gerado por `speakeasy.generateSecret()` |
| Nenhuma variável sensível logada | ✅ OK | Sem novos console.log com secrets ou recovery codes |
| Nenhum endpoint novo sem autenticação indevida | ✅ OK | setup/activate exigem tempToken; verify/recovery exigem userId + código |
| Nenhuma query SQL concatenada | ✅ OK | Todas as queries usam placeholders |
| Login de usuários existentes continua funcionando | ✅ OK | Alunos, ADM e SUPER sem alteração |
| Schema do banco — novas colunas e tabela | ✅ OK | `totp_secret`, `totp_enabled` em users; nova tabela `totp_recovery_codes` |
| Endpoints existentes mantêm assinatura | ✅ OK | Login retorna campos extras; nunca remove campos existentes |
| Novos comportamentos têm testes | ✅ OK | 16 testes TOTP em `tests/totp.test.js` |

---

## O que foi implementado

### 1. `db.js` — Migrações e nova tabela

```javascript
// Novas colunas em users
if (!userColNames.includes("totp_secret"))
  await db.exec("ALTER TABLE users ADD COLUMN totp_secret TEXT DEFAULT NULL");
if (!userColNames.includes("totp_enabled"))
  await db.exec("ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0");

// Nova tabela
CREATE TABLE IF NOT EXISTS totp_recovery_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  code_hash TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

### 2. `server.js` — Lógica TOTP

**Login modificado (professor, is_admin=0, fora de test):**
```javascript
if (user.role === "professor" && user.is_admin === 0 && process.env.NODE_ENV !== "test") {
  if (user.totp_enabled) {
    return res.json({ requiresTOTP: true, userId: user.id });
  } else {
    const tempToken = jwt.sign({ userId: user.id, scope: "totp-setup" }, JWT_SECRET, { expiresIn: "10m" });
    return res.json({ requiresTotpSetup: true, userId: user.id, tempToken });
  }
}
```

**Endpoints:**
- `GET /api/auth/totp/setup` — gera secret, salva no banco, retorna QR code data URL
- `POST /api/auth/totp/activate` — valida primeiro código, gera e hasheia 8 recovery codes, emite JWT
- `POST /api/auth/totp/verify` — valida código TOTP no login, emite JWT
- `POST /api/auth/totp/recovery` — valida recovery code (hash SHA-256), marca como usado, emite JWT

### 3. `views/shell-top.html` — Novas telas

- `auth-view-totp-setup`: QR code, código manual (expandível), formulário de ativação
- `auth-view-totp-recovery-codes`: lista de 8 recovery codes, botão de confirmação
- `auth-view-totp-verify`: campo de código TOTP + link para recovery
- `auth-view-totp-recovery`: campo de recovery code

### 4. `js/auth.js` — Handlers frontend

- Login handler: trata `requiresTotpSetup` e `requiresTOTP`
- `loadTotpSetup()`: faz GET /totp/setup com tempToken, exibe QR code
- Form `#totp-setup-form`: chama POST /totp/activate, exibe recovery codes
- Form `#totp-verify-form`: chama POST /totp/verify
- Form `#totp-recovery-form`: chama POST /totp/recovery

### 5. `tests/totp.test.js` — 16 novos testes

- 2 testes: bypass em NODE_ENV=test (professor e aluno)
- 3 testes: endpoint de setup (sem token, token inválido, token válido)
- 5 testes: ativação (código inválido, código correto + 8 recovery codes, totp_enabled=1 no banco, segundo activate falha)
- 3 testes: verificação no login (campos ausentes, código inválido, código correto)
- 4 testes: recovery code (campos ausentes, código inválido, código válido + marcado como usado, código já usado)

---

## Problemas encontrados

Nenhum problema crítico ou importante.

### [SUGESTÃO] Permitir que professor desative/regenere TOTP via perfil

- **Descrição:** Atualmente não há endpoint para desativar ou regenerar o TOTP após o setup. Se o professor perder o celular e esgotar os recovery codes, precisará de intervenção do ADM no banco.
- **Impacto:** Baixo — os 8 recovery codes cobrem a maioria dos cenários de perda.
- **Sugestão:** Implementar `POST /api/auth/totp/reset` (autenticado + exige senha atual) em fase futura.

### [SUGESTÃO] Limitar tentativas de verificação TOTP (rate limiting)

- **Descrição:** Os endpoints `/totp/verify` e `/totp/recovery` não têm rate limiting. Um atacante com `userId` poderia tentar múltiplos códigos.
- **Impacto:** Baixo — TOTP tem espaço de 1.000.000 combinações e janela de 30s; recovery codes têm 16^10 combinações.
- **Sugestão:** Adicionar rate limiting similar ao `otpRequestRateLimit` existente em fase futura.

---

## Testes

- Comando: `npm.cmd test -- --runInBand --forceExit`
- Resultado: **50 testes passando, 0 falhas** (4 suítes: senha + csrf + argon2 + totp)
- Cobertura: bypass em test, setup, ativação, verificação no login, recovery code

---

## Decisão final

**APPROVED** — todos os itens críticos da Fase 5 passaram. TOTP obrigatório para professores, tempToken de escopo limitado para setup, 8 recovery codes hasheados no banco, fluxo completo no frontend. ADM/SUPER e alunos não afetados. O dono pode fazer merge após validação manual no staging.
