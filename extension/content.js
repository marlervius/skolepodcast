(() => {
  if (window.__lytteromExtLoaded) return;
  window.__lytteromExtLoaded = true;

  const capturedMedia = new Map();
  const pendingReads = new Map();
  let readSeq = 0;

  let drawerEl = null;
  let backdropEl = null;
  let fabEl = null;
  let fabBadgeEl = null;

  let studioState = null;
  let selectedMediaKey = "";
  let localFile = null;
  let busy = false;

  /* ---------- Meldinger med page-hook.js (MAIN world) ---------- */

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.source !== "lytterom-nlm-hook") return;

    if (event.data.type === "MEDIA_CAPTURED" && event.data.item?.url) {
      const item = event.data.item;
      const existing = capturedMedia.get(item.url);
      capturedMedia.set(item.url, { ...existing, ...item });
      updateFabBadge();
      if (drawerEl) renderMediaList();
      return;
    }

    if (event.data.type === "READ_MEDIA_RESULT") {
      const resolver = pendingReads.get(event.data.requestId);
      if (resolver) {
        pendingReads.delete(event.data.requestId);
        resolver(event.data);
      }
    }
  });

  function scanPageMedia() {
    window.postMessage({ source: "lytterom-nlm-content", type: "SCAN_MEDIA" }, "*");
  }

  function readCapturedMedia(url) {
    return new Promise((resolve, reject) => {
      const requestId = `req-${++readSeq}`;
      const timer = setTimeout(() => {
        pendingReads.delete(requestId);
        reject(new Error("Tidsavbrudd ved lesing av mediefil fra NotebookLM."));
      }, 25000);
      pendingReads.set(requestId, (result) => {
        clearTimeout(timer);
        if (result.ok) resolve(result);
        else reject(new Error(result.error || "Kunne ikke hente mediefilen."));
      });
      window.postMessage({ source: "lytterom-nlm-content", type: "READ_MEDIA", requestId, url }, "*");
    });
  }

  /* ---------- Hjelpere ---------- */

  function sendBg(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!response?.ok) {
          reject(new Error(response?.error || "Kunne ikke kontakte Lytterom."));
          return;
        }
        resolve(response.data);
      });
    });
  }

  function currentNotebookTitle() {
    const raw = (document.title || "")
      .replace(/\s*[-–—|]\s*NotebookLM\s*$/i, "")
      .replace(/^NotebookLM\s*[-–—|]\s*/i, "")
      .trim();
    return raw && raw.toLowerCase() !== "notebooklm" ? raw.slice(0, 140) : "";
  }

  function cleanFilenameTitle(name) {
    return (name || "")
      .replace(/\.[^.]+$/, "")
      .replace(/^(?:audio|video)\s+overview\s*[-–—:]\s*/i, "")
      .replace(/^(?:lyd|video)oversikt\s*[-–—:]\s*/i, "")
      .replace(/\s*\(\d+\)\s*$/, "")
      .replace(/[_]+/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim()
      .slice(0, 140);
  }

  function cleanNotesMarkdown(raw) {
    return raw
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((line) =>
        line
          .replace(/^#{1,6}\s+/, "")
          .replace(/^\s*[*•-]\s+/, "• ")
          .replace(/\*\*([^*]+)\*\*/g, "$1")
          .replace(/__([^_]+)__/g, "$1")
          .trimEnd(),
      )
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, 8000);
  }

  function extensionFromMime(mime, kind) {
    const m = (mime || "").toLowerCase();
    if (m.includes("mp4") || m.includes("m4a")) return kind === "video" ? ".mp4" : ".m4a";
    if (m.includes("mpeg") || m.includes("mp3")) return ".mp3";
    if (m.includes("webm")) return ".webm";
    if (m.includes("ogg")) return ".ogg";
    if (m.includes("aac")) return ".aac";
    if (m.includes("quicktime")) return ".mov";
    return kind === "video" ? ".mp4" : ".wav";
  }

  function uint8ToBase64(bytes) {
    let binary = "";
    const step = 0x8000;
    for (let i = 0; i < bytes.length; i += step) {
      binary += String.fromCharCode(...bytes.subarray(i, i + step));
    }
    return btoa(binary);
  }

  async function measureDurationFromBuffer(buffer, mime, isVideo) {
    return new Promise((resolve) => {
      const blob = new Blob([buffer], { type: mime });
      const url = URL.createObjectURL(blob);
      const el = document.createElement(isVideo ? "video" : "audio");
      let done = false;
      const timer = setTimeout(() => finish(0), 4000);
      function finish(sec) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        el.removeAttribute("src");
        URL.revokeObjectURL(url);
        resolve(Number.isFinite(sec) ? Math.round(sec) : 0);
      }
      el.preload = "metadata";
      el.onloadedmetadata = () => finish(el.duration);
      el.onerror = () => finish(0);
      el.src = url;
    });
  }

  /* ---------- Flytende «Send til Lytterom»-knapp ---------- */

  function mountFab() {
    if (fabEl) return;
    fabEl = document.createElement("button");
    fabEl.type = "button";
    fabEl.className = "lytterom-ext-fab";
    fabEl.innerHTML = `<span>Send til Lytterom</span>`;
    fabBadgeEl = document.createElement("span");
    fabBadgeEl.className = "lytterom-ext-fab-badge";
    fabBadgeEl.style.display = "none";
    fabEl.appendChild(fabBadgeEl);
    fabEl.addEventListener("click", () => openDrawer());
    document.body.appendChild(fabEl);
    updateFabBadge();
  }

  function updateFabBadge() {
    if (!fabBadgeEl) return;
    const count = capturedMedia.size;
    if (count > 0) {
      fabBadgeEl.textContent = String(count);
      fabBadgeEl.style.display = "inline-flex";
    } else {
      fabBadgeEl.style.display = "none";
    }
  }

  /* ---------- Skuff (Drawer) ---------- */

  function closeDrawer() {
    if (busy) return;
    drawerEl?.remove();
    backdropEl?.remove();
    drawerEl = null;
    backdropEl = null;
  }

  async function openDrawer() {
    if (drawerEl) return;
    scanPageMedia();

    backdropEl = document.createElement("div");
    backdropEl.className = "lytterom-ext-backdrop";
    backdropEl.addEventListener("click", closeDrawer);

    drawerEl = document.createElement("aside");
    drawerEl.className = "lytterom-ext-drawer";
    drawerEl.innerHTML = `
      <header class="lytterom-ext-head">
        <div class="lytterom-ext-brand">
          <span class="lytterom-ext-logo">L</span>
          <div>
            <h2>Send til Lytterom</h2>
            <small id="lyt-sub">Kobler til …</small>
          </div>
        </div>
        <button type="button" class="lytterom-ext-close" id="lyt-close" aria-label="Lukk">&times;</button>
      </header>
      <div class="lytterom-ext-body" id="lyt-body">
        <p class="lytterom-ext-muted">Henter fagrommene dine fra Lytterom …</p>
      </div>
    `;

    document.body.appendChild(backdropEl);
    document.body.appendChild(drawerEl);
    drawerEl.querySelector("#lyt-close").addEventListener("click", closeDrawer);

    try {
      studioState = await sendBg({ type: "LOAD_STUDIO" });
      if (!studioState.authenticated) {
        renderAuthPrompt();
      } else {
        renderPublisher();
      }
    } catch (err) {
      const body = drawerEl.querySelector("#lyt-body");
      body.innerHTML = `
        <div class="lytterom-ext-status lytterom-ext-status--error">${escapeHtml(err.message)}</div>
        <p class="lytterom-ext-muted">Åpne Lytterom-ikonet i nettleserens verktøylinje for å sjekke serveradresse og innlogging.</p>
      `;
    }
  }

  function renderAuthPrompt() {
    drawerEl.querySelector("#lyt-sub").textContent = "Ikke tilkoblet";
    const body = drawerEl.querySelector("#lyt-body");
    body.innerHTML = `
      <div class="lytterom-ext-card">
        <strong>Koble til lærerkontoen din</strong>
        <p class="lytterom-ext-muted">
          Klikk på <strong>Lytterom-ikonet</strong> øverst i Chrome for å logge inn eller lime inn en tilkoblingsnøkkel fra Lærerstudio.
        </p>
        <a class="lytterom-ext-btn lytterom-ext-btn--primary lytterom-ext-btn--block" href="${escapeHtml(studioState.serverUrl)}/studio" target="_blank" rel="noreferrer">
          Åpne Lærerstudio
        </a>
        <button type="button" class="lytterom-ext-btn lytterom-ext-btn--block" id="lyt-retry">Jeg er logget inn — prøv igjen</button>
      </div>
    `;
    body.querySelector("#lyt-retry").addEventListener("click", () => {
      closeDrawer();
      openDrawer();
    });
  }

  function renderPublisher() {
    const sub = drawerEl.querySelector("#lyt-sub");
    sub.textContent = `${studioState.teacher.name} · ${new URL(studioState.serverUrl).host}`;

    const courses = studioState.courses || [];
    const body = drawerEl.querySelector("#lyt-body");

    if (!courses.length) {
      body.innerHTML = `
        <div class="lytterom-ext-card">
          <strong>Du har ingen fagrom ennå</strong>
          <p class="lytterom-ext-muted">Opprett ditt første fagrom i Lærerstudio før du sender episoder fra NotebookLM.</p>
          <a class="lytterom-ext-btn lytterom-ext-btn--primary" href="${escapeHtml(studioState.serverUrl)}/studio" target="_blank" rel="noreferrer">Åpne Lærerstudio</a>
        </div>
      `;
      return;
    }

    const defaultCourseId = courses.some((c) => c.id === studioState.lastCourseId) ? studioState.lastCourseId : courses[0].id;
    const defaultTitle = currentNotebookTitle();

    body.innerHTML = `
      <div class="lytterom-ext-card">
        <div class="lytterom-ext-card-head">
          <strong>1. Velg lyd eller video</strong>
          <button type="button" class="lytterom-ext-btn lytterom-ext-btn--small" id="lyt-scan">Søk på siden</button>
        </div>
        <div class="lytterom-ext-media-list" id="lyt-media-list"></div>
        <div class="lytterom-ext-dropzone" id="lyt-dropzone">
          <input type="file" id="lyt-file" hidden accept=".mp3,.m4a,.wav,.ogg,.aac,.flac,.mp4,.webm,.mov" />
          <span id="lyt-file-label">Eller dra / velg en nedlastet fil fra NotebookLM her</span>
        </div>
        <label class="lytterom-ext-check">
          <input type="checkbox" id="lyt-compress" checked />
          <span>Komprimer WAV-lyd automatisk til M4A før opplasting (anbefalt)</span>
        </label>
      </div>

      <label class="lytterom-ext-field">
        2. Fagrom
        <select id="lyt-course">
          ${courses.map((c) => `<option value="${escapeHtml(c.id)}"${c.id === defaultCourseId ? " selected" : ""}>${escapeHtml(c.title)} (${escapeHtml(c.code)})</option>`).join("")}
        </select>
      </label>

      <label class="lytterom-ext-field">
        <span class="lytterom-ext-row">
          <span>Kapittel</span>
          <button type="button" class="lytterom-ext-btn lytterom-ext-btn--small" id="lyt-new-topic-btn">+ Nytt kapittel</button>
        </span>
        <select id="lyt-topic"></select>
      </label>

      <div id="lyt-new-topic-box" class="lytterom-ext-card" style="display:none">
        <label class="lytterom-ext-field">
          Navn på nytt kapittel
          <input type="text" id="lyt-new-topic-title" placeholder="F.eks. Den kalde krigen" maxlength="100" />
        </label>
        <div class="lytterom-ext-row">
          <button type="button" class="lytterom-ext-btn lytterom-ext-btn--small" id="lyt-new-topic-cancel">Avbryt</button>
          <button type="button" class="lytterom-ext-btn lytterom-ext-btn--primary lytterom-ext-btn--small" id="lyt-new-topic-save">Opprett kapittel</button>
        </div>
      </div>

      <label class="lytterom-ext-field">
        3. Episodetittel
        <input type="text" id="lyt-title" value="${escapeHtml(defaultTitle)}" placeholder="F.eks. Den kalde krigen forklart" maxlength="140" />
      </label>

      <label class="lytterom-ext-field">
        Beskrivelse (valgfritt)
        <textarea id="lyt-desc" rows="2" maxlength="1600" placeholder="Kort om hva episoden tar opp …"></textarea>
      </label>

      <label class="lytterom-ext-field">
        <span class="lytterom-ext-row">
          <span>Nøkkelpunkter og spørsmål</span>
          <button type="button" class="lytterom-ext-btn lytterom-ext-btn--small" id="lyt-grab-sel">Hent markert tekst</button>
        </span>
        <textarea id="lyt-notes" rows="4" maxlength="8000" placeholder="Marker tekst i NotebookLM og klikk «Hent markert tekst», eller lim inn studieguide …"></textarea>
      </label>

      <label class="lytterom-ext-check">
        <input type="checkbox" id="lyt-link-notebook" checked />
        <span>Koble denne NotebookLM-notatboka til kapittelet i Lærerstudio</span>
      </label>

      <div id="lyt-feedback"></div>

      <button type="button" class="lytterom-ext-btn lytterom-ext-btn--primary lytterom-ext-btn--block" id="lyt-publish">
        Publiser til Lytterom
      </button>
    `;

    const courseSelect = body.querySelector("#lyt-course");
    const topicSelect = body.querySelector("#lyt-topic");
    const fileInput = body.querySelector("#lyt-file");
    const dropzone = body.querySelector("#lyt-dropzone");
    const titleInput = body.querySelector("#lyt-title");

    function populateTopics(courseId, selectTopicId) {
      const course = courses.find((c) => c.id === courseId);
      const topics = course?.topics || [];
      topicSelect.innerHTML = topics.length
        ? topics.map((t) => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.title)}</option>`).join("")
        : `<option value="">Ingen kapitler ennå — lag et nytt</option>`;
      if (selectTopicId && topics.some((t) => t.id === selectTopicId)) {
        topicSelect.value = selectTopicId;
      }
    }

    populateTopics(defaultCourseId, studioState.lastTopicId);
    courseSelect.addEventListener("change", () => populateTopics(courseSelect.value));

    // Opprett nytt kapittel direkte fra skuffen
    const newTopicBox = body.querySelector("#lyt-new-topic-box");
    const newTopicInput = body.querySelector("#lyt-new-topic-title");
    body.querySelector("#lyt-new-topic-btn").addEventListener("click", () => {
      newTopicBox.style.display = "flex";
      newTopicInput.focus();
    });
    body.querySelector("#lyt-new-topic-cancel").addEventListener("click", () => {
      newTopicBox.style.display = "none";
      newTopicInput.value = "";
    });
    body.querySelector("#lyt-new-topic-save").addEventListener("click", async () => {
      const title = newTopicInput.value.trim();
      if (!title) return;
      try {
        const created = await sendBg({
          type: "CREATE_TOPIC",
          courseId: courseSelect.value,
          title,
          notebookUrl: window.location.href.startsWith("https://notebooklm.google.com/") ? window.location.href : "",
        });
        const course = courses.find((c) => c.id === courseSelect.value);
        if (course) course.topics.push({ id: created.id, title: created.title });
        populateTopics(courseSelect.value, created.id);
        newTopicBox.style.display = "none";
        newTopicInput.value = "";
      } catch (err) {
        setFeedback("error", err.message);
      }
    });

    // Filvelger & dra-og-slipp
    function pickLocalFile(file) {
      localFile = file;
      selectedMediaKey = "__local__";
      body.querySelector("#lyt-file-label").textContent = `Valgt fil: ${file.name} (${window.LytteromAudio.formatBytes(file.size)})`;
      if (!titleInput.value.trim() || titleInput.value === defaultTitle) {
        const cleaned = cleanFilenameTitle(file.name);
        if (cleaned) titleInput.value = cleaned;
      }
      renderMediaList();
    }

    dropzone.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => {
      if (fileInput.files?.[0]) pickLocalFile(fileInput.files[0]);
      fileInput.value = "";
    });
    dropzone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropzone.dataset.dragging = "true";
    });
    dropzone.addEventListener("dragleave", () => {
      dropzone.dataset.dragging = "false";
    });
    dropzone.addEventListener("drop", (e) => {
      e.preventDefault();
      dropzone.dataset.dragging = "false";
      if (e.dataTransfer.files?.[0]) pickLocalFile(e.dataTransfer.files[0]);
    });

    // Skann NotebookLM etter lyd/video
    body.querySelector("#lyt-scan").addEventListener("click", () => {
      scanPageMedia();
      setTimeout(renderMediaList, 250);
    });

    // Hent markert tekst fra NotebookLM
    body.querySelector("#lyt-grab-sel").addEventListener("click", () => {
      const sel = window.getSelection()?.toString() || "";
      if (!sel.trim()) {
        setFeedback("info", "Marker teksten du vil hente i NotebookLM først, og klikk igjen.");
        return;
      }
      const notes = body.querySelector("#lyt-notes");
      const cleaned = cleanNotesMarkdown(sel);
      notes.value = notes.value.trim() ? `${notes.value.trim()}\n\n${cleaned}` : cleaned;
      setFeedback("success", "Hentet markert tekst fra NotebookLM.");
    });

    body.querySelector("#lyt-publish").addEventListener("click", publishEpisode);
    renderMediaList();
  }

  function renderMediaList() {
    if (!drawerEl) return;
    const list = drawerEl.querySelector("#lyt-media-list");
    if (!list) return;

    const items = Array.from(capturedMedia.values()).reverse();
    if (!selectedMediaKey && items.length) {
      selectedMediaKey = items[0].url;
    }

    if (!items.length && !localFile) {
      list.innerHTML = `<p class="lytterom-ext-muted">Ingen lyd eller video fanget opp ennå. Trykk <strong>Spill av</strong> på en lyd- eller videooversikt i NotebookLM, eller dra en nedlastet fil nedenfor.</p>`;
      return;
    }

    list.innerHTML = items
      .map((item) => {
        const selected = selectedMediaKey === item.url;
        const sizeText = item.size ? window.LytteromAudio.formatBytes(item.size) : "";
        const durText = item.duration ? `${Math.floor(item.duration / 60)}:${String(item.duration % 60).padStart(2, "0")}` : "";
        const meta = [item.kind === "video" ? "Video" : "Podkast", durText, sizeText].filter(Boolean).join(" · ");
        return `
          <label class="lytterom-ext-media-item" data-selected="${selected}">
            <input type="radio" name="lyt-media" value="${escapeHtml(item.url)}" ${selected ? "checked" : ""} />
            <span class="lytterom-ext-media-meta">
              <strong>${escapeHtml(item.label || "Mediefil fra NotebookLM")}</strong>
              <small>${escapeHtml(meta || "Klar til publisering")}</small>
            </span>
          </label>
        `;
      })
      .join("");

    list.querySelectorAll('input[name="lyt-media"]').forEach((radio) => {
      radio.addEventListener("change", () => {
        selectedMediaKey = radio.value;
        renderMediaList();
      });
    });
  }

  function setFeedback(kind, text, progress) {
    const box = drawerEl?.querySelector("#lyt-feedback");
    if (!box) return;
    if (!text) {
      box.innerHTML = "";
      return;
    }
    const bar = typeof progress === "number" ? `<progress class="lytterom-ext-progress" value="${progress}" max="100"></progress>` : "";
    box.innerHTML = `<div class="lytterom-ext-status lytterom-ext-status--${kind}">${escapeHtml(text)}${bar}</div>`;
  }

  async function publishEpisode() {
    if (busy || !drawerEl) return;

    const courseId = drawerEl.querySelector("#lyt-course").value;
    const topicId = drawerEl.querySelector("#lyt-topic").value;
    const title = drawerEl.querySelector("#lyt-title").value.trim();
    const description = drawerEl.querySelector("#lyt-desc").value.trim();
    const studyNotes = drawerEl.querySelector("#lyt-notes").value.trim();
    const shouldCompress = drawerEl.querySelector("#lyt-compress").checked;
    const linkNotebook = drawerEl.querySelector("#lyt-link-notebook").checked;

    if (!courseId || !topicId) {
      setFeedback("error", "Velg både fagrom og kapittel først.");
      return;
    }
    if (!title) {
      setFeedback("error", "Gi episoden en tittel.");
      return;
    }
    if (!selectedMediaKey) {
      setFeedback("error", "Spill av lyd/video i NotebookLM først, eller velg en nedlastet fil.");
      return;
    }

    busy = true;
    const publishBtn = drawerEl.querySelector("#lyt-publish");
    publishBtn.disabled = true;

    try {
      let buffer;
      let filename;
      let mime;
      let isVideo = false;
      let durationSeconds = 0;

      if (selectedMediaKey === "__local__" && localFile) {
        setFeedback("info", "Leser valgt fil …", 5);
        buffer = await localFile.arrayBuffer();
        filename = localFile.name;
        mime = localFile.type || "";
        isVideo = /\.(mp4|webm|mov)$/i.test(filename) || mime.startsWith("video/");
      } else {
        const mediaItem = capturedMedia.get(selectedMediaKey);
        if (!mediaItem) throw new Error("Fant ikke mediefilen på siden. Trykk «Søk på siden» og prøv igjen.");
        setFeedback("info", "Henter lyd/video fra NotebookLM …", 5);
        const result = await readCapturedMedia(mediaItem.url);
        buffer = result.buffer;
        mime = result.mime || mediaItem.mime || "audio/wav";
        isVideo = mediaItem.kind === "video" || mime.startsWith("video/");
        durationSeconds = mediaItem.duration || 0;
        const ext = extensionFromMime(mime, isVideo ? "video" : "audio");
        filename = `${title.replace(/[^\wÆØÅæøå -]/g, "").slice(0, 60) || "notebooklm"}${ext}`;
      }

      if (!isVideo && shouldCompress && window.LytteromAudio.isWav(filename, mime)) {
        const originalBytes = buffer.byteLength;
        const compressed = await window.LytteromAudio.compressWavBuffer(buffer, filename, (label) => {
          setFeedback("info", label, 10);
        });
        buffer = compressed.buffer;
        filename = compressed.filename;
        mime = compressed.mime;
        if (compressed.durationSeconds) durationSeconds = compressed.durationSeconds;
        if (compressed.compressed) {
          setFeedback(
            "info",
            `Komprimert ${window.LytteromAudio.formatBytes(originalBytes)} → ${window.LytteromAudio.formatBytes(buffer.byteLength)}`,
            15,
          );
        }
      }

      const maxBytes = (studioState.maxUploadMb || 50) * 1024 * 1024;
      if (buffer.byteLength > maxBytes) {
        throw new Error(`Filen er for stor (${window.LytteromAudio.formatBytes(buffer.byteLength)}, maks ${studioState.maxUploadMb || 50} MB).`);
      }

      if (!durationSeconds) {
        durationSeconds = await measureDurationFromBuffer(buffer, mime, isVideo);
      }

      const result = await uploadViaPort({
        buffer,
        filename,
        courseId,
        topicId,
        title,
        description,
        studyNotes,
        durationSeconds,
        linkNotebookUrl: linkNotebook && window.location.href.startsWith("https://notebooklm.google.com/") ? window.location.href : "",
      });

      const box = drawerEl.querySelector("#lyt-feedback");
      box.innerHTML = `
        <div class="lytterom-ext-status lytterom-ext-status--success">
          <strong>Publisert!</strong> «${escapeHtml(result.episode.title)}» ligger nå ute i Lytterom.
          <div style="margin-top:8px">
            <a class="lytterom-ext-btn lytterom-ext-btn--small" href="${escapeHtml(result.studioUrl)}" target="_blank" rel="noreferrer">Åpne Lærerstudio</a>
          </div>
        </div>
      `;
    } catch (err) {
      setFeedback("error", err instanceof Error ? err.message : "Noe gikk galt under publiseringen.");
    } finally {
      busy = false;
      if (publishBtn) publishBtn.disabled = false;
    }
  }

  function uploadViaPort(payload) {
    return new Promise((resolve, reject) => {
      const port = chrome.runtime.connect({ name: "lytterom-upload" });
      const bytes = new Uint8Array(payload.buffer);
      const chunkSize = 2 * 1024 * 1024; // 2 MB per chunk
      const totalChunks = Math.max(1, Math.ceil(bytes.byteLength / chunkSize));
      let nextChunk = 0;

      function sendNextChunk() {
        if (nextChunk >= totalChunks) {
          port.postMessage({ type: "FINISH" });
          return;
        }
        const start = nextChunk * chunkSize;
        const slice = bytes.subarray(start, Math.min(start + chunkSize, bytes.byteLength));
        const pct = 15 + Math.round(((nextChunk + 1) / totalChunks) * 25);
        setFeedback("info", "Overfører fil …", pct);
        port.postMessage({ type: "CHUNK", index: nextChunk, data: uint8ToBase64(slice) });
        nextChunk++;
      }

      port.onMessage.addListener((msg) => {
        if (msg.type === "READY" || msg.type === "CHUNK_ACK") {
          sendNextChunk();
        } else if (msg.type === "STAGE") {
          setFeedback("info", msg.label, msg.progress);
        } else if (msg.type === "DONE") {
          port.disconnect();
          resolve(msg);
        } else if (msg.type === "ERROR") {
          port.disconnect();
          reject(new Error(msg.error));
        }
      });

      port.onDisconnect.addListener(() => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        }
      });

      port.postMessage({
        type: "START",
        filename: payload.filename,
        courseId: payload.courseId,
        topicId: payload.topicId,
        title: payload.title,
        description: payload.description,
        studyNotes: payload.studyNotes,
        durationSeconds: payload.durationSeconds,
        linkNotebookUrl: payload.linkNotebookUrl,
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

  // Lytt på melding fra popup-en om å åpne skuffen
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "OPEN_DRAWER") {
      openDrawer();
      sendResponse({ ok: true });
    }
  });

  if (document.body) {
    mountFab();
  } else {
    document.addEventListener("DOMContentLoaded", mountFab, { once: true });
  }
})();
