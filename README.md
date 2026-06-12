# PILHA

Plataforma web de gestão de projetos acadêmicos com metodologia **Scrum/Kanban**, voltada para professores e alunos de ensino superior.

- **Produção:** https://pilha.eusford.com
- **Stack:** Node.js + Express + SQLite + Socket.IO + HTML/CSS/JS vanilla
- **Documentação técnica completa:** [PILHADOCUMENTACAOTECNICA.md](PILHADOCUMENTACAOTECNICA.md)

---

## Sumário

1. [Visão geral](#1-visão-geral)
2. [Perfis de usuário](#2-perfis-de-usuário)
3. [Funcionalidades](#3-funcionalidades)
4. [Stack tecnológica](#4-stack-tecnológica)
5. [Estrutura do projeto](#5-estrutura-do-projeto)
6. [Como rodar localmente](#6-como-rodar-localmente)
7. [Variáveis de ambiente](#7-variáveis-de-ambiente)
8. [Deploy em produção (Docker)](#8-deploy-em-produção-docker)
9. [Banco de dados](#9-banco-de-dados)
10. [Autenticação e segurança](#10-autenticação-e-segurança)
11. [Testes](#11-testes)
12. [Convenções e fluxo de trabalho](#12-convenções-e-fluxo-de-trabalho)

---

## 1. Visão geral

O **PILHA** organiza o ciclo de vida de projetos acadêmicos do início ao fim:

- Professores criam **turmas** e acompanham os projetos dos alunos.
- Alunos formam **equipes**, criam **projetos**, gerenciam **sprints**, **tarefas**, **documentos (TAP/PI)** e usam **chat em tempo real**.
- Professores **avaliam** entregas e geram **relatórios** em Excel/PDF.

O sistema é um **monolito Node.js/Express** que serve uma SPA em HTML/CSS/JS vanilla.

---

## 2. Perfis de usuário

| Perfil | `is_admin` | Acesso |
|---|---|---|
| **Aluno** | 0 | Participa de projetos, organiza tarefas, Kanban, chat, documentos, onboarding |
| **Professor** | 0 | Cria turmas, acompanha projetos, avalia entregas, gerencia alunos |
| **ADM** | 1 | Painel administrativo, criação de professores |
| **SUPER ADM** | 2 | Acesso global, dump de banco, ações sensíveis (2FA por email obrigatório) |

---

## 3. Funcionalidades

### Para alunos
- Cadastro via **token de turma** ou **convite** por email
- Onboarding guiado
- Criação e participação em **projetos**
- **Scrum:** backlog, sprints, story points, prioridade
- **Kanban:** boards customizáveis (colunas com cor e ordem)
- **Tarefas:** subtasks, checklists, tags, anexos, comentários, auditoria
- **Documentos:** TAP (Termo de Abertura) e PI (Projeto Integrador), com fluxo de aprovação
- **Chat por turma** (Socket.IO)
- **Mensagens por projeto**
- Recuperação de senha por email

### Para professores
- Criação e gestão de **turmas** com token de convite
- Acompanhamento de **todos os projetos** da turma
- **Avaliação** de projetos: atividades, notas por membro, observações
- Aprovação/rejeição de documentos TAP e PI
- Liberação de documentos por turma
- Exportação de relatórios em **Excel** (com estilo) e **PDF**

### Para ADM / SUPER ADM
- Painel administrativo
- Criação de contas de professor
- Login com **2FA por email** (OTP de 6 dígitos, TTL de 10 min)
- **Logs de acesso** (IP, timestamp, usuário)
- SUPER ADM: dump do banco e acesso global

---

## 4. Stack tecnológica

### Backend
- **Node.js 20** (Alpine no Docker)
- **Express 4** — framework HTTP
- **SQLite** (`sqlite` + `sqlite3`) — dois bancos: principal e avaliação
- **jsonwebtoken** — JWT HS256
- **bcryptjs** + **argon2** — hash de senhas
- **cookie-parser** — cookies HttpOnly
- **helmet** — headers de segurança
- **nodemailer** — SMTP para OTP e recuperação de senha
- **multer** — upload de arquivos
- **socket.io** — chat em tempo real
- **exceljs** + **xlsx** — exportação de planilhas
- **speakeasy** + **qrcode** — preparação para 2FA TOTP

### Frontend
- **HTML5** (14 arquivos em [views/](views/), particionados em shell + páginas)
- **JavaScript vanilla** (14 arquivos em [js/](js/))
- **CSS** único ([styles.css](styles.css))
- **Socket.io client**

### Infra
- **Docker** + **docker-compose** (rede `proxy` externa)
- **PM2** ([ecosystem.config.js](ecosystem.config.js)) para gerenciamento de processo
- **VPS HostGator Ubuntu** (2 vCPUs / 4 GB RAM / 100 GB)

---

## 5. Estrutura do projeto

```
.
├── server.js                       # Servidor Express, rotas REST, Socket.IO, uploads
├── db.js                           # Abertura SQLite, migrations, seeds
├── package.json
├── Dockerfile
├── docker-compose.prod.yml
├── ecosystem.config.js             # PM2
├── .env.example                    # Modelo de variáveis de ambiente
├── landing.html                    # Landing page pública
├── cadastro.html                   # Cadastro por convite
├── styles.css                      # CSS global
├── views/                          # Partials da SPA (shell, dashboard, kanban, chat...)
├── js/                             # JS por módulo (auth, tasks, projects, kanban...)
├── assets/                         # Imagens e ícones estáticos
├── uploads/                        # Anexos de tarefas (volume persistente)
├── data/                           # Bancos SQLite em produção
├── tests/                          # Testes Jest + Supertest
├── PILHADOCUMENTACAOTECNICA.md     # Documentação técnica detalhada
└── REVIEW_FASE_*.md                # Revisões por fase de segurança
```

---

## 6. Como rodar localmente

### Pré-requisitos
- **Node.js 20+**
- **npm**
- (Opcional) **Docker** + **docker-compose** para rodar como em produção

### Passo a passo

```bash
# 1. Clonar e instalar
git clone <repo-url>
cd Pilha-staging
npm install

# 2. Configurar variáveis de ambiente
cp .env.example .env
# Edite .env com seus valores (gere JWT_SECRET com: openssl rand -base64 48)

# 3. Iniciar o servidor
npm start

# Servidor disponível em http://localhost:3000
```

Na primeira execução, [db.js](db.js) cria as tabelas e popula dados iniciais (incluindo o usuário SUPER ADM, configurável via env).

---

## 7. Variáveis de ambiente

Veja [.env.example](.env.example) para o modelo completo. Resumo:

| Variável | Obrigatória | Descrição |
|---|---|---|
| `NODE_ENV` | sim | `production` ou `development` |
| `PORT` | não | Porta HTTP (padrão `3000`) |
| `JWT_SECRET` | **sim** | Segredo HS256 para assinatura do JWT (gerar com `openssl rand -base64 48`) |
| `ADMIN_PASSWORD` | sim | Senha inicial do ADM |
| `SUPER_PASSWORD` | sim | Senha inicial do SUPER ADM |
| `PI_PASSWORD` | sim | Senha para área de PI |
| `SUPER_OTP_EMAIL` | sim | Email que recebe OTP do SUPER ADM |
| `DB_PATH` | não | Caminho do banco principal (padrão `campusflow.db`) |
| `EVAL_DB_PATH` | não | Caminho do banco de avaliação (padrão `grading.db`) |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` | sim em prod | Servidor SMTP |
| `SMTP_USER` / `SMTP_PASS` | sim em prod | Credenciais SMTP |
| `EMAIL_FROM` | sim em prod | Remetente dos emails |
| `APP_BASE_URL` / `APP_URL` | sim em prod | URL pública para links em emails |

**Nunca commitar o `.env` real.**

---

## 8. Deploy em produção (Docker)

A imagem `pilha-app` é construída via [Dockerfile](Dockerfile) (Node 20 Alpine).

```bash
# 1. Garantir rede 'proxy' externa (compartilhada com Nginx/Traefik)
docker network create proxy

# 2. Criar .env de produção e diretórios persistentes
cp .env.example .env
mkdir -p data uploads

# 3. Subir
docker compose -f docker-compose.prod.yml up -d --build
```

Volumes persistentes:
- `./data` → `/data` (bancos SQLite)
- `./uploads` → `/app/uploads` (anexos de tarefas)

O container expõe a porta `3000` na rede `proxy` — coloque um reverse proxy (Nginx/Traefik) na frente para TLS.

---

## 9. Banco de dados

PILHA usa **dois bancos SQLite separados**:

### `campusflow.db` (principal)
Usuários, projetos, sprints, tarefas, kanban, turmas, chat, documentos, convites, OTPs, tokens de recuperação, logs de acesso.

### `grading.db` (avaliação)
Atividades de avaliação, notas individuais, notas de entrega, observações do professor.

Tabelas, colunas e relacionamentos estão documentados em [PILHADOCUMENTACAOTECNICA.md §3](PILHADOCUMENTACAOTECNICA.md).

---

## 10. Autenticação e segurança

### JWT
- **Algoritmo:** HS256 com `JWT_SECRET`
- **TTL:** 12 horas
- **Transporte:** cookie `pilha_tab_token` (HttpOnly, SameSite=lax, Secure em prod) + `sessionStorage` por aba (isolamento multi-aba)

### Middlewares
```
authRequired       → verifica JWT (cookie ou header)
professorOnly      → role === 'professor' OU isAdmin
adminOnly          → is_admin >= 1
superAdminOnly     → is_admin >= 2
```

### 2FA (ADM e SUPER ADM)
OTP de 6 dígitos enviado por email, TTL 10 min, uso único.

### Rate limiting
| Endpoint | Limite | Janela |
|---|---|---|
| `POST /api/auth/login` | 10 | 15 min |
| `POST /api/auth/verify-otp` | 5 | 15 min |
| `POST /api/auth/request-otp` | 3 | 15 min |

### Recuperação de senha
Token seguro com TTL de 1 hora, uso único. Respostas anti-enumeração (200 OK mesmo se o email não existir).

### Política de senha forte (Fase 1)
Checklist visual no cadastro com validação client-side e server-side. Detalhes em [REVIEW_FASE_1.md](REVIEW_FASE_1.md).

---

## 11. Testes

```bash
npm test
```

Suíte com **Jest** + **Supertest**, rodando em série (`--runInBand`) por causa do SQLite compartilhado. Testes em [tests/](tests/).

---

## 12. Convenções e fluxo de trabalho

- **Branches:** `seguranca/fase-N-descricao` para hardening de segurança, `feature/<nome>` para novas funcionalidades.
- **Commits:** prefixados por área — `security(...)`, `docs(...)`, `feat(...)`, `fix(...)`.
- **Revisões por fase:** cada fase de segurança gera um `REVIEW_FASE_N.md` com checklist do que foi feito.

---

## Licença

Projeto privado/acadêmico — todos os direitos reservados.
