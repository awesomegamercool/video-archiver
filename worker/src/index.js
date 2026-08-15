const enc = new TextEncoder();

function html(body, status = 200, headers = {}) {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=UTF-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

function b64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function hmac(secret, value) {
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(value))));
}

async function validSession(request, env) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(/(?:^|;\s*)archive_session=([^;]+)/);
  if (!match) return false;
  const [expiry, signature] = decodeURIComponent(match[1]).split(".");
  if (!expiry || !signature || Number(expiry) < Date.now()) return false;
  return signature === await hmac(env.SESSION_SECRET, expiry);
}

function loginPage(error = "") {
  return `<!doctype html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Private archive</title>
<style>
body{font-family:system-ui;max-width:420px;margin:12vh auto;padding:24px;background:#111;color:#eee}
input,button{width:100%;box-sizing:border-box;padding:12px;margin:8px 0;border-radius:10px;border:1px solid #444}
button{cursor:pointer}.err{color:#ff8a8a}
</style></head>
<body><h1>Private archive</h1>${error ? `<p class="err">${error}</p>` : ""}
<form method="post" action="/login"><input name="password" type="password" placeholder="Password" autofocus required>
<button>Sign in</button></form></body></html>`;
}

function galleryPage(items) {
  const cards = items.map(x => {
    const name = x.key.split("/").pop();
    const ext = name.split(".").pop().toLowerCase();
    if (!["mp4","webm","mov"].includes(ext)) return "";
    const base = name.replace(/\.[^.]+$/, "");
    return `<article><video controls preload="metadata" src="/file/${encodeURIComponent(x.key)}"></video>
<div>${base}</div></article>`;
  }).join("");
  return `<!doctype html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<title>TikTok archive</title>
<style>
body{font-family:system-ui;margin:0;background:#0d0d0d;color:#eee}
header{position:sticky;top:0;padding:16px 20px;background:#151515;border-bottom:1px solid #333}
main{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:16px;padding:16px}
article{background:#171717;border:1px solid #333;border-radius:14px;overflow:hidden}
video{display:block;width:100%;aspect-ratio:9/16;background:black}
article div{padding:10px;font-size:12px;word-break:break-all;color:#bbb}
</style></head><body><header><strong>Private TikTok Archive</strong></header>
<main>${cards || "<p>No archived videos yet.</p>"}</main></body></html>`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/login" && request.method === "GET") return html(loginPage());

    if (url.pathname === "/login" && request.method === "POST") {
      const form = await request.formData();
      if (form.get("password") !== env.ARCHIVE_PASSWORD) {
        return html(loginPage("Wrong password."), 401);
      }
      const expiry = String(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const sig = await hmac(env.SESSION_SECRET, expiry);
      return new Response(null, {
        status: 302,
        headers: {
          location: "/",
          "set-cookie": `archive_session=${expiry}.${sig}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=2592000`,
        },
      });
    }

    if (!(await validSession(request, env))) {
      return new Response(null, { status: 302, headers: { location: "/login" } });
    }

    if (url.pathname.startsWith("/file/")) {
      const key = decodeURIComponent(url.pathname.slice("/file/".length));
      if (!key.startsWith("media/")) return new Response("Not found", { status: 404 });
      const obj = await env.ARCHIVE.get(key);
      if (!obj) return new Response("Not found", { status: 404 });
      const headers = new Headers();
      obj.writeHttpMetadata(headers);
      headers.set("etag", obj.httpEtag);
      headers.set("cache-control", "private, max-age=3600");
      return new Response(obj.body, { headers });
    }

    const listed = await env.ARCHIVE.list({ prefix: "media/", limit: 1000 });
    listed.objects.sort((a, b) => b.uploaded - a.uploaded);
    return html(galleryPage(listed.objects));
  },
};
