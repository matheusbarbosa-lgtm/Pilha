// ── Socket.io client ─────────────────────────────────────
// Carregado depois de todos os outros módulos
(function initSocket() {
  if (typeof io === "undefined") return; // socket.io não carregado

  const tokenKey = typeof SESSION_TOKEN_KEY !== "undefined" ? SESSION_TOKEN_KEY : "pilha_tab_token";
  const token = sessionStorage.getItem(tokenKey) || "";
  const socket = io({ auth: { token }, transports: ["websocket", "polling"] });

  socket.on("connect", () => {
    console.log("[Socket] conectado:", socket.id);
  });

  socket.on("connect_error", (err) => {
    console.warn("[Socket] erro de conexão:", err.message);
  });

  // Tarefa atualizada → recarrega dados
  socket.on("task-updated", ({ taskId }) => {
    // Recarrega silenciosamente
    if (typeof refreshAndRender === "function") refreshAndRender();
    // Se modal aberto para esta tarefa, recarrega
    if (typeof _detailTask !== "undefined" && _detailTask?.id === taskId) {
      loadTaskAttachments(taskId);
      loadTaskAudit(taskId);
    }
  });

  // Mensagem no chat de projeto → atualiza se estiver aberto
  socket.on("project-message", ({ projectId }) => {
    if (typeof _chatProjectId !== "undefined" && String(_chatProjectId) === String(projectId)) {
      if (typeof loadProjectChatMessages === "function") loadProjectChatMessages();
    }
  });

  // Comentário no doc → atualiza se chat aberto
  socket.on("doc-comment", ({ project_id, doc_type }) => {
    if (typeof _docChatProjectId !== "undefined"
        && String(_docChatProjectId) === String(project_id)
        && _docChatType === doc_type) {
      if (typeof loadDocChatMessages === "function") loadDocChatMessages();
    }
  });

  // Status do documento mudou → atualiza banner
  socket.on("doc-status", ({ projectId, type, status, approvedBy, reason }) => {
    const sel = document.getElementById(`${type}-project-select`);
    if (sel && String(sel.value) === String(projectId)) {
      if (typeof updateDocStatusUI === "function") {
        updateDocStatusUI(type, status, approvedBy, reason);
      }
    }
  });

  window._pilhaSocket = socket;
})();
