# PILHA - Estrutura Tecnologica e Autenticacao

Documento tecnico do projeto PILHA aberto em `d:\Pilha`.

## 1. Visao geral

O PILHA e uma aplicacao web para gestao de projetos academicos usando praticas de Scrum e Kanban. O sistema atende principalmente dois perfis:

- Aluno: participa de projetos, organiza tarefas, usa Kanban, documentos, chat e onboarding.
- Professor: cria turmas, acompanha projetos, avalia entregas, gerencia alunos e acessa recursos administrativos conforme permissao.

A aplicacao esta organizada como um monolito Node.js/Express com frontend em HTML, CSS e JavaScript vanilla. O backend entrega a SPA, expoe a API REST, gerencia autenticacao por JWT e mantem comunicacao em tempo real via Socket.IO.

## 2. Estrutura tecnologica

### 2.1 Backend

Stack principal:

- Node.js
- Express 4
- SQLite com `sqlite` e `sqlite3`
- JWT com `jsonwebtoken`
- Cookies com `cookie-parser`
- Senhas com `bcryptjs`
- E-mail com `nodemailer`
- Upload com `multer`
- Tempo real com `socket.io`
- Exportacoes com `exceljs` e `xlsx`

Arquivos principais:

- `server.js`: servidor Express, rotas REST, autenticacao, autorizacao, Socket.IO, uploads e exports.
- `db.js`: abertura dos bancos SQLite, criacao de tabelas, migracoes simples e seeds iniciais.
- `package.json`: scripts e dependencias.
- `Dockerfile`: imagem de producao baseada em Node 20 Alpine.
- `docker-compose.prod.yml`: servico `pilha`, volumes de dados/uploads e rede externa `proxy`.
- `ecosystem.config.js`: configuracao PM2 para rodar `server.js` na porta 3000.

### 2.2 Frontend

Stack principal:

- HTML particionado em arquivos dentro de `views/`
- JavaScript vanilla dentro de `js/`
- CSS unico em `styles.css`
- Landing page publica em `landing.html`
- Tela de cadastro por convite em `cadastro.html`

Organizacao das views:

- `views/shell-top.html` e `views/shell-bottom.html`: base da SPA.
- `views/nav.html`: navegacao principal.
- `views/dashboard.html`, `projects.html`, `scrum.html`, `kanban.html`, `documents.html`, `turmas.html`, `chat.html`, `equipes.html`, `avaliacao.html`, `admin.html`: telas funcionais.
- `views/modals.html`: dialogs e formularios reutilizados pela interface.

Organizacao dos scripts:

- `js/core.js`: estado global, helpers, `apiFetch`, seletores DOM e carregamento de dados.
- `js/auth.js`: login, registro, onboarding, 2FA, recuperacao/reset de senha, logout e boot de sessao.
- `js/socket.js`: integracao Socket.IO.
- Demais arquivos em `js/`: modulos de dominio como tarefas, projetos, Kanban, turmas, chat, equipes, avaliacao e admin.

### 2.3 Persistencia

O projeto usa SQLite. Os caminhos podem ser controlados por variaveis de ambiente:

- `DB_PATH`: banco principal. Em producao, o compose aponta para `/data/campusflow.db`.
- `EVAL_DB_PATH`: banco de avaliacao. Em producao, o compose aponta para `/data/grading.db`.

Principais tabelas do banco principal:

- `users`: usuarios, perfis, dados academicos, hash de senha, flags administrativas e onboarding.
- `projects`: projetos academicos.
- `project_members`: membros dos projetos e papeis Scrum.
- `sprints`: sprints.
- `tasks`: tarefas.
- `task_comments`: comentarios de tarefas.
- `kanban_boards` e `kanban_columns`: boards e colunas Kanban.
- `custom_field_definitions` e `custom_field_values`: campos customizados.
- `project_invites`: convites de projeto.
- `turmas`: turmas criadas por professores.
- `chat_messages`: mensagens de chat por turma.
- `password_reset_tokens`: tokens de recuperacao de senha.
- `otp_codes`: codigos de 2FA para contas administrativas.
- `project_docs`, `doc_comments`, `doc_permissions`: documentos TAP/PI, comentarios e liberacoes.
- `access_logs`: logs de acesso.
- `task_attachments`: anexos de tarefas.
- `task_audit`: historico de alteracoes de tarefas.
- `project_messages`: mensagens de projeto.

Banco de avaliacao:

- `eval_activities`
- `eval_individual`
- `eval_meta`
- `eval_activity_scores`

### 2.4 Tempo real

O backend inicializa Socket.IO quando `server.js` roda diretamente. A autenticacao do socket usa o mesmo JWT da aplicacao:

- Primeiro tenta ler o cookie `campusflow_token`.
- Depois tenta ler `socket.handshake.auth.token`.

Ao conectar, o usuario entra nas salas dos seus projetos. Professores e admins entram nas salas de todos os projetos. Eventos usados no sistema incluem atualizacoes de tarefas, documentos e mensagens de projeto.

### 2.5 Uploads e arquivos

Uploads de anexos de tarefas usam `multer` com destino em `uploads/tasks`.

Regras principais:

- Tamanho maximo por arquivo: 300 KB.
- Tipos aceitos: PDF, Word, Excel, PNG, JPEG, GIF e texto.
- `uploads/` nao e exposto diretamente como pasta publica; downloads passam por endpoint autenticado.

### 2.6 E-mail

O envio de e-mail usa `nodemailer`, ativado quando existem credenciais SMTP no ambiente:

- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_SECURE`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM` ou `EMAIL_FROM`

Usos principais:

- Convites para projetos.
- Recuperacao de senha.
- OTP de 2FA para ADM/SUPER.
- Boas-vindas para professor criado via painel admin.

### 2.7 Deploy e infraestrutura

O projeto esta preparado para rodar em container Docker:

- `Dockerfile` instala dependencias de producao com `npm ci --omit=dev`.
- `docker-compose.prod.yml` monta `./data` em `/data` e `./uploads` em `/app/uploads`.
- A aplicacao expoe a porta 3000.
- A rede Docker esperada e `proxy`, externa, normalmente usada pelo Nginx Proxy Manager.

Ambiente de producao informado no projeto:

- VPS HostGator com Ubuntu.
- Portainer.
- Nginx Proxy Manager.
- N8N.
- Dominio publico: `pilha.eusford.com`.

Nenhum deploy, reinicio de servico, alteracao de container, proxy, dominio ou SSL deve ser feito sem autorizacao explicita.

### 2.8 Testes

O projeto declara Jest e Supertest como ferramentas de teste:

- Script: `npm test`
- Comando configurado: `jest --runInBand`
- Ambiente Jest: `node`
- Timeout: 15000 ms

O contexto do projeto registra uma suite com 53 testes, sendo 52 passando e 1 falhando relacionado ao endpoint `POST /api/admin/professor`, que deveria retornar `username` no corpo da resposta.

Observacao do estado local: na arvore atual do diretorio aberto, nao ha arquivos `*.test.js` ou `*.spec.js` versionados fora de `node_modules`.

## 3. Autenticacao

### 3.1 Modelo de usuario

A tabela `users` concentra identidade, perfil e flags de acesso.

Campos relevantes:

- `id`: identificador interno.
- `username`: nome de usuario unico.
- `name`: nome exibido.
- `role`: perfil funcional, com valores `aluno` ou `professor`.
- `is_admin`: nivel administrativo.
- `email`: e-mail unico.
- `password_hash`: hash bcrypt da senha.
- `onboarding_done`: indica se o aluno terminou onboarding.
- `must_change_password`: exige troca de senha.
- `turma`, `periodo`, `curso`, `turma_id`: vinculos academicos.
- `profile_complete`: perfil expandido preenchido.

Niveis de acesso:

- `aluno`: usuario comum de projeto/turma.
- `professor`: cria turmas, avalia, acompanha projetos e tem permissoes ampliadas.
- `is_admin = 1`: ADM, pode acessar rotas administrativas.
- `is_admin >= 2`: SUPER, pode acessar rotas superadmin.

### 3.2 Hash de senha

Senhas sao armazenadas com `bcryptjs`.

Fluxos que geram ou trocam senha:

- Registro comum.
- Registro por turma.
- Registro por convite.
- Onboarding do aluno.
- Criacao de professor pelo admin.
- Recuperacao/reset de senha.
- Troca obrigatoria de senha.

O backend valida tamanho minimo de 6 caracteres nos principais fluxos.

### 3.3 Login

Endpoint principal:

`POST /api/auth/login`

Entrada aceita:

- `identifier`
- `email`
- `username`
- `password`

Regras:

- Se o identificador tiver formato de e-mail, busca por `email`.
- Se nao tiver formato de e-mail, busca por `username`.
- Login por `username` e permitido apenas para contas administrativas.
- A senha e comparada com `bcrypt.compareSync`.
- Em credenciais invalidas, retorna 401.
- Em sucesso, gera JWT e retorna dados do usuario.

Resposta em sucesso pode incluir:

- `user`
- `requiresOnboarding`
- `mustChangePassword`

Existe tambem o endpoint legado/complementar:

`POST /api/auth/login-email`

Ele autentica diretamente por e-mail e senha.

### 3.4 JWT e sessao

O JWT e assinado com `JWT_SECRET` e expira em 12 horas.

Payload gerado por `buildAuthPayload`:

- `id`
- `username`
- `name`
- `role`
- `isAdmin`
- `isSuperAdmin`
- `email`
- `turma`
- `periodo`
- `curso`
- `turmaId`
- `profileComplete`
- `onboardingDone`

O backend entrega o token de duas formas:

- Cookie HTTP-only chamado `campusflow_token`.
- Header `X-Auth-Token`, para o frontend guardar no `sessionStorage` da aba.

Configuracao do cookie:

- `httpOnly: true`
- `sameSite: "lax"`
- `secure: true` apenas em producao
- `maxAge`: 12 horas

No frontend, `apiFetch` envia:

- `credentials: "include"` para incluir cookies.
- Header `Authorization: Bearer <token>` quando existe token no `sessionStorage`.

Esse desenho permite sessao por cookie e tambem isolamento por aba usando `sessionStorage`.

### 3.5 Middleware de autorizacao

Middlewares principais em `server.js`:

- `authRequired`: exige JWT valido por header `Authorization`, header legado `x-auth-token` ou cookie `campusflow_token`.
- `professorOnly`: permite professor ou admin.
- `adminOnly`: permite apenas `isAdmin`.
- `superAdminOnly`: permite apenas `isSuperAdmin`.

Padrao de resposta:

- Sem token: 401 `Nao autenticado`.
- Token invalido: 401 `Sessao invalida`.
- Sem permissao: 403.

### 3.6 2FA por e-mail para admins

Contas ADM e SUPER usam OTP por e-mail no login, exceto em ambiente de teste ou quando o usuario esta em `NO_2FA_USERNAMES`.

Fluxo:

1. Admin envia login e senha em `POST /api/auth/login`.
2. Se credenciais forem validas, o backend gera codigo numerico de 6 digitos.
3. Codigo e salvo em `otp_codes`.
4. Validade: 10 minutos.
5. Resposta indica `requires2FA: true`, `userId` e e-mail mascarado.
6. Frontend mostra tela de 2FA.
7. Usuario confirma em `POST /api/auth/verify-otp`.
8. Backend marca codigo como usado, gera JWT e cria sessao.

Endpoints:

- `POST /api/auth/request-otp`: solicita novo codigo.
- `POST /api/auth/verify-otp`: valida codigo e emite sessao.

Rate limits:

- Login: 10 tentativas por 15 minutos por IP.
- Verificacao OTP: 5 tentativas por 15 minutos por IP.
- Pedido de OTP: 3 solicitacoes por 15 minutos por IP.

### 3.7 Registro e onboarding

Registro comum:

`POST /api/auth/register`

- Cria aluno ou professor.
- Valida `username`, `name`, `role` e senha.
- `role` deve ser `aluno` ou `professor`.
- Aluno nasce com `onboarding_done = 0`.
- Professor nasce com `onboarding_done = 1`.

Registro por turma:

`POST /api/auth/register-by-turma`

- Usa token criado por professor em `/api/turmas`.
- Cria aluno vinculado a turma, periodo, curso e `turma_id`.
- Gera sessao imediatamente.
- Retorna `requiresOnboarding: true`.

Registro por convite de projeto:

`POST /api/auth/register-by-invite`

- Usa token de `project_invites`.
- Exige e-mail igual ao e-mail do convite.
- Cria aluno, adiciona no projeto e marca convite como aceito.
- Gera sessao imediatamente.

Onboarding de aluno:

`POST /api/auth/student-onboarding`

- Exige usuario autenticado com `role = aluno`.
- Atualiza e-mail, senha, turma, periodo, curso e foto.
- Pode criar projeto novo ou aceitar convite pendente.
- Marca `onboarding_done = 1`.
- Emite novo JWT com payload atualizado.

### 3.8 Recuperacao e troca de senha

Recuperacao por e-mail:

- `POST /api/auth/forgot-password`
- Recebe usuario/e-mail.
- Retorna sucesso mesmo se usuario nao existir, evitando enumeracao.
- Gera token em `password_reset_tokens`.
- Validade: 1 hora.
- Envia link por e-mail quando SMTP esta configurado.

Reset com token:

- `POST /api/auth/reset-password`
- Exige token valido, nao usado e nao expirado.
- Atualiza `password_hash`.
- Marca token como usado.
- Remove `must_change_password`.

Troca autenticada:

- `POST /api/auth/change-password`
- Exige JWT valido.
- Atualiza `password_hash`.
- Remove `must_change_password`.

Observacao de seguranca:

- O endpoint antigo `/api/auth/recover` foi removido no backend porque permitia troca de senha sem autenticacao.
- O frontend ainda contem um handler antigo chamando `/api/auth/recover`, mas o backend documenta que o fluxo correto e `forgot-password` + `reset-password` ou reset administrativo.

### 3.9 Logout e sessao atual

Endpoints:

- `POST /api/auth/logout`: limpa o cookie `campusflow_token`.
- `GET /api/auth/me`: retorna o usuario do JWT atual.

No frontend:

- `clearSession` remove o token da aba em `sessionStorage`.
- A interface volta para a tela de autenticacao.

### 3.10 Autenticacao no Socket.IO

O Socket.IO usa o mesmo JWT da API:

- Cookie `campusflow_token`.
- Ou token enviado em `socket.handshake.auth.token`.

Se o token estiver ausente ou invalido, a conexao e recusada.

Depois de autenticado:

- Alunos entram nas salas dos projetos em que sao membros.
- Professores e admins entram nas salas de todos os projetos.

### 3.11 Superficies protegidas

Exemplos de areas protegidas por `authRequired`:

- Projetos.
- Tarefas.
- Sprints.
- Kanban.
- Turmas.
- Chat.
- Perfil.
- Documentos.
- Avaliacao.
- Admin.
- Superadmin.
- Uploads/downloads de anexos.

Exemplos de regras adicionais:

- Criacao de sprint: professor/admin.
- Criacao/listagem de turmas: professor/admin.
- Avaliacao: professor/admin.
- Admin: ADM/SUPER.
- Superadmin: SUPER.
- Edicao de membros/papeis: professor/admin ou Product Owner do projeto, conforme rota.

### 3.12 Variaveis de ambiente relevantes

Seguranca e app:

- `JWT_SECRET`
- `NODE_ENV`
- `PORT`
- `APP_BASE_URL`
- `APP_URL`

Banco:

- `DB_PATH`
- `EVAL_DB_PATH`

Admin:

- `ADMIN_PASSWORD`
- `SUPER_PASSWORD`
- `PI_PASSWORD`
- `SUPER_OTP_EMAIL`
- `NO_2FA_USERNAMES`

SMTP:

- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_SECURE`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM`
- `EMAIL_FROM`

### 3.13 Pontos de atencao

- `JWT_SECRET`, `ADMIN_PASSWORD` e `SUPER_PASSWORD` possuem fallbacks inseguros se nao forem definidos; em producao devem existir no ambiente.
- Rate limiter e em memoria; reinicia junto com o processo.
- Migracoes em `db.js` sao imperativas e sem versionamento formal.
- `server.js` concentra muitas responsabilidades.
- O frontend ainda referencia um fluxo antigo `/api/auth/recover`, embora o backend tenha removido esse endpoint por seguranca.
- O contexto atual registra um teste falhando em `POST /api/admin/professor`; o codigo local ja mostra retorno de `username`, mas a validacao deve ser feita com `npm test` quando a suite estiver disponivel.

