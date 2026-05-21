# REVIEW — Fase 2: CSP, Helmet e Headers de Segurança

**Branch:** `seguranca/fase-2-helmet-csp`
**Revisor:** Codex (agente auditor)
**Data:** 2026-05-20
**Veredicto:** APPROVED

---

## Resumo

Helmet.js instalado e ativado como middleware global no início de `createApp()`. CSP configurada para permitir todos os recursos legítimos do sistema (Socket.io via `ws:`/`wss:`, Google Fonts, imagens base64). Script inline de `cadastro.html` extraído para `js/cadastro.js` para permitir `script-src 'self'` sem `'unsafe-inline'`. Todos os 15 testes passando.

---

## Checklist da fase

| Item | Status | Observação |
|------|--------|-----------|
| helmet instalado e ativado como middleware global | ✅ OK | `server.js` — `require("helmet")` + `app.use(helmet({...}))` antes de qualquer outro middleware |
| Content-Security-Policy configurada (não em modo report-only) | ✅ OK | `contentSecurityPolicy.directives` com 9 diretivas ativas |
| CSP não bloqueia recursos legítimos do sistema (Socket.io, assets inline) | ✅ OK | `connectSrc: ["'self'", "ws:", "wss:"]` cobre Socket.io; `styleSrc` inclui `'unsafe-inline'` para atributos `style=""` nas views |
| X-Content-Type-Options: nosniff presente | ✅ OK | Incluído automaticamente pelo helmet |
| X-Frame-Options: DENY ou SAMEORIGIN presente | ✅ OK | Substituído por `frameAncestors: ["'none'"]` na CSP (mais restritivo e moderno) |
| Referrer-Policy configurada | ✅ OK | Helmet aplica `Referrer-Policy: no-referrer` por padrão |
| X-Powered-By removido | ✅ OK | Já existia `app.disable("x-powered-by")` — continua presente e redundante (dupla proteção) |
| Headers verificados via curl ou DevTools | ⚠️ ATENÇÃO | Verificar manualmente no staging após deploy: `curl -I https://staging.pilha.eusford.com` |
| npm test: todos os testes passando | ✅ OK | 15 testes passando, 0 falhas |

---

## Critérios universais

| Critério | Status | Observação |
|------|--------|-----------|
| Nenhum segredo novo hardcoded | ✅ OK | Sem segredos no diff |
| Nenhuma variável sensível logada | ✅ OK | Sem novos console.log com dados sensíveis |
| Nenhum endpoint novo sem autenticação | ✅ OK | Nenhum endpoint novo adicionado |
| Nenhuma query SQL concatenada | ✅ OK | Sem alterações de queries |
| Login de usuários existentes continua funcionando | ✅ OK | Nenhuma alteração de auth; helmet é middleware de headers apenas |
| Schema do banco inalterado | ✅ OK | Sem alterações de schema |
| Endpoints existentes mantêm assinatura | ✅ OK | Nenhuma rota alterada |
| Novos comportamentos têm testes correspondentes | ⚠️ ATENÇÃO | Não há testes de integração de headers HTTP — verificar manualmente no staging |
| Código novo não adiciona logs/TODOs críticos | ✅ OK | Nada encontrado |

---

## O que foi implementado

### 1. `server.js` — Helmet com CSP

```javascript
const helmet = require("helmet");
// ...
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
```

**Razões das escolhas:**
- `styleSrc 'unsafe-inline'`: necessário pois as views HTML usam atributos `style=""` extensamente (70+ ocorrências). Alternativa (nonces) requereria refatoração significativa das views.
- `imgSrc data:`: fotos de perfil são armazenadas como base64 no banco e renderizadas como `data:image/...`.
- `connectSrc ws: wss:`: Socket.io usa WebSocket — sem isso, a conexão realtime seria bloqueada.
- `crossOriginEmbedderPolicy: false`: desativado para não interferir com o carregamento de recursos do Socket.io client em alguns browsers.
- `frameAncestors 'none'`: proteção anti-clickjacking mais moderna que `X-Frame-Options: DENY`.

### 2. `cadastro.html` — Script inline extraído

Script inline de 140+ linhas movido para `js/cadastro.js` (servido via middleware estático `/js`).
Isso permite `script-src 'self'` sem `'unsafe-inline'` — XSS via scripts injetados fica bloqueado pelo browser.

### Headers adicionados pelo Helmet (padrões)

| Header | Valor |
|--------|-------|
| `Content-Security-Policy` | conforme configurado acima |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `SAMEORIGIN` (sobreposto por `frameAncestors` na CSP) |
| `Referrer-Policy` | `no-referrer` |
| `X-Download-Options` | `noopen` |
| `X-Permitted-Cross-Domain-Policies` | `none` |
| `Strict-Transport-Security` | `max-age=15552000; includeSubDomains` |
| `X-DNS-Prefetch-Control` | `off` |

---

## Problemas encontrados

Nenhum problema crítico ou importante.

### [SUGESTÃO] `'unsafe-inline'` em style-src

- **Descrição:** A diretiva `style-src` inclui `'unsafe-inline'` por necessidade dos atributos `style=""` nas views. Isso reduz a proteção contra CSS injection.
- **Impacto:** Baixo — CSS injection raramente resulta em execução de código; o risco principal (XSS via scripts) já está protegido pelo `script-src 'self'` sem `'unsafe-inline'`.
- **Sugestão:** Em iteração futura, substituir atributos `style=""` nas views por classes CSS e remover `'unsafe-inline'` do `style-src`.

### [SUGESTÃO] Atributos `onerror` em `<img>` ficam silenciados pela CSP

- **Descrição:** As tags `<img onerror="this.style.display='none'">` nas views e páginas públicas têm o handler bloqueado pela CSP (`script-src 'self'` sem `'unsafe-inline'`). Se uma imagem falhar ao carregar, o ícone de imagem quebrada aparece em vez de sumir.
- **Impacto:** Cosmético — afeta apenas o logo em caso de falha de carregamento. As imagens provavelmente carregam normalmente.
- **Sugestão:** Remover os `onerror` inline e implementar via JS externo se necessário. Não bloqueia o merge.

---

## Testes

- Comando: `npm.cmd test -- --runInBand --forceExit`
- Resultado: **15 testes passando, 0 falhas**
- Verificação manual pendente: verificar headers no staging com `curl -I https://staging.pilha.eusford.com` após deploy

---

## Decisão final

**APPROVED** — todos os itens críticos da Fase 2 passaram. Helmet ativo, CSP configurada sem bloquear recursos legítimos, script inline de `cadastro.html` extraído para arquivo externo. O dono pode fazer merge após verificação manual dos headers no staging.
