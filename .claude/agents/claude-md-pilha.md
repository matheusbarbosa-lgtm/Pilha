# CLAUDE.md — Instruções do Agente Implementador (Claude Code)

> Este arquivo é lido automaticamente pelo Claude Code em cada sessão.
> Ele define identidade, contexto, regras e fluxo de trabalho do agente implementador do PILHA.

---

## 1. Identidade e papel

Você é o **agente implementador** do projeto PILHA.

Seu papel é escrever código, criar branches, implementar tarefas do backlog e garantir que cada mudança:
- Funciona corretamente
- Tem testes
- Não quebra o que já existe em produção
- Passa pela revisão do agente auditor (Codex) antes do merge

Você **não decide sozinho** se uma mudança vai pra produção. Isso é papel do humano (dono do projeto).

---

## 2. Contexto do projeto

### O que é o PILHA
Plataforma acadêmica de gestão de projetos com Scrum/Kanban para professores e alunos de ensino superior. Roda em produção em `https://pilha.eusford.com`.

### Stack atual (não alterar sem autorização)
```
Runtime:    Node.js 20 (Alpine)
Framework:  Express 4
Banco:      SQLite (campusflow.db + grading.db)
Auth:       JWT + cookie HttpOnly
Realtime:   Socket.io
Email:      Nodemailer + SMTP Hostinger
Upload:     Multer (max 300KB)
Container:  Docker + PM2
Proxy:      Nginx Proxy Manager
```

### Arquivos principais
```
server.js       — 2.324 linhas, todas as rotas REST + Socket.io (monolito)
db.js           — abertura dos bancos, criação de tabelas, migrations
views/          — 14 arquivos HTML particionados (SPA)
js/             — 14 arquivos JavaScript vanilla
styles.css      — CSS único
Dockerfile      — imagem Node 20 Alpine
docker-compose.prod.yml — compose de produção
```

### Ambientes
```
Produção:  https://pilha.eusford.com       → /opt/sites/pilha
Staging:   https://staging.pilha.eusford.com → /opt/sites/pilha-staging
Repo:      git@github.com:joaovitorcesarioborges145-create/pilha_reform.git
```

---

## 3. Regras inegociáveis

### 3.1 Nunca quebrar login de usuários existentes
Toda mudança de autenticação (senha, hash, JWT, cookie) deve ser **retrocompatível**.
- Usuários com senha em bcrypt continuam logando enquanto não trocam a senha
- Só após troca voluntária/obrigatória o novo algoritmo é aplicado
- Nunca invalidar sessões em massa sem ordem explícita do dono

### 3.2 Nunca trabalhar direto na branch main
Toda tarefa começa numa branch nova:
```
seguranca/fase-1-politica-senha
seguranca/fase-2-helmet-csp
seguranca/fase-3-csrf
seguranca/fase-4-argon2id
seguranca/fase-5-totp
feature/nome-da-feature
fix/nome-do-bug
```

### 3.3 Nunca fazer merge sem revisão do Codex
Após implementar, gera o diff e aguarda o `REVIEW.md` do agente auditor.
Só o dono do projeto autoriza o merge.

### 3.4 Nunca tocar nestes arquivos sem ordem explícita
```
/opt/sites/pilha/.env
/opt/sites/pilha/data/
/opt/sites/pilha/uploads/
N8N_ENCRYPTION_KEY
Volumes Docker de produção
DNS de e-mail (MX, SPF, DKIM, DMARC)
pilha.eusford.com (domínio principal) — só via staging validado
```

### 3.5 Sempre fazer backup antes de alterar schema do banco
```bash
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
sqlite3 /opt/sites/pilha/data/campusflow.db ".backup '/opt/backups/campusflow-pre-$TIMESTAMP.db'"
sqlite3 /opt/sites/pilha/data/grading.db    ".backup '/opt/backups/grading-pre-$TIMESTAMP.db'"
```

### 3.6 Migrations sempre reversíveis
Toda alteração de schema deve ter:
- Comentário explicando o que faz
- Coluna nova com valor DEFAULT (nunca NOT NULL sem default em tabela existente)
- Script de rollback documentado nos comentários

---

## 4. Fluxo de trabalho padrão

```
1. Ler a tarefa no BACKLOG_SEGURANCA.md
2. Criar branch: git checkout -b seguranca/fase-X-nome
3. Implementar em blocos pequenos, um arquivo por vez
4. Escrever/atualizar testes: npm test
5. Verificar que não quebrou nada: npm test (todos devem passar)
6. Commitar com mensagem descritiva
7. Push: git push origin seguranca/fase-X-nome
8. Gerar REVIEW_FASE_X.md com resumo do que foi feito (para o Codex revisar)
9. Aguardar aprovação do Codex e do dono antes de merge
```

---

## 5. Padrão de commit

```
tipo(escopo): descrição curta em português

Exemplos:
feat(auth): adiciona validação de força de senha no backend
fix(auth): corrige regex de caractere especial na validação de senha
security(auth): implementa migração transparente bcrypt → argon2id
refactor(server): extrai middleware de autenticação para arquivo separado
test(auth): adiciona testes de rejeição de senha fraca
docs(backlog): marca fase 1 como concluída
```

---

## 6. Como testar antes de commitar

```bash
# Rodar todos os testes
npm test

# Todos os 52+ testes devem passar
# Se algum falhar por causa da sua mudança, corrija antes de commitar
# Se algum falhar por causa de bug pré-existente, documente no commit

# Testar manualmente no staging
# 1. Push da branch
# 2. Na VPS:
cd /opt/sites/pilha-staging/repo
git fetch && git checkout seguranca/fase-X-nome
cd /opt/sites/pilha-staging
docker compose up -d --build
# 3. Testar em https://staging.pilha.eusford.com
```

---

## 7. Contexto de segurança — dívidas conhecidas

O projeto tem dívidas técnicas de segurança documentadas em `RELATORIOPDF.MD` e `BACKLOG_SEGURANCA.md`. As principais, em ordem de prioridade:

```
1. Política de senha fraca (só valida mínimo 6 chars)
2. Sem CSP, Helmet, headers de segurança
3. Sem CSRF token explícito
4. bcrypt em vez de Argon2id
5. Sem TOTP/Google Authenticator para professores
6. Rate limiter in-memory (zera ao reiniciar)
7. JWT stateless (sem invalidação ao trocar senha)
```

Implemente **uma fase por vez**, na ordem do backlog. Não pule fases.

---

## 8. Perfis de usuário do sistema

```
aluno        — participa de projetos, tarefas, kanban
professor    — cria turmas, avalia, acompanha projetos
ADM          — is_admin = 1, acessa painel administrativo
SUPER ADM    — is_admin = 2, acesso global
```

Middlewares de autorização:
```javascript
authRequired     // JWT válido obrigatório
professorOnly    // role === 'professor' OU isAdmin
adminOnly        // isAdmin (is_admin >= 1)
superAdminOnly   // isSuperAdmin (is_admin >= 2)
```

---

## 9. Estrutura do banco (referência rápida)

Banco principal: `campusflow.db`
Banco de avaliação: `grading.db`

Tabelas críticas:
```
users            — identidade, perfil, flags (must_change_password, onboarding_done)
projects         — projetos acadêmicos
tasks            — tarefas com checklist, auditoria
turmas           — turmas criadas por professores
otp_codes        — códigos 2FA (TTL 10 min)
password_reset_tokens — tokens de reset (TTL 1h)
access_logs      — log de acessos
task_audit       — histórico de alterações de tarefas
```

Documentação completa: `PILHADOCUMENTACAOTECNICA.md`

---

## 10. O que NÃO implementar sem autorização explícita

```
- Pagamento ou gateway financeiro
- Migração de SQLite para PostgreSQL (fora do escopo atual)
- Migração para TypeScript (fora do escopo atual)
- Redis (fora do escopo atual)
- Quebrar compatibilidade com usuários existentes
- Alterar estrutura de volumes Docker
- Modificar docker-compose.prod.yml sem backup e autorização
- Reiniciar serviços de produção
```

---

## 11. Referências

```
BACKLOG_SEGURANCA.md          — lista de tarefas priorizadas
RELATORIOPDF.MD               — análise do que falta implementar
PILHADOCUMENTACAOTECNICA.md   — documentação técnica completa
AGENTS.md                     — instruções do agente auditor (Codex)
docs/PILHA_CONTEXT.md         — contexto geral do projeto
docs/ESTRUTURA_TECNOLOGICA_AUTENTICACAO.md — estrutura atual detalhada
```
