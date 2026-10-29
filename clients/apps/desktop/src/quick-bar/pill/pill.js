// The case pill: search the vault and type or copy a detail, drop a document in, or fill the
// document in front. It talks to the main process through window.vowkeyPill.
(() => {
  const pill = window.vowkeyPill;
  const stage = document.getElementById("stage");
  const slot = document.getElementById("slot");
  const sheet = document.getElementById("sheet");
  const fillButton = document.getElementById("fill");
  const MAX_ROWS = 8;

  const ICON_SEARCH =
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3"/></svg>';
  const ICON_TRAY =
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2.5v7M5 6.5l3 3 3-3"/><path d="M2.5 10v2.5a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V10"/></svg>';

  const state = {
    platform: "mac",
    profiles: [],
    profileId: null,
    details: [],
    operations: [],
    offer: null,
    account: false,
    choosingForFill: false,
    error: "",
    locked: false,
    query: "",
    selected: 0,
    front: null,
    resetTimer: 0,
  };

  const escape = (text) =>
    String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  const matching = () => {
    const query = state.query.trim().toLowerCase();
    const hits = query
      ? state.details.filter((d) => `${d.label} ${d.value}`.toLowerCase().includes(query))
      : state.details;
    return hits.slice(0, MAX_ROWS);
  };

  function showSearch() {
    clearTimeout(state.resetTimer);
    slot.innerHTML = `<label class="p-search">${ICON_SEARCH}<input id="q" placeholder="Search details" autocomplete="off" aria-label="Search details" value="${escape(state.query)}"><kbd>${state.platform === "mac" ? "⌘K" : "Ctrl K"}</kbd></label>`;
    const input = document.getElementById("q");
    input.addEventListener("input", () => {
      state.query = input.value;
      state.selected = 0;
      renderSheet();
    });
    input.focus();
    renderFill();
    renderSheet();
  }

  function showDrop() {
    slot.innerHTML = `<div class="p-drop">${ICON_TRAY}Drop a document to add it, or a form to fill</div>`;
    sheet.hidden = true;
  }

  function showReading(name) {
    slot.innerHTML = `<div class="p-read"><span class="thumb"></span><div><b>${escape(name)}</b><small>Reading on this ${state.platform === "mac" ? "Mac" : "PC"}</small><div class="prog"><i></i></div></div></div>`;
    sheet.hidden = true;
    fillButton.hidden = true;
  }

  function showStatus(status) {
    slot.innerHTML = `<div class="p-stat ${status.good ? "" : "bad"}" title="${escape(status.title)} ${escape(status.subtitle || "")}"><span class="ok">${status.good ? "✓" : "!"}</span><span><b>${escape(status.title)}</b> ${escape(status.subtitle || "")}</span></div>`;
    sheet.innerHTML = status.profileId
      ? `<div class="qnote"><button class="qact p" type="button" data-open-profile="${escape(status.profileId)}" data-open-source="${escape(status.sourceId || "")}">Open ${status.sourceId ? "document" : "profile"}</button></div>`
      : status.subtitle === "Continue in Vowkey"
        ? `<div class="qnote"><button class="qact p" type="button" data-hub>Continue in Vowkey</button></div>` : "";
    sheet.hidden = !sheet.innerHTML;
    clearTimeout(state.resetTimer);
    state.resetTimer = setTimeout(async () => {
      await load();
      showSearch();
    }, status.good ? 3500 : 6000);
  }

  function renderFill() {
    const front = state.front;
    if (!front || state.locked) {
      fillButton.hidden = true;
      return;
    }
    const app = document.getElementById("fill-app");
    const kind = front.name.split(".").pop().toLowerCase();
    app.className = "app" + (kind === "docx" ? " word" : kind === "pdf" ? " pdf" : kind === "hwpx" ? " hwp" : "");
    app.textContent = kind === "docx" ? "W" : kind === "pdf" ? "P" : kind === "hwpx" ? "H" : "X";
    document.getElementById("fill-name").textContent = front.name.replace(/\.[^.]+$/, "");
    fillButton.title = `Fill ${front.name}`;
    fillButton.hidden = false;
  }

  function renderSheet() {
    if (state.locked) {
      sheet.innerHTML = state.account
        ? `<div class="qempty">Unlock the vault in Vowkey.</div><div class="qnote"><button class="qact p" type="button" data-hub>Open Vowkey</button></div>`
        : `<form id="unlock-form" class="qnote"><label>Local password<input type="password" name="password" autocomplete="current-password"></label><p role="alert" id="unlock-error"></p><button class="qact p" type="submit">Unlock</button></form>`;
      sheet.hidden = false;
      const form = document.getElementById("unlock-form");
      form?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const result = await pill.unlock(form.elements.password.value || undefined);
        if (result.good === false || result.locked) {
          document.getElementById("unlock-error").textContent = result.subtitle || "Couldn't unlock. Check the password and try again.";
          return;
        }
        await load(); showSearch();
      });
      return;
    }
    const picker = state.profiles.length > 1
      ? `<label class="qnote">Whose details?<select id="profile-picker" aria-label="Profile"><option value="">Choose profile</option>${state.profiles.map((profile) =>
        `<option value="${escape(profile.id)}" ${state.profileId === profile.id ? "selected" : ""}>${escape(profile.name)}</option>`).join("")}</select></label>` : "";
    const pending = state.operations.map((operation) =>
      `<div class="qrow"><div><small>${operation.kind === "move" ? "Move waiting" : operation.kind === "delete" ? "Deletion waiting" : "Upload waiting"}</small><b>${escape(operation.fileName)}</b></div><button class="qact s" type="button" data-open-profile="${escape(operation.profileId)}">Review</button></div>`).join("");
    const hits = matching();
    state.selected = Math.min(state.selected, Math.max(0, hits.length - 1));
    const rows = hits.map((hit, index) =>
      `<div class="qrow ${index === state.selected ? "sel" : ""}" data-row="${index}"><div><small>${escape(hit.label)}</small><b>${escape(hit.value)}</b></div><span class="acts"><button class="qact p" type="button" data-type="${index}">Type</button><details><summary aria-label="More for ${escape(hit.label)}">•••</summary><div class="qmenu"><button class="qact s" type="button" data-copy="${index}">Copy</button><button class="qact s" type="button" data-open-profile="${escape(hit.profileId)}" data-open-source="${escape(hit.sourceId || "")}" data-open-variant="${escape(hit.variantId || "")}">${hit.sourceId ? "Show in document" : "Open profile"}</button></div></details></span></div>`
    ).join("");
    const empty = state.error || (state.profiles.length > 1 && !state.profileId
      ? "Choose whose details to use."
      : state.query.trim() ? `No detail matches “${escape(state.query.trim())}”.`
        : "Add a document or type the details to fill this form.");
    const offer = state.offer?.show
      ? `<div class="qnote"><b>Use these details on your other devices</b><p>Create an account to sync this vault.</p><button class="qact p" type="button" data-hub>Continue</button><button class="qact s" type="button" data-dismiss-offer>Not now</button></div>` : "";
    sheet.innerHTML = picker + pending + `<div class="sh">${state.query.trim() ? "Details" : "Your details"}</div>` +
      (rows || `<div class="qempty">${empty}</div>${state.profiles.length === 0 ? '<div class="qnote"><button class="qact p" type="button" data-hub>Enter details</button></div>' : ""}`) +
      offer + `<div class="foot2"><span>↑↓ to choose · <kbd>↵</kbd> to type</span><span>Drop a document to add it</span></div>`;
    sheet.hidden = false;
    document.getElementById("profile-picker")?.addEventListener("change", async (event) => {
      state.profileId = event.target.value || null;
      state.selected = 0;
      if (!state.profileId) { state.details = []; renderSheet(); return; }
      await load();
      if (state.choosingForFill) {
        state.choosingForFill = false; showReading(state.front?.name || "Form");
        showStatus(await pill.fill(state.profileId));
      } else { renderSheet(); }
    });
  }

  async function load() {
    const result = await pill.details(state.profileId || undefined);
    state.locked = Boolean(result.locked);
    state.account = Boolean(result.account);
    state.profiles = result.profiles || [];
    state.profileId = result.profileId || null;
    state.details = result.details || [];
    state.operations = result.operations || [];
    state.offer = result.postFillOffer || null;
    state.error = result.good === false ? result.subtitle || result.title : "";
  }

  async function typeHit(index) {
    const hit = matching()[index];
    if (!hit) return;
    const problem = await pill.type(hit.value);
    if (problem) showStatus({ good: false, title: `Couldn't type ${hit.label}`, subtitle: problem });
  }

  async function copyHit(index) {
    const hit = matching()[index];
    if (!hit) return;
    await pill.copy(hit.value);
    showStatus({ good: true, title: `${hit.label} copied`, subtitle: "" });
  }

  sheet.addEventListener("mousemove", (event) => {
    const row = event.target.closest("[data-row]");
    if (row && Number(row.dataset.row) !== state.selected) {
      state.selected = Number(row.dataset.row);
      for (const el of sheet.querySelectorAll(".qrow")) el.classList.toggle("sel", el === row);
    }
  });
  sheet.addEventListener("click", (event) => {
    const type = event.target.closest("[data-type]");
    const copy = event.target.closest("[data-copy]");
    const row = event.target.closest("[data-row]");
    const open = event.target.closest("[data-open-profile]");
    if (open) return void pill.openProfile(open.dataset.openProfile, open.dataset.openSource || undefined, open.dataset.openVariant || undefined);
    if (event.target.closest("[data-hub]")) return void pill.openHub();
    if (event.target.closest("[data-dismiss-offer]")) {
      return void pill.dismissProtection().then(() => { state.offer = null; renderSheet(); });
    }
    if (copy) return void copyHit(Number(copy.dataset.copy));
    if (event.target.closest("details")) return;
    if (type) return void typeHit(Number(type.dataset.type));
    if (row) return void typeHit(Number(row.dataset.row));
  });

  document.getElementById("mark").addEventListener("click", () => pill.openHub());
  document.getElementById("pill").addEventListener("click", (event) => {
    // The rest of the pill opens the Hub, as the mark does.
    if (event.target === event.currentTarget) pill.openHub();
  });
  fillButton.addEventListener("click", async () => {
    const name = state.front?.name ?? "";
    if (state.profiles.length > 1 && !state.profileId) {
      state.choosingForFill = true; renderSheet(); document.getElementById("profile-picker")?.focus(); return;
    }
    showReading(name);
    showStatus(await pill.fill(state.profileId || undefined));
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      pill.hide();
    } else if (event.key === "ArrowDown" && event.target.id === "q") {
      event.preventDefault();
      state.selected = Math.min(state.selected + 1, Math.max(0, matching().length - 1));
      renderSheet();
    } else if (event.key === "ArrowUp" && event.target.id === "q") {
      event.preventDefault();
      state.selected = Math.max(0, state.selected - 1);
      renderSheet();
    } else if (event.key === "Enter" && !state.locked && event.target.id === "q") {
      event.preventDefault();
      void typeHit(state.selected);
    }
  });

  // A document dragged over the pill turns its middle into the drop box.
  let dragDepth = 0;
  window.addEventListener("dragenter", (event) => {
    event.preventDefault();
    if (dragDepth++ === 0) showDrop();
  });
  window.addEventListener("dragover", (event) => event.preventDefault());
  window.addEventListener("dragleave", () => {
    if (--dragDepth === 0) showSearch();
  });
  window.addEventListener("drop", async (event) => {
    event.preventDefault();
    dragDepth = 0;
    const file = event.dataTransfer?.files?.[0];
    if (!file) return showSearch();
    showReading(file.name);
    showStatus(await pill.add(file, state.profileId || undefined));
  });

  // The window is as tall as the pill and its sheet, with room for their shadow.
  const SHADOW = 28;
  const fit = () => {
    const boxes = [document.getElementById("pill"), sheet]
      .filter((el) => !el.hidden)
      .map((el) => el.getBoundingClientRect());
    const height =
      state.platform === "mac"
        ? Math.max(...boxes.map((b) => b.bottom)) + SHADOW
        : window.innerHeight - Math.min(...boxes.map((b) => b.top)) + SHADOW;
    pill.resize(Math.ceil(height));
  };
  new ResizeObserver(fit).observe(stage);
  new MutationObserver(fit).observe(stage, { subtree: true, childList: true, attributes: true });

  pill.onShow(async (message) => {
    state.platform = message.platform;
    state.front = message.front;
    state.query = "";
    state.selected = 0;
    stage.className = message.platform;
    // Restart the entrance animation.
    for (const el of [document.getElementById("pill"), sheet]) {
      el.style.animation = "none";
      void el.offsetWidth;
      el.style.animation = "";
    }
    await load();
    showSearch();
  });
})();
