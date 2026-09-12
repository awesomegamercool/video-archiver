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
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Private archive</title>

<style>
body{
  font-family:system-ui;
  max-width:420px;
  margin:12vh auto;
  padding:24px;
  background:#111;
  color:#eee
}

input,button{
  width:100%;
  box-sizing:border-box;
  padding:12px;
  margin:8px 0;
  border-radius:10px;
  border:1px solid #444
}

button{
  cursor:pointer
}

.err{
  color:#ff8a8a
}
</style>

</head>

<body>

<h1>Private archive</h1>

${
  error
    ? `<p class="err">${error}</p>`
    : ""
}

<form method="post" action="/login">

<input
  name="password"
  type="password"
  placeholder="Password"
  autofocus
  required
>

<button>
  Sign in
</button>

</form>

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

    return parts.length >= 2
      ? parts[1]
      : "Unknown";
  };

  const videoCards = videos.map((x) => {
    const name = getFileName(x.key);
    const postId = getPostId(x.key);

    return `
      <article class="media-card">
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
      <article class="media-card">

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

  const cards =
    videoCards + photoCards;

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

<html>
<head>

<meta
  name="viewport"
  content="width=device-width,initial-scale=1"
>

<title>
TikTok Archive
</title>

<style>

:root {
  color-scheme: dark;
  font-family:
    Inter,
    ui-sans-serif,
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    sans-serif;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background:
    radial-gradient(
      circle at top,
      #202020 0,
      #0b0b0b 45%,
      #080808 100%
    );
  color: #f5f5f5;
  min-height: 100vh;
}

header {
  position: sticky;
  top: 0;
  z-index: 10;

  backdrop-filter: blur(18px);

  background:
    rgba(15, 15, 15, 0.82);

  border-bottom:
    1px solid rgba(255,255,255,0.08);

  padding: 18px 28px;
}

.header-inner {
  max-width: 1500px;
  margin: auto;

  display: flex;
  align-items: center;
  justify-content: space-between;

  gap: 20px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
}

.brand-icon {
  width: 40px;
  height: 40px;

  display: grid;
  place-items: center;

  border-radius: 12px;

  background:
    linear-gradient(
      135deg,
      #25f4ee,
      #fe2c55
    );

  color: white;
  font-weight: 900;
  font-size: 18px;
}

.brand-text strong {
  display: block;
  font-size: 16px;
}

.brand-text span {
  display: block;
  margin-top: 2px;

  color: #888;
  font-size: 12px;
}

main {
  max-width: 1500px;
  margin: auto;
  padding: 28px;
}

.hero {
  margin-bottom: 28px;
}

.hero h1 {
  margin: 0;
  font-size: 32px;
  letter-spacing: -1px;
}

.hero p {
  margin: 7px 0 0;
  color: #888;
}

.status {
  display: inline-flex;
  align-items: center;
  gap: 8px;

  margin-top: 14px;

  padding: 7px 11px;

  border-radius: 999px;

  background:
    rgba(50, 205, 100, 0.08);

  border:
    1px solid rgba(50, 205, 100, 0.2);

  color: #8df0aa;

  font-size: 12px;
}

.status-dot {
  width: 7px;
  height: 7px;

  border-radius: 50%;

  background: #55e87b;

  box-shadow:
    0 0 10px
    rgba(85, 232, 123, 0.7);
}

.stats {
  display: grid;

  grid-template-columns:
    repeat(
      auto-fit,
      minmax(170px, 1fr)
    );

  gap: 12px;

  margin-bottom: 34px;
}

.stat {
  padding: 18px;

  border:
    1px solid rgba(255,255,255,0.08);

  border-radius: 16px;

  background:
    rgba(255,255,255,0.035);

  box-shadow:
    0 10px 30px
    rgba(0,0,0,0.18);
}

.stat-label {
  color: #888;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: .7px;
}

.stat-value {
  margin-top: 8px;

  font-size: 25px;
  font-weight: 750;

  letter-spacing: -0.5px;
}

.stat-sub {
  margin-top: 4px;

  color: #666;

  font-size: 11px;
}

.section-header {
  display: flex;
  align-items: end;
  justify-content: space-between;

  gap: 20px;

  margin-bottom: 15px;
}

.section-header h2 {
  margin: 0;

  font-size: 20px;
}

.section-header span {
  color: #777;
  font-size: 12px;
}

.grid {
  display: grid;

  grid-template-columns:
    repeat(
      auto-fill,
      minmax(245px, 1fr)
    );

  gap: 16px;
}

.media-card {
  overflow: hidden;

  border:
    1px solid rgba(255,255,255,0.08);

  border-radius: 17px;

  background:
    rgba(255,255,255,0.035);

  box-shadow:
    0 12px 35px
    rgba(0,0,0,0.22);

  transition:
    transform .18s ease,
    border-color .18s ease;

  min-width: 0;
}

.media-card:hover {
  transform: translateY(-3px);

  border-color:
    rgba(255,255,255,0.16);
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
  transition: transform 0.25s ease;
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

  width: 34px;
  height: 34px;

  border: 0;
  border-radius: 50%;

  background: rgba(0, 0, 0, 0.65);
  color: white;

  font-size: 25px;
  line-height: 1;

  display: grid;
  place-items: center;

  cursor: pointer;

  z-index: 2;

  transition:
    background .15s ease,
    transform .15s ease;
}

.photo-arrow:hover {
  background: rgba(0, 0, 0, 0.85);
}

.photo-prev {
  left: 10px;
}

.photo-next {
  right: 10px;
}

.photo-dots {
  position: absolute;

  bottom: 10px;
  left: 50%;

  transform: translateX(-50%);

  display: flex;
  gap: 5px;

  padding: 5px 7px;

  border-radius: 999px;

  background: rgba(0, 0, 0, 0.5);

  z-index: 2;
}

.photo-dot {
  width: 6px;
  height: 6px;

  border-radius: 50%;

  background: rgba(255,255,255,0.45);
}

.photo-dot.active {
  background: white;
}

.photo-count {
  position: absolute;

  top: 10px;
  right: 10px;

  padding: 4px 8px;

  border-radius: 999px;

  background: rgba(0, 0, 0, 0.65);

  color: white;

  font-size: 11px;
  font-weight: 600;

  z-index: 2;
}

.media-info {
  padding: 13px 14px 15px;
}

.media-type {
  color: #25f4ee;

  font-size: 10px;
  font-weight: 800;

  letter-spacing: 1px;
}

.photo-type {
  color: #fe2c55;
}

.media-title {
  margin-top: 7px;

  font-size: 13px;

  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.media-details {
  display: flex;
  justify-content: space-between;

  gap: 8px;

  margin-top: 8px;

  color: #888;

  font-size: 11px;
}

.media-id {
  margin-top: 7px;

  color: #555;

  font-size: 10px;

  overflow: hidden;
  text-overflow: ellipsis;
}

.empty {
  padding: 60px 20px;

  text-align: center;

  color: #666;

  border:
    1px dashed #333;

  border-radius: 16px;
}

@media (max-width: 600px) {

  header {
    padding: 15px;
  }

  main {
    padding: 18px 14px;
  }

  .hero h1 {
    font-size: 27px;
  }

  .grid {
    grid-template-columns:
      repeat(2, minmax(0, 1fr));

    gap: 10px;
  }

  .media-card {
    border-radius: 13px;
  }

  .media-info {
    padding: 10px;
  }

  .media-details {
    display: block;
  }

  .media-details span {
    display: block;
    margin-top: 3px;
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
Archive Dashboard
</h1>

<p>
Your archived TikTok posts and media.
</p>

<div class="status">

<span class="status-dot"></span>

Archive storage online

</div>

</section>

<section class="stats">

<div class="stat">

<div class="stat-label">
Archived Posts
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
Total Files
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
Storage Used
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
Latest Archive
</div>

<div class="stat-value"
     style="font-size:16px">

${formatDate(latestUpload)}

</div>

<div class="stat-sub">
Most recently uploaded
</div>

</div>

<div class="stat">

<div class="stat-label">
First Archive
</div>

<div class="stat-value"
     style="font-size:16px">

${formatDate(oldestUpload)}

</div>

<div class="stat-sub">
Oldest stored media
</div>

</div>

</section>

<section>

<div class="section-header">

<h2>
Archived Media
</h2>

<span>
${media.length} files
</span>

</div>

<div class="grid">

${
  cards ||
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