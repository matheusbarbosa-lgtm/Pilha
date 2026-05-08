// ── Profile modal ─────────────────────────────────────────
if (openProfileModalBtn && profileModal) {
  openProfileModalBtn.addEventListener("click", async () => {
    profileError.textContent = "";
    profileSuccess.textContent = "";
    state.profilePendingPhoto = null;

    try {
      const { user } = await apiFetch("/api/profile");

      document.querySelector("#profile-name").textContent = user.name || "";
      document.querySelector("#profile-username").textContent = "@" + (user.username || "");
      document.querySelector("#profile-email").textContent = user.email || "(nao configurado)";
      document.querySelector("#profile-turma").textContent = user.turma || "—";
      document.querySelector("#profile-periodo").textContent = user.periodo || "—";
      document.querySelector("#profile-curso").textContent = user.curso || "—";
      const bioEl = document.querySelector("#profile-bio");
      if (bioEl) bioEl.value = user.bio || "";

      const avatarImg = document.querySelector("#profile-avatar-img");
      const avatarInitials = document.querySelector("#profile-avatar-initials");
      if (user.photo) {
        avatarImg.src = user.photo;
        avatarImg.classList.remove("hidden");
        avatarInitials.classList.add("hidden");
      } else {
        avatarImg.classList.add("hidden");
        avatarInitials.textContent = (user.name || "?").charAt(0).toUpperCase();
        avatarInitials.classList.remove("hidden");
      }

      const isProf = state.currentUser?.role === "professor" || state.currentUser?.isAdmin;
      const alunoFields = [
        document.querySelector("#profile-curso")?.closest(".profile-info-item"),
        document.querySelector("#profile-turma")?.closest(".profile-info-item"),
        document.querySelector("#profile-periodo")?.closest(".profile-info-item"),
        document.querySelector("#profile-scrum-roles")?.closest(".profile-info-item"),
      ];
      alunoFields.forEach(el => { if (el) el.classList.toggle("hidden", isProf); });

      if (!isProf) {
        const scrumRolesEl = document.querySelector("#profile-scrum-roles");
        const roles = getCurrentUserScrumRoles();
        scrumRolesEl.innerHTML = roles.length
          ? roles.map((r) => `<span class="badge">${escapeHtml(r)}</span>`).join(" ")
          : "<span style='color:var(--muted);'>sem papel definido</span>";
      }

    } catch (err) {
      console.error("Erro ao carregar perfil:", err);
    }

    profileModal.showModal();
  });
}

if (profileCloseBtn) {
  profileCloseBtn.addEventListener("click", () => profileModal.close());
}

if (profilePhotoBtn && profilePhotoInput) {
  profilePhotoBtn.addEventListener("click", () => profilePhotoInput.click());
  profilePhotoInput.addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (!file) return;
    resizeAndPreviewPhoto(file, "#profile-avatar-img", "#profile-avatar-initials", (dataUrl) => {
      state.profilePendingPhoto = dataUrl;
      profileError.textContent = "";
    }, (errorMessage) => {
      state.profilePendingPhoto = null;
      event.target.value = "";
      profileError.textContent = errorMessage;
    });
  });
}

if (profileSaveBtn) {
  profileSaveBtn.addEventListener("click", async () => {
    profileError.textContent = "";
    profileSuccess.textContent = "";

    const avatarImg = document.querySelector("#profile-avatar-img");
    const photo = state.profilePendingPhoto
      || (!avatarImg.classList.contains("hidden") && avatarImg.src.startsWith("data:") ? avatarImg.src : null);

    try {
      const bio = document.querySelector("#profile-bio")?.value.trim() || "";
      const result = await apiFetch("/api/profile", {
        method: "PATCH",
        body: JSON.stringify({ bio, photo })
      });

      state.currentUser = { ...state.currentUser, ...result.user };
      state.profilePendingPhoto = null;
      profileSuccess.textContent = "Perfil atualizado com sucesso.";

      if (photo) updateTopbarPhoto(photo);
      updateTopbarDisplay();
    } catch (err) {
      profileError.textContent = err.message;
    }
  });
}
