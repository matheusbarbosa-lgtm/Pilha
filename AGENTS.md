# AGENTS.md - Regras dos agentes para o projeto PILHA

## Projeto

Nome: PILHA  
URL de produção: https://pilha.eusford.com

O PILHA é um sistema de gestão de projetos acadêmicos com metodologia Scrum/Kanban para alunos e professores de ensino superior.

## Produção

A aplicação roda em uma VPS HostGator com Ubuntu.

Configuração:
- 2 vCPUs
- 4 GB de RAM
- 100 GB de armazenamento

Infraestrutura:
- Portainer
- Nginx Proxy Manager
- N8N
- FileZilla usado para envio de arquivos
- Aplicação acessível por pilha.eusford.com

## Stack

Backend:
- Node.js
- Express
- SQLite
- sqlite + sqlite3 5.1.7
- JWT cookie HttpOnly
- bcryptjs
- nodemailer
- Socket.io 4.8
- exceljs
- xlsx

Frontend:
- Vanilla JS
- app.js
- index.html particionado em 14 partes
- styles.css

Testes:
- Jest
- supertest

## Estado atual

O sistema está funcional em produção.

Existem 53 testes:
- 52 passando
- 1 falhando

Teste falhando conhecido:
POST /api/admin/professor retorna username undefined no body.
O teste espera username "prof.novo".

## Regras absolutas

Agentes NÃO podem:

- Fazer commit automático.
- Fazer push automático.
- Fazer merge automático.
- Mexer direto na VPS.
- Alterar produção sem autorização explícita.
- Alterar Portainer.
- Alterar Nginx Proxy Manager.
- Alterar N8N.
- Alterar containers.
- Alterar domínio, SSL, proxy host ou portas.
- Usar FileZilla para sobrescrever arquivos sem autorização.
- Reiniciar serviços sem autorização.
- Refatorar o server.js inteiro agora.
- Refatorar o app.js inteiro agora.
- Criar novas features.
- Alterar contratos de API sem justificar.
- Remover testes existentes.
- Remover documentação existente.
- Expor JWT_SECRET, senhas, tokens, cookies ou dados reais.

## Objetivo dos agentes

Finalizar o PILHA com segurança, focando em:

1. Corrigir o teste falhando.
2. Fazer a suíte chegar a 53/53.
3. Melhorar cobertura de testes de forma estratégica.
4. Documentar endpoints e fluxos principais.
5. Mapear dívidas técnicas sem grandes refatorações.
6. Preparar deploy seguro, mas sem executar deploy automaticamente.

## Fluxo obrigatório

1. Claude Arquiteto analisa e planeja.
2. Codex Implementador executa somente escopo aprovado.
3. Codex Auditor revisa sem alterar código.
4. Codex Implementador corrige achados Crítico, Alto e Médio.
5. Codex Auditor aprova.
6. Claude Arquiteto dá parecer final.
7. Usuário roda git status.
8. Usuário faz commit/push/merge manualmente.
9. Deploy em pilha.eusford.com só com autorização explícita.

## Comandos de validação

Antes de considerar qualquer tarefa pronta, rodar:

```bash
git status
npm test