# BACKLOG_SEGURANCA.md — Fases de Segurança do PILHA

> Backlog estruturado para refatoração incremental de segurança.
> Cada fase é independente, tem branch própria e passa por revisão do Codex antes do merge.
> **Ordem obrigatória:** não pular fases. Cada fase depende da anterior estar em produção.

---

## Status geral

| Fase | Nome | Status | Branch |
|------|------|--------|--------|
| 1 | Política de senha forte | ✅ Concluída (APPROVED) | `seguranca/fase-1-politica-senha` |
| 2 | CSP, Helmet e headers | ✅ Concluída (APPROVED) | `seguranca/fase-2-helmet-csp` |
| 3 | CSRF token | ✅ Concluída (APPROVED) | `seguranca/fase-3-csrf` |
| 4 | Migração bcrypt → Argon2id | ✅ Concluída (APPROVED) | `seguranca/fase-1-politica-senha` |
| 5 | TOTP / Google Authenticator | ✅ Concluída (APPROVED) | `seguranca/fase-1-politica-senha` |

Legenda: 🔲 Pendente | 🔄 Em andamento | 👀 Em revisão | ✅ Concluída | ❌ Bloqueada

---

## Fase 1 — Política de senha forte

**Branch:** `seguranca/fase-1-politica-senha`
**Risco:** Baixo — não quebra login de ninguém (senhas antigas continuam válidas)
**Esforço estimado:** 2-4 horas
**Dependências:** nenhuma

### Contexto

Hoje o sistema valida apenas mínimo de 6 caracteres. O PDF da especificação 2.0 exige política mais forte. Senhas fracas são o vetor de ataque mais comum.

### Regra de negócio

```
Senha válida deve ter:
- Mínimo 8 caracteres
- Pelo menos 1 letra maiúscula (A-Z)
- Pelo menos 1 número (0-9)
- Pelo menos 1 caractere especial (!@#$%^&*()_+-=[]{}|;:,.<>?)

Senhas existentes: continuam válidas até o usuário trocar voluntariamente.
Senhas novas (registro, reset, troca): devem seguir a nova política.
Mensagem de erro: específica por critério, em português.
```

### Tarefas do implementador (Claude Code)

#### Backend — `server.js`

**1. Criar função de validação centralizada** (adicionar perto do topo do arquivo, após os requires):

```javascript
function validatePasswordStrength(password) {
  const errors = [];
  if (!password || password.length < 8)
    errors.push('A senha deve ter no mínimo 8 caracteres');
  if (!/[A-Z]/.test(password))
    errors.push('A senha deve conter pelo menos uma letra maiúscula');
  if (!/[0-9]/.test(password))
    errors.push('A senha deve conter pelo menos um número');
  if (!/[!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/.test(password))
    errors.push('A senha deve conter pelo menos um caractere especial');
  return errors;
}
```

**2. Aplicar nos seguintes endpoints** (substituir validação atual de 6 chars):

```
POST /api/auth/register
POST /api/auth/register-by-turma
POST /api/auth/register-by-invite
POST /api/auth/student-onboarding
POST /api/auth/change-password
POST /api/auth/reset-password
POST /api/admin/professor  (criação de professor pelo admin)
```

Padrão de uso:
```javascript
const pwdErrors = validatePasswordStrength(password);
if (pwdErrors.length > 0) {
  return res.status(400).json({ error: pwdErrors.join('. ') });
}
```

**3. NÃO aplicar em:**
```
POST /api/auth/login          — login não valida força, só compara hash
POST /api/auth/login-email    — idem
POST /api/auth/verify-otp     — não envolve senha
POST /api/auth/request-otp    — não envolve senha
```

#### Frontend — `js/auth.js`

**4. Adicionar validação client-side** (antes do submit, para feedback imediato):

```javascript
function checkPasswordStrength(password) {
  return {
    length: password.length >= 8,
    uppercase: /[A-Z]/.test(password),
    number: /[0-9]/.test(password),
    special: /[!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/.test(password)
  };
}
```

**5. Adicionar barra de força visual e checklist** nos formulários que têm campo de senha nova:
- Tela de registro
- Tela de onboarding
- Tela de troca de senha
- Tela de reset de senha

HTML a adicionar após o campo de senha:
```html
<div id="password-strength-container" style="display:none; margin-top:8px;">
  <div id="strength-bar" style="height:4px; border-radius:2px; background:#eee; margin-bottom:8px;">
    <div id="strength-fill" style="height:100%; border-radius:2px; width:0%; transition:width .3s, background .3s;"></div>
  </div>
  <ul id="password-checklist" style="list-style:none; padding:0; margin:0; font-size:12px;">
    <li id="check-length">⬜ Mínimo 8 caracteres</li>
    <li id="check-upper">⬜ Uma letra maiúscula</li>
    <li id="check-number">⬜ Um número</li>
    <li id="check-special">⬜ Um caractere especial</li>
  </ul>
</div>
```

JavaScript para atualizar em tempo real:
```javascript
passwordInput.addEventListener('input', function() {
  const val = this.value;
  const checks = checkPasswordStrength(val);
  const passed = Object.values(checks).filter(Boolean).length;

  document.getElementById('password-strength-container').style.display = val ? 'block' : 'none';
  document.getElementById('check-length').textContent  = (checks.length  ? '✅' : '⬜') + ' Mínimo 8 caracteres';
  document.getElementById('check-upper').textContent   = (checks.uppercase? '✅' : '⬜') + ' Uma letra maiúscula';
  document.getElementById('check-number').textContent  = (checks.number  ? '✅' : '⬜') + ' Um número';
  document.getElementById('check-special').textContent = (checks.special ? '✅' : '⬜') + ' Um caractere especial';

  const colors = ['#eee', '#e53e3e', '#ed8936', '#ecc94b', '#48bb78'];
  const fill = document.getElementById('strength-fill');
  fill.style.width = (passed * 25) + '%';
  fill.style.background = colors[passed];
});
```

#### Testes — criar arquivo `tests/auth.test.js` (se não existir) ou adicionar nos existentes

**6. Adicionar testes de política de senha:**

```javascript
describe('Política de senha forte', () => {
  test('rejeita senha menor que 8 chars', async () => {
    const res = await request(app).post('/api/auth/register')
      .send({ username: 'test', name: 'Test', role: 'aluno', email: 'test@test.com', password: 'Ab1!' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/8 caracteres/);
  });

  test('rejeita senha sem maiúscula', async () => {
    const res = await request(app).post('/api/auth/register')
      .send({ username: 'test2', name: 'Test', role: 'aluno', email: 'test2@test.com', password: 'abcd1234!' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/maiúscula/);
  });

  test('rejeita senha sem número', async () => {
    const res = await request(app).post('/api/auth/register')
      .send({ username: 'test3', name: 'Test', role: 'aluno', email: 'test3@test.com', password: 'Abcdefgh!' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/número/);
  });

  test('rejeita senha sem caractere especial', async () => {
    const res = await request(app).post('/api/auth/register')
      .send({ username: 'test4', name: 'Test', role: 'aluno', email: 'test4@test.com', password: 'Abcdefg1' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/especial/);
  });

  test('aceita senha forte válida', async () => {
    const res = await request(app).post('/api/auth/register')
      .send({ username: 'test5', name: 'Test', role: 'aluno', email: 'test5@test.com', password: 'Senha@123' });
    expect(res.status).toBe(201);
  });
});
```

### Plano de rollback

Se algo quebrar em produção após o merge:

```bash
# Na VPS
cd /opt/sites/pilha
git log --oneline -5          # identifica o commit anterior
git revert HEAD               # cria commit de reversão
docker compose -f docker-compose.prod.yml up -d --build
```

A reversão é segura porque: nenhum dado do banco foi alterado, nenhum schema foi modificado, apenas validações foram adicionadas.

### Critério de aceite

- [ ] `npm test` passando (mínimo 52, idealmente 57+ com os novos)
- [ ] Testado manualmente no staging: registro com senha fraca é rejeitado
- [ ] Testado manualmente no staging: registro com senha forte funciona
- [ ] Testado manualmente no staging: login de usuário existente (senha bcrypt antiga) continua funcionando
- [ ] Barra de força aparece nos formulários de senha
- [ ] Codex emitiu veredicto `APPROVED`

---

## Fase 2 — CSP, Helmet e headers de segurança

**Branch:** `seguranca/fase-2-helmet-csp`
**Risco:** Baixo-médio — pode quebrar carregamento de recurso externo se CSP mal configurada
**Esforço estimado:** 2-3 horas
**Dependências:** Fase 1 concluída e em produção

### Contexto

O sistema não tem headers de segurança padrão. Qualquer site pode embedar o PILHA em iframe, scripts inline não têm política, e não há proteção contra clickjacking.

### Tarefas do implementador

```
1. npm install helmet
2. Adicionar app.use(helmet()) após a criação do app
3. Configurar CSP permitindo:
   - self para scripts, styles, fonts
   - ws: e wss: para Socket.io
   - data: para imagens base64 (fotos de perfil)
4. Testar que sistema funciona após CSP (Socket.io conecta, uploads funcionam)
5. Verificar headers com: curl -I https://staging.pilha.eusford.com
6. npm test passando
```

### Plano de rollback

```bash
# Reverter commit do helmet
git revert HEAD
docker compose -f docker-compose.prod.yml up -d --build
```

---

## Fase 3 — CSRF token

**Branch:** `seguranca/fase-3-csrf`
**Risco:** Médio — frontend precisa enviar token em todos os requests mutáveis
**Esforço estimado:** 4-6 horas
**Dependências:** Fase 2 concluída e em produção

### Contexto

O sistema usa cookie HttpOnly para sessão, o que já mitiga alguns ataques. Mas sem CSRF token explícito, um site malicioso pode forjar requests autenticados se o usuário estiver logado.

### Tarefas do implementador

```
1. npm install csrf (ou implementar double-submit cookie manualmente)
2. Gerar token CSRF no login e salvar em cookie não-HttpOnly (legível pelo JS)
3. Middleware de validação CSRF em todos os routes mutáveis autenticados
4. Atualizar apiFetch em js/core.js para incluir header X-CSRF-Token em toda request
5. Isentar endpoints públicos: /api/auth/login, /api/auth/register, /api/auth/forgot-password
6. Testes: request sem token retorna 403, request com token válido passa
7. npm test passando
```

### Plano de rollback

```bash
git revert HEAD
docker compose -f docker-compose.prod.yml up -d --build
```

---

## Fase 4 — Migração bcrypt → Argon2id

**Branch:** `seguranca/fase-4-argon2id`
**Risco:** Alto — envolve o coração do sistema de autenticação
**Esforço estimado:** 3-4 horas + testes extensivos
**Dependências:** Fase 3 concluída e em produção

### Contexto

bcrypt é seguro mas Argon2id é o padrão moderno recomendado pelo OWASP. A migração deve ser **completamente transparente** para os usuários — eles não percebem nada.

### Estratégia de migração transparente

```
Login com senha correta (hash bcrypt antigo):
  1. bcrypt.compare() retorna true
  2. Sistema gera novo hash Argon2id silenciosamente
  3. Atualiza password_hash no banco
  4. Usuário loga normalmente
  5. Na próxima vez que logar, já usa Argon2id

Login com senha correta (hash Argon2id novo):
  1. argon2.verify() retorna true
  2. Login normal, sem re-hash

Login com senha errada:
  1. Tenta Argon2id → falha
  2. Tenta bcrypt → falha
  3. Retorna 401 (mesmo comportamento de antes)
```

### Tarefas do implementador

```
1. npm install argon2
2. Criar função hashPassword(password) que usa argon2id
3. Criar função verifyPassword(password, hash) que detecta algoritmo pelo prefixo:
   - Hash começa com $argon2id → usa argon2.verify()
   - Hash começa com $2a$ ou $2b$ → usa bcrypt.compare()
   - Se bcrypt retornar true → re-hasheia em argon2id e salva no banco
4. Substituir todos os bcrypt.hash() por hashPassword()
5. Substituir todos os bcrypt.compare() por verifyPassword()
6. Testes: migração transparente, novos hashes são argon2id, senhas antigas continuam funcionando
7. npm test passando
```

### Plano de rollback

```bash
git revert HEAD
docker compose -f docker-compose.prod.yml up -d --build
# Usuários que já migraram para argon2id precisarão resetar senha
# (Por isso staging deve ser testado exaustivamente antes do merge em produção)
```

**Atenção:** esta é a fase com rollback mais complexo. Usuários que já fizeram login após o deploy e tiveram senha migrada para Argon2id não conseguirão mais logar se o rollback for feito (porque bcrypt não lê hash Argon2id). Por isso: **nunca fazer deploy desta fase em sexta/fim de semana**, e ter o suporte pronto para reset manual de senha via banco se necessário.

---

## Fase 5 — TOTP / Google Authenticator para professores

**Branch:** `seguranca/fase-5-totp`
**Risco:** Alto — muda fluxo de login de professores
**Esforço estimado:** 6-8 horas
**Dependências:** Fase 4 concluída e em produção

### Contexto

Hoje apenas ADM e SUPER têm 2FA (OTP por email). O PDF da especificação 2.0 exige 2FA também para professores. TOTP (Google Authenticator) é mais seguro que OTP por email.

### Decisão de design (confirmar com dono antes de implementar)

```
Professores:
  - Na primeira configuração: obrigado a configurar TOTP antes de acessar o sistema
  - Login: senha → TOTP (Google Authenticator)
  - Recovery: 8 códigos de uso único gerados no setup

ADM e SUPER:
  - Mantém OTP por email (não muda nesta fase)
  - TOTP como alternativa opcional (pode ser Fase 6 futura)

Alunos:
  - Sem 2FA (não muda)
```

### Tarefas do implementador

```
1. npm install speakeasy qrcode
2. Adicionar colunas no banco:
   - users.totp_secret (TEXT, nullable)
   - users.totp_enabled (INTEGER DEFAULT 0)
   - Criar tabela totp_recovery_codes (id, user_id, code_hash, used, created_at)
3. Endpoint de setup: GET /api/auth/totp/setup → retorna QR Code e secret
4. Endpoint de ativação: POST /api/auth/totp/activate → valida primeiro código e ativa
5. Endpoint de verificação no login: POST /api/auth/verify-totp
6. Modificar fluxo de login para professor: após senha correta, retornar requires2FA: true
7. Gerar e hashear 8 recovery codes no setup
8. Endpoint de uso de recovery code: POST /api/auth/totp/recovery
9. Tela de setup no frontend (QR Code, código de confirmação, lista de recovery codes)
10. Tela de verificação TOTP no login (após senha)
11. Testes: setup, verify, recovery code, login completo
12. npm test passando
```

### Plano de rollback

```bash
git revert HEAD
docker compose -f docker-compose.prod.yml up -d --build
# Professores voltam a logar sem 2FA
# Colunas totp_* no banco ficam (inofensivas sem o código)
```

---

## Notas para os agentes

### Para o Claude Code (implementador)
- Implemente uma fase por vez
- Sempre crie a branch antes de começar: `git checkout -b seguranca/fase-X-nome`
- Sempre rode `npm test` antes de commitar
- Sempre gere `REVIEW_FASE_X.md` com resumo do que foi feito
- Nunca faça merge sem veredicto `APPROVED` do Codex

### Para o Codex (auditor)
- Use o checklist da fase correspondente em `AGENTS.md`
- Sempre verifique os critérios universais também
- Documente cada problema com arquivo e linha aproximada
- Emita veredicto claro no `REVIEW_FASE_X.md`

### Para o dono do projeto (João)
- Só faça merge após veredicto `APPROVED` do Codex
- Sempre teste manualmente no staging antes de aprovar
- Sempre faça backup do banco antes de deploy em produção:
  ```bash
  TIMESTAMP=$(date +%Y%m%d-%H%M%S)
  sqlite3 /opt/sites/pilha/data/campusflow.db ".backup '/opt/backups/campusflow-$TIMESTAMP.db'"
  ```
- Deploy em produção:
  ```bash
  cd /opt/sites/pilha
  git pull
  docker compose -f docker-compose.prod.yml up -d --build
  ```
