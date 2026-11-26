const app = document.getElementById("app");

function sendBg(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (res) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!res?.ok) return reject(new Error(res?.error || "Noe gikk galt."));
      resolve(res.data);
    });
  });
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function ensureHostPermission(serverUrl) {
  const origin = `${new URL(serverUrl).origin}/*`;
  const has = await chrome.permissions.contains({ origins: [origin] });
  if (has) return true;
  return chrome.permissions.request({ origins: [origin] });
}

async function init() {
  try {
    const config = await sendBg({ type: "GET_CONFIG" });
    if (config.token && config.teacher) {
      renderConnected(config);
    } else {
      renderLogin(config.serverUrl);
    }
  } catch (err) {
    app.innerHTML = `<p class="error">${escapeHtml(err.message)}</p>`;
  }
}

async function renderConnected(config) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const isNotebook = Boolean(tab?.url?.startsWith("https://notebooklm.google.com/"));

  app.innerHTML = `
    <div class="card">
      <div>
        <strong>${escapeHtml(config.teacher.name)}</strong>
        <p class="muted">${escapeHtml(config.teacher.email)}</p>
        <p class="muted" style="margin-top:4px">Server: ${escapeHtml(config.serverUrl)}</p>
      </div>
      ${
        isNotebook
          ? `<button type="button" class="btn btn--primary" id="open-drawer">Send fra denne notatboka</button>`
          : `<a class="btn btn--primary" href="https://notebooklm.google.com" target="_blank" rel="noreferrer">Åpne NotebookLM</a>`
      }
      <div class="row">
        <a class="btn" href="${escapeHtml(config.serverUrl)}/studio" target="_blank" rel="noreferrer">Lærerstudio</a>
        <button type="button" class="btn btn--danger" id="logout">Koble fra</button>
      </div>
    </div>
    <p class="muted">Tips: På notebooklm.google.com finner du alltid «Send til Lytterom»-knappen nederst til høyre.</p>
  `;

  if (isNotebook) {
    document.getElementById("open-drawer").addEventListener("click", async () => {
      await chrome.tabs.sendMessage(tab.id, { type: "OPEN_DRAWER" }).catch(() => undefined);
      window.close();
    });
  }

  document.getElementById("logout").addEventListener("click", async () => {
    await sendBg({ type: "LOGOUT" });
    renderLogin(config.serverUrl);
  });
}

function renderLogin(defaultServer) {
  let mode = "token";

  function draw(error = "") {
    app.innerHTML = `
      <div class="card">
        <label>
          Lytterom-adresse
          <input id="server" type="url" value="${escapeHtml(defaultServer)}" placeholder="https://skolepodcast.vercel.app" />
        </label>

        <div class="tabs">
          <button type="button" id="tab-token" aria-pressed="${mode === "token"}">Tilkoblingsnøkkel</button>
          <button type="button" id="tab-pass" aria-pressed="${mode === "password"}">E-post og passord</button>
        </div>

        ${
          mode === "token"
            ? `
              <label>
                Tilkoblingsnøkkel fra Lærerstudio
                <input id="token" type="password" placeholder="Lim inn nøkkel …" />
              </label>
              <p class="muted">Åpne Lærerstudio → <strong>NotebookLM</strong> → <strong>Chrome-utvidelse</strong> for å kopiere nøkkelen.</p>
            `
            : `
              <label>E-post<input id="email" type="email" autocomplete="email" /></label>
              <label>Passord<input id="password" type="password" autocomplete="current-password" /></label>
            `
        }

        ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
        <button type="button" class="btn btn--primary" id="submit">Koble til Lytterom</button>
      </div>
    `;

    document.getElementById("tab-token").addEventListener("click", () => { mode = "token"; draw(); });
    document.getElementById("tab-pass").addEventListener("click", () => { mode = "password"; draw(); });

    document.getElementById("submit").addEventListener("click", async () => {
      const btn = document.getElementById("submit");
      const serverUrl = document.getElementById("server").value.trim() || defaultServer;
      btn.disabled = true;
      try {
        await ensureHostPermission(serverUrl);
        if (mode === "token") {
          const token = document.getElementById("token").value.trim();
          const res = await sendBg({ type: "CONNECT_TOKEN", serverUrl, token });
          renderConnected({ ...res, token });
        } else {
          const email = document.getElementById("email").value.trim();
          const password = document.getElementById("password").value;
          const res = await sendBg({ type: "LOGIN_PASSWORD", serverUrl, email, password });
          renderConnected({ ...res, token: "active" });
        }
      } catch (err) {
        draw(err instanceof Error ? err.message : "Kunne ikke koble til.");
      }
    });
  }

  draw();
}

init();
