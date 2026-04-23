const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

function normalizeUrl(raw) {
  if (!raw) return null;
  raw = raw.trim();
  if (!/^https?:\/\//i.test(raw)) raw = "https://" + raw;
  return raw;
}

function rewriteUrl(val, base) {
  if (!val) return val;
  const skip = ["data:", "javascript:", "mailto:", "tel:", "blob:", "about:", "chrome:"];
  if (val.startsWith("#") || skip.some(p => val.startsWith(p))) return val;
  if (val.startsWith("/proxy?url=")) return val;
  try {
    const absolute = new URL(val, base).href;
    if (!absolute.startsWith("http")) return val;
    return `/proxy?url=${encodeURIComponent(absolute)}`;
  } catch {
    return val;
  }
}

app.get("/proxy", async (req, res) => {
  let targetUrl = req.query.url;
  if (!targetUrl) return res.redirect("/");

  targetUrl = normalizeUrl(targetUrl);
  if (!targetUrl) return res.redirect("/");

  let parsedTarget;
  try {
    parsedTarget = new URL(targetUrl);
  } catch {
    return res.status(400).send("Invalid URL");
  }

  try {
    const response = await axios.get(targetUrl, {
      responseType: "arraybuffer",
      timeout: 20000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        Referer: parsedTarget.origin,
      },
      maxRedirects: 10,
    });

    const contentType = response.headers["content-type"] || "";

    if (!contentType.includes("text/html")) {
      res.set("Content-Type", contentType);
      res.removeHeader("X-Frame-Options");
      res.removeHeader("Content-Security-Policy");
      return res.send(response.data);
    }

    const html = response.data.toString("utf-8");
    const $ = cheerio.load(html);

    // Rewrite static attributes
    $("a[href]").each((_, el) => {
      $(el).attr("href", rewriteUrl($(el).attr("href"), targetUrl));
    });
    $("img[src], script[src], source[src], video[src], audio[src], track[src]").each((_, el) => {
      const src = $(el).attr("src");
      if (src) $(el).attr("src", rewriteUrl(src, targetUrl));
    });
    $("link[href]").each((_, el) => {
      $(el).attr("href", rewriteUrl($(el).attr("href"), targetUrl));
    });
    $("form[action]").each((_, el) => {
      $(el).attr("action", rewriteUrl($(el).attr("action"), targetUrl));
    });
    $("[srcset]").each((_, el) => {
      const srcset = $(el).attr("srcset");
      if (!srcset) return;
      const rewritten = srcset.split(",").map(part => {
        const [u, ...rest] = part.trim().split(/\s+/);
        return [rewriteUrl(u, targetUrl), ...rest].join(" ");
      }).join(", ");
      $(el).attr("srcset", rewritten);
    });

    // Remove security meta tags
    $('meta[http-equiv="Content-Security-Policy"]').remove();
    $('meta[http-equiv="X-Frame-Options"]').remove();

    // Dark mode injection
    $("head").prepend(`
      <meta name="color-scheme" content="dark">
      <style>
        :root { color-scheme: dark !important; }
        html { color-scheme: dark !important; }
      </style>
    `);

    // Runtime JS injection — link interceptor + proxy bar
    const escapedUrl = JSON.stringify(targetUrl);
    const escapedOrigin = JSON.stringify(parsedTarget.origin);

    $("body").append(`
<script>
(function() {
  'use strict';
  var BASE = ${escapedUrl};

  function proxyHref(href) {
    if (!href) return null;
    if (href.startsWith('#') || href.startsWith('javascript:') ||
        href.startsWith('mailto:') || href.startsWith('data:') ||
        href.startsWith('blob:') || href.startsWith('/proxy?url=')) return null;
    try {
      var abs = new URL(href, BASE).href;
      if (!abs.startsWith('http')) return null;
      return '/proxy?url=' + encodeURIComponent(abs);
    } catch(e) { return null; }
  }

  // Global click interceptor — catches dynamically added links
  document.addEventListener('click', function(e) {
    var link = e.target.closest('a[href]');
    if (!link) return;
    var href = link.getAttribute('href');
    var p = proxyHref(href);
    if (p) { e.preventDefault(); e.stopPropagation(); location.href = p; }
  }, true);

  // Intercept window.open
  var origOpen = window.open;
  window.open = function(url, target, features) {
    if (url) { var p = proxyHref(url); if (p) { location.href = p; return null; } }
    return origOpen.call(window, url, target, features);
  };

  // Intercept location.assign / replace
  try {
    var origAssign = location.assign.bind(location);
    var origReplace = location.replace.bind(location);
    Location.prototype.assign = function(u) { var p=proxyHref(u); p?origAssign(p):origAssign(u); };
    Location.prototype.replace = function(u) { var p=proxyHref(u); p?origReplace(p):origReplace(u); };
  } catch(e) {}

  // Intercept history navigation
  var origPush = history.pushState;
  var origRepl = history.replaceState;
  history.pushState = function(s,t,u) {
    if (u) { var p=proxyHref(String(u)); if(p){location.href=p;return;} }
    origPush.call(history,s,t,u);
  };
  history.replaceState = function(s,t,u) {
    if (u) { var p=proxyHref(String(u)); if(p){location.href=p;return;} }
    origRepl.call(history,s,t,u);
  };

  // ——— Tide proxy bar ———
  var style = document.createElement('style');
  style.textContent = [
    '#__tide-bar__{position:fixed;top:0;left:0;right:0;z-index:2147483647;',
    'background:rgba(10,7,20,0.95);backdrop-filter:blur(16px);',
    'border-bottom:1px solid rgba(124,58,237,0.35);',
    'transition:transform .22s cubic-bezier(.4,0,.2,1);}',
    '#__tide-bar__.collapsed{transform:translateY(-100%);}',
    '#__tide-inner__{display:flex;align-items:center;gap:8px;padding:7px 14px;}',
    '#__tide-logo__{display:flex;align-items:center;gap:7px;text-decoration:none;',
    'color:#a78bfa;font-family:Georgia,serif;font-style:italic;font-size:15px;',
    'white-space:nowrap;flex-shrink:0;}',
    '#__tide-input__{flex:1;padding:5px 10px;background:rgba(255,255,255,.05);',
    'border:1px solid rgba(124,58,237,.4);border-radius:6px;color:#e0e0f0;',
    'font-size:13px;outline:none;transition:border-color .15s;font-family:monospace;}',
    '#__tide-input__:focus{border-color:#a78bfa;}',
    '#__tide-go__{padding:5px 13px;background:#7c3aed;border:none;',
    'border-radius:6px;color:#fff;font-size:13px;font-weight:600;cursor:pointer;flex-shrink:0;}',
    '#__tide-go__:hover{background:#6d28d9;}',
    '#__tide-btn__{padding:5px 8px;background:rgba(255,255,255,.05);',
    'border:1px solid rgba(124,58,237,.3);border-radius:6px;',
    'color:#a78bfa;cursor:pointer;display:flex;align-items:center;flex-shrink:0;}',
    '#__tide-btn__:hover{background:rgba(124,58,237,.2);}',
    '#__tide-tab__{position:fixed;top:0;left:50%;transform:translateX(-50%);',
    'z-index:2147483647;background:rgba(10,7,20,.92);backdrop-filter:blur(8px);',
    'border:1px solid rgba(124,58,237,.4);border-top:none;border-radius:0 0 10px 10px;',
    'padding:4px 14px 5px;color:#a78bfa;font-family:Georgia,serif;font-style:italic;',
    'font-size:12px;cursor:pointer;align-items:center;gap:5px;display:none;}',
    '#__tide-tab__.show{display:flex;}',
    '#__tide-spacer__{height:42px;}',
  ].join('');
  document.head.appendChild(style);

  var bar = document.createElement('div');
  bar.id = '__tide-bar__';
  bar.innerHTML = '<div id="__tide-inner__">'
    + '<a href="/" id="__tide-logo__">'
    + '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">'
    + '<path d="M2 11C2 11 5.5 5 12 5C18.5 5 22 11 22 11" stroke="#a78bfa" stroke-width="2.5" stroke-linecap="round"/>'
    + '<path d="M2 16C2 16 5.5 10 12 10C18.5 10 22 16 22 16" stroke="#7c3aed" stroke-width="2" stroke-linecap="round" opacity="0.5"/>'
    + '<circle cx="12" cy="14" r="3.5" fill="#a78bfa"/>'
    + '</svg>tide</a>'
    + '<input id="__tide-input__" type="text" value="" spellcheck="false" />'
    + '<button id="__tide-go__">Go</button>'
    + '<button class="__tide-btn__" id="__tide-fs__" title="Fullscreen">'
    + '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>'
    + '</button>'
    + '<button class="__tide-btn__" id="__tide-hide__" title="Hide bar">'
    + '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="18 15 12 9 6 15"/></svg>'
    + '</button>'
    + '</div>';

  var tab = document.createElement('div');
  tab.id = '__tide-tab__';
  tab.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 11C2 11 5.5 5 12 5C18.5 5 22 11 22 11" stroke="#a78bfa" stroke-width="2.5" stroke-linecap="round"/><circle cx="12" cy="13" r="3" fill="#a78bfa"/></svg> tide';

  var spacer = document.createElement('div');
  spacer.id = '__tide-spacer__';

  document.body.prepend(spacer);
  document.body.prepend(bar);
  document.body.prepend(tab);

  // Set current URL in input
  document.getElementById('__tide-input__').value = BASE;

  // Style fix for buttons (inline style since class selector may conflict)
  document.querySelectorAll('.__tide-btn__').forEach(function(b) {
    b.style.cssText = 'padding:5px 8px;background:rgba(255,255,255,.05);border:1px solid rgba(124,58,237,.3);border-radius:6px;color:#a78bfa;cursor:pointer;display:flex;align-items:center;flex-shrink:0;';
  });

  document.getElementById('__tide-go__').onclick = function() {
    var val = document.getElementById('__tide-input__').value.trim();
    if (!val) return;
    if (!/^https?:\\/\\//i.test(val)) val = 'https://' + val;
    location.href = '/proxy?url=' + encodeURIComponent(val);
  };

  document.getElementById('__tide-input__').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') document.getElementById('__tide-go__').click();
  });

  document.getElementById('__tide-hide__').onclick = function() {
    bar.classList.add('collapsed');
    spacer.style.height = '0';
    tab.classList.add('show');
  };

  tab.onclick = function() {
    bar.classList.remove('collapsed');
    spacer.style.height = '42px';
    tab.classList.remove('show');
  };

  document.getElementById('__tide-fs__').onclick = function() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(function(){});
    } else {
      document.exitFullscreen();
    }
  };

})();
</script>
`);

    res.set("Content-Type", "text/html; charset=utf-8");
    res.removeHeader("X-Frame-Options");
    res.removeHeader("Content-Security-Policy");
    res.removeHeader("X-Content-Type-Options");
    res.send($.html());

  } catch (err) {
    const msg = err.response
      ? `Remote server returned ${err.response.status}`
      : err.message;
    res.status(502).send(`<!DOCTYPE html><html>
<head><title>Tide — Error</title>
<style>
  body{font-family:Georgia,serif;background:#0a0714;color:#e0e0f0;
       display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;}
  .box{text-align:center;padding:40px;}
  h2{color:#a78bfa;font-size:22px;margin-bottom:10px;}
  p{color:#777;margin-bottom:24px;font-size:14px;}
  a{color:#7c3aed;text-decoration:none;}
</style></head>
<body><div class="box">
  <h2>Could not load page</h2>
  <p>${msg}</p>
  <a href="/">← Back to Tide</a>
</div></body></html>`);
  }
});

app.listen(PORT, () => console.log(`Tide running → http://localhost:${PORT}`));
