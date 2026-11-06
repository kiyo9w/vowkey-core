// Vowkey Quick Bar: search logins, profile details, cards, keys, and notes; fill the active
// browser/app or open file (`⌘\`); drop documents in; and approve external AI agent requests.
(() => {
  const pill = window.vowkeyPill;
  const stage = document.getElementById("stage");
  const panel = document.getElementById("panel");
  const slot = document.getElementById("slot");
  const agentCapsule = document.getElementById("agent-capsule");
  const sheet = document.getElementById("sheet");
  const footer = document.getElementById("pill-footer");
  const fillButton = document.getElementById("fill");
  const scanButton = document.getElementById("scan-screen");
  const aiButton = document.getElementById("ai-mode");

  const ICON_SEARCH =
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3"/></svg>';
  const ICON_TRAY =
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2.5v7M5 6.5l3 3 3-3"/><path d="M2.5 10v2.5a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V10"/></svg>';

  const state = {
    platform: "mac",
    profiles: [],
    profileId: "",
    items: [],
    details: [],
    operations: [],
    agentPrompt: null,
    offer: null,
    account: false,
    choosingForFill: false,
    choosingForCapture: false,
    aiMode: false,
    aiRunning: null,
    error: "",
    locked: false,
    query: "",
    selected: 0,
    front: null,
    resetTimer: 0,
    strings: null,
  };

  const s = (key, fallback) => (state.strings && state.strings[key]) || fallback;

  const escape = (text) =>
    String(text ?? "").replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );

  const formatTotp = (code) => {
    const clean = String(code || "").replace(/\s+/g, "");
    return clean.length === 6 ? `${clean.slice(0, 3)} ${clean.slice(3)}` : clean;
  };

  const allItems = () => {
    if (state.items.length > 0) {
      return state.profileId
        ? state.items.filter((item) => item.kind !== "detail" || item.profileId === state.profileId)
        : state.items;
    }
    return state.details.map((d) => ({
      ...d,
      kind: "detail",
      subtitle: d.profile || "",
      displayValue: d.value,
    }));
  };

  const matching = () => {
    const query = state.query.trim().toLowerCase();
    const list = allItems();
    if (!query) {
      return list;
    }
    return list.filter((item) => {
      const searchable = [
        item.label,
        item.subtitle,
        item.profile,
        item.username,
        ...(item.uris || []),
        item.kind === "detail" ? item.value : "",
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return searchable.includes(query);
    });
  };

  const bar = document.getElementById("pill");
  const ICON_SCAN = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.8 6.4h10.4a1.4 1.4 0 0 1 1.4 1.4v8.4a1.4 1.4 0 0 1-1.4 1.4H6.8a1.4 1.4 0 0 1-1.4-1.4V7.8a1.4 1.4 0 0 1 1.4-1.4z" fill="currentColor" fill-opacity="0.14" stroke="none"/><path d="M3.6 8V6a2.4 2.4 0 0 1 2.4-2.4h2M16 3.6h2A2.4 2.4 0 0 1 20.4 6v2M20.4 16v2a2.4 2.4 0 0 1-2.4 2.4h-2M8 20.4H6A2.4 2.4 0 0 1 3.6 18v-2M5.6 12h12.8M8.8 9.1h4.6M8.8 14.9h6.4"/></svg>`;
  const ICON_FORM = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5.8 8.2h6.6a5 5 0 0 0 5 5h2.2v3.2a2.6 2.6 0 0 1-2.6 2.6H5.8a2.6 2.6 0 0 1-2.6-2.6v-5.6a2.6 2.6 0 0 1 2.6-2.6zM17.6 3c.34 2.1 1.7 3.46 3.8 3.8-2.1.34-3.46 1.7-3.8 3.8-.34-2.1-1.7-3.46-3.8-3.8 2.1-.34 3.46-1.7 3.8-3.8z" fill="currentColor" fill-opacity="0.14" stroke="none"/><path d="M12 8.2H5.8a2.6 2.6 0 0 0-2.6 2.6v5.6A2.6 2.6 0 0 0 5.8 19H17a2.6 2.6 0 0 0 2.6-2.6v-2.8M7 13.6h4.6M14.4 11.6v4M17.6 3c.34 2.1 1.7 3.46 3.8 3.8-2.1.34-3.46 1.7-3.8 3.8-.34-2.1-1.7-3.46-3.8-3.8 2.1-.34 3.46-1.7 3.8-3.8z"/></svg>`;
  const ICON_CHECK = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5.4 12.6 9.8 17l8.8-9.6"/></svg>`;
  const ICON_ALERT = `<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.6a8.4 8.4 0 1 1 0 16.8 8.4 8.4 0 0 1 0-16.8z" fill="currentColor" fill-opacity="0.15" stroke="none"/><path d="M12 3.6a8.4 8.4 0 1 1 0 16.8 8.4 8.4 0 0 1 0-16.8zM12 8v4.6M12 15.8h.01"/></svg>`;
  const ICON_ORBIT = `<svg class="p-orbit" viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="7" stroke="currentColor" stroke-opacity="0.2" stroke-width="2"/><path d="M10 3a7 7 0 0 1 7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;

  function showSearch() {
    bar.classList.remove("busy");
    clearTimeout(state.resetTimer);
    const placeholder = escape(s("searchPlaceholder", "Search logins, details, keys"));
    slot.innerHTML = `<label class="p-search">${ICON_SEARCH}<input id="q" placeholder="${placeholder}" autocomplete="off" aria-label="${placeholder}" value="${escape(state.query)}"></label>`;
    const input = document.getElementById("q");
    input.addEventListener("input", () => {
      state.query = input.value;
      state.selected = 0;
      renderSheet();
    });
    input.focus();
    renderFill();
    renderAgentCapsule();
    renderSheet();
  }

  function showDrop() {
    bar.classList.remove("busy");
    slot.innerHTML = `<div class="p-drop">${ICON_TRAY}${escape(s("dropHint", "Drop a document to add, or a form to fill"))}</div>`;
    sheet.hidden = true;
    if (footer) footer.hidden = true;
  }

  function showReading(name, actionText) {
    const label = name || "Form";
    const sub = actionText || s("onThisDevice", "On this device");
    const icon = /fill/i.test(sub) ? ICON_FORM : ICON_SCAN;
    bar.classList.add("busy");
    slot.innerHTML = `<div class="p-read"><span class="thumb">${icon}</span><div class="p-read-text"><b>${escape(label)}</b><small>${escape(sub)}</small></div>${ICON_ORBIT}</div>`;
    sheet.hidden = true;
    if (footer) footer.hidden = true;
    fillButton.hidden = true;
  }

  function showStatus(status) {
    bar.classList.add("busy");
    slot.innerHTML = `<div class="p-stat ${status.good ? "" : "bad"}" title="${escape(status.title)} ${escape(status.subtitle || "")}"><span class="ok">${status.good ? ICON_CHECK : ICON_ALERT}</span><span class="p-stat-text"><b>${escape(status.title)}</b>${status.subtitle ? `<small>${escape(status.subtitle)}</small>` : ""}</span></div>`;
    sheet.innerHTML = status.profileId
      ? `<div class="qnote"><button class="qact p" type="button" data-open-profile="${escape(status.profileId)}" data-open-source="${escape(status.sourceId || "")}">Open ${status.sourceId ? "document" : "profile"}</button></div>`
      : status.subtitle === "Continue in Vowkey"
        ? `<div class="qnote"><button class="qact p" type="button" data-hub>Continue in Vowkey</button></div>`
        : "";
    sheet.hidden = !sheet.innerHTML;
    if (footer) footer.hidden = true;
    clearTimeout(state.resetTimer);
    state.resetTimer = setTimeout(
      async () => {
        await load();
        showSearch();
      },
      status.good ? 3200 : 5500,
    );
  }

  function renderFill() {
    renderFillButton();
    renderAi();
  }

  /** The AI mode switch sits beside Fill whenever Fill can act on an app or site window. */
  function renderAi() {
    if (!aiButton) return;
    const canUse =
      state.platform === "mac" && !state.locked && !state.front?.file && !fillButton.hidden;
    aiButton.hidden = !canUse;
    aiButton.setAttribute("aria-checked", state.aiMode ? "true" : "false");
    aiButton.title = state.aiMode
      ? s("aiModeOn", "AI mode on: Fill asks your AI agent to fill this window")
      : s("aiModeOff", "AI mode off: Fill types your saved login instantly");
    fillButton.classList.toggle("ai", canUse && state.aiMode);
    if (canUse && state.aiMode) {
      fillButton.title = s("aiFillTitle", "Fill this window with your AI agent");
    }
  }

  function aiStepText(message) {
    const agent = message?.agent || s("aiAgent", "AI agent");
    switch (message?.step) {
      case "thinking":
        return `${agent} ${s("aiThinking", "is reading the form…")}`;
      case "reading":
        return s("aiReading", "Reading the window…");
      case "filling":
        return message.detail
          ? `${s("aiFillingN", "Filling fields:")} ${message.detail}`
          : s("aiFilling", "Filling…");
      case "looking":
        return s("aiLooking", "Checking the result…");
      default:
        return `${s("aiStarting", "Starting")} ${agent}…`;
    }
  }

  function showRunning(message) {
    clearTimeout(state.resetTimer);
    state.aiRunning = message || { step: "starting" };
    slot.innerHTML = `<div class="p-run"><i class="spin"></i><span id="ai-step">${escape(aiStepText(state.aiRunning))}</span><button type="button" id="ai-stop">${escape(s("aiStop", "Stop"))}</button></div>`;
    document.getElementById("ai-stop")?.addEventListener("click", () => pill.aiStop());
    sheet.hidden = true;
    if (footer) footer.hidden = true;
    fillButton.hidden = true;
    if (aiButton) aiButton.hidden = true;
  }

  function renderFillButton() {
    if (scanButton) {
      scanButton.hidden = Boolean(state.locked) || state.platform !== "mac";
    }
    if (state.locked) {
      fillButton.hidden = true;
      return;
    }
    const fillVerb = document.getElementById("fill-verb");
    if (fillVerb) {
      fillVerb.textContent = s("fill", "Fill");
    }
    const front = state.front;
    const matchedLogin = allItems().find((item) => item.kind === "login" && item.matched);
    const appBadge = document.getElementById("fill-app");
    const nameEl = document.getElementById("fill-name");

    if (front?.file) {
      const ext = (front.file.name.split(".").pop() || "").toLowerCase();
      const cls =
        ext === "docx"
          ? " word"
          : ext === "pdf"
            ? " pdf"
            : ext === "hwpx"
              ? " hwp"
              : ext === "xlsx"
                ? " xls"
                : /^(png|jpe?g|heic|webp|tiff?)$/.test(ext)
                  ? " img"
                  : "";
      appBadge.className = "app" + cls;
      appBadge.textContent =
        ext === "docx"
          ? "W"
          : ext === "pdf"
            ? "P"
            : ext === "hwpx"
              ? "H"
              : ext === "xlsx"
                ? "X"
                : cls === " img"
                  ? "I"
                  : "F";
      nameEl.textContent = front.file.name.replace(/\.[^.]+$/, "");
      fillButton.title = `Fill ${front.file.name}`;
      fillButton.hidden = false;
      return;
    }

    if (matchedLogin || front?.host || front?.appName) {
      const target = front?.host || front?.appName || matchedLogin?.label || "";
      appBadge.className = "app";
      appBadge.textContent = (target[0] || "F").toUpperCase();
      nameEl.textContent = target;
      fillButton.title = matchedLogin
        ? `Fill ${matchedLogin.label} into ${target || "active window"}`
        : `Fill ${target}`;
      fillButton.hidden = false;
      return;
    }

    fillButton.hidden = true;
  }

  function renderAgentCapsule() {
    const prompt = state.agentPrompt;
    if (!prompt || state.locked) {
      agentCapsule.hidden = true;
      agentCapsule.innerHTML = "";
      return;
    }

    if (prompt.kind === "pair") {
      agentCapsule.innerHTML = `
        <div class="p-agent-head">
          <strong>${escape(prompt.agentName)} wants to connect</strong>
          <span class="p-agent-tag">Agent</span>
        </div>
        <p class="p-agent-note">Approve to let this agent ask before using saved details.</p>
        <div class="p-agent-acts">
          <button class="qact p" type="button" data-agent-pair="${escape(prompt.connectionId)}">Connect</button>
        </div>
      `;
      agentCapsule.hidden = false;
      return;
    }

    const where = prompt.targetDisplay || "this destination";
    const alwaysLabel = /^https?:\/\/|\./i.test(where)
      ? s("alwaysAllowSite", "Always allow on this site")
      : s("alwaysAllowHere", "Always allow here");
    const note = prompt.reason || prompt.goal || "";
    const chips = (prompt.entries || [])
      .map((entry) => `<span class="p-agent-chip">${escape(entry.label)}</span>`)
      .join("");

    agentCapsule.innerHTML = `
      <div class="p-agent-head">
        <strong>${escape(prompt.agentName)} · ${escape(where)}</strong>
        <span class="p-agent-tag">${escape(s("needsApproval", "Needs approval"))}</span>
      </div>
      ${note ? `<p class="p-agent-note">${escape(note)}</p>` : ""}
      ${chips ? `<div class="p-agent-fields">${chips}</div>` : ""}
      <div class="p-agent-acts">
        <button class="qact p" type="button" data-agent-answer="allow_once">${escape(s("allowOnce", "Allow once"))}</button>
        <button class="qact s" type="button" data-agent-answer="always_allow">${escape(alwaysLabel)}</button>
        <button class="qact s" type="button" data-agent-answer="deny">${escape(s("dontAllow", "Don't allow"))}</button>
      </div>
    `;
    agentCapsule.hidden = false;
  }

  function renderRow(hit, index) {
    const sel = index === state.selected ? "sel" : "";
    const subParts = [hit.subtitle || hit.profile].filter(Boolean).join(" · ");
    const matchedBadge = hit.matched
      ? `<span class="qbadge">${escape(s("suggested", "Suggested"))}</span>`
      : "";
    const shownValue = hit.displayValue ?? hit.value ?? "";
    const monoClass =
      hit.kind === "key" || hit.kind === "card" || /^(?:id\.|bank\.)/.test(hit.attribute || "")
        ? "mono"
        : "";

    let actions = "";
    if (hit.kind === "login") {
      const codeBtn = hit.totp
        ? `<button class="qact code" type="button" data-copy-code="${index}" title="Copy verification code">${escape(formatTotp(hit.totp))}</button>`
        : "";
      actions = `
        ${codeBtn}
        <button class="qact p" type="button" data-fill-login="${index}">${escape(s("fill", "Fill"))}</button>
        <details>
          <summary aria-label="More for ${escape(hit.label)}">•••</summary>
          <div class="qmenu">
            ${hit.username ? `<button class="qact s" type="button" data-type-user="${index}">Type username</button>` : ""}
            ${hit.password ? `<button class="qact s" type="button" data-type-pass="${index}">Type password</button>` : ""}
            ${hit.username ? `<button class="qact s" type="button" data-copy-user="${index}">Copy username</button>` : ""}
            ${hit.password ? `<button class="qact s" type="button" data-copy-pass="${index}">Copy password</button>` : ""}
            ${hit.cipherId ? `<button class="qact s" type="button" data-open-item="${escape(hit.cipherId)}">${escape(s("openVowkey", "Open Vowkey"))}</button>` : ""}
          </div>
        </details>
      `;
    } else if (hit.kind === "card") {
      actions = `
        <button class="qact p" type="button" data-type="${index}">${escape(s("typeVerb", "Type"))}</button>
        <details>
          <summary aria-label="More for ${escape(hit.label)}">•••</summary>
          <div class="qmenu">
            <button class="qact s" type="button" data-copy="${index}">Copy number</button>
            ${hit.cardExp ? `<button class="qact s" type="button" data-copy-exp="${index}">Copy expiry</button>` : ""}
            ${hit.cardCode ? `<button class="qact s" type="button" data-copy-cvv="${index}">Copy security code</button>` : ""}
            ${hit.cipherId ? `<button class="qact s" type="button" data-open-item="${escape(hit.cipherId)}">${escape(s("openVowkey", "Open Vowkey"))}</button>` : ""}
          </div>
        </details>
      `;
    } else if (hit.kind === "detail") {
      actions = `
        <button class="qact p" type="button" data-type="${index}">${escape(s("typeVerb", "Type"))}</button>
        <details>
          <summary aria-label="More for ${escape(hit.label)}">•••</summary>
          <div class="qmenu">
            <button class="qact s" type="button" data-copy="${index}">${escape(s("copy", "Copy"))}</button>
            <button class="qact s" type="button" data-open-profile="${escape(hit.profileId || "")}" data-open-source="${escape(hit.sourceId || "")}" data-open-variant="${escape(hit.variantId || "")}">${escape(hit.sourceId ? s("showInDocument", "Show in document") : s("openProfile", "Open profile"))}</button>
          </div>
        </details>
      `;
    } else {
      actions = `
        <button class="qact p" type="button" data-type="${index}">${escape(s("typeVerb", "Type"))}</button>
        <button class="qact s" type="button" data-copy="${index}">${escape(s("copy", "Copy"))}</button>
      `;
    }

    return `<div class="qrow ${sel}" data-row="${index}"><div><div class="qrow-meta"><small>${escape(hit.label)}${subParts ? ` · ${escape(subParts)}` : ""}</small>${matchedBadge}</div><b class="${monoClass}">${escape(shownValue)}</b></div><span class="acts">${actions}</span></div>`;
  }

  function renderFooter(hits = matching()) {
    if (!footer) return;
    if (state.locked) {
      footer.hidden = true;
      footer.innerHTML = "";
      return;
    }
    const mac = state.platform === "mac";
    const copyKey = mac ? "⌘C" : "Ctrl+C";
    const fillKey = mac ? "⌘\\" : "Ctrl+\\";
    const activeHit = hits[state.selected] || null;
    const hints = [];
    if (activeHit) {
      const enterVerb = activeHit.kind === "login" ? s("fill", "Fill") : s("typeVerb", "Type");
      hints.push(`<span class="p-hint"><kbd>↵</kbd> ${escape(enterVerb)}</span>`);
      hints.push(`<span class="p-hint"><kbd>${copyKey}</kbd> ${escape(s("copy", "Copy"))}</span>`);
    } else if (state.front?.file) {
      hints.push(
        `<span class="p-hint"><kbd>${fillKey}</kbd> ${escape(s("fillForm", "Fill form"))}</span>`,
      );
    } else {
      hints.push(
        `<span class="p-hint"><kbd>${fillKey}</kbd> ${escape(s("fillWindow", "Fill window"))}</span>`,
      );
    }
    footer.innerHTML = `<div class="p-foot-hints">${hints.join("")}</div><span class="p-hint-muted">${escape(s("dropFooter", "Drop document or form"))}</span>`;
    footer.hidden = false;
  }

  function renderSheet() {
    if (state.locked) {
      if (footer) {
        footer.hidden = true;
        footer.innerHTML = "";
      }
      sheet.innerHTML = state.account
        ? `<div class="qempty">${escape(s("unlockInVowkey", "Unlock the vault in Vowkey."))}</div><div class="qnote"><button class="qact p" type="button" data-hub>${escape(s("openVowkey", "Open Vowkey"))}</button></div>`
        : `<form id="unlock-form" class="qnote"><label>${escape(s("localPassword", "Password on this device"))}<input type="password" name="password" autocomplete="current-password"></label><p role="alert" id="unlock-error"></p><button class="qact p" type="submit">${escape(s("unlock", "Unlock"))}</button></form>`;
      sheet.hidden = false;
      const form = document.getElementById("unlock-form");
      form?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const result = await pill.unlock(form.elements.password.value || undefined);
        if (result.good === false || result.locked) {
          document.getElementById("unlock-error").textContent =
            result.subtitle || "Couldn't unlock. Check the password and try again.";
          return;
        }
        await load();
        showSearch();
      });
      return;
    }

    const picker =
      state.profiles.length > 1
        ? `<div class="p-toolbar"><label>${escape(s("whoseDetails", "Whose details"))}<select id="profile-picker" aria-label="${escape(s("whoseDetails", "Whose details"))}"><option value="" ${!state.profileId ? "selected" : ""}>${escape(s("allProfiles", "All profiles"))}</option>${state.profiles
            .map(
              (profile) =>
                `<option value="${escape(profile.id)}" ${state.profileId === profile.id ? "selected" : ""}>${escape(profile.name)}</option>`,
            )
            .join("")}</select></label></div>`
        : "";

    const pending = state.operations
      .map(
        (operation) =>
          `<div class="qrow"><div><small>${operation.kind === "move" ? "Move waiting" : operation.kind === "delete" ? "Deletion waiting" : "Upload waiting"}</small><b>${escape(operation.fileName)}</b></div><button class="qact s" type="button" data-open-profile="${escape(operation.profileId)}">Review</button></div>`,
      )
      .join("");

    const hits = matching();
    state.selected = Math.min(state.selected, Math.max(0, hits.length - 1));
    const rows = hits.map((hit, index) => renderRow(hit, index)).join("");

    const empty =
      state.error ||
      (state.query.trim()
        ? `Nothing matches “${escape(state.query.trim())}”.`
        : escape(s("emptyHint", "Drop a document to add details, or save a login in Vowkey.")));

    const offer = state.offer?.show
      ? `<div class="qnote"><b>Use this vault on your other devices</b><p>Sign in when you want encrypted sync.</p><button class="qact p" type="button" data-hub>Sign in</button><button class="qact s" type="button" data-dismiss-offer>Not now</button></div>`
      : "";

    const heading = state.query.trim()
      ? `${hits.length}`
      : state.front?.host || state.front?.appName
        ? `${escape(state.front.host || state.front.appName)}`
        : escape(s("vault", "Vault"));

    sheet.innerHTML =
      picker +
      pending +
      `<div class="sh">${heading}</div>` +
      (rows
        ? `<div id="rows">${rows}</div>`
        : `<div class="qempty">${empty}</div>${allItems().length === 0 ? `<div class="qnote"><button class="qact p" type="button" data-hub>${escape(s("openVowkey", "Open Vowkey"))}</button></div>` : ""}`) +
      offer;

    sheet.hidden = false;
    renderFooter(hits);
    document.getElementById("profile-picker")?.addEventListener("change", async (event) => {
      state.profileId = event.target.value || "";
      state.selected = 0;
      await load();
      if (state.choosingForCapture && state.profileId) {
        state.choosingForCapture = false;
        await captureAndFill();
      } else if (state.choosingForFill && state.profileId) {
        state.choosingForFill = false;
        showReading(state.front?.file?.name || "Form", "Filling form");
        showStatus(await pill.fill(state.profileId));
      } else {
        renderSheet();
      }
    });
  }

  async function load() {
    const result = await pill.details(state.profileId || undefined);
    state.locked = Boolean(result.locked);
    state.account = Boolean(result.account);
    if (result.strings) {
      state.strings = result.strings;
    }
    state.profiles = result.profiles || [];
    state.items = result.items || [];
    state.details = result.details || [];
    state.operations = result.operations || [];
    state.agentPrompt = result.agentPrompt || null;
    state.offer = result.postFillOffer || null;
    state.error = result.good === false ? result.subtitle || result.title : "";
  }

  async function activateHit(index) {
    const hit = matching()[index];
    if (!hit) return;
    if (hit.kind === "login") {
      const problem = await pill.typeLogin(hit.username || "", hit.password || "", hit.totp || "");
      if (problem) {
        showStatus({ good: false, title: `Couldn't fill ${hit.label}`, subtitle: problem });
      }
      return;
    }
    const problem = await pill.type(hit.value);
    if (problem) {
      showStatus({ good: false, title: `Couldn't type ${hit.label}`, subtitle: problem });
    }
  }

  async function typeValue(value, label) {
    if (!value) return;
    const problem = await pill.type(value);
    if (problem) {
      showStatus({ good: false, title: `Couldn't type ${label}`, subtitle: problem });
    }
  }

  async function copyValue(value, label) {
    if (!value) return;
    await pill.copy(value);
    showStatus({ good: true, title: `${label} copied`, subtitle: "" });
  }

  agentCapsule.addEventListener("click", async (event) => {
    const pairBtn = event.target.closest("[data-agent-pair]");
    if (pairBtn) {
      await pill.agentDecision({
        decision: "allow_once",
        connectionId: pairBtn.dataset.agentPair,
      });
      await load();
      renderAgentCapsule();
      return;
    }
    const answerBtn = event.target.closest("[data-agent-answer]");
    if (answerBtn && state.agentPrompt?.requestId) {
      const entryIds = (state.agentPrompt.entries || []).map((e) => e.entryId);
      await pill.agentDecision({
        decision: answerBtn.dataset.agentAnswer,
        requestId: state.agentPrompt.requestId,
        entryIds,
      });
      await load();
      renderAgentCapsule();
    }
  });

  sheet.addEventListener("mousemove", (event) => {
    const row = event.target.closest("[data-row]");
    if (row && Number(row.dataset.row) !== state.selected) {
      state.selected = Number(row.dataset.row);
      for (const el of sheet.querySelectorAll(".qrow")) {
        el.classList.toggle("sel", el === row);
      }
      renderFooter();
    }
  });

  sheet.addEventListener("click", (event) => {
    const open = event.target.closest("[data-open-profile]");
    if (open) {
      return void pill.openProfile(
        open.dataset.openProfile,
        open.dataset.openSource || undefined,
        open.dataset.openVariant || undefined,
      );
    }
    const openItem = event.target.closest("[data-open-item]");
    if (openItem) {
      return void pill.openItem(openItem.dataset.openItem);
    }
    if (event.target.closest("[data-hub]")) {
      return void pill.openHub();
    }
    if (event.target.closest("[data-dismiss-offer]")) {
      return void pill.dismissProtection().then(() => {
        state.offer = null;
        renderSheet();
      });
    }

    const fillLogin = event.target.closest("[data-fill-login]");
    if (fillLogin) return void activateHit(Number(fillLogin.dataset.fillLogin));

    const copyCode = event.target.closest("[data-copy-code]");
    if (copyCode) {
      const hit = matching()[Number(copyCode.dataset.copyCode)];
      return void copyValue(hit?.totp, "Verification code");
    }
    const typeUser = event.target.closest("[data-type-user]");
    if (typeUser) {
      const hit = matching()[Number(typeUser.dataset.typeUser)];
      return void typeValue(hit?.username, "Username");
    }
    const typePass = event.target.closest("[data-type-pass]");
    if (typePass) {
      const hit = matching()[Number(typePass.dataset.typePass)];
      return void typeValue(hit?.password, "Password");
    }
    const copyUser = event.target.closest("[data-copy-user]");
    if (copyUser) {
      const hit = matching()[Number(copyUser.dataset.copyUser)];
      return void copyValue(hit?.username, "Username");
    }
    const copyPass = event.target.closest("[data-copy-pass]");
    if (copyPass) {
      const hit = matching()[Number(copyPass.dataset.copyPass)];
      return void copyValue(hit?.password, "Password");
    }
    const copyExp = event.target.closest("[data-copy-exp]");
    if (copyExp) {
      const hit = matching()[Number(copyExp.dataset.copyExp)];
      return void copyValue(hit?.cardExp, "Expiry date");
    }
    const copyCvv = event.target.closest("[data-copy-cvv]");
    if (copyCvv) {
      const hit = matching()[Number(copyCvv.dataset.copyCvv)];
      return void copyValue(hit?.cardCode, "Security code");
    }

    const copy = event.target.closest("[data-copy]");
    if (copy) {
      const hit = matching()[Number(copy.dataset.copy)];
      return void copyValue(hit?.value, hit?.label || "Value");
    }
    if (event.target.closest("details")) return;

    const type = event.target.closest("[data-type]");
    if (type) return void activateHit(Number(type.dataset.type));

    const row = event.target.closest("[data-row]");
    if (row) return void activateHit(Number(row.dataset.row));
  });

  document.getElementById("mark").addEventListener("click", () => pill.openHub());
  document.getElementById("close-pill")?.addEventListener("click", () => pill.hide());

  /** Capture a form on screen; Vowkey fills it from the chosen profile and opens the filled copy. */
  async function captureAndFill() {
    const result = await pill.scanScreen(state.profileId || undefined);
    if (!result || result.cancelled) {
      return;
    }
    showStatus(result);
  }

  scanButton?.addEventListener("click", async () => {
    if (state.locked || !pill.scanScreen) return;
    if (state.profiles.length > 1 && !state.profileId) {
      state.choosingForCapture = true;
      renderSheet();
      document.getElementById("profile-picker")?.focus();
      return;
    }
    await captureAndFill();
  });

  aiButton?.addEventListener("click", async () => {
    state.aiMode = !state.aiMode;
    renderAi();
    const prefs = await pill.setAiMode(state.aiMode);
    state.aiMode = Boolean(prefs?.aiMode);
    renderAi();
  });

  fillButton.addEventListener("click", async () => {
    const fileTarget = state.front?.file;
    if (state.aiMode && !fileTarget && state.platform === "mac") {
      showRunning({ step: "starting" });
      const status = await pill.fill(state.profileId || undefined);
      state.aiRunning = null;
      showStatus(status);
      return;
    }
    if (fileTarget && state.profiles.length > 1 && !state.profileId) {
      state.choosingForFill = true;
      renderSheet();
      document.getElementById("profile-picker")?.focus();
      return;
    }
    if (fileTarget) {
      showReading(fileTarget.name, "Filling form");
    }
    const status = await pill.fill(state.profileId || undefined);
    if (!status.good || fileTarget) {
      showStatus(status);
    }
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      pill.hide();
    } else if (
      !state.locked &&
      (event.metaKey || event.ctrlKey) &&
      !event.altKey &&
      !event.shiftKey &&
      event.key.toLowerCase() === "c"
    ) {
      const qInput = document.getElementById("q");
      const inputHasSelection =
        qInput &&
        document.activeElement === qInput &&
        qInput.selectionStart !== qInput.selectionEnd;
      const domSelection = window.getSelection?.()?.toString() || "";
      if (!inputHasSelection && !domSelection) {
        const hit = matching()[state.selected];
        if (hit) {
          event.preventDefault();
          if (hit.kind === "login") {
            void copyValue(hit.password || hit.username, hit.password ? "Password" : "Username");
          } else if (hit.kind === "card") {
            void copyValue(hit.value, "Card number");
          } else {
            void copyValue(hit.value, hit.label || "Value");
          }
        }
      }
    } else if (event.key === "ArrowDown" && event.target.id === "q") {
      event.preventDefault();
      state.selected = Math.min(state.selected + 1, Math.max(0, matching().length - 1));
      renderSheet();
      sheet.querySelector(".qrow.sel")?.scrollIntoView({ block: "nearest" });
    } else if (event.key === "ArrowUp" && event.target.id === "q") {
      event.preventDefault();
      state.selected = Math.max(0, state.selected - 1);
      renderSheet();
      sheet.querySelector(".qrow.sel")?.scrollIntoView({ block: "nearest" });
    } else if (event.key === "Enter" && !state.locked && event.target.id === "q") {
      event.preventDefault();
      void activateHit(state.selected);
    }
  });

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
    showReading(file.name, "Reading document");
    showStatus(await pill.add(file, state.profileId || undefined));
  });

  window.addEventListener("paste", async (event) => {
    if (state.locked) return;
    let pastedFile = null;
    const items = event.clipboardData?.items || [];
    for (const item of items) {
      if (item.kind === "file") {
        const candidate = item.getAsFile();
        if (
          candidate &&
          (candidate.type.startsWith("image/") ||
            /\.(?:pdf|docx|xlsx|hwpx|png|jpe?g|heic|webp|tiff?)$/i.test(candidate.name))
        ) {
          pastedFile = candidate;
          break;
        }
      }
    }
    if (pastedFile && pill.pasteImage) {
      event.preventDefault();
      const rawName = (pastedFile.name || "").trim();
      const name = rawName && !/^image\.[a-z0-9]+$/i.test(rawName) ? rawName : "Screenshot.png";
      showReading(name, "Reading document");
      const bytes = new Uint8Array(await pastedFile.arrayBuffer());
      showStatus(await pill.pasteImage(name, bytes, state.profileId || undefined));
      return;
    }

    const plainText = event.clipboardData?.getData("text/plain") || "";
    if (!plainText && pill.pasteClipboardImage) {
      event.preventDefault();
      showReading("Screenshot", "Reading document");
      const status = await pill.pasteClipboardImage(state.profileId || undefined);
      if (status) {
        showStatus(status);
      } else {
        showSearch();
      }
    }
  });

  const fit = () => {
    const height = Math.ceil(panel.getBoundingClientRect().height);
    if (height > 0) {
      pill.resize(height);
    }
  };
  new ResizeObserver(fit).observe(panel);
  new MutationObserver(fit).observe(panel, { subtree: true, childList: true, attributes: true });

  pill.onRefresh(async () => {
    await load();
    renderAgentCapsule();
    renderFill();
    if (!state.locked) {
      renderSheet();
    }
  });

  pill.onFront?.(async (front) => {
    state.front = front || null;
    await load();
    renderFill();
    if (!state.locked) {
      renderSheet();
    }
  });

  pill.onPrefs?.((prefs) => {
    state.prefs = prefs || null;
    state.aiMode = Boolean(prefs?.aiMode);
    renderAi();
  });

  pill.onAiProgress?.((message) => {
    state.aiRunning = message;
    const step = document.getElementById("ai-step");
    if (step) {
      step.textContent = aiStepText(message);
    } else {
      showRunning(message);
    }
  });

  pill.onScanning?.((label) => {
    showReading(label || s("captureForm", "Screen capture"), s("fillingForm", "Filling the form"));
  });

  pill.onShow(async (message) => {
    state.platform = message.platform || "mac";
    state.front = message.front || null;
    if (typeof message.profileId === "string" && message.profileId) {
      state.profileId = message.profileId;
    }
    state.query = "";
    state.selected = 0;
    stage.className = state.platform;
    state.aiMode = Boolean(message.prefs?.aiMode);
    panel.style.animation = "none";
    void panel.offsetWidth;
    panel.style.animation = "";
    await load();
    if (message.aiProgress) {
      showRunning(message.aiProgress);
    } else if (message.status) {
      renderAgentCapsule();
      showStatus(message.status);
    } else {
      showSearch();
    }
  });
})();
