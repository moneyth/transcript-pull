// Replace with your Vercel URL after deploying
const API_BASE = "";

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () =>
    navigator.serviceWorker.register("/sw.js").catch(console.warn)
  );
}

let deferredInstall = null;
window.addEventListener("beforeinstallprompt", e => {
  e.preventDefault();
  deferredInstall = e;
  document.getElementById("install-banner").hidden = false;
});

document.getElementById("btn-install")?.addEventListener("click", async () => {
  if (!deferredInstall) return;
  deferredInstall.prompt();
  const { outcome } = await deferredInstall.userChoice;
  if (outcome === "accepted") document.getElementById("install-banner").hidden = true;
  deferredInstall = null;
});

window.addEventListener("appinstalled", () => {
  document.getElementById("install-banner").hidden = true;
});

function parseYouTubeInput(raw) {
  const str = raw.trim();
  try {
    const url = new URL(str);
    const listId = url.searchParams.get("list");
    const videoId = url.searchParams.get("v");
    if (listId) return { type: "playlist", id: listId };
    if (videoId) return { type: "video", id: videoId };
    if (url.hostname === "youtu.be") {
      const vid = url.pathname.replace(/^\//, "").split("?")[0];
      if (vid) return { type: "video", id: vid };
    }
  } catch (_) {}
  if (/^PL[A-Za-z0-9_-]{16,}$/.test(str)) return { type: "playlist", id: str };
  if (/^[A-Za-z0-9_-]{11}$/.test(str)) return { type: "video", id: str };
  return null;
}

function slugify(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "transcript";
}

function api(path) {
  return API_BASE ? `${API_BASE}${path}` : path;
}

let videos = [];

const urlInput     = document.getElementById("url-input");
const btnRun       = document.getElementById("btn-run");
const errorMsg     = document.getElementById("error-msg");
const progressSec  = document.getElementById("progress-section");
const progressFill = document.getElementById("progress-fill");
const progressLbl  = document.getElementById("progress-label");
const progressCnt  = document.getElementById("progress-count");
const downloadBar  = document.getElementById("download-bar");
const dlSummary    = document.getElementById("dl-summary");
const btnDlAll     = document.getElementById("btn-dl-all");
const videoList    = document.getElementById("video-list");
const emptyState   = document.getElementById("empty-state");

function renderVideos() {
  emptyState.hidden = videos.length > 0;
  videoList.innerHTML = "";
  videos.forEach((v, i) => {
    const card = document.createElement("div");
    card.className = `video-card ${v.transcript ? "success" : v.error ? "failed" : ""}`;
    const action = v.transcript
      ? `<button class="btn-dl-one" data-idx="${i}">↓ .txt</button>`
      : v.error
      ? `<span class="badge-nocaption">No captions</span>`
      : `<span class="badge-loading">⟳</span>`;
    card.innerHTML = `
      <span class="video-num">${i + 1}</span>
      <div class="video-info">
        <div class="video-title">${escHtml(v.title || v.videoId)}</div>
        <a class="video-url" href="https://youtube.com/watch?v=${v.videoId}" target="_blank" rel="noreferrer">
          youtu.be/${v.videoId}
        </a>
      </div>
      <div class="video-action">${action}</div>
    `;
    videoList.appendChild(card);
  });
}

function escHtml(str) {
  return str.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function setProgress(done, total) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  progressFill.style.width = `${pct}%`;
  progressLbl.textContent = "Fetching transcripts";
  progressCnt.textContent = `${done} / ${total}`;
}

function showDownloadBar() {
  const successful = videos.filter(v => v.transcript);
  const skipped = videos.length - successful.length;
  downloadBar.hidden = successful.length === 0;
  dlSummary.innerHTML = `<strong>${successful.length}</strong> transcript${successful.length !== 1 ? "s" : ""} ready${skipped ? ` <span>· ${skipped} skipped</span>` : ""}`;
}

function setError(msg) {
  if (msg) {
    errorMsg.textContent = msg;
    errorMsg.hidden = false;
  } else {
    errorMsg.hidden = true;
  }
}

function downloadTxt(text, filename) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

btnDlAll.addEventListener("click", () => {
  const successful = videos.filter(v => v.transcript);
  const text = successful.map(v =>
    `${"=".repeat(60)}\n${v.title || v.videoId}\nhttps://youtube.com/watch?v=${v.videoId}\n${"=".repeat(60)}\n\n${v.transcript}`
  ).join("\n\n\n");
  downloadTxt(text, "transcripts.txt");
});

videoList.addEventListener("click", e => {
  const btn = e.target.closest(".btn-dl-one");
  if (!btn) return;
  const v = videos[parseInt(btn.dataset.idx, 10)];
  if (!v?.transcript) return;
  downloadTxt(`${v.title || v.videoId}\nhttps://youtube.com/watch?v=${v.videoId}\n\n${v.transcript}`, `${slugify(v.title || v.videoId)}.txt`);
});

async function run() {
  const raw = urlInput.value;
  const parsed = parseYouTubeInput(raw);
  if (!parsed) {
    setError("Paste a YouTube playlist URL, video URL, or ID.");
    return;
  }

  setError("");
  videos = [];
  renderVideos();
  downloadBar.hidden = true;
  progressSec.hidden = false;
  btnRun.disabled = true;
  urlInput.disabled = true;
  setProgress(0, 1);

  try {
    const listParam = parsed.type === "playlist"
      ? `playlistId=${parsed.id}`
      : `videoId=${parsed.id}`;
    const listRes = await fetch(api(`/api/playlist?${listParam}`));
    const listData = await listRes.json();
    if (!listRes.ok) throw new Error(listData.error || "Failed to load playlist");

    const items = listData.videos;
    setProgress(0, items.length);

    for (let i = 0; i < items.length; i++) {
      const { videoId, title: knownTitle } = items[i];
      try {
        const tRes = await fetch(api(`/api/transcript?videoId=${videoId}`));
        const tData = await tRes.json();
        videos.push({
          videoId,
          title: tData.title || knownTitle || videoId,
          transcript: tData.transcript || null,
          error: tData.error || null,
        });
      } catch (_) {
        videos.push({ videoId, title: knownTitle || videoId, transcript: null, error: "Network error" });
      }
      setProgress(i + 1, items.length);
      renderVideos();
    }

    showDownloadBar();
    progressSec.hidden = true;
  } catch (err) {
    setError(err.message);
    progressSec.hidden = true;
  } finally {
    btnRun.disabled = false;
    urlInput.disabled = false;
  }
}

btnRun.addEventListener("click", run);
urlInput.addEventListener("keydown", e => { if (e.key === "Enter" && !btnRun.disabled) run(); });
