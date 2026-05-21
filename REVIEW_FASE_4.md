# REVIEW — Fase 4: Argon2id

**Branch:** `seguranca/fase-1-politica-senha`
**Revisor:** Codex (agente auditor)
**Data:** 2026-05-20
**Veredicto:** APPROVED

---

## Resumo

Migração transparente de bcrypt para Argon2id. Todos os novos hashes são gerados com `argon2.hash(..., { type: argon2.argon2id })`. No login, hashes com prefixo `$2a$/`$2b$` (bcrypt) são detectados automaticamente, verificados com `bcrypt.compareSync`, e — se a senha estiver correta — o hash é imediatamente reescrito no banco com Argon2id. Usuários legados migram de forma silenciosa na próxima autenticação, sem interrupção de serviço. 8 novos testes adicionados; 34 testes passando no total.

---

## Checklist da fase

| Item | Status | Observação |
|------|--------|-----------|
| Argon2id usado em todos os novos hashes | ✅ OK | `hashPassword()` usa `argon2.hash` com `type: argon2id` |
| Migração transparente: bcrypt → Argon2id no login | ✅ OK | `verifyPassword()` detecta prefixo `$2a$/`$2b$` e sinaliza `needsRehash` |
| Hash atualizado no DB após login bem-sucedido | ✅ OK | `UPDATE users SET password_hash = ?` chamado quando `needsRehash === true` |
| Senha errada não migra hash bcrypt | ✅ OK | `needsRehash` é `true` apenas quando `valid === true` |
| bcrypt mantido apenas em db.js (seed accounts) | ✅ OK | server.js não chama mais `bcrypt.hashSync/compareSync` diretamente |
| Todas as rotas de hash de senha migradas | ✅ OK | register, reset-password, change-password, student-onboarding, register-by-turma, register-by-invite, login-email, admin create professor (8 rotas) |
| npm test: todos os testes passando | ✅ OK | 34 testes, 0 falhas (3 suítes: senha + csrf + argon2) |

---

## Critérios universais

| Critério | Status | Observação |
|------|--------|-----------|
| Nenhum segredo novo hardcoded | ✅ OK | Sem valores fixos; argon2 usa salt automático |
| Nenhuma variável sensível logada | ✅ OK | Sem novos console.log com senhas ou hashes |
| Nenhum endpoint novo sem autenticação indevida | ✅ OK | Nenhum endpoint novo |
| Nenhuma query SQL concatenada | ✅ OK | Sem alterações de queries |
| Login de usuários existentes continua funcionando | ✅ OK | verifyPassword() aceita bcrypt e migra transparentemente |
| Schema do banco inalterado | ✅ OK | Nenhuma alteração de banco — password_hash já é TEXT |
| Endpoints existentes mantêm assinatura | ✅ OK | Comportamento externo idêntico; mudança é interna |
| Novos comportamentos têm testes | ✅ OK | 8 testes Argon2id em `tests/argon2.test.js` |

---

## O que foi implementado

### 1. `server.js` — require e funções auxiliares

```javascript
const argon2 = require("argon2");

async function hashPassword(password) {
  return argon2.hash(String(password), { type: argon2.argon2id });
}

// Retorna { valid: boolean, needsRehash: boolean }
// needsRehash=true quando o hash é bcrypt e a senha está correta
async function verifyPassword(password, hash) {
  const pw = String(password);
  if (hash && hash.startsWith("$argon2")) {
    const valid = await argon2.verify(hash, pw);
    return { valid, needsRehash: false };
  }
  const valid = bcrypt.compareSync(pw, hash);
  return { valid, needsRehash: valid };
}
```

### 2. Login principal — migração transparente

```javascript
const { valid: _loginValid, needsRehash: _loginNeedsRehash } = await verifyPassword(password, user.password_hash);
if (!_loginValid) return res.status(401).json({ error: "Credenciais inválidas" });
if (_loginNeedsRehash) await db.run("UPDATE users SET password_hash = ? WHERE id = ?", [await hashPassword(password), user.id]);
```

### 3. Rotas migradas (hashSync → hashPassword)

- `/api/auth/register` — registro padrão
- `/api/auth/reset-password` — recuperação de senha
- `/api/auth/change-password` — troca de senha autenticada
- `/api/auth/student-onboarding` — onboarding de aluno
- `/api/auth/register-by-turma` — registro via turma
- `/api/auth/register-by-invite` — registro via convite
- `/api/auth/login-email` — login alternativo por e-mail (+ migração)
- `POST /api/admin/professores` — criação de professor por admin

### 4. `tests/argon2.test.js` — 8 novos testes

- 3 testes: novos registros usam Argon2id e login funciona
- 4 testes: migração transparente — login com bcrypt funciona, hash é migrado, funciona após migração, senha errada não migra
- 1 teste: change-password salva Argon2id

---

## Problemas encontrados

Nenhum problema crítico ou importante.

### [INFORMAÇÃO] bcrypt mantido em db.js para seed accounts

- **Descrição:** As contas seed (ADM, SUPER, PI) em `db.js` continuam usando `bcrypt.hashSync`. Isso é intencional — elas migram para Argon2id automaticamente na primeira autenticação em ambiente com dados reais.
- **Impacto:** Zero — a migração transparente cobre exatamente esse caso.

---

## Testes

- Comando: `npm.cmd test -- --runInBand --forceExit`
- Resultado: **34 testes passando, 0 falhas** (3 suítes: senha.test.js + csrf.test.js + argon2.test.js)
- Cobertura: novos registros, login com Argon2id, migração de bcrypt, senha errada não migra, change-password

---

## Decisão final

**APPROVED** — todos os itens críticos da Fase 4 passaram. Argon2id ativo para todos os novos hashes, migração transparente funcionando, bcrypt mantido apenas como fallback de leitura. O dono pode fazer merge após validação manual no staging.
