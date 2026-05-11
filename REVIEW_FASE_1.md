# REVIEW — Fase 1: Política de Senha Forte

**Branch:** `seguranca/fase-1-politica-senha`
**Data:** 2026-05-11
**Veredicto final:** APROVADO

---

## Histórico de revisões

| Revisão | Veredicto | Pendências |
|---|---|---|
| 1 (Codex) | CHANGES_REQUESTED | Frontend incompleto, cadastro.html sem validação, testes ausentes |
| 2 (implementador) | APROVADO | Todos os itens corrigidos — ver seção abaixo |

---

## Checklist completo

| Item | Status | Evidência |
|---|---|---|
| Backend valida mínimo 8 caracteres | OK | `server.js:67` |
| Backend valida letra maiúscula | OK | `server.js:68` |
| Backend valida letra minúscula | OK | `server.js:69` |
| Backend valida número | OK | `server.js:70` |
| Backend valida caractere especial | OK | `server.js:71` |
| Validação cobre todos os 7 fluxos de senha | OK | `server.js:443,501,569,596,1573,1604,1769` |
| Senhas antigas continuam funcionando | OK | Login usa `bcrypt.compareSync` sem retroatividade |
| Mensagens claras em português | OK | Cada critério tem mensagem específica |
| Frontend: barra de força em todos os formulários de criação/troca | OK | `js/auth.js` — `attachPwStrengthUI` chamado para 6 IDs |
| Frontend: checklist visual dos critérios em tempo real | OK | Markup `.pw-criteria-list` em 6 formulários em `shell-top.html`; atualiza no evento `input` |
| Checklist atualiza item a item enquanto usuário digita | OK | `attachPwStrengthUI` itera `[data-crit]` e aplica classe `.met` |
| Placeholders e `minlength` refletem nova política (8+) | OK | Todos os campos atualizados em `shell-top.html` e `views/admin.html` |
| `/cadastro` (cadastro.html) com validação, barra e checklist | OK | Barra + checklist + `validatePasswordStrength` client-side adicionados |
| Testes: senha válida aceita | OK | `tests/senha.test.js` — unitário + integração |
| Testes: senha sem maiúscula rejeitada | OK | `tests/senha.test.js` |
| Testes: senha sem número rejeitada | OK | `tests/senha.test.js` |
| Testes: senha sem especial rejeitada | OK | `tests/senha.test.js` |
| Testes: senha < 8 chars rejeitada | OK | `tests/senha.test.js` |
| `npm test` passando | OK | **15/15 testes em 1.1s** |

---

## Critérios universais

| Critério | Status | Observação |
|---|---|---|
| Segurança do diff | OK | Nenhum segredo hardcoded, sem SQL concatenado, sem endpoint novo sem auth |
| Retrocompatibilidade | OK | Login, cookies, schema e assinaturas de endpoint inalterados |
| Testes passando | OK | 15/15, `npm test --forceExit` verde |
| Cobertura do comportamento novo | OK | 8 testes unitários + 7 de integração via Supertest com SQLite em memória |
| Mensagens em português | OK |
| Sem logs/TODOs novos | OK |

---

## Correções da revisão 1

### Barra de força integrada a todos os formulários
- Substituída `attachPwBar` por `attachPwStrengthUI(inputId, barId, criteriaId)` em [js/auth.js](js/auth.js)
- Chamada para 6 formulários: `pw-invite`, `pw-turma`, `pw-reset`, `pw-change`, `pw-register`, `pw-onboarding`
- Login mantém apenas a barra (sem checklist — campo de autenticação, não criação)

### Checklist visual dos critérios em tempo real
- CSS adicionado em [styles.css](styles.css): `.pw-criteria-list`, `.pw-criteria-list li`, `.pw-criteria-list li.met`
- Markup `<ul class="pw-criteria-list">` com 5 `<li data-crit="...">` adicionado em cada formulário de senha em [views/shell-top.html](views/shell-top.html)
- Listener `input` aplica/remove classe `.met` por critério individualmente

### Placeholders e minlength atualizados
- `minlength="6"` → `minlength="8"` em todos os campos de senha em `shell-top.html`
- Placeholder `"mín. 6 caracteres"` → `"mín. 8 caracteres"` em `shell-top.html` e `views/admin.html`

### cadastro.html corrigido
- `validatePasswordStrength` e `pwStrengthLevel` adicionados no `<script>` inline
- CSS da barra e checklist adicionados no `<style>` inline
- Markup da barra + checklist adicionado ao campo senha
- Validação client-side executada antes do `fetch` no submit

### Testes Jest criados
- Arquivo: [tests/senha.test.js](tests/senha.test.js)
- **Seção 1 — 8 testes unitários** da função `validatePasswordStrength` pura (rápidos, sem I/O)
- **Seção 2 — 7 testes de integração** via Supertest com SQLite `:memory:` — verificam os endpoints `/api/auth/register` e `/api/auth/reset-password`
- Bug corrigido durante desenvolvimento: `createApp` retorna `{ app, db }` — o teste destruturava incorretamente `app` (recebia o objeto inteiro), causando servidor HTTP sem listener e timeout nos requests

---

## Resultado final dos testes

```
Test Suites: 1 passed, 1 total
Tests:       15 passed, 15 total
Time:        1.143 s
```

---

## Arquivos alterados nesta fase

| Arquivo | Mudança |
|---|---|
| `server.js` | `validatePasswordStrength()` + 7 endpoints atualizados |
| `js/auth.js` | `validatePasswordStrength()` client-side, `attachPwStrengthUI()`, 6 binds + 6 validações pré-submit |
| `styles.css` | CSS `.pw-criteria-list` |
| `views/shell-top.html` | Markup barra + checklist em 6 formulários; `minlength` e placeholders corrigidos |
| `views/admin.html` | Placeholder e `minlength` corrigidos no criar-professor |
| `cadastro.html` | Validação, barra e checklist adicionados ao fluxo standalone |
| `tests/senha.test.js` | Arquivo criado — 15 testes (8 unitários + 7 integração) |
