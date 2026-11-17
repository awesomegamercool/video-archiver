import {
  ArchiveWorkflow,
} from "./archive-workflow.js";


const enc =
  new TextEncoder();


function html(
  body,
  status = 200,
  headers = {}
) {
  return new Response(
    body,
    {
      status,

      headers: {
        "content-type":
          "text/html; charset=UTF-8",

        "cache-control":
          "no-store",

        ...headers,
      },
    }
  );
}


function b64url(bytes) {
  let s = "";

  for (
    const b of bytes
  ) {
    s += String.fromCharCode(b);
  }

  return btoa(s)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}


async function hmac(
  secret,
  value
) {
  const key =
    await crypto.subtle.importKey(
      "raw",

      enc.encode(secret),

      {
        name: "HMAC",
        hash: "SHA-256",
      },

      false,

      ["sign"]
    );

  return b64url(
    new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        key,
        enc.encode(value)
      )
    )
  );
}


async function validSession(
  request,
  env
) {
  const cookie =
    request.headers.get("Cookie") ||
    "";

  const match =
    cookie.match(
      /(?:^|;\s*)archive_session=([^;]+)/
    );

  if (!match) {
    return false;
  }

  const parts =
    decodeURIComponent(
      match[1]
    ).split(".");

  const expiry =
    parts[0];

  const signature =
    parts[1];

  if (
    !expiry ||
    !signature ||
    Number(expiry) < Date.now()
  ) {
    return false;
  }

  const expected =
    await hmac(
      env.SESSION_SECRET,
      expiry
    );

  return (
    signature === expected
  );
}


function loginPage(
  error = ""
) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign in · Private Archive</title>

<style>
  :root {
    color-scheme: dark;
    --bg: #0a0a0b;
    --bg-elevated: #111113;
    --border: #1f1f23;
    --border-strong: #2a2a30;
    --text: #ededef;
    --text-muted: #8b8b93;
    --text-subtle: #5c5c63;
    --accent: #6e8efb;
    --accent-hover: #7f9dff;
    --danger: #f87171;
    --radius: 8px;
    --font-sans: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif;
    --font-mono: "SF Mono", "JetBrains Mono", "Fira Code", ui-monospace, Menlo, Monaco, monospace;
  }

  * { box-sizing: border-box; }

  html, body {
    margin: 0;
    padding: 0;
    height: 100%;
  }

  body {
    font-family: var(--font-sans);
    background: var(--bg);
    color: var(--text);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    font-size: 14px;
    line-height: 1.5;
  }

  .login-shell {
    width: 100%;
    max-width: 360px;
  }

  .login-mark {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 28px;
  }

  .login-mark-symbol {
    width: 28px;
    height: 28px;
    border-radius: 7px;
    background: var(--bg-elevated);
    border: 1px solid var(--border-strong);
    display: grid;
    place-items: center;
    font-family: var(--font-mono);
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
  }

  .login-mark-text {
    font-size: 13px;
    color: var(--text-muted);
    letter-spacing: 0.01em;
  }

  h1 {
    margin: 0 0 6px;
    font-size: 20px;
    font-weight: 600;
    letter-spacing: -0.02em;
    color: var(--text);
  }

  .subtitle {
    margin: 0 0 24px;
    font-size: 13px;
    color: var(--text-muted);
  }

  .error-banner {
    margin: 0 0 16px;
    padding: 10px 12px;
    font-size: 13px;
    color: var(--danger);
    background: rgba(248, 113, 113, 0.06);
    border: 1px solid rgba(248, 113, 113, 0.2);
    border-radius: var(--radius);
    font-family: var(--font-mono);
  }

  form {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  label {
    display: block;
    font-size: 12px;
    font-weight: 500;
    color: var(--text-muted);
    margin-bottom: 6px;
    letter-spacing: 0.01em;
  }

  input {
    width: 100%;
    padding: 9px 12px;
    font-family: var(--font-sans);
    font-size: 14px;
    color: var(--text);
    background: var(--bg-elevated);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    outline: none;
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
  }

  input::placeholder {
    color: var(--text-subtle);
  }

  input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px rgba(110, 142, 251, 0.12);
  }

  button {
    margin-top: 4px;
    width: 100%;
    padding: 9px 14px;
    font-family: var(--font-sans);
    font-size: 13px;
    font-weight: 500;
    color: #fff;
    background: var(--accent);
    border: 1px solid var(--accent);
    border-radius: var(--radius);
    cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease;
  }

  button:hover {
    background: var(--accent-hover);
    border-color: var(--accent-hover);
  }

  button:active {
    transform: translateY(0.5px);
  }
</style>

</head>
<body>

<div class="login-shell">

  <div class="login-mark">
    <div class="login-mark-symbol">T</div>
    <div class="login-mark-text">Private Archive</div>
  </div>

  <h1>Sign in</h1>
  <p class="subtitle">Access your personal media archive.</p>

  ${
    error
      ? `<div class="error-banner">${error}</div>`
      : ""
  }

  <form method="post" action="/login">
    <div>
      <label for="password">Password</label>
      <input
        id="password"
        name="password"
        type="password"
        placeholder="Enter your password"
        autofocus
        required
      >
    </div>
    <button type="submit">Continue</button>
  </form>

</div>

</body>
</html>`;
}


function galleryPage(items) {
  const media = items.filter((x) =>
    x.key.startsWith("media/")
  );

  const videos = media.filter((x) => {
    const ext = x.key
      .split(".")
      .pop()
      .toLowerCase();

    return ["mp4", "webm", "mov"].includes(ext);
  });

  const photos = media.filter((x) => {
    const ext = x.key
      .split(".")
      .pop()
      .toLowerCase();

    return ["jpg", "jpeg", "png", "webp", "gif"].includes(ext);
  });

  const totalBytes = media.reduce(
    (sum, x) => sum + (x.size || 0),
    0
  );

  const formatBytes = (bytes) => {
    if (!bytes) return "0 B";

    const units = [
      "B",
      "KB",
      "MB",
      "GB",
      "TB",
    ];

    let value = bytes;
    let unit = 0;

    while (
      value >= 1024 &&
      unit < units.length - 1
    ) {
      value /= 1024;
      unit++;
    }

    return `${value.toFixed(
      unit === 0 ? 0 : 1
    )} ${units[unit]}`;
  };

  const formatDate = (date) => {
    if (!date) return "Unknown";

    return new Intl.DateTimeFormat(
      "en-CA",
      {
        dateStyle: "medium",
        timeStyle: "short",
      }
    ).format(new Date(date));
  };

  const getFileName = (key) =>
    key.split("/").pop();

  const getExtension = (key) =>
    getFileName(key)
      .split(".")
      .pop()
      .toLowerCase();

  const getPostId = (key) => {
    const parts = key.split("/");

    if (parts.length < 2) {
      return "Unknown";
    }

    return parts[1].replace(/\.[^.]+$/, "");
  };

  const getPostDate = (postId) => {
    try {
      const timestamp =
        Number(BigInt(postId) >> 32n);

      if (
        !Number.isFinite(timestamp) ||
        timestamp <= 0
      ) {
        return null;
      }

      return new Date(timestamp * 1000);
    } catch {
      return null;
    }
  };

  const videoCards = videos.map((x) => {
    const name = getFileName(x.key);
    const postId = getPostId(x.key);

    return `
      <article
        class="media-card"
        data-uploaded="${getPostDate(postId)?.getTime() || 0}"
        data-archived="${new Date(x.uploaded).getTime() || 0}"
        data-size="${x.size || 0}"
      >
        <div class="media-preview">
          <video
            controls
            preload="metadata"
            src="/file/${encodeURIComponent(x.key)}"
          ></video>
        </div>

        <div class="media-info">
          <div class="media-type">
            VIDEO
          </div>

          <div class="media-title">
            ${name}
          </div>

          <div class="media-details">
            <span>
              ${formatBytes(x.size)}
            </span>

            <span>
              ${formatDate(x.uploaded)}
            </span>
          </div>

          <div class="media-id">
            ID: ${postId}
          </div>
        </div>
      </article>
    `;
  }).join("");

  const photoGroups = new Map();

  for (const x of photos) {
    const postId = getPostId(x.key);

    if (!photoGroups.has(postId)) {
      photoGroups.set(postId, []);
    }

    photoGroups.get(postId).push(x);
  }

  const photoCards = Array.from(
    photoGroups.entries()
  ).map(([postId, group]) => {
    const totalPhotoBytes = group.reduce(
      (sum, x) => sum + (x.size || 0),
      0
    );

    const photoSlides = group.map(
      (photo, index) => `
        <div
          class="photo-slide"
          data-index="${index}"
        >
          <img
            src="/file/${encodeURIComponent(photo.key)}"
            loading="lazy"
          >
        </div>
      `
    ).join("");

    const photoDots = group.length > 1
      ? `
        <div class="photo-dots">
          ${group.map(
            (_, index) => `
              <span
                class="photo-dot ${
                  index === 0 ? "active" : ""
                }"
                data-index="${index}"
              ></span>
            `
          ).join("")}
        </div>
      `
      : "";

    const photoControls = group.length > 1
      ? `
        <button
          class="photo-arrow photo-prev"
          type="button"
          aria-label="Previous photo"
        >
          ‹
        </button>

        <button
          class="photo-arrow photo-next"
          type="button"
          aria-label="Next photo"
        >
          ›
        </button>
      `
      : "";

    return `
          <article
            class="media-card"
            data-uploaded="${getPostDate(postId)?.getTime() || 0}"
            data-archived="${
              new Date(
                group.reduce(
                  (latest, photo) =>
                    new Date(photo.uploaded) >
                    new Date(latest)
                      ? photo.uploaded
                      : latest,
                  group[0].uploaded
                )
              ).getTime() || 0
            }"
            data-size="${totalPhotoBytes}"
          >

        <div
          class="media-preview photo-preview"
          data-photo-gallery
        >

          <div class="photo-track">
            ${photoSlides}
          </div>

          ${photoControls}
          ${photoDots}

          ${
            group.length > 1
              ? `
                <div class="photo-count">
                  1 / ${group.length}
                </div>
              `
              : ""
          }

        </div>

        <div class="media-info">

          <div class="media-type photo-type">
            PHOTO POST
          </div>

          <div class="media-title">
            ${group.length}
            ${group.length === 1 ? "photo" : "photos"}
          </div>

          <div class="media-details">

            <span>
              ${formatBytes(totalPhotoBytes)}
            </span>

            <span>
              ${formatDate(group[0].uploaded)}
            </span>

          </div>

          <div class="media-id">
            ID: ${postId}
          </div>

        </div>

      </article>
    `;
  }).join("");

  const posts = [
    ...videos.map((video) => ({
      id: getPostId(video.key),
      type: "video",
      files: [video],
      size: video.size || 0,
      archived: video.uploaded,
    })),

    ...Array.from(
      photoGroups.entries()
    ).map(([postId, group]) => ({
      id: postId,
      type: "photo",
      files: group,
      size: group.reduce(
        (sum, photo) =>
          sum + (photo.size || 0),
        0
      ),
      archived: group.reduce(
        (latest, photo) =>
          new Date(photo.uploaded) >
          new Date(latest)
            ? photo.uploaded
            : latest,
        group[0].uploaded
      ),
    })),
  ];

  const latestUpload =
    media.length > 0
      ? media.reduce(
          (latest, current) =>
            new Date(current.uploaded) >
            new Date(latest.uploaded)
              ? current
              : latest
        ).uploaded
      : null;

  const oldestUpload =
    media.length > 0
      ? media.reduce(
          (oldest, current) =>
            new Date(current.uploaded) <
            new Date(oldest.uploaded)
              ? current
              : oldest
        ).uploaded
      : null;

  const uniquePosts = new Set(
    media.map((x) =>
      getPostId(x.key)
    )
  ).size;

  return `<!doctype html>
<html lang="en">
<head>

<meta charset="utf-8">
<meta
  name="viewport"
  content="width=device-width,initial-scale=1"
>

<title>TikTok Archive</title>

<style>

:root {
  color-scheme: dark;

  --bg: #0a0a0b;
  --bg-elevated: #111113;
  --bg-hover: #16161a;
  --border: #1f1f23;
  --border-strong: #2a2a30;
  --border-hover: #3a3a42;

  --text: #ededef;
  --text-muted: #8b8b93;
  --text-subtle: #5c5c63;

  --accent: #6e8efb;
  --accent-muted: rgba(110, 142, 251, 0.1);
  --success: #4ade80;
  --success-muted: rgba(74, 222, 128, 0.1);

  --radius: 8px;
  --radius-lg: 10px;

  --font-sans: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif;
  --font-mono: "SF Mono", "JetBrains Mono", "Fira Code", ui-monospace, Menlo, Monaco, monospace;
}

* {
  box-sizing: border-box;
}

html, body {
  margin: 0;
  padding: 0;
}

body {
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 1.5;
  color: var(--text);
  background: var(--bg);
  min-height: 100vh;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

/* ---------- Header ---------- */

header {
  position: sticky;
  top: 0;
  z-index: 10;

  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);

  background: rgba(10, 10, 11, 0.75);

  border-bottom: 1px solid var(--border);

  padding: 0 24px;
}

.header-inner {
  max-width: 1280px;
  margin: 0 auto;

  height: 56px;

  display: flex;
  align-items: center;
  justify-content: space-between;

  gap: 20px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
}

.brand-icon {
  width: 28px;
  height: 28px;

  display: grid;
  place-items: center;

  border-radius: 7px;

  background: var(--bg-elevated);
  border: 1px solid var(--border-strong);

  color: var(--text);
  font-family: var(--font-mono);
  font-weight: 600;
  font-size: 13px;
}

.brand-text strong {
  display: block;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--text);
}

.brand-text span {
  display: block;
  margin-top: 1px;

  color: var(--text-subtle);
  font-size: 11px;
  letter-spacing: 0.01em;
}

/* ---------- Layout ---------- */

main {
  max-width: 1280px;
  margin: 0 auto;
  padding: 32px 24px 64px;
}

/* ---------- Hero ---------- */

.hero {
  margin-bottom: 28px;
}

.hero h1 {
  margin: 0;
  font-size: 22px;
  font-weight: 600;
  letter-spacing: -0.02em;
  color: var(--text);
}

.hero p {
  margin: 4px 0 0;
  color: var(--text-muted);
  font-size: 13px;
}

.status {
  display: inline-flex;
  align-items: center;
  gap: 7px;

  margin-top: 14px;

  padding: 4px 10px;

  border-radius: 999px;

  background: var(--success-muted);

  border: 1px solid rgba(74, 222, 128, 0.18);

  color: var(--success);

  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 500;
}

.status-dot {
  width: 6px;
  height: 6px;

  border-radius: 50%;

  background: var(--success);
}

/* ---------- Stats ---------- */

.stats {
  display: grid;

  grid-template-columns:
    repeat(auto-fit, minmax(160px, 1fr));

  gap: 1px;

  margin-bottom: 36px;

  background: var(--border);

  border: 1px solid var(--border);
  border-radius: var(--radius-lg);

  overflow: hidden;
}

.stat {
  padding: 16px 18px;

  background: var(--bg-elevated);
}

.stat-label {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.stat-value {
  margin-top: 6px;

  font-size: 22px;
  font-weight: 600;

  letter-spacing: -0.02em;
  color: var(--text);

  font-variant-numeric: tabular-nums;
}

.stat-sub {
  margin-top: 2px;

  color: var(--text-subtle);

  font-size: 11px;
}

/* ---------- Section header ---------- */

.section-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;

  gap: 20px;

  margin-bottom: 16px;
}

.section-header h2 {
  margin: 0;

  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.section-header span {
  color: var(--text-subtle);
  font-family: var(--font-mono);
  font-size: 11px;
}

/* ---------- Sort controls ---------- */

.sort-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 20px;
}

.sort-controls select,
.sort-controls button {
  padding: 7px 11px;

  border: 1px solid var(--border-strong);
  border-radius: var(--radius);

  background: var(--bg-elevated);
  color: var(--text);

  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: 500;

  cursor: pointer;

  transition:
    background 0.15s ease,
    border-color 0.15s ease;
}

.sort-controls select {
  min-width: 150px;
}

.sort-controls select:focus,
.sort-controls button:focus {
  outline: none;
  border-color: var(--accent);
}

.sort-controls button:hover,
.sort-controls select:hover {
  border-color: var(--border-hover);
  background: var(--bg-hover);
}

/* ---------- Grid ---------- */

.grid {
  display: grid;

  grid-template-columns:
    repeat(auto-fill, minmax(220px, 1fr));

  gap: 14px;
}

/* ---------- Media card ---------- */

.media-card {
  overflow: hidden;

  border: 1px solid var(--border);
  border-radius: var(--radius-lg);

  background: var(--bg-elevated);

  transition:
    border-color 0.15s ease;

  min-width: 0;
}

.media-card:hover {
  border-color: var(--border-hover);
}

.media-preview {
  background: #000;

  aspect-ratio: 9 / 16;

  overflow: hidden;
}

.media-preview video,
.media-preview img {
  display: block;

  width: 100%;
  height: 100%;

  object-fit: cover;
}

.photo-preview img {
  object-fit: contain;
}

.photo-preview {
  position: relative;
}

.photo-track {
  display: flex;
  width: 100%;
  height: 100%;
  transition: transform 0.22s ease;
}

.photo-slide {
  flex: 0 0 100%;
  width: 100%;
  height: 100%;
}

.photo-slide img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.photo-arrow {
  position: absolute;

  top: 50%;
  transform: translateY(-50%);

  width: 28px;
  height: 28px;

  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 50%;

  background: rgba(0, 0, 0, 0.6);
  color: white;

  font-size: 20px;
  line-height: 1;

  display: grid;
  place-items: center;

  cursor: pointer;

  z-index: 2;

  padding: 0;

  transition:
    background 0.15s ease,
    border-color 0.15s ease;
}

.photo-arrow:hover {
  background: rgba(0, 0, 0, 0.85);
  border-color: rgba(255, 255, 255, 0.2);
}

.photo-prev {
  left: 8px;
}

.photo-next {
  right: 8px;
}

.photo-dots {
  position: absolute;

  bottom: 8px;
  left: 50%;

  transform: translateX(-50%);

  display: flex;
  gap: 4px;

  padding: 4px 6px;

  border-radius: 999px;

  background: rgba(0, 0, 0, 0.5);

  z-index: 2;
}

.photo-dot {
  width: 5px;
  height: 5px;

  border-radius: 50%;

  background: rgba(255, 255, 255, 0.35);
}

.photo-dot.active {
  background: #fff;
}

.photo-count {
  position: absolute;

  top: 8px;
  right: 8px;

  padding: 2px 7px;

  border-radius: 999px;

  background: rgba(0, 0, 0, 0.6);

  color: white;

  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 500;

  z-index: 2;
}

.media-info {
  padding: 12px 14px 14px;
}

.media-type {
  color: var(--accent);

  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;

  letter-spacing: 0.06em;
}

.photo-type {
  color: #f472b6;
}

.media-title {
  margin-top: 6px;

  font-size: 13px;
  font-weight: 500;

  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.media-details {
  display: flex;
  justify-content: space-between;

  gap: 8px;

  margin-top: 6px;

  color: var(--text-muted);

  font-family: var(--font-mono);
  font-size: 11px;
}

.media-id {
  margin-top: 6px;

  color: var(--text-subtle);

  font-family: var(--font-mono);
  font-size: 10px;

  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ---------- Empty ---------- */

.empty {
  grid-column: 1 / -1;

  padding: 56px 20px;

  text-align: center;

  color: var(--text-subtle);

  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-lg);

  font-size: 13px;
}

/* ---------- Responsive ---------- */

@media (max-width: 720px) {
  header {
    padding: 0 16px;
  }

  main {
    padding: 24px 16px 48px;
  }

  .hero h1 {
    font-size: 20px;
  }

  .stats {
    grid-template-columns:
      repeat(auto-fit, minmax(130px, 1fr));
  }

  .stat {
    padding: 13px 14px;
  }

  .stat-value {
    font-size: 18px;
  }

  .grid {
    grid-template-columns:
      repeat(2, minmax(0, 1fr));

    gap: 10px;
  }

  .media-info {
    padding: 10px 11px 12px;
  }

  .media-details {
    display: block;
  }

  .media-details span {
    display: block;
    margin-top: 2px;
  }

  .sort-controls {
    gap: 6px;
    flex-wrap: wrap;
  }

  .sort-controls select,
  .sort-controls button {
    padding: 6px 9px;
    font-size: 11px;
  }
}

</style>

</head>

<body>

<header>

<div class="header-inner">

<div class="brand">

<div class="brand-icon">
T
</div>

<div class="brand-text">

<strong>
TikTok Archive
</strong>

<span>
Private personal archive
</span>

</div>

</div>

</div>

</header>

<main>

<section class="hero">

<h1>
Archive
</h1>

<p>
Your archived TikTok posts and media.
</p>

<div class="status">

<span class="status-dot"></span>

Storage online

</div>

</section>

<section class="stats">

<div class="stat">

<div class="stat-label">
Posts
</div>

<div class="stat-value">
${uniquePosts}
</div>

<div class="stat-sub">
Unique TikTok IDs
</div>

</div>

<div class="stat">

<div class="stat-label">
Videos
</div>

<div class="stat-value">
${videos.length}
</div>

<div class="stat-sub">
Video files
</div>

</div>

<div class="stat">

<div class="stat-label">
Photos
</div>

<div class="stat-value">
${photos.length}
</div>

<div class="stat-sub">
Individual images
</div>

</div>

<div class="stat">

<div class="stat-label">
Files
</div>

<div class="stat-value">
${media.length}
</div>

<div class="stat-sub">
Stored in R2
</div>

</div>

<div class="stat">

<div class="stat-label">
Storage
</div>

<div class="stat-value">
${formatBytes(totalBytes)}
</div>

<div class="stat-sub">
Archive media
</div>

</div>

<div class="stat">

<div class="stat-label">
Latest
</div>

<div class="stat-value"
     style="font-size:13px;font-family:var(--font-mono);font-weight:500">

${formatDate(latestUpload)}

</div>

<div class="stat-sub">
Most recent upload
</div>

</div>

<div class="stat">

<div class="stat-label">
Oldest
</div>

<div class="stat-value"
     style="font-size:13px;font-family:var(--font-mono);font-weight:500">

${formatDate(oldestUpload)}

</div>

<div class="stat-sub">
First stored media
</div>

</div>

</section>

<section>

<div class="section-header">

<h2>
Media
</h2>

<span>
${media.length} files
</span>

</div>

<div class="sort-controls">

  <select id="sort-by">
    <option value="uploaded">
      Date uploaded
    </option>

    <option value="archived">
      Date archived
    </option>

    <option value="size">
      Size
    </option>
  </select>

  <button
    id="sort-direction"
    type="button"
    data-direction="descending"
  >
    Newest first ↓
  </button>

</div>

<div class="grid" id="media-grid">

${
  (videoCards + photoCards) ||
  `
    <div class="empty">
      No archived media yet.
    </div>
  `
}

</div>

</section>

</main>

<script>
  document.querySelectorAll("[data-photo-gallery]").forEach(
    (gallery) => {
      const track =
        gallery.querySelector(".photo-track");

      const slides =
        gallery.querySelectorAll(".photo-slide");

      const dots =
        gallery.querySelectorAll(".photo-dot");

      const count =
        gallery.querySelector(".photo-count");

      const previous =
        gallery.querySelector(".photo-prev");

      const next =
        gallery.querySelector(".photo-next");

      let current = 0;

      function showPhoto(index) {
        if (!slides.length) {
          return;
        }

        current =
          (index + slides.length) %
          slides.length;

        track.style.transform =
          "translateX(-" + (current * 100) + "%)";

        dots.forEach((dot, i) => {
          dot.classList.toggle(
            "active",
            i === current
          );
        });

        if (count) {
          count.textContent =
            (current + 1) + " / " + slides.length;
        }
      }

      if (previous) {
        previous.addEventListener(
          "click",
          () => showPhoto(current - 1)
        );
      }

      if (next) {
        next.addEventListener(
          "click",
          () => showPhoto(current + 1)
        );
      }

      dots.forEach((dot, index) => {
        dot.addEventListener(
          "click",
          () => showPhoto(index)
        );
      });

      showPhoto(0);
    }
  );

  const mediaGrid =
    document.getElementById("media-grid");

  const sortBy =
    document.getElementById("sort-by");

  const sortDirection =
    document.getElementById("sort-direction");

  let direction = "descending";

  function sortMedia() {
    const cards = Array.from(
      mediaGrid.querySelectorAll(".media-card")
    );

    const property = sortBy.value;

    cards.sort((a, b) => {
      const aValue =
        Number(a.dataset[property]) || 0;

      const bValue =
        Number(b.dataset[property]) || 0;

      return direction === "ascending"
        ? aValue - bValue
        : bValue - aValue;
    });

    cards.forEach((card) => {
      mediaGrid.appendChild(card);
    });

    if (property === "size") {
      sortDirection.textContent =
        direction === "ascending"
          ? "Smallest first ↑"
          : "Largest first ↓";
    } else if (property === "archived") {
      sortDirection.textContent =
        direction === "ascending"
          ? "Oldest archived ↑"
          : "Newest archived ↓";
    } else {
      sortDirection.textContent =
        direction === "ascending"
          ? "Oldest first ↑"
          : "Newest first ↓";
    }

    sortDirection.dataset.direction =
      direction;
  }

  sortBy.addEventListener(
    "change",
    sortMedia
  );

  sortDirection.addEventListener(
    "click",
    () => {
      direction =
        direction === "descending"
          ? "ascending"
          : "descending";

      sortMedia();
    }
  );

  sortMedia();
</script>

</body>

</html>`;
}


export default {

  async fetch(
    request,
    env
  ) {
    const url =
      new URL(request.url);


    /*
     * Login.
     */

    if (
      url.pathname === "/login" &&
      request.method === "GET"
    ) {
      return html(
        loginPage()
      );
    }


    if (
      url.pathname === "/login" &&
      request.method === "POST"
    ) {
      const form =
        await request.formData();

      if (
        form.get("password") !==
        env.ARCHIVE_PASSWORD
      ) {
        return html(
          loginPage(
            "Wrong password."
          ),
          401
        );
      }


      const expiry =
        String(
          Date.now() +
          30 *
          24 *
          60 *
          60 *
          1000
        );


      const sig =
        await hmac(
          env.SESSION_SECRET,
          expiry
        );


      return new Response(
        null,
        {
          status: 302,

          headers: {
            location: "/",

            "set-cookie":
              `archive_session=${expiry}.${sig}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=2592000`,
          },
        }
      );
    }


    /*
     * Protect everything else.
     */

    if (
      !(await validSession(
        request,
        env
      ))
    ) {
      return new Response(
        null,
        {
          status: 302,

          headers: {
            location:
              "/login",
          },
        }
      );
    }


    /*
     * Video streaming.
     */

    if (
      url.pathname.startsWith(
        "/file/"
      )
    ) {
      const key =
        decodeURIComponent(
          url.pathname.slice(
            "/file/".length
          )
        );


      if (
        !key.startsWith(
          "media/"
        )
      ) {
        return new Response(
          "Not found",
          { status: 404 }
        );
      }


      const obj =
        await env.ARCHIVE.get(
          key
        );


      if (!obj) {
        return new Response(
          "Not found",
          { status: 404 }
        );
      }


      const headers =
        new Headers();


      obj.writeHttpMetadata(
        headers
      );


      headers.set(
        "etag",
        obj.httpEtag
      );


      headers.set(
        "cache-control",
        "private, max-age=3600"
      );


      return new Response(
        obj.body,
        {
          headers,
        }
      );
    }


    /*
     * Gallery.
     */

    const listed =
      await env.ARCHIVE.list({
        prefix:
          "media/",
        limit:
          1000,
      });


    listed.objects.sort(
      (a, b) =>
        b.uploaded -
        a.uploaded
    );


    return html(
      galleryPage(
        listed.objects
      )
    );
  },

  async scheduled(event, env, ctx) {
    const response = await fetch(
      "https://api.github.com/repos/awesomegamercool/video-archiver/dispatches",
      {
        method: "POST",

        headers: {
          "Accept":
            "application/vnd.github+json",

          "Authorization":
            `Bearer ${env.GITHUB_TOKEN}`,

          "X-GitHub-Api-Version":
            "2026-03-10",

          "Content-Type":
            "application/json",

          "User-Agent":
            "tiktok-archive-worker",
        },

        body: JSON.stringify({
          event_type:
            "archive_tiktok",
        }),
      }
    );


    if (!response.ok) {
      const text =
        await response.text();

      throw new Error(
        `GitHub dispatch failed: ${response.status} ${text}`
      );
    }


    console.log(
      "GitHub archive workflow dispatched."
    );
  },
};


/*
 * Cloudflare Workflow export.
 *
 * This is intentionally exported from
 * the same Worker bundle.
 */

export {
  ArchiveWorkflow,
};