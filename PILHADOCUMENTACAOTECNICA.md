# PILHA — Documentação Técnica Completa

**Versão analisada:** branch `finalizacao-pilha-agentes`  
**Data:** 2026-05-08  
**URL de produção:** https://pilha.eusford.com  
**Ambiente:** VPS HostGator Ubuntu — 2 vCPUs / 4 GB RAM / 100 GB Storage

---

## 1. Visão Geral

O PILHA é uma plataforma web de gestão de projetos acadêmicos com metodologia Scrum/Kanban, desenvolvida para atender professores e alunos de ensino superior. O sistema roda como um monolito Node.js/Express servindo uma SPA (Single Page Application) em HTML/CSS/JavaScript vanilla.

**Perfis de usuário:**
- **Aluno** — participa de projetos, organiza tarefas, usa Kanban, documentos, chat e onboarding
- **Professor** — cria turmas, acompanha projetos, avalia entregas, gerencia alunos
- **ADM** (`is_admin = 1`) — acessa rotas administrativas, cria professores
- **SUPER ADM** (`is_admin = 2`) — acesso global, dump de banco, superadmin

---

## 2. Stack Tecnológica

### 2.1 Backend

| Tecnologia | Versão | Uso |
|---|---|---|
| Node.js | 20 (Alpine) | Runtime |
| Express | 4.21.2 | Framework HTTP |
| SQLite (`sqlite` + `sqlite3`) | 5.1.1 + 5.1.7 | Banco de dados principal e avaliação |
| `jsonwebtoken` | 9.0.2 | Autenticação JWT |
| `bcryptjs` | 2.4.3 | Hash de senhas |
| `cookie-parser` | 1.4.7 | Parse de cookies HttpOnly |
| `nodemailer` | 8.0.2 | Envio de email SMTP |
| `multer` | 2.1.1 | Upload de arquivos |
| `socket.io` | 4.8.3 | Comunicação realtime WebSocket |
| `exceljs` | 4.4.0 | Geração de planilhas Excel estilizadas |
| `xlsx` | 0.18.5 | Leitura/escrita Excel complementar |
| `dotenv` | 17.3.1 | Variáveis de ambiente |

### 2.2 Frontend

| Tecnologia | Uso |
|---|---|
| HTML5 | 14 arquivos em `views/` (particionados) |
| JavaScript vanilla | 14 arquivos em `js/` |
| CSS | `styles.css` único |
| Socket.io client | Realtime no browser |

**Arquivos de view:**
- `views/shell-top.html` e `views/shell-bottom.html` — base da SPA
- `views/nav.html` — navegação principal
- `views/dashboard.html` — tela inicial do usuário
- `views/projects.html` — gestão de projetos
- `views/scrum.html` — backlog e sprints
- `views/kanban.html` — board Kanban
- `views/documents.html` — documentos TAP e PI
- `views/turmas.html` — turmas do professor
- `views/chat.html` — chat por turma
- `views/equipes.html` — membros da equipe e perfis
- `views/avaliacao.html` — avaliação de projetos
- `views/admin.html` — painel administrativo
- `views/modals.html` — dialogs reutilizáveis

**Arquivos JS:**
- `js/core.js` (498 linhas) — estado global, `apiFetch`, helpers DOM, carregamento de dados
- `js/auth.js` (545 linhas) — login, registro, onboarding, 2FA, recuperação de senha, logout
- `js/socket.js` (56 linhas) — integração Socket.IO
- `js/tasks.js` (463 linhas) — gestão de tarefas
- `js/projects.js` (575 linhas) — projetos e tarefas
- `js/equipes.js` (760 linhas) — equipes e turmas
- `js/avaliacao.js` (378 linhas) — avaliação e notas
- `js/kanban.js` (204 linhas) — board Kanban
- `js/chat.js` (221 linhas) — chat por turma
- `js/admin.js` (264 linhas) — painel administrativo
- `js/dashboard.js` (158 linhas) — dashboard
- `js/nav.js` (150 linhas) — navegação
- `js/profile.js` (103 linhas) — perfil do usuário
- `js/main.js` (102 linhas) — inicialização

### 2.3 Páginas públicas
- `landing.html` — landing page pública
- `cadastro.html` — tela de cadastro por convite

### 2.4 Arquivos principais do servidor

| Arquivo | Linhas | Responsabilidade |
|---|---|---|
| `server.js` | 2.324 | Servidor Express, todas as rotas REST, Socket.IO, uploads, exports |
| `db.js` | 594 | Abertura dos bancos SQLite, criação de tabelas, migrations, seeds |
| `package.json` | 34 | Scripts e dependências |
| `Dockerfile` | 20 | Imagem de produção Node 20 Alpine |
| `docker-compose.prod.yml` | — | Serviço `pilha`, volumes de dados/uploads, rede `proxy` |
| `ecosystem.config.js` | — | Configuração PM2 para rodar na porta 3000 |

---

## 3. Persistência de Dados

O projeto usa **dois bancos SQLite**, controlados por variáveis de ambiente:

### 3.1 campusflow.db (banco principal)

`DB_PATH` (padrão: `campusflow.db`) — em produção mapeado para `/data/campusflow.db`

#### Tabela: `users`
| Coluna | Tipo | Descrição |
|---|---|---|
| id | INTEGER PK | Identificador único |
| username | TEXT UNIQUE | Nome de usuário |
| name | TEXT | Nome exibido |
| role | TEXT | `aluno` ou `professor` |
| is_admin | INTEGER | 0=comum, 1=ADM, 2=SUPER ADM |
| email | TEXT UNIQUE | Email único |
| password_hash | TEXT | Hash bcrypt da senha |
| turma | TEXT | Turma do aluno |
| periodo | TEXT | Período letivo |
| curso | TEXT | Curso |
| turma_id | INTEGER FK | Referência à tabela turmas |
| photo | TEXT | Foto de perfil base64 JPEG |
| onboarding_done | INTEGER | 0=pendente, 1=concluído |
| must_change_password | INTEGER | 1=obrigar troca na próxima entrada |
| bio | TEXT | Biografia/sobre |
| skills | TEXT | Skills em JSON |
| graduations | TEXT | Graduações |
| specialty | TEXT | Especialidade |
| experience_years | INTEGER | Anos de experiência |
| profile_complete | INTEGER | Perfil estendido preenchido |

#### Tabela: `projects`
| Coluna | Tipo | Descrição |
|---|---|---|
| id | INTEGER PK | Identificador |
| name | TEXT | Nome do projeto |
| team | TEXT | Nome da equipe |
| deadline | TEXT | Prazo |
| description | TEXT | Descrição |
| discipline | TEXT | Disciplina |
| start_date | TEXT | Data de início |

#### Tabela: `project_members`
| Coluna | Tipo | Descrição |
|---|---|---|
| project_id | INTEGER FK | Projeto |
| member_name | TEXT | Nome do membro |
| scrum_role | TEXT | Product Owner / Scrum Master / Development Team |

#### Tabela: `sprints`
| Coluna | Tipo | Descrição |
|---|---|---|
| id | INTEGER PK | Identificador |
| name | TEXT | Nome da sprint |
| goal | TEXT | Objetivo |
| start | TEXT | Início |
| end | TEXT | Término |

#### Tabela: `tasks`
| Coluna | Tipo | Descrição |
|---|---|---|
| id | INTEGER PK | Identificador |
| project_id | INTEGER FK | Projeto |
| title | TEXT | Título |
| assignee | TEXT | Responsável |
| due_date | TEXT | Data de vencimento |
| start_date | TEXT | Data de início |
| sprint_id | INTEGER FK | Sprint (nullable) |
| status | TEXT | `todo` / `doing` / `done` |
| parent_task_id | INTEGER FK | Tarefa pai (subtasks) |
| priority | TEXT | `baixa` / `media` / `alta` |
| urgency | TEXT | `low` / `medium` / `high` |
| points | INTEGER | Story points |
| description | TEXT | Descrição/requisitos |
| checklist | TEXT | Checklist em JSON |
| tags | TEXT | Tags em JSON |

#### Tabela: `task_comments`
| Coluna | Tipo | Descrição |
|---|---|---|
| id | INTEGER PK | Identificador |
| task_id | INTEGER FK | Task |
| user_id | INTEGER FK | Usuário |
| content | TEXT | Conteúdo do comentário |
| created_at | TEXT | Timestamp |

#### Tabela: `task_attachments`
| Coluna | Tipo | Descrição |
|---|---|---|
| id | INTEGER PK | Identificador |
| task_id | INTEGER FK | Task |
| filename | TEXT | Nome interno do arquivo |
| original_name | TEXT | Nome original |
| mime_type | TEXT | Tipo MIME |
| size | INTEGER | Tamanho em bytes |
| uploaded_by | INTEGER FK | Usuário que enviou |
| created_at | TEXT | Timestamp |

#### Tabela: `task_audit`
| Coluna | Tipo | Descrição |
|---|---|---|
| id | INTEGER PK | Identificador |
| task_id | INTEGER FK | Task |
| user_name | TEXT | Nome do usuário |
| field | TEXT | Campo alterado |
| old_val | TEXT | Valor anterior |
| new_val | TEXT | Novo valor |
| created_at | TEXT | Timestamp |

#### Tabela: `kanban_boards`
| Coluna | Tipo | Descrição |
|---|---|---|
| id | INTEGER PK | Identificador |
| project_id | INTEGER FK | Projeto |
| name | TEXT | Nome do board |
| created_by | INTEGER FK | Usuário criador |

#### Tabela: `kanban_columns`
| Coluna | Tipo | Descrição |
|---|---|---|
| id | INTEGER PK | Identificador |
| board_id | INTEGER FK | Board |
| name | TEXT | Nome da coluna |
| col_order | INTEGER | Ordem |
| color | TEXT | Cor da coluna |

#### Tabela: `custom_field_definitions`
| Coluna | Tipo | Descrição |
|---|---|---|
| id | INTEGER PK | Identificador |
| project_id | INTEGER FK | Projeto |
| name | TEXT | Nome do campo |
| field_type | TEXT | `text` / `number` / `select` / `date` / `checkbox` |
| options | TEXT | Opções em JSON (para select) |

#### Tabela: `custom_field_values`
| Coluna | Tipo | Descrição |
|---|---|---|
| task_id | INTEGER FK | Task |
| field_id | INTEGER FK | Campo |
| value | TEXT | Valor |

#### Tabela: `project_invites`
| Coluna | Tipo | Descrição |
|---|---|---|
| id | INTEGER PK | Identificador |
| project_id | INTEGER FK | Projeto |
| inviter_user_id | INTEGER FK | Usuário que convidou |
| invite_email | TEXT | Email convidado |
| invite_token | TEXT UNIQUE | Token único do convite |
| status | TEXT | `pending` / `accepted` / `expired` / `canceled` |
| created_at | TEXT | Timestamp de criação |
| accepted_at | TEXT | Timestamp de aceite |

#### Tabela: `turmas`
| Coluna | Tipo | Descrição |
|---|---|---|
| id | INTEGER PK | Identificador |
| professor_id | INTEGER FK | Professor responsável |
| curso | TEXT | Curso |
| periodo | TEXT | Período |
| turma | TEXT | Nome/identificador da turma |
| invite_token | TEXT UNIQUE | Token de convite único |
| created_at | TEXT | Timestamp |

#### Tabela: `chat_messages`
| Coluna | Tipo | Descrição |
|---|---|---|
| id | INTEGER PK | Identificador |
| turma_id | INTEGER FK | Turma |
| sender_id | INTEGER FK | Usuário enviante |
| content | TEXT | Mensagem |
| created_at | TEXT | Timestamp |

#### Tabela: `password_reset_tokens`
| Coluna | Tipo | Descrição |
|---|---|---|
| id | INTEGER PK | Identificador |
| user_id | INTEGER FK | Usuário |
| token | TEXT UNIQUE | Token seguro |
| expires_at | TEXT | Expiração (1 hora) |
| used | INTEGER | 0=ativo, 1=usado |
| created_at | TEXT | Timestamp |

#### Tabela: `otp_codes`
| Coluna | Tipo | Descrição |
|---|---|---|
| id | INTEGER PK | Identificador |
| user_id | INTEGER FK | Usuário |
| code | TEXT | Código numérico de 6 dígitos |
| expires_at | TEXT | Expiração (10 minutos) |
| used | INTEGER | 0=ativo, 1=usado |
| created_at | TEXT | Timestamp |

#### Tabela: `access_logs`
| Coluna | Tipo | Descrição |
|---|---|---|
| id | INTEGER PK | Identificador |
| user_id | INTEGER | ID do usuário |
| username | TEXT | Username no momento |
| name | TEXT | Nome no momento |
| role | TEXT | Role no momento |
| is_admin | INTEGER | Nível admin no momento |
| ip | TEXT | IP do acesso |
| logged_at | TEXT | Timestamp |

#### Tabela: `project_docs`
| Coluna | Tipo | Descrição |
|---|---|---|
| id | INTEGER PK | Identificador |
| project_id | INTEGER FK | Projeto |
| doc_type | TEXT | `tap` ou `pi` |
| content | TEXT | Conteúdo em JSON |
| updated_at | TEXT | Última atualização |
| approval_status | TEXT | `draft` / `submitted` / `approved` / `rejected` |
| approved_by | INTEGER FK | Usuário que aprovou |
| approved_at | TEXT | Timestamp de aprovação |
| rejected_reason | TEXT | Motivo de rejeição |

#### Tabela: `doc_comments`
| Coluna | Tipo | Descrição |
|---|---|---|
| id | INTEGER PK | Identificador |
| project_id | INTEGER FK | Projeto |
| doc_type | TEXT | `tap` ou `pi` |
| user_id | INTEGER FK | Usuário |
| user_name | TEXT | Nome do usuário |
| content | TEXT | Comentário |
| created_at | TEXT | Timestamp |

#### Tabela: `doc_permissions`
| Coluna | Tipo | Descrição |
|---|---|---|
| id | INTEGER PK | Identificador |
| turma_id | INTEGER FK | Turma |
| doc_type | TEXT | `tap` ou `pi` |
| released_by | INTEGER FK | Professor que liberou |
| released_at | TEXT | Timestamp |

#### Tabela: `project_messages`
| Coluna | Tipo | Descrição |
|---|---|---|
| id | INTEGER PK | Identificador |
| project_id | INTEGER FK | Projeto |
| sender_id | INTEGER FK | Usuário |
| sender_name | TEXT | Nome do enviante |
| content | TEXT | Mensagem |
| created_at | TEXT | Timestamp |

### 3.2 grading.db (banco de avaliação)

`EVAL_DB_PATH` (padrão: `grading.db`) — em produção mapeado para `/data/grading.db`

#### Tabela: `eval_activities`
| Coluna | Tipo | Descrição |
|---|---|---|
| id | INTEGER PK | Identificador |
| project_id | INTEGER | Projeto |
| section | TEXT | `planejamento` / `desenvolvimento` |
| name | TEXT | Nome da atividade |
| max_pts | REAL | Pontuação máxima |
| score | REAL | Pontuação atribuída |

#### Tabela: `eval_individual`
| Coluna | Tipo | Descrição |
|---|---|---|
| project_id | INTEGER | Projeto |
| member_name | TEXT | Nome do membro |
| score | REAL | Nota individual |

#### Tabela: `eval_meta`
| Coluna | Tipo | Descrição |
|---|---|---|
| project_id | INTEGER | Projeto |
| entrega_score | REAL | Nota da entrega |
| observacoes | TEXT | Observações do professor |

#### Tabela: `eval_activity_scores`
| Coluna | Tipo | Descrição |
|---|---|---|
| activity_id | INTEGER FK | Atividade |
| member_name | TEXT | Nome do membro |
| score | REAL | Pontuação do membro nesta atividade |

---

## 4. Autenticação e Autorização

### 4.1 Modelo JWT

- **Assinatura:** HS256 com `JWT_SECRET` (variável de ambiente obrigatória em produção)
- **Expiração:** 12 horas
- **Cookie:** `pilha_tab_token` — HttpOnly, SameSite=lax, Secure em produção
- **Duplo canal:** cookie para sessão persistente + `sessionStorage` por aba para isolamento de múltiplas abas

**Payload do JWT (`buildAuthPayload`):**
```json
{
  "id": 1,
  "username": "prof.silva",
  "name": "Prof. Silva",
  "role": "professor",
  "isAdmin": 0,
  "isSuperAdmin": false,
  "email": "prof.silva@unipam.edu.br",
  "turma": "ADS",
  "periodo": "5",
  "curso": "ADS",
  "turmaId": 3,
  "profileComplete": true,
  "onboardingDone": true
}
```

### 4.2 Middlewares de autorização

```
authRequired      → verifica JWT (cookie ou header). 401 sem token. 401 token inválido.
professorOnly     → role === 'professor' OU isAdmin. 403 se falhar.
adminOnly         → isAdmin (is_admin >= 1). 403 se falhar.
superAdminOnly    → isSuperAdmin (is_admin >= 2). 403 se falhar.
```

### 4.3 Fluxo de login para alunos e professores

```
POST /api/auth/login
  → busca por email (se formato email) ou username
  → login por username: apenas contas admin
  → bcrypt.compareSync(password, hash)
  → se válido: emite JWT → cookie + X-Auth-Token header
  → retorna user data + flags (requiresOnboarding, mustChangePassword)
```

### 4.4 Fluxo de login para ADM e SUPER ADM (2FA por email)

```
POST /api/auth/login
  → credenciais válidas
  → gera OTP de 6 dígitos → salva em otp_codes (TTL 10 min)
  → envia OTP por email
  → retorna { requires2FA: true, userId, emailMasked }

POST /api/auth/verify-otp
  → valida código + expiração + não usado
  → emite JWT completo
  → marca OTP como usado
```

### 4.5 Rate limiters

| Endpoint | Limite | Janela |
|---|---|---|
| POST /api/auth/login | 10 tentativas | 15 minutos |
| POST /api/auth/verify-otp | 5 tentativas | 15 minutos |
| POST /api/auth/request-otp | 3 tentativas | 15 minutos |

### 4.6 Recuperação de senha

```
POST /api/auth/forgot-password
  → gera token seguro → salva em password_reset_tokens (TTL 1 hora)
  → envia link por email (quando SMTP configurado)
  → retorna 200 mesmo se email não existe (anti-enumeração)

POST /api/auth/reset-password
  → valida token: não expirado, não usado
  → atualiza password_hash
  → marca token como usado
  → remove must_change_password
```

---

## 5. Funcionalidades Disponíveis Agora

### 5.1 Autenticação

| Funcionalidade | Endpoint | Acesso |
|---|---|---|
| Login | POST /api/auth/login | Público |
| Login por email | POST /api/auth/login-email | Público |
| Registro | POST /api/auth/register | Público |
| Logout | POST /api/auth/logout | Autenticado |
| Usuário atual | GET /api/auth/me | Autenticado |
| Recuperar senha | POST /api/auth/forgot-password | Público |
| Resetar senha | POST /api/auth/reset-password | Público (com token) |
| Trocar senha | POST /api/auth/change-password | Autenticado |
| Solicitar OTP | POST /api/auth/request-otp | Público |
| Verificar OTP | POST /api/auth/verify-otp | Público |
| Onboarding aluno | POST /api/auth/student-onboarding | Autenticado (aluno) |
| Registro por turma | POST /api/auth/register-by-turma | Público (com token) |
| Registro por convite | POST /api/auth/register-by-invite | Público (com token) |

### 5.2 Perfil de Usuário

| Funcionalidade | Endpoint | Acesso |
|---|---|---|
| Ver perfil | GET /api/profile | Autenticado |
| Atualizar perfil básico | PATCH /api/profile | Autenticado |
| Atualizar perfil estendido | PATCH /api/profile/extended | Autenticado |
| Listar alunos | GET /api/students | Autenticado |

**Campos do perfil básico:** nome, email, turma, período, curso, foto (base64 JPEG)  
**Campos do perfil estendido:** bio, skills (JSON), graduações, especialidade, anos de experiência

### 5.3 Projetos

| Funcionalidade | Endpoint | Acesso |
|---|---|---|
| Listar projetos | GET /api/projects | Autenticado |
| Ver projeto | GET /api/projects/:id | Autenticado |
| Criar projeto | POST /api/projects | Professor |
| Atualizar projeto | PATCH /api/projects/:id | Autenticado |
| Adicionar membro | POST /api/projects/:id/members | Autenticado |
| Remover membro | DELETE /api/projects/:id/members/:name | Autenticado |
| Mudar role Scrum | PATCH /api/projects/:id/members/:name/role | Autenticado |
| Convidar por email | POST /api/projects/:id/invites | Autenticado |
| Export Excel | GET /api/projects/:id/export/xlsx | Autenticado |
| Export todos | GET /api/export/projects/xlsx | Autenticado |
| Mensagens do projeto | GET /api/projects/:id/messages | Autenticado |
| Enviar mensagem | POST /api/projects/:id/messages | Autenticado |

**Roles Scrum disponíveis:** `Product Owner`, `Scrum Master`, `Development Team`

### 5.4 Convites

| Funcionalidade | Endpoint | Acesso |
|---|---|---|
| Info do convite | GET /api/invites/info?token=... | Público |
| Meus convites | GET /api/invites/my | Autenticado |
| Aceitar convite | POST /api/invites/accept | Autenticado |

### 5.5 Sprints

| Funcionalidade | Endpoint | Acesso |
|---|---|---|
| Listar sprints | GET /api/sprints | Autenticado |
| Criar sprint | POST /api/sprints | Professor |

### 5.6 Tasks (Tarefas)

| Funcionalidade | Endpoint | Acesso |
|---|---|---|
| Listar tasks | GET /api/tasks | Autenticado |
| Ver task | GET /api/tasks/:id | Autenticado |
| Criar task | POST /api/tasks | Autenticado |
| Atualizar task | PATCH /api/tasks/:id | Autenticado |
| Mudar status | PATCH /api/tasks/:id/status | Autenticado |
| Mudar checklist | PATCH /api/tasks/:id/checklist | Autenticado |
| Mudar urgência | PATCH /api/tasks/:id/urgency | Autenticado |
| Mudar tags | PATCH /api/tasks/:id/tags | Autenticado |
| Deletar task | DELETE /api/tasks/:id | Autenticado |
| Listar comentários | GET /api/tasks/:id/comments | Autenticado |
| Comentar | POST /api/tasks/:id/comments | Autenticado |
| Deletar comentário | DELETE /api/tasks/:id/comments/:cid | Autenticado |
| Histórico de alterações | GET /api/tasks/:id/audit | Autenticado |

**Campos de task:** título, descrição, responsável, data início, data vencimento, sprint, status, tarefa pai, prioridade, urgência, pontos, checklist (JSON), tags (JSON)  
**Status disponíveis:** `todo`, `doing`, `done`  
**Prioridades:** `baixa`, `media`, `alta`  
**Urgência:** `low`, `medium`, `high`

### 5.7 Anexos em Tasks

| Funcionalidade | Endpoint | Acesso |
|---|---|---|
| Upload de arquivo | POST /api/tasks/:id/attachments | Autenticado |
| Listar anexos | GET /api/tasks/:id/attachments | Autenticado |
| Download | GET /api/tasks/:id/attachments/:aid/download | Autenticado |
| Deletar anexo | DELETE /api/tasks/:id/attachments/:aid | Autenticado |

**Tipos aceitos:** PDF, Word (.doc/.docx), Excel (.xls/.xlsx), PNG, JPEG, GIF, texto  
**Tamanho máximo:** 300 KB por arquivo  
**Storage:** `/uploads/tasks/` (fora do webroot público)

### 5.8 Campos Customizados

| Funcionalidade | Endpoint | Acesso |
|---|---|---|
| Listar campos | GET /api/projects/:id/fields | Autenticado |
| Criar campo | POST /api/projects/:id/fields | Professor |
| Deletar campo | DELETE /api/projects/:id/fields/:fieldId | Professor |

**Tipos de campo:** `text`, `number`, `select`, `date`, `checkbox`

### 5.9 Kanban

- Tabelas `kanban_boards` e `kanban_columns` com cor e ordem
- Frontend com board completo em `views/kanban.html` e `js/kanban.js`
- Tasks movidas entre colunas com atualização de status em realtime

### 5.10 Turmas

| Funcionalidade | Endpoint | Acesso |
|---|---|---|
| Criar turma | POST /api/turmas | Professor |
| Listar minhas turmas | GET /api/turmas | Professor |
| Resolver token | GET /api/turmas/resolve/:token | Público |
| Membros da turma | GET /api/team/members/:turmaId | Autenticado |

**Campos ao criar turma:** curso, período, turma, invite_token (gerado automaticamente)

### 5.11 Chat por Turma

| Funcionalidade | Endpoint | Acesso |
|---|---|---|
| Listar mensagens | GET /api/chat/:turmaId | Autenticado |
| Enviar mensagem | POST /api/chat/:turmaId | Autenticado |

- Realtime via Socket.io
- Histórico persistido em `chat_messages`

### 5.12 Documentos Acadêmicos (TAP e PI)

| Funcionalidade | Endpoint | Acesso |
|---|---|---|
| Ver documento | GET /api/projects/:id/docs/:type | Autenticado |
| Salvar documento | PUT /api/projects/:id/docs/:type | Autenticado |
| Ver comentários | GET /api/projects/:id/docs/:type/comments | Autenticado |
| Comentar | POST /api/projects/:id/docs/:type/comments | Autenticado |
| Deletar comentário | DELETE /api/projects/:id/docs/:type/comments/:cid | Autenticado |
| Submeter para avaliação | POST /api/projects/:id/docs/:type/submit | Autenticado |
| Aprovar documento | POST /api/projects/:id/docs/:type/approve | Professor |
| Rejeitar documento | POST /api/projects/:id/docs/:type/reject | Professor |
| Ver permissões | GET /api/docs/permissions | Autenticado |
| Liberar documento | POST /api/docs/permissions/:turmaId/:type | Professor |
| Remover liberação | DELETE /api/docs/permissions/:turmaId/:type | Professor |

**Tipos:** `tap` (Termo de Abertura de Projeto) e `pi` (Projeto de Intervenção)  
**Status do documento:** `draft` → `submitted` → `approved` / `rejected`  
**Conteúdo:** armazenado como JSON flexível  
**Realtime:** eventos `doc-comment` e `doc-status` via Socket.io

### 5.13 Avaliação

| Funcionalidade | Endpoint | Acesso |
|---|---|---|
| Dashboard de avaliação | GET /api/eval | Professor |
| Criar atividade (turma) | POST /api/eval/turma/:turmaId/activities | Professor |
| Criar atividade (projeto) | POST /api/eval/:projectId/activities | Professor |
| Atualizar atividade | PATCH /api/eval/activities/:actId | Professor |
| Scores dos membros | PATCH /api/eval/activities/:actId/scores | Professor |
| Deletar atividade | DELETE /api/eval/activities/:actId | Professor |
| Meta de avaliação | PATCH /api/eval/:projectId/meta | Professor |
| Nota individual | PATCH /api/eval/:projectId/individual | Professor |
| Export por turma | GET /api/export/grading/turma/:turma | Professor |
| Export por projeto | GET /api/export/grading/project/:id | Autenticado |
| Export turmas | GET /api/export/turmas | Professor |

**Seções de avaliação:** `planejamento`, `desenvolvimento`

### 5.14 Exportação Excel

- **Projetos:** export de dados do projeto com membros e tasks
- **Avaliação por turma:** planilha formatada com ExcelJS (cores, merges, blocos por grupo)
- **Avaliação por projeto:** dados de atividades e scores
- **Turmas:** listagem de turmas do professor

### 5.15 Painel Administrativo

| Funcionalidade | Endpoint | Acesso |
|---|---|---|
| Listar usuários | GET /api/admin/users | ADM |
| Criar professor | POST /api/admin/professor | ADM |
| Executar comando | POST /api/admin/cmd | ADM |

### 5.16 Painel Superadmin

| Funcionalidade | Endpoint | Acesso |
|---|---|---|
| Listar uploads | GET /api/superadmin/files | SUPER ADM |
| Dump banco principal | GET /api/superadmin/db | SUPER ADM |
| Dump de tabela | GET /api/superadmin/db/:table | SUPER ADM |
| Logs do servidor | GET /api/superadmin/logs | SUPER ADM |

---

## 6. Realtime (Socket.io)

### 6.1 Autenticação do Socket

O Socket.IO aceita o mesmo JWT da API REST:
1. Cookie `campusflow_token`
2. `socket.handshake.auth.token`

Se ausente ou inválido, a conexão é recusada.

### 6.2 Salas de projeto

Ao conectar:
- **Alunos:** entram nas salas dos projetos em que são membros
- **Professores e ADMs:** entram nas salas de TODOS os projetos

### 6.3 Eventos emitidos pelo servidor

| Evento | Payload | Quando |
|---|---|---|
| `task-updated` | dados da task | Task criada, editada ou com status alterado |
| `doc-comment` | dados do comentário | Novo comentário em TAP ou PI |
| `doc-status` | doc_type, status | Aprovação ou rejeição de documento |
| `project-message` | dados da mensagem | Nova mensagem de projeto |

---

## 7. Email (SMTP)

### 7.1 Configuração

```env
SMTP_HOST=smtp.hostinger.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=no-reply@eusford.com
SMTP_PASS=<senha>
EMAIL_FROM=PILHA <no-reply@eusford.com>
```

O sistema verifica a existência de credenciais SMTP ao iniciar. Se não configurado, funciona sem email (exceto 2FA que fica indisponível para ADM).

### 7.2 Emails enviados pelo sistema

| Situação | Destinatário | Conteúdo |
|---|---|---|
| Criação de professor | Novo professor | Boas-vindas com dados de acesso (email, senha temporária, link) |
| Recuperação de senha | Usuário | Link de reset com token (1 hora de validade) |
| OTP de 2FA | ADM/SUPER | Código numérico de 6 dígitos (10 min validade) |
| Convite de projeto | Convidado | Link de convite (quando SMTP configurado) |

---

## 8. Upload de Arquivos

### 8.1 Configuração do Multer

- **Destino:** `/uploads/tasks/`
- **Tamanho máximo:** 300 KB por arquivo
- **Tipos MIME aceitos:** `application/pdf`, `application/msword`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `application/vnd.ms-excel`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `image/png`, `image/jpeg`, `image/gif`, `text/plain`
- **Acesso:** downloads passam por endpoint autenticado (não expostos diretamente via URL pública)
- **Metadados:** armazenados em `task_attachments` (nome original, MIME, tamanho, uploader)

---

## 9. Segurança

### 9.1 Medidas implementadas

| Medida | Status | Detalhe |
|---|---|---|
| Hash de senhas | Ativo | bcryptjs com fator 10 |
| JWT HttpOnly cookie | Ativo | cookie `pilha_tab_token` |
| Cookie Secure em produção | Ativo | `NODE_ENV=production` |
| Cookie SameSite | Ativo | `lax` |
| Queries parametrizadas | Ativo | Previne SQL injection |
| Sanitização de inputs | Ativo | `sanitize()` e `sanitizeUsername()` |
| Rate limiting | Ativo | In-memory por IP |
| 2FA email para ADM/SUPER | Ativo | OTP 6 dígitos, TTL 10 min |
| Troca obrigatória de senha | Ativo | `must_change_password` flag |
| Anti-enumeração de usuários | Ativo | forgot-password sempre retorna 200 |
| `x-powered-by` desativado | Ativo | Express default removido |
| Uploads com MIME validation | Ativo | Whitelist de tipos aceitos |
| Downloads autenticados | Ativo | Endpoint protegido por `authRequired` |

### 9.2 Limitações de segurança conhecidas

| Limitação | Impacto | Mitigação atual |
|---|---|---|
| Rate limiter in-memory | Zera ao reiniciar; não funciona com múltiplos processos | Single process via PM2 |
| JWT stateless | Tokens não invalidados ao trocar senha | Expiração de 12h |
| Sem CSP | XSS sem mitigação extra no browser | SameSite + sanitização |
| Sem CSRF token | Confia no SameSite lax | SameSite lax + CORS |
| Senhas: mínimo 6 chars apenas | Não exige complexidade | Orientação ao usuário |
| Fotos como base64 no banco | Banco cresce com fotos | Aceitável para escala atual |
| Fallback de senha hardcoded (db.js) | Risco se variável de ambiente não definida | `.env` obrigatório em produção |

---

## 10. Infraestrutura e Deploy

### 10.1 Docker

```dockerfile
FROM node:20-alpine
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server.js db.js ecosystem.config.js ./
COPY styles.css landing.html cadastro.html ./
COPY js/ ./js/
COPY views/ ./views/
COPY assets/ ./assets/
RUN mkdir -p /data /app/uploads/tasks
EXPOSE 3000
CMD ["node", "server.js"]
```

### 10.2 Docker Compose (produção)

```yaml
services:
  pilha:
    build: .
    image: pilha-app
    container_name: site-pilha
    restart: unless-stopped
    env_file: .env
    environment:
      - DB_PATH=/data/campusflow.db
      - EVAL_DB_PATH=/data/grading.db
    volumes:
      - ./data:/data          # bancos SQLite persistentes
      - ./uploads:/app/uploads # arquivos enviados pelos usuários
    networks:
      - proxy                 # rede externa do Nginx Proxy Manager
```

### 10.3 PM2 (ecosystem.config.js)

```javascript
{
  name: "pilha",
  script: "server.js",
  instances: 1,
  autorestart: true,
  watch: false,
  max_memory_restart: "256M",
  env_production: { NODE_ENV: "production", PORT: 3000 }
}
```

### 10.4 Variáveis de ambiente obrigatórias em produção

| Variável | Uso |
|---|---|
| `JWT_SECRET` | Assinar tokens JWT (sem fallback seguro) |
| `ADMIN_PASSWORD` | Senha da conta ADM |
| `SUPER_PASSWORD` | Senha da conta SUPER ADM |
| `PI_PASSWORD` | Senha da conta PI |
| `SUPER_OTP_EMAIL` | Email destino do OTP do SUPER |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | SMTP para emails |
| `DB_PATH` | Caminho do banco principal |
| `EVAL_DB_PATH` | Caminho do banco de avaliação |
| `NODE_ENV` | `production` para ativar Secure cookie |
| `PORT` | Porta do servidor (padrão: 3000) |

---

## 11. Testes

| Ferramenta | Versão | Uso |
|---|---|---|
| Jest | 30.3.0 | Framework de testes |
| Supertest | 7.2.2 | Testes HTTP |

**Suíte:** `jest --runInBand` (sequencial para evitar conflitos de banco)  
**Ambiente:** `node`  
**Timeout:** 15.000 ms  
**Estado:** 53 testes (52 passando, 1 corrigido na branch atual)

```bash
npm test
```

---

## 12. Dívidas Técnicas

| # | Dívida | Impacto |
|---|---|---|
| 1 | server.js com 2.324 linhas (monolito) | Difícil manutenção e testes |
| 2 | SQLite sem pooling, replicação ou foreign keys estritas | Limitação de escala |
| 3 | Rate limiter in-memory | Zera ao reiniciar o processo |
| 4 | Fotos de perfil como base64 no banco | Banco cresce desnecessariamente |
| 5 | Sem TOTP/Google Authenticator | Professores sem 2FA |
| 6 | Requisito de senha: apenas mínimo 6 chars | Senhas fracas permitidas |
| 7 | Migrations sem versionamento formal | Risco em atualizações |
| 8 | Sem CSP, Helmet ou HSTS no backend | Segurança de browser menor |
| 9 | JWT stateless — sem revogação imediata | Tokens continuam válidos após troca de senha |
| 10 | Baixa cobertura de testes em turmas, chat, documentos, avaliação, kanban, export | Risco de regressão em features críticas |
| 11 | 3 testes marcados como `todo` | Fluxos não validados automaticamente |
| 12 | Fallback de senha hardcoded em db.js | Risco de segurança se `.env` não configurado |

---

*Documentação gerada por análise de código estático. Nenhum arquivo do projeto foi alterado.*
