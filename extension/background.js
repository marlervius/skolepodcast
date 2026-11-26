/**
 * Bakgrunnstjeneste (MV3 service worker) for Lytterom-utvidelsen.
 * Håndterer all kommunikasjon mot Lytterom-serveren og Supabase Storage.
 */

const DEFAULT_SERVER = "https://skolepodcast.vercel.app";

function normalizeServerUrl(raw) {
  const value = (raw || DEFAULT_SERVER).trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(value)) return `https://${value}`;
  return value;
}

async function getConfig() {
  const data = await chrome.storage.local.get(["serverUrl", "token", "teacher", "lastCourseId", "lastTopicId"]);
  return {
    serverUrl: normalizeServerUrl(data.serverUrl || DEFAULT_SERVER),
    token: data.token || "",
    teacher: data.teacher || null,
    lastCourseId: data.lastCourseId || "",
    lastTopicId: data.lastTopicId || "",
  };
}

async function apiFetch(path, options = {}, overrideConfig) {
  const config = overrideConfig || (await getConfig());
  const headers = { ...(options.headers || {}) };
  if (config.token) headers["Authorization"] = `Bearer ${config.token}`;
  if (options.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";

  const response = await fetch(`${config.serverUrl}${path}`, {
    ...options,
    headers,
    credentials: "include",
    cache: "no-store",
  });

  if (response.status === 204) return null;
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(json?.error || `Serveren svarte med feil (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return json;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((err) => sendResponse({ ok: false, error: err instanceof Error ? err.message : "Ukjent feil.", status: err?.status || 0 }));
  return true;
});

async function handleMessage(message) {
  switch (message.type) {
    case "GET_CONFIG":
      return getConfig();

    case "LOGIN_PASSWORD": {
      const serverUrl = normalizeServerUrl(message.serverUrl);
      const result = await apiFetch(
        "/api/auth/token",
        { method: "POST", body: JSON.stringify({ email: message.email, password: message.password }) },
        { serverUrl, token: "" },
      );
      await chrome.storage.local.set({ serverUrl, token: result.token, teacher: result.teacher });
      return { serverUrl, teacher: result.teacher, maxUploadMb: result.max_upload_mb || 50 };
    }

    case "CONNECT_TOKEN": {
      const serverUrl = normalizeServerUrl(message.serverUrl);
      const token = (message.token || "").trim();
      if (!token) throw new Error("Lim inn tilkoblingsnøkkelen fra Lærerstudio.");
      const me = await apiFetch("/api/auth/me", { method: "GET" }, { serverUrl, token });
      if (!me?.teacher) throw new Error("Nøkkelen er ugyldig eller utløpt. Lag en ny i Lærerstudio.");
      await chrome.storage.local.set({ serverUrl, token, teacher: me.teacher });
      return { serverUrl, teacher: me.teacher };
    }

    case "LOGOUT": {
      await chrome.storage.local.remove(["token", "teacher"]);
      return { loggedOut: true };
    }

    case "LOAD_STUDIO": {
      const config = await getConfig();
      const me = await apiFetch("/api/auth/me", { method: "GET" }, config);
      if (!me?.teacher) {
        return { authenticated: false, serverUrl: config.serverUrl };
      }
      const data = await apiFetch("/api/courses?mine=1&with_topics=1", { method: "GET" }, config);
      await chrome.storage.local.set({ teacher: me.teacher });
      return {
        authenticated: true,
        serverUrl: config.serverUrl,
        teacher: me.teacher,
        courses: data.courses || [],
        maxUploadMb: data.max_upload_mb || 50,
        lastCourseId: config.lastCourseId,
        lastTopicId: config.lastTopicId,
      };
    }

    case "CREATE_TOPIC": {
      const result = await apiFetch(`/api/courses/${encodeURIComponent(message.courseId)}/topics`, {
        method: "POST",
        body: JSON.stringify({
          title: message.title,
          description: message.description || "",
          notebook_url: message.notebookUrl || "",
        }),
      });
      return result.topic;
    }

    default:
      throw new Error("Ukjent handling.");
  }
}

/* ---------- Chunked opplasting over port (ingen størrelsesgrense eller CSP-problemer) ---------- */

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "lytterom-upload") return;

  let meta = null;
  const chunks = [];

  port.onMessage.addListener(async (msg) => {
    try {
      if (msg.type === "START") {
        meta = msg;
        chunks.length = 0;
        port.postMessage({ type: "READY" });
        return;
      }

      if (msg.type === "CHUNK") {
        // Base64 -> Uint8Array
        const binary = atob(msg.data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        chunks.push(bytes);
        port.postMessage({ type: "CHUNK_ACK", index: msg.index });
        return;
      }

      if (msg.type === "FINISH") {
        if (!meta) throw new Error("Opplastingen ble avbrutt.");
        const totalLength = chunks.reduce((sum, part) => sum + part.byteLength, 0);
        const combined = new Uint8Array(totalLength);
        let offset = 0;
        for (const part of chunks) {
          combined.set(part, offset);
          offset += part.byteLength;
        }
        chunks.length = 0;

        port.postMessage({ type: "STAGE", label: "Henter opplastingslenke …", progress: 15 });
        const ticket = await apiFetch("/api/uploads", {
          method: "POST",
          body: JSON.stringify({
            course_id: meta.courseId,
            filename: meta.filename,
            size: combined.byteLength,
          }),
        });

        port.postMessage({ type: "STAGE", label: "Laster opp fil til Lytterom …", progress: 45 });
        const putRes = await fetch(ticket.upload_url, {
          method: "PUT",
          headers: {
            "Content-Type": ticket.content_type,
            "Cache-Control": "max-age=31536000",
            "x-upsert": "false",
          },
          body: combined,
        });
        if (!putRes.ok) {
          throw new Error(putRes.status === 413 ? "Filen er for stor for lagringen." : "Opplastingen til lagring mislyktes.");
        }

        port.postMessage({ type: "STAGE", label: "Publiserer episode …", progress: 85 });
        const created = await apiFetch("/api/episodes", {
          method: "POST",
          body: JSON.stringify({
            course_id: meta.courseId,
            topic_id: meta.topicId,
            title: meta.title,
            description: meta.description || "",
            study_notes: meta.studyNotes || "",
            upload_path: ticket.upload_path,
            duration_seconds: meta.durationSeconds || 0,
          }),
        });

        if (meta.linkNotebookUrl) {
          await apiFetch(`/api/topics/${encodeURIComponent(meta.topicId)}`, {
            method: "PATCH",
            body: JSON.stringify({ notebook_url: meta.linkNotebookUrl }),
          }).catch(() => undefined);
        }

        await chrome.storage.local.set({ lastCourseId: meta.courseId, lastTopicId: meta.topicId });
        const config = await getConfig();
        port.postMessage({
          type: "DONE",
          episode: created.episode,
          studioUrl: `${config.serverUrl}/studio`,
        });
      }
    } catch (err) {
      port.postMessage({
        type: "ERROR",
        error: err instanceof Error ? err.message : "Opplastingen mislyktes.",
      });
    }
  });
});
