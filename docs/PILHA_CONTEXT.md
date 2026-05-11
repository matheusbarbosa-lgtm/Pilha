
---

# 4. Agora crie o contexto do projeto

No arquivo `docs\PILHA_CONTEXT.md`, cole:

```md
# Contexto técnico do PILHA

## Objetivo

Sistema de gestão de projetos acadêmicos com metodologia Scrum/Kanban para alunos e professores de ensino superior.

Professores criam turmas e avaliam grupos.  
Alunos organizam tarefas, sprints e documentos.

## Produção

URL: https://pilha.eusford.com

VPS:
- HostGator
- Ubuntu
- 2 vCPUs
- 4 GB RAM
- 100 GB armazenamento

Serviços na VPS:
- Portainer
- Nginx Proxy Manager
- N8N
- FileZilla para envio de arquivos

## Funcionalidades implementadas

- Auth: login, registro, logout, forgot/reset-password, OTP por email, change-password, must_change_password.
- Onboarding aluno: criar projeto ou entrar via invite token.
- Projetos: CRUD, membros, roles Scrum, convites por email, export XLSX.
- Sprints: CRUD com professor only.
- Tasks: CRUD, status, urgência, tags, checklist, prioridade, subtasks, comentários, campos customizados e anexos.
- Kanban: boards e colunas customizadas por projeto.
- Turmas: CRUD, invite token, membros e atividades de avaliação.
- Chat: mensagens por turma via REST e Socket.io.
- Documentos: criação, comentários, submit, approve, reject e eventos Socket.io.
- Realtime: task-updated, doc-comment, doc-status e project-message.
- Auditoria: GET /api/tasks/:id/audit.
- Avaliação: atividades, scores, notas individuais, meta e export Excel.
- Admin: criar professor por email, comando admin e dump de tabela SUPER only.
- Perfil: foto base64 JPEG, bio, turma, período e curso.
- Segurança: rate limiters, sanitização, x-powered-by desativado, cookie secure em produção, fail2ban e UFW.

## Problemas conhecidos

1. Um teste falhando:
   POST /api/admin/professor retorna username undefined.
   O teste espera username "prof.novo".

2. Baixa cobertura em:
   - turmas
   - chat
   - documentos
   - avaliação
   - anexos
   - kanban boards
   - export

3. Existem 3 testes marcados como todo.

4. server.js com mais de 2.300 linhas.

5. app.js grande e sem testes frontend.

6. Migrações em db.js são manuais e sem versionamento formal.

7. Rate limiter in-memory zera em restart do processo.

## Prioridade atual

1. Corrigir o teste falhando.
2. Garantir 53/53 testes passando.
3. Adicionar testes estratégicos sem criar features.
4. Documentar API.
5. Preparar checklist de deploy.