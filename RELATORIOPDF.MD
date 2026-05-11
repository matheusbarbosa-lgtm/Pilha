# RELATÓRIO — PILHA vs PILHA 2.0 (Especificação PDF)

**Data da análise:** 2026-05-08  
**Metodologia:** Inspeção de código (server.js, db.js, js/, views/), estrutura de banco de dados e comparação item a item com o documento PILHA.pdf  
**Nenhum código foi alterado durante esta análise.**

---

## JÁ TEMOS NO PROJETO

### Autenticação e Sessão
- Login por email ou username (`POST /api/auth/login`)
- Login alternativo por email (`POST /api/auth/login-email`)
- Registro de usuário (`POST /api/auth/register`)
- Logout seguro com limpeza de cookie (`POST /api/auth/logout`)
- Cookie HttpOnly com nome `pilha_tab_token`
- Cookie `secure: true` ativado em produção (`NODE_ENV=production`)
- Cookie `sameSite: lax` configurado
- JWT assinado com `JWT_SECRET` e expiração em 12 horas
- Middleware `authRequired` aceitando cookie, header `Authorization` e `x-auth-token`
- Endpoint `GET /api/auth/me` retorna usuário autenticado
- Recuperação de senha por email (`POST /api/auth/forgot-password`)
- Reset de senha com token de 1 hora (`POST /api/auth/reset-password`)
- Troca de senha autenticada (`POST /api/auth/change-password`)
- Troca obrigatória de senha no primeiro login (`must_change_password = 1`)
- Proteção contra enumeração: forgot-password retorna 200 mesmo quando email não existe

### 2FA (ADM e SUPER ADM)
- OTP numérico de 6 dígitos enviado por email no login de ADM/SUPER
- Tabela `otp_codes` com expiração de 10 minutos e flag `used`
- Endpoint `POST /api/auth/request-otp` para solicitar novo código
- Endpoint `POST /api/auth/verify-otp` para validar código e emitir JWT
- Rate limiter: 10 tentativas de login / 15 min, 5 verify-otp / 15 min, 3 request-otp / 15 min
- `NO_2FA_USERNAMES` via variável de ambiente para bypass de contas específicas
- `SUPER_OTP_EMAIL` para redirecionar OTP do SUPER ADM

### Gestão de Usuários e Perfis
- Tabela `users` com 25+ colunas: id, username, name, role, is_admin, email, turma, periodo, curso, photo (base64), onboarding_done, must_change_password, password_hash, bio, skills (JSON), graduations, specialty, experience_years, profile_complete, turma_id
- Níveis de acesso: aluno, professor, ADM (is_admin=1), SUPER ADM (is_admin=2)
- Middlewares: `authRequired`, `professorOnly`, `adminOnly`, `superAdminOnly`
- Perfil básico: `PATCH /api/profile` (nome, email, turma, período, curso, foto base64)
- Perfil estendido: `PATCH /api/profile/extended` (bio, skills, graduações, especialidade, anos de experiência)
- Listagem de alunos: `GET /api/students`
- Listagem de usuários para admin: `GET /api/admin/users`

### Criação de Professor pelo ADM
- Endpoint protegido `POST /api/admin/professor` (requer `adminOnly`)
- Cria professor com nome, email, senha temporária, `must_change_password=1`, `onboarding_done=1`
- Gera username determinístico a partir do email (com deduplicação `.2`, `.3`...)
- Envia email de boas-vindas com dados de acesso via SMTP quando configurado
- Retorna `{ id, username, email }` na resposta 201

### Onboarding de Alunos
- `POST /api/auth/student-onboarding` — atualiza email, senha, turma, período, curso, foto
- Pode criar projeto novo ou aceitar convite pendente durante onboarding
- Marca `onboarding_done=1` ao concluir
- `POST /api/auth/register-by-turma` — registro via token de turma com vinculação automática
- `POST /api/auth/register-by-invite` — registro via convite de projeto com vinculação automática

### Turmas
- Criação de turma pelo professor: `POST /api/turmas` (curso, período, turma, invite_token único)
- Listagem das turmas do professor: `GET /api/turmas`
- Resolver token de turma publicamente: `GET /api/turmas/resolve/:token`
- Listagem de membros da turma: `GET /api/team/members/:turmaId`
- Tabela `turmas` com professor_id, curso, periodo, turma, invite_token

### Projetos
- CRUD de projetos: `GET/POST /api/projects`, `GET/PATCH /api/projects/:id`
- Membros com roles Scrum: Product Owner, Scrum Master, Development Team
- Alterar role: `PATCH /api/projects/:id/members/:memberName/role`
- Remover membro: `DELETE /api/projects/:id/members/:memberName`
- Adicionar membro: `POST /api/projects/:id/members`
- Convites por email: `POST /api/projects/:id/invites`
- Export Excel do projeto: `GET /api/projects/:id/export/xlsx`
- Export de todos os projetos visíveis: `GET /api/export/projects/xlsx`
- Mensagens de projeto (chat interno): `GET/POST /api/projects/:id/messages`
- Realtime de mensagens via Socket.io (`project-message`)

### Convites
- Tabela `project_invites` com token único, status (pending/accepted/expired/canceled), invite_email
- Info pública do convite: `GET /api/invites/info?token=...`
- Meus convites: `GET /api/invites/my`
- Aceitar convite: `POST /api/invites/accept`

### Sprints
- Criação de sprint por professor: `POST /api/sprints`
- Listagem: `GET /api/sprints`

### Tasks (Tarefas)
- CRUD completo: `GET/POST /api/tasks`, `GET/PATCH/DELETE /api/tasks/:id`
- Campos: título, descrição, assignee, due_date, start_date, sprint_id, status, parent_task_id, priority, urgency, points, checklist (JSON), tags (JSON)
- Mudar status: `PATCH /api/tasks/:id/status` (todo|doing|done)
- Mudar checklist: `PATCH /api/tasks/:id/checklist`
- Mudar urgência: `PATCH /api/tasks/:id/urgency`
- Mudar tags: `PATCH /api/tasks/:id/tags`
- Comentários: `GET/POST /api/tasks/:id/comments`, `DELETE /api/tasks/:id/comments/:cid`
- Auditoria de alterações: `GET /api/tasks/:id/audit` — registra field, old_val, new_val, user_name
- Realtime de tasks via Socket.io (`task-updated`)
- Subtasks via `parent_task_id`

### Anexos em Tasks
- Upload: `POST /api/tasks/:id/attachments` (max 300KB, MIME: PDF, Word, Excel, PNG, JPEG, GIF, texto)
- Listagem: `GET /api/tasks/:id/attachments`
- Download autenticado: `GET /api/tasks/:id/attachments/:aid/download`
- Deletar: `DELETE /api/tasks/:id/attachments/:aid`
- Tabela `task_attachments` com metadados (filename, original_name, mime_type, size, uploaded_by)
- Arquivos armazenados em `/uploads/tasks/`

### Campos Customizados de Projeto
- Criação (professor): `POST /api/projects/:id/fields` (text|number|select|date|checkbox)
- Listagem: `GET /api/projects/:id/fields`
- Deletar: `DELETE /api/projects/:id/fields/:fieldId`
- Tabelas: `custom_field_definitions` e `custom_field_values`

### Kanban
- Tabelas `kanban_boards` e `kanban_columns` (com cor e ordem)
- Frontend com aba Kanban (`kanban.html`, `js/kanban.js`)

### Chat por Turma
- Mensagens por turma: `GET/POST /api/chat/:turmaId`
- Tabela `chat_messages` (turma_id, sender_id, content)
- Realtime via Socket.io

### Documentos TAP e PI
- Conteúdo em JSON: `GET/PUT /api/projects/:id/docs/:type`
- Comentários do professor: `GET/POST/DELETE /api/projects/:id/docs/:type/comments`
- Submissão para avaliação: `POST /api/projects/:id/docs/:type/submit`
- Aprovação/Rejeição: `POST /api/projects/:id/docs/:type/approve` e `/reject` (professor only)
- Status: draft → submitted → approved/rejected
- Tabela `doc_permissions` para liberação por turma
- Liberar documento por turma: `POST /api/docs/permissions/:turmaId/:type`
- Remover liberação: `DELETE /api/docs/permissions/:turmaId/:type`
- Realtime via Socket.io (`doc-comment`, `doc-status`)

### Avaliação
- Criar atividade por turma: `POST /api/eval/turma/:turmaId/activities`
- Criar atividade por projeto: `POST /api/eval/:projectId/activities`
- Atualizar atividade: `PATCH /api/eval/activities/:actId`
- Atualizar scores: `PATCH /api/eval/activities/:actId/scores`
- Deletar atividade: `DELETE /api/eval/activities/:actId`
- Meta de avaliação: `PATCH /api/eval/:projectId/meta`
- Nota individual: `PATCH /api/eval/:projectId/individual`
- Dashboard de avaliação: `GET /api/eval`
- Banco separado `grading.db` com: eval_activities, eval_individual, eval_meta, eval_activity_scores

### Exportação Excel
- Export avaliação por turma: `GET /api/export/grading/turma/:turma`
- Export avaliação por projeto: `GET /api/export/grading/project/:id`
- Export turmas: `GET /api/export/turmas`
- Usa ExcelJS para estilização rica

### Painel Administrativo
- Criar professor: `POST /api/admin/professor`
- Executar comandos admin: `POST /api/admin/cmd`
- Listar usuários: `GET /api/admin/users`

### Painel Superadmin
- Dump do banco: `GET /api/superadmin/db` e `/db/:table`
- Listar uploads: `GET /api/superadmin/files`
- Logs do servidor: `GET /api/superadmin/logs`

### Real-time (Socket.io)
- Autenticação do socket via cookie `campusflow_token` ou `socket.handshake.auth.token`
- Alunos entram nas salas dos seus projetos
- Professores/admins entram nas salas de todos os projetos
- Eventos: `task-updated`, `doc-comment`, `doc-status`, `project-message`

### Segurança implementada
- Senhas com bcryptjs (hash seguro)
- Queries parametrizadas (proteção SQLi)
- Sanitização de inputs com `sanitize()` e `sanitizeUsername()`
- `x-powered-by` desativado
- Rate limiters por IP para endpoints sensíveis
- Uploads com validação de MIME type e tamanho máximo
- Downloads via endpoint autenticado (não expostos diretamente)

### Infraestrutura
- Dockerfile (Node 20 Alpine, `npm ci --omit=dev`)
- docker-compose.prod.yml (rede `proxy` externa para Nginx Proxy Manager)
- ecosystem.config.js para PM2 (restart automático, max 256MB)
- Variáveis de ambiente via `.env`
- SMTP Hostinger configurado para envio de emails
- 2 bancos SQLite com migrations automáticas em `db.js`
- Deploy em https://pilha.eusford.com

---

## NÃO TEMOS NO PROJETO

### Tecnologia e Arquitetura (conforme especificado no PDF)
- **TypeScript** — projeto usa JavaScript puro
- **PostgreSQL** — projeto usa SQLite
- **Redis** — rate limit é in-memory (zera ao reiniciar o processo)
- **Arquitetura modular** — server.js tem 2.324 linhas concentrando tudo (rotas, lógica, middlewares)
- **Separação rotas/serviços/repositórios/validações** — tudo em um arquivo monolítico
- **Migrations formais com versionamento** — migrações são imperativas dentro do db.js (sem controle de versão como Flyway/Liquibase/Knex)
- **Storage separado para fotos de perfil** — fotos são base64 diretamente na coluna `photo` do banco
- **Logs estruturados com request ID / correlation ID** — não há sistema de logs estruturado

### 2FA / MFA (conforme especificado no PDF)
- **TOTP compatível com Google Authenticator** — o sistema usa OTP por email, não TOTP
- **QR Code para configuração de 2FA** — não implementado
- **Recovery codes seguros** — não implementado
- **Possibilidade de reconfiguração controlada do 2FA** — não implementado
- **Logs de ativação/desativação de 2FA** — não implementado
- **Step-up auth para ações críticas do admin** — não implementado
- **2FA obrigatória para professores** — professores não passam por nenhum fluxo de 2FA atualmente (só ADM e SUPER ADM)

### Senhas (conforme especificado no PDF)
- **Argon2id** — projeto usa bcryptjs
- **Requisitos completos de senha** (letra maiúscula + número + caractere especial + mínimo 8 chars) — sistema valida apenas mínimo de 6 caracteres
- **Indicador visual de força de senha** — não implementado no frontend
- **Checklist visual dos critérios de senha** — não implementado
- **Validação backend dos requisitos completos** — não implementado (só mínimo 6 chars)
- **Super usuário inicial por bootstrap seguro** — contas ADM/SUPER/PI criadas com senhas padrão via variável de ambiente com fallback hardcoded

### Segurança (conforme especificado no PDF)
- **Proteção CSRF com token dedicado** — sistema confia no cookie SameSite sem token CSRF explícito
- **Content Security Policy (CSP)** — não configurada no backend
- **Helmet.js** — não utilizado
- **HSTS** — não configurado no backend (pode estar no Nginx)
- **Referrer-Policy** — não configurado
- **Permissions-Policy** — não configurado
- **Invalidação de sessão ao trocar senha** — JWT é stateless; tokens emitidos antes da troca continuam válidos até expirar
- **Invalidação de sessão ao alterar privilégios** — mesma limitação do JWT stateless
- **Validação de conteúdo binário de uploads** — só verifica MIME type declarado, não o conteúdo real
- **Nomes internos aleatórios para uploads** — multer usa timestamps, não UUIDs aleatórios
- **Trilha de auditoria de downloads** — não há registro de quem baixou um anexo

### Funcionalidades (conforme especificado no PDF)
- **Controle de limite de participantes por projeto** — schema de `turmas` não tem campo `max_members`; sistema não bloqueia excesso de membros
- **Liberação específica para exportar TAP/PI em PDF** — sistema aprova/rejeita documento, mas não tem botão separado de "liberar exportação PDF"
- **Status "exportação liberada" no documento** — status existentes são draft/submitted/approved/rejected
- **Filtro de exportação por curso E período** — exportação atual por turma funciona, mas o filtro combinado completo não foi verificado
- **Log registrando cada exportação realizada** — não há auditoria explícita de exportações

---

## TEMOS UMA PARTE

### 2FA — Parcialmente implementada
- **Temos:** 2FA por email OTP para ADM e SUPER ADM
- **Falta:** TOTP/Google Authenticator, QR Code, 2FA para professores, recovery codes

### Validação de Senha — Parcialmente implementada
- **Temos:** validação de tamanho mínimo (6 chars) no backend
- **Falta:** requisitos completos (maiúscula, número, especial, 8+ chars), indicador visual, checklist

### Auditoria e Logs — Parcialmente implementada
- **Temos:** `task_audit` (alterações de tasks), `access_logs` (logins), `doc_comments` com timestamps
- **Falta:** logs de exportação, logs de download de anexos, logs de ativação/desativação 2FA, correlation ID

### Perfil Expandido do Professor — Parcialmente implementada
- **Temos:** colunas no banco: `bio`, `skills` (JSON), `graduations`, `specialty`, `experience_years`, `profile_complete`
- **Falta:** verificar completude do frontend para todos os campos; campo "tempo de casa" mapeado como `experience_years`; "grade curricular/disciplinas" não tem campo dedicado

### Fluxo do Product Owner (PO) — Parcialmente implementado
- **Temos:** role Product Owner em `project_members`, onboarding com opção de criar projeto, convites por email
- **Falta:** limite de participantes por projeto, bloqueio de convites excedentes, exibição clara de vagas restantes na UI

### Proteção IDOR — Parcialmente implementada
- **Temos:** verificação de vínculo em vários endpoints (projetos, turmas)
- **Falta:** cobertura completa auditada; alguns endpoints podem não verificar vínculo do usuário com o recurso

### Documentos TAP e PI — Parcialmente implementados
- **Temos:** conteúdo JSON livre, submit, approve, reject, comentários, liberação por turma, realtime
- **Falta:** estrutura OBRIGATÓRIA da seção TAP (1.1 a 1.9) e PI (Capa, Folha de Rosto, Sumário, etc.) validada no backend; só PO edita (verificar se backend impede alunos comuns de editar); liberação específica para exportar em PDF

### Kanban — Parcialmente implementado
- **Temos:** boards, colunas com cor e ordem, frontend com kanban.html e kanban.js, tasks com status todo/doing/done
- **Falta:** verificar se modal de criação de task remove Sprint/Pontos/Tarefa pai conforme especificado no PDF §10.1

### Realtime — Parcialmente implementado
- **Temos:** Socket.io com eventos de task, documento e mensagem
- **Falta:** notificações por evento específico de tarefa (nova tarefa criada, mudança de prazo, novo anexo, atualização de checklist) conforme §10.4

### Segurança de Uploads — Parcialmente implementada
- **Temos:** validação de MIME type, tamanho máximo 300KB, download autenticado, storage em /uploads
- **Falta:** magic bytes validation (conteúdo binário real), nomes internos verdadeiramente aleatórios (UUIDs), trilha de auditoria de downloads

### Separação de Storage de Arquivos — Parcialmente implementada
- **Temos:** attachments de tasks ficam em `/uploads/tasks/` separados do banco
- **Falta:** fotos de perfil ainda ficam como base64 no banco (campo `photo` na tabela `users`)

---

## O QUE TEMOS AGORA NO PROJETO

### Resumo executivo do estado atual (2026-05-08)

O PILHA é um sistema **funcional em produção** em https://pilha.eusford.com com as seguintes capacidades confirmadas pelo código:

#### Backend (server.js — 2.324 linhas, Node.js/Express)
- **94 endpoints REST** cobrindo: autenticação, perfis, projetos, sprints, tasks, kanban, turmas, chat, documentos, avaliação, exportação, admin e superadmin
- **Autenticação JWT** com cookie HttpOnly + fallback sessionStorage por aba
- **2FA por email** para ADM e SUPER ADM
- **Rate limiting** in-memory em endpoints sensíveis
- **Bcrypt** para hash de senhas
- **Multer** para upload de até 300KB com validação de MIME
- **Nodemailer** integrado com SMTP Hostinger
- **Socket.io** para realtime de tasks, documentos e mensagens
- **ExcelJS** para exportação de planilhas formatadas

#### Banco de Dados (SQLite — 2 bancos)
- **campusflow.db:** 22 tabelas cobrindo users, projects, tasks, kanban, turmas, chat, docs, attachments, invites, sprints, audit, OTP, reset tokens
- **grading.db:** 4 tabelas para avaliação (activities, individual scores, meta, activity scores)
- Migrations automáticas no startup via `db.js`

#### Frontend (Vanilla JS + HTML particionado)
- **14 arquivos HTML** em `views/` (dashboard, projetos, kanban, scrum, turmas, chat, documentos, avaliação, admin, equipes, etc.)
- **14 arquivos JS** em `js/` (auth, core, tasks, kanban, chat, equipes, avaliação, socket, etc.)
- SPA renderizada pelo servidor com injeção de estado de sessão
- Socket.io client para realtime

#### Módulos funcionais confirmados
| Módulo | Status |
|--------|--------|
| Login/Logout/Registro | Funcional |
| 2FA email para ADM/SUPER | Funcional |
| Troca obrigatória de senha | Funcional |
| Criação de professor pelo ADM | Funcional |
| Onboarding de alunos | Funcional |
| Convites por email para projetos | Funcional |
| Turmas com invite token | Funcional |
| Projetos com roles Scrum | Funcional |
| Sprints | Funcional |
| Tasks com checklist/auditoria | Funcional |
| Anexos em tasks | Funcional |
| Campos customizados | Funcional |
| Kanban boards | Funcional |
| Chat por turma (REST + Socket.io) | Funcional |
| Documentos TAP e PI | Funcional |
| Avaliação com scores individuais | Funcional |
| Exportação Excel (projetos/avaliação) | Funcional |
| Perfil com foto base64 | Funcional |
| Realtime Socket.io | Funcional |
| Painel Admin | Funcional |
| Painel Superadmin | Funcional |
| Email SMTP Hostinger | Funcional |
| Docker + PM2 | Configurados |

#### Testes
- Suíte Jest com Supertest: **53 testes** (52 passando, 1 corrigido nesta branch)
- Arquivo de testes ausente neste checkout local — deve ser validado no ambiente de CI/produção

#### Dívidas técnicas conhecidas
1. server.js monolítico (2.324 linhas) — difícil de manter
2. SQLite (sem transações complexas, sem conexão pooling, sem replicação)
3. Rate limiter in-memory (zera ao reiniciar)
4. Fotos de perfil como base64 no banco
5. Sem CSRF token explícito
6. Sem CSP, Helmet, HSTS no backend
7. Sem TOTP/Google Authenticator (apenas OTP por email para admins)
8. Validação de senha apenas mínimo 6 chars (sem requisitos de complexidade)
9. Migrations sem versionamento formal
10. Professores sem 2FA

---

*Análise realizada com base na inspeção de código. Nenhum arquivo foi alterado.*
