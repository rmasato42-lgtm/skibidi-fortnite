const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const url = require("url");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve the frontend
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Proxy route — handles any URL passed as query param
// e.g. /proxy?url=https://example.com
app.get("/proxy", async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send("Missing ?url= parameter");

  let parsedTarget;
  try {
    parsedTarget = new URL(targetUrl);
  } catch {
    return res.status(400).send("Invalid URL");
  }

  try {
    const response = await axios.get(targetUrl, {
      responseType: "arraybuffer",
      timeout: 15000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        Referer: parsedTarget.origin,
      },
      maxRedirects: 10,
    });

    const contentType = response.headers["content-type"] || "";

    // For non-HTML content (images, CSS, JS, fonts, etc.) — stream through directly
    if (!contentType.includes("text/html")) {
      res.set("Content-Type", contentType);
      // Strip security headers that would block embedding
      res.removeHeader("X-Frame-Options");
      res.removeHeader("Content-Security-Policy");
      return res.send(response.data);
    }

    // HTML — rewrite links
    const html = response.data.toString("utf-8");
    const $ = cheerio.load(html);
    const base = parsedTarget.origin;

    const rewrite = (attrVal) => {
      if (!attrVal || attrVal.startsWith("data:") || attrVal.startsWith("javascript:") || attrVal.startsWith("#")) {
        return attrVal;
      }
      try {
        const absolute = new URL(attrVal, targetUrl).href;
        return `/proxy?url=${encodeURIComponent(absolute)}`;
      } catch {
        return attrVal;
      }
    };

    // Rewrite <a href>
    $("a[href]").each((_, el) => {
      $(el).attr("href", rewrite($(el).attr("href")));
    });

    // Rewrite <img src>, <script src>, <link href>, <source src>
    $("img[src], script[src], source[src]").each((_, el) => {
      $(el).attr("src", rewrite($(el).attr("src")));
    });

    $("link[href]").each((_, el) => {
      $(el).attr("href", rewrite($(el).attr("href")));
    });

    // Rewrite <form action>
    $("form[action]").each((_, el) => {
      $(el).attr("action", rewrite($(el).attr("action")));
    });

    // Inject a small helper bar at the top
    $("body").prepend(`
      <div id="__proxy-bar__" style="position:fixed;top:0;left:0;right:0;z-index:999999;background:#1a1a2e;color:#eee;padding:8px 16px;font-family:sans-serif;font-size:13px;display:flex;gap:10px;align-items:center;box-shadow:0 2px 8px rgba(0,0,0,.4)">
        <span style="font-weight:bold;color:#7c83ff">🔓 Proxy</span>
        <input id="__proxy-url__" value="${targetUrl}" style="flex:1;padding:4px 8px;border-radius:4px;border:1px solid #444;background:#0d0d1a;color:#eee;font-size:13px" />
        <button onclick="location.href='/proxy?url='+encodeURIComponent(document.getElementById('__proxy-url__').value)" style="padding:4px 12px;background:#7c83ff;border:none;border-radius:4px;color:#fff;cursor:pointer">Go</button>
        <a href="/" style="color:#aaa;text-decoration:none;font-size:12px">Home</a>
      </div>
      <div style="height:42px"></div>
    `);

    // Remove CSP and other restrictive meta tags
    $('meta[http-equiv="Content-Security-Policy"]').remove();
    $('meta[http-equiv="X-Frame-Options"]').remove();

    res.set("Content-Type", "text/html; charset=utf-8");
    res.removeHeader("X-Frame-Options");
    res.removeHeader("Content-Security-Policy");
    res.send($.html());
  } catch (err) {
    const msg = err.response
      ? `Remote server returned ${err.response.status}`
      : err.message;
    res.status(502).send(`
      <html><body style="font-family:sans-serif;padding:40px;background:#0d0d1a;color:#eee">
        <h2>⚠️ Proxy Error</h2>
        <p>${msg}</p>
        <a href="/" style="color:#7c83ff">← Back</a>
      </body></html>
    `);
  }
});

app.listen(PORT, () => {
  console.log(`Proxy running at http://localhost:${PORT}`);
});
