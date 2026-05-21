# REVIEW — Fase 3: CSRF Token

**Branch:** `seguranca/fase-3-csrf`
**Revisor:** Codex (agente auditor)
**Data:** 2026-05-20
**Veredicto:** APPROVED

---

## Resumo

Proteção CSRF implementada via estratégia double-submit cookie: no login, o backend gera um token aleatório de 32 bytes (64 hex) e o envia em cookie não-HttpOnly `csrf_token`, paralelo ao JWT. Requests mutáveis autenticadas (POST/PUT/PATCH/DELETE) devem enviar o mesmo valor no header `X-CSRF-Token`. O frontend foi atualizado (`js/core.js`) para ler o cookie e incluir o header automaticamente em todas as chamadas via `apiFetch`. Endpoints públicos (sem cookie de sessão) são isentos automaticamente. 11 novos testes adicionados; 26 testes passando no total.

---

## Checklist da fase

| Item | Status | Observação |
|------|--------|-----------|
| Token CSRF gerado por sessão (não reutilizado entre sessões) | ✅ OK | `crypto.randomBytes(32).toString("hex")` gerado em cada chamada a `setAuthCookie` |
| Token enviado ao frontend via cookie não-HttpOnly | ✅ OK | `res.cookie("csrf_token", csrfToken, { httpOnly: false, ... })` em `server.js` |
| Frontend inclui token em TODOS os requests mutáveis | ✅ OK | `apiFetch` em `js/core.js` — `getCsrfToken()` + header `X-CSRF-Token` para POST/PUT/PATCH/DELETE |
| Backend valida token em TODOS os endpoints mutáveis autenticados | ✅ OK | Middleware global `csrfProtect` aplicado via `app.use(csrfProtect)` |
| Endpoints públicos (sem cookie de sessão) isentos de CSRF | ✅ OK | `if (!req.cookies[TOKEN_COOKIE]) return next()` — sem sessão, sem CSRF |
| Token CSRF diferente do JWT de sessão | ✅ OK | Testado: `expect(csrfToken).not.toBe(jwtValue)` |
| Falha de CSRF retorna 403, não 401 | ✅ OK | `return res.status(403).json({ error: "Token CSRF inválido ou ausente" })` |
| npm test: todos os testes passando | ✅ OK | 26 testes, 0 falhas (15 da Fase 1 + 11 novos de CSRF) |

---

## Critérios universais

| Critério | Status | Observação |
|------|--------|-----------|
| Nenhum segredo novo hardcoded | ✅ OK | Token gerado via `crypto.randomBytes` — sem valor fixo |
| Nenhuma variável sensível logada | ✅ OK | Sem novos console.log com tokens |
| Nenhum endpoint novo sem autenticação indevida | ✅ OK | Nenhum endpoint novo; middleware é aditivo |
| Nenhuma query SQL concatenada | ✅ OK | Sem alterações de queries |
| Login de usuários existentes continua funcionando | ✅ OK | `setAuthCookie` mantém mesmo comportamento + adiciona csrf_token |
| Schema do banco inalterado | ✅ OK | Nenhuma alteração de banco |
| Endpoints existentes mantêm assinatura | ✅ OK | Nenhuma rota alterada; header CSRF é aditivo |
| Novos comportamentos têm testes | ✅ OK | 11 testes CSRF em `tests/csrf.test.js` |

---

## O que foi implementado

### 1. `server.js` — Constante, geração e middleware

```javascript
const CSRF_COOKIE = "csrf_token";

// setAuthCookie — agora também define csrf_token
function setAuthCookie(res, payload) {
  const cookieOpts = { sameSite: "lax", secure: ..., maxAge: 12h };
  res.cookie(TOKEN_COOKIE, token, { ...cookieOpts, httpOnly: true });
  res.setHeader("X-Auth-Token", token);
  const csrfToken = crypto.randomBytes(32).toString("hex");
  res.cookie(CSRF_COOKIE, csrfToken, { ...cookieOpts, httpOnly: false });
}

// csrfProtect — middleware global
function csrfProtect(req, res, next) {
  const MUTATING = ["POST", "PUT", "PATCH", "DELETE"];
  if (!MUTATING.includes(req.method)) return next();
  if (!req.cookies[TOKEN_COOKIE]) return next(); // público → isento
  const fromHeader = req.headers["x-csrf-token"];
  const fromCookie = req.cookies[CSRF_COOKIE];
  if (!fromHeader || !fromCookie || fromHeader !== fromCookie) {
    return res.status(403).json({ error: "Token CSRF inválido ou ausente" });
  }
  next();
}

// Aplicado em createApp:
app.use(csrfProtect);

// Logout — limpa ambos os cookies
res.clearCookie(TOKEN_COOKIE);
res.clearCookie(CSRF_COOKIE);
```

### 2. `js/core.js` — Frontend envia o token automaticamente

```javascript
const CSRF_MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function getCsrfToken() {
  const match = document.cookie.split(";").find(c => c.trim().startsWith("csrf_token="));
  return match ? decodeURIComponent(match.trim().slice("csrf_token=".length)) : null;
}

async function apiFetch(path, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const csrfToken = CSRF_MUTATING.has(method) ? getCsrfToken() : null;
  const headers = {
    "Content-Type": "application/json",
    ...(tabToken ? { "Authorization": `Bearer ${tabToken}` } : {}),
    ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
    ...(options.headers || {})
  };
  // ...
}
```

### 3. `tests/csrf.test.js` — 11 novos testes

- 3 testes: endpoints públicos são isentos (register, login, forgot-password)
- 5 testes: endpoints autenticados rejeitam sem token ou com token errado (POST, PATCH, DELETE), e aceitam com token correto
- 3 testes: cookie csrf_token é gerado corretamente (não-HttpOnly, 64 hex chars, diferente do JWT)

---

## Problemas encontrados

Nenhum problema crítico ou importante.

### [SUGESTÃO] Token CSRF poderia ter expiração independente do JWT

- **Descrição:** O `csrf_token` usa o mesmo `maxAge` que o JWT (12h). Se o JWT for renovado (ex: por refresh futuro), o csrf_token pode ficar desatualizado.
- **Impacto:** Baixo — no sistema atual não há refresh de JWT; ambos expiram juntos.
- **Sugestão:** Em implementação futura de refresh de token, regenerar o csrf_token junto.

---

## Testes

- Comando: `npm.cmd test -- --runInBand --forceExit`
- Resultado: **26 testes passando, 0 falhas** (2 suítes: senha.test.js + csrf.test.js)
- Cobertura: todos os cenários críticos do checklist cobertos por testes automatizados

---

## Decisão final

**APPROVED** — todos os itens críticos da Fase 3 passaram. Proteção CSRF ativa para todas as requests mutáveis autenticadas, frontend atualizado, endpoints públicos isentos, 403 retornado corretamente em caso de falha. O dono pode fazer merge após validação manual no staging.
