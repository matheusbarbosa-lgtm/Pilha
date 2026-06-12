// ── Sininho de Notificações ───────────────────────────────
// Carregado após login; gerencia o dropdown e o badge.

(function initNotifications() {
  const bellBtn     = document.getElementById("notif-bell-btn");
  const bellWrap    = document.getElementById("notif-bell-wrap");
  const dropdown    = document.getElementById("notif-dropdown");
  const badge       = document.getElementById("notif-badge");
  const list        = document.getElementById("notif-list");
  const readAllBtn  = document.getElementById("notif-read-all-btn");

  if (!bellBtn || !dropdown || !list) return;

  let _notifs = []; // cache local

  function formatRelTime(iso) {
    try {
      const diff = Date.now() - new Date(iso.replace(" ", "T") + (iso.includes("T") ? "" : "Z")).getTime();
      if (diff < 60000) return "agora";
      if (diff < 3600000) return `${Math.floor(diff / 60000)}min atrás`;
      if (diff < 86400000) return `${Math.floor(diff / 3600000)}h atrás`;
      return `${Math.floor(diff / 86400000)}d atrás`;
    } catch (_) { return ""; }
  }

  function renderList() {
    if (!_notifs.length) {
      list.innerHTML = '<li class="notif-empty">Nenhuma notificação</li>';
      return;
    }
    list.innerHTML = _notifs.map(n => `
      <li class="notif-item${n.is_read ? "" : " unread"}" data-id="${n.id || ""}">
        <span class="notif-dot${n.is_read ? " read" : ""}"></span>
        <div class="notif-body">
          <div class="notif-msg">${escapeHtml ? escapeHtml(n.message) : n.message}</div>
          <div class="notif-time">${formatRelTime(n.created_at)}</div>
        </div>
      </li>
    `).join("");

    // Click: mark read + navigate
    list.querySelectorAll(".notif-item[data-id]").forEach((li, idx) => {
      li.addEventListener("click", async () => {
        const n = _notifs[idx];
        if (!n) return;
        if (!n.is_read && n.id) {
          try {
            await apiFetch(`/api/notifications/${n.id}/read`, { method: "PATCH" });
          } catch (_) {}
          n.is_read = 1;
          li.classList.remove("unread");
          li.querySelector(".notif-dot")?.classList.add("read");
          updateBadge();
        }
        if (n.link) window.location.href = n.link;
      });
    });
  }

  function updateBadge() {
    const unread = _notifs.filter(n => !n.is_read).length;
    if (unread > 0) {
      badge.textContent = unread > 99 ? "99+" : String(unread);
      badge.classList.remove("hidden");
    } else {
      badge.classList.add("hidden");
    }
  }

  async function loadNotifications() {
    try {
      _notifs = await apiFetch("/api/notifications");
      renderList();
      updateBadge();
    } catch (_) {}
  }

  // Toggle dropdown
  bellBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    dropdown.classList.toggle("hidden");
    if (!dropdown.classList.contains("hidden")) loadNotifications();
  });

  // Fechar ao clicar fora
  document.addEventListener("click", (e) => {
    if (!bellWrap.contains(e.target)) dropdown.classList.add("hidden");
  });

  // Marcar todas como lidas
  readAllBtn?.addEventListener("click", async () => {
    try {
      await apiFetch("/api/notifications/read-all", { method: "PATCH" });
      _notifs.forEach(n => { n.is_read = 1; });
      renderList();
      updateBadge();
    } catch (_) {}
  });

  // Recebe nova notificação do socket (sem recarregar)
  window.pilhaNotifAddNew = function(notif) {
    _notifs.unshift(notif);
    if (_notifs.length > 50) _notifs.pop();
    renderList();
    updateBadge();
  };

  // Carregar ao iniciar
  loadNotifications();
})();
