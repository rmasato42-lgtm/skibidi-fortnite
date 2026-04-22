# Open Proxy

A lightweight web proxy built with Node.js + Express. Browse any site through your own server — bypasses local network filters.

---

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Run locally
```bash
npm start
# → http://localhost:3000
```

---

## Deploy (so it's accessible anywhere)

The proxy only works as a bypass if it runs on an **external server**, not your local machine.
Here are the easiest free/cheap options:

### Option A — Railway (easiest, free tier)
1. Push this folder to a GitHub repo
2. Go to https://railway.app → New Project → Deploy from GitHub
3. Select your repo — it auto-detects Node.js and deploys
4. You get a public URL like `https://your-app.up.railway.app`

### Option B — Render (free tier)
1. Push to GitHub
2. Go to https://render.com → New → Web Service
3. Connect repo, set:
   - **Build command:** `npm install`
   - **Start command:** `node server.js`
4. Deploy → get a public `.onrender.com` URL

### Option C — VPS (DigitalOcean, Vultr, etc. ~$4-6/mo)
```bash
# On the server:
git clone <your-repo>
cd proxy
npm install
# Use PM2 to keep it running:
npm install -g pm2
pm2 start server.js --name proxy
pm2 save
```
Then point a domain (or use the server IP) to port 3000, and set up nginx as a reverse proxy.

---

## How it works

1. User visits your deployed URL
2. Enters a target URL (e.g. `https://reddit.com`)
3. The server fetches that page **from its own network** (not the user's)
4. HTML is rewritten so all links route through `/proxy?url=...`
5. The page is returned to the user — the local network only sees traffic to *your* server

## Notes
- JavaScript-heavy SPAs (React, etc.) may not render perfectly — the proxy rewrites static HTML but can't fully intercept client-side JS routing
- YouTube video playback won't work (uses complex streaming + DRM)
- HTTPS on your server is strongly recommended — use Cloudflare or Let's Encrypt
