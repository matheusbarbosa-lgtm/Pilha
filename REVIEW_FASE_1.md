# REVIEW — Fase 1: Política de Senha Forte

**Branch:** `seguranca/fase-1-politica-senha`
**Revisor:** Codex (agente auditor)
**Data:** 2026-05-11
**Veredicto:** CHANGES_REQUESTED

---

## Resumo

Segunda rodada de auditoria após as correções do primeiro `CHANGES_REQUESTED`.
O backend agora centraliza a política forte e a aplica aos 7 fluxos exigidos. O frontend principal e o `cadastro.html` receberam barra, checklist e validação client-side; testes Jest foram adicionados e passam.

Ainda há uma lacuna no fluxo admin de criação de professor: o campo de senha temporária foi atualizado para `minlength=8`, mas não recebeu barra/checklist nem validação client-side equivalente.

---

## Checklist da fase

| Item | Status | Observação |
|------|--------|-----------|
| Backend valida mínimo 8 caracteres | ✅ OK | `server.js:65-73` |
| Backend valida presença de letra maiúscula | ✅ OK | `server.js:68` |
| Backend valida presença de número | ✅ OK | `server.js:70` |
| Backend valida presença de caractere especial | ✅ OK | `server.js:71` |
| Validação cobre TODOS os fluxos: register, register-by-turma, register-by-invite, student-onboarding, change-password, reset-password, criação de professor pelo admin | ✅ OK | Chamadas em `server.js:443`, `501`, `569`, `596`, `1573`, `1604`, `1769` |
| Senhas ANTIGAS continuam funcionando | ✅ OK | Login continua usando `bcrypt.compareSync` sobre `password_hash`; não há migração retroativa nesta fase |
| Validação retorna mensagem clara ao usuário | ✅ OK | Cada critério retorna mensagem específica em português |
| Frontend exibe barra de força de senha em tempo real | ❌ FALHOU | Corrigido em `js/auth.js` e `cadastro.html`, mas ausente em `views/admin.html:10` para criação de professor |
| Frontend exibe checklist visual dos critérios | ❌ FALHOU | Ausente no formulário `#create-professor-form` |
| Checklist visual atualiza em tempo real enquanto usuário digita | ❌ FALHOU | `attachPwStrengthUI` não é chamado para `pw-admin-prof`; `js/admin.js:33-51` não implementa validação visual |
| Testes cobrem senha válida, sem maiúscula, sem número, sem especial e abaixo de 8 chars | ✅ OK | `tests/senha.test.js` cobre os critérios por unitário e integração em `/api/auth/register` |
| `npm test`: todos os testes passando | ✅ OK | `npm.cmd test -- --runInBand --forceExit`: 1 suite, 15 testes passando |

---

## Critérios universais

| Critério | Status | Observação |
|------|--------|-----------|
| Nenhum segredo novo hardcoded no diff | ✅ OK | O diff da fase não adiciona senha, token ou chave hardcoded |
| Nenhuma variável sensível logada no diff | ✅ OK | Nenhum `console.log`/`console.warn` novo com segredo no diff |
| Nenhum endpoint novo sem autenticação indevida | ✅ OK | Não há endpoint novo; endpoints existentes mantêm guardas atuais |
| Nenhuma query SQL concatenada nova | ✅ OK | O diff não adiciona SQL concatenado |
| Nenhum dado sensível novo retornado sem necessidade | ✅ OK | Sem alteração de payload expondo `password_hash` ou token |
| Login de usuários existentes continua funcionando | ✅ OK | Comparação bcrypt e cookie `campusflow_token` inalterados |
| Schema do banco não remove/renomeia campos | ✅ OK | Sem alterações de schema |
| Endpoints existentes mantêm assinatura | ✅ OK | Path/método mantidos; validação ficou mais restritiva para novas senhas |
| Novos comportamentos têm testes correspondentes | ⚠️ ATENÇÃO | Há testes para critérios e dois endpoints; os demais fluxos fortes não têm integração específica |
| Código novo não adiciona logs/TODOs críticos | ✅ OK | Nada novo encontrado no diff |

---

## Verificação das pendências da revisão 1

| Pendência anterior | Resultado da segunda rodada |
|------|--------|
| Frontend incompleto | ❌ Parcial. `shell-top.html`, `js/auth.js` e `cadastro.html` foram corrigidos, mas `views/admin.html`/`js/admin.js` continuam sem barra/checklist/validação client-side no criar professor |
| `cadastro.html` sem validação | ✅ Resolvido. `cadastro.html:141-269` adiciona barra, checklist, listener em tempo real e validação antes do `fetch` |
| Testes ausentes | ✅ Resolvido em termos de presença. `tests/senha.test.js` foi criado e a suíte passa |

---

## Problemas encontrados

### [IMPORTANTE] Criação de professor pelo admin não tem barra/checklist nem validação client-side
- **Arquivo:** `views/admin.html`
- **Linha:** ~10
- **Descrição:** O campo `pw-admin-prof` recebeu `placeholder="mín. 8 caracteres"` e `minlength="8"`, mas não há `.pw-strength-bar`, `.pw-criteria-list` nem bind equivalente a `attachPwStrengthUI`.
- **Impacto:** A checklist da fase exige barra de força, checklist visual e atualização em tempo real no frontend. O fluxo admin de criação de professor ainda depende apenas do HTML `minlength` e da rejeição backend após submit.
- **Sugestão:** Reutilizar o mesmo padrão de `shell-top.html`: adicionar barra/checklist ao formulário admin e chamar lógica equivalente para `pw-admin-prof`; em `js/admin.js`, validar `validatePasswordStrength(payload.password)` antes do `apiFetch`.

### [SUGESTÃO] Cobertura de integração poderia incluir todos os fluxos alterados
- **Arquivo:** `tests/senha.test.js`
- **Linha:** ~75
- **Descrição:** Os testes verificam a função replicada e os endpoints `/api/auth/register` e `/api/auth/reset-password`, mas não exercitam `change-password`, `student-onboarding`, `register-by-turma`, `register-by-invite` e `/api/admin/professor`.
- **Impacto:** A inspeção de código mostra as chamadas corretas, mas regressões de wiring nesses endpoints poderiam passar.
- **Sugestão:** Adicionar pelo menos um teste de rejeição de senha fraca para cada fluxo protegido pela política.

---

## Testes

- Comando executado: `npm.cmd test -- --runInBand --forceExit`
- Resultado: 1 suite passando, 15 testes passando, 0 falhas
- Observação: `npm test` via PowerShell falhou por `ExecutionPolicy` bloqueando `npm.ps1`; a suíte foi executada com sucesso via `npm.cmd`.
- Cobertura da mudança: parcial; suficiente para provar os critérios principais, mas não cobre todos os endpoints modificados.

---

## Decisão final

**CHANGES_REQUESTED** — não aprovar ainda. Corrigir o fluxo admin de criação de professor para cumprir a checklist visual/client-side da Fase 1 e ressubmeter para nova rodada.
