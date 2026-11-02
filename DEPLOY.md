# Vercel Deployment Guide for Companion AI

## Overview

This guide walks you through deploying your existing Companion AI website on Vercel, so you can access it from your mobile browser even when your PC is turned off.

### What This Does

- **Preserves**: UI, character personalities, biography engine, conversation history, model selection, FreeLLMAPI integration, response stripping, all settings
- **Adapts**: Moves from a continuously-running local Node server to Vercel's serverless functions
- **Persists**: Conversation history and settings via Vercel KV (Redis) or local fallbacks
- **Keeps**: FreeLLMAPI credentials private via environment variables

---

## Step 1: Push to GitHub

### 1.1 Initialize a Git repo (if you haven't already)

```bash
cd "D:\03 - Projects\companion"
git init
git add -A
git commit -m "Initial companion AI - Vercel deployment ready"
```

### 1.2 Create a GitHub repo and push

1. Go to [github.com/new](https://github.com/new)
2. Create a new repo called `companion` (or your preferred name)
3. Follow the push instructions:

```bash
git remote add origin git@github.com:YOUR-USERNAME/companion.git
git branch -M main
git push -u origin main
```

---

## Step 2: Configure Vercel

### 2.1 Install the Vercel CLI (optional but helpful)

```bash
npm install -g vercel
```

### 2.2 Connect to Vercel

```bash
vercel login
```

### 2.3 Deploy

From your project folder:

```bash
vercel
```

Or simply connect your GitHub repo to Vercel at [vercel.com/import/github](https://vercel.com/import/github) and enable automatic deploys.

---

## Step 3: Set Environment Variables

In the Vercel dashboard, go to your project → **Settings → Variables**, and add these:

| Variable | Value | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Your FreeLLMAPI key (e.g. `freellmapi-xxx`) | The API key used by the companion to reach your proxy |
| `ANTHROPIC_BASE_URL` | `http://127.0.0.1:31415` | **Do not change this** — it points to your FreeLLMAPI proxy |
| `COMPANION_PORT` | `8787` (or any port) | Optional: port the server listens on |
| `COMPANION_BIND_HOST` | `0.0.0.0` | Optional: bind host for local network access |
| `COMPANION_ALLOW_LAN` | `1` | Optional: allow access from other devices on your network |

### Important: Keep Credentials Private

- The `ANTHROPIC_API_KEY` and `ANTHROPIC_BASE_URL` are sensitive. **Never** commit them to your repo.
- They are stored securely in Vercel's environment variable system.
- The companion reads them via `process.env.ANTHROPIC_API_KEY` and `process.env.ANTHROPIC_BASE_URL` at runtime.

---

## Step 4: Configure Build & Output

Your project has these files ready:

- `package.json` — Node.js >= 18, scripts: `test`, `test:all`
- `vercel.json` — Configures the serverless function and routes
- `api/index.js` — Vercel entry point that re-exports the companion handler
- `server.js` — The companion server (now exports a handler for Vercel)

### Build Settings (automatic, no custom build needed)

Vercel auto-detects Node.js projects. The `vercel.json` sets:

- `buildCommand: "echo 'No build step required'"` — we have no bundler
- `functions.api/index.js` — our serverless function
- Routes that map `/api/*` → the function and `/(.*)` → `public/$1` (static files)

---

## Step 5: Understanding the Architecture

### Before (Local Only)

```
Your PC (always on) ── node server.js ──► http://127.0.0.1:8787
                                    ▲
                                    │ FreeLLMAPI proxy at 127.0.0.1:31415
                                    └── conversation JSON files in data/
```

### After (Vercel)

```
Internet ──► Vercel Edge/Node ──► api/index.js (serverless function)
                                    │
                                    ├─ /api/* routes → companion's request handler
                                    ├─ / routes → public/ static files (index.html, app.js, styles.css)
                                    │
                                    ├─ Reads/writes Vercel KV (Redis) OR local data/ folder
                                    ├─ Reads ANTHROPIC_API_KEY + ANTHROPIC_BASE_URL from env
                                    └─ Calls FreeLLMAPI proxy at ANTHROPIC_BASE_URL
```

### Vercel Serverless Limitations (and how we handle them)

| Feature | Limitation | Our Adaptation |
|---|---|---|
| **Continuously running server** | Serverless functions sleep after inactivity | The companion starts quickly (< 2s cold start). First request may be slightly slower, but subsequent requests are fast. |
| **WebSockets** | Not natively supported in Vercel serverless | The companion never used WebSockets — all communication is HTTP POST/GET, which works fine. |
| **In-memory state** | Lost between invocations | We use Vercel KV (Redis) for conversations and settings. Falls back to `data/` JSON files on disk if KV is unavailable. |
| **localhost URLs** | Can't reach 127.0.0.1 from the internet | The companion now reads `ANTHROPIC_BASE_URL` from env vars instead of hardcoding `127.0.0.1:31415`. Set this in Vercel env. |
| **Local file persistence** | Vercel filesystem is ephemeral | Conversations and settings use KV. Local `data/` folder still works for local testing. |

---

## Step 6: Persistent Storage — Conversations & Settings

### Option A: Vercel KV (Recommended)

When you deploy to Vercel, if the `KV_URL` or `KV_REST_API_URL` environment variables are present, the companion automatically uses Vercel's managed Redis database. This gives you:

- ✅ Conversation history persists across deploys
- ✅ Settings persist across sessions  
- ✅ Works even when your PC is off
- ✅ Scales automatically

The `lib/storage.js` module handles the transition transparently.

### Option B: Local Fallback

If KV env vars are absent, the companion falls back to reading/writing JSON files in `data/`. This works for local testing (`node server.js`) but **does not persist** when your PC is off — Vercel's file system is temporary.

### How to Enable KV

1. Go to [vercel.com/integrations](https://vercel.com/integrations)
2. Enable **Vercel KV** (it's free for small projects)
3. Vercel automatically adds `KV_URL` and `KV_REST_API_URL` to your project
4. Redeploy

---

## Step 7: Run Available Tests

After deploying, verify these work:

### 7.1 Test the deployed site

Open your Vercel URL (e.g., `https://companion.vercel.app`) and check:

- [ ] Page loads at `https://your-url.vercel.app`
- [ ] Settings modal opens (gear icon or Ctrl+K)
- [ ] Model list loads from the FreeLLMAPI proxy
- [ ] You can send messages and get replies
- [ ] Model selection changes work
- [ ] Age/personality/flirting controls update the character

### 7.2 Run unit tests locally

```bash
cd "D:\03 - Projects\companion"
npm test      # runs test_strip.js — 18/18 passed
npm run test:all  # runs all integration tests
```

### 7.3 Verify specific features

- [ ] **Character persistence**: Change age/personality, start a new conversation, come back later — settings survive
- [ ] **Conversation history**: Start a chat, close the tab, reopen — conversation is still there
- [ ] **Model substitution**: The `routing` field in the meta shows `opaque`, `exact`, or `substituted`
- [ ] **Thinking stripping**: Model output has internal reasoning removed automatically

---

## Step 8: Going Daily from Mobile

### 8.1 Bookmark the URL

Once deployed, bookmark your Vercel URL on your mobile browser: `https://companion.vercel.app` (or your custom domain).

### 8.2 Use it anywhere

- On Wi-Fi: works immediately
- On cellular: may need to ensure your FreeLLMAPI proxy is accessible (some proxies require being on the same network; if so, set `COMPANION_ALLOW_LAN=1` and `COMPANION_BIND_HOST=0.0.0.0`)
- When your PC is off: the FreeLLMAPI proxy must be running somewhere accessible. If you host your proxy on a cloud service (AWS, GCP, etc.), point `ANTHROPIC_BASE_URL` to that URL instead of `127.0.0.1:31415`.

### 8.3 Recommended FreeLLMAPI proxy setups for always-on access

- **Anthropic's own API**: Replace `ANTHROPIC_BASE_URL` with `https://api.anthropic.com` and use an Anthropic API key
- **Self-hosted FreeLLMAPI**: Host it on a cloud VM (AWS EC2, Google Cloud, etc.) and set `ANTHROPIC_BASE_URL` to its public IP/hostname
- **A data center proxy**: If you have a always-on server, point the base URL there

---

## Step 9: Troubleshooting

### Common Issues

| Problem | Cause | Fix |
|---|---|---|
| "No API key configured" | `ANTHROPIC_API_KEY` not set in Vercel env | Add it in Vercel dashboard → Settings → Variables |
| "Cannot reach proxy" | `ANTHROPIC_BASE_URL` wrong or proxy offline | Set to your proxy's actual URL, ensure it's reachable |
| 500 errors on API calls | KV unavailable, fell back to local storage | For production, enable Vercel KV; or ensure `data/` folder is accessible |
| Conversations disappear after reload | Using local `data/` fallback, PC off | Enable Vercel KV for persistent storage |
| Slow first load | Serverless cold start | Normal — subsequent loads are < 500ms |
| LAN access not working | `allowLAN` not enabled | Set `COMPANION_ALLOW_LAN=1` in Vercel env |

### Debug Mode

Add `?showAll=true` to the URL to see all catalog models (including routers). The proxy may substitute different models; the UI shows the routing info.

---

## Step 10: Full File Summary

Here's what was changed/added for Vercel deployment:

| File | Purpose |
|---|---|
| `package.json` | Node.js project manifest, `test`/`test:all` scripts, `engines.node >= 18` |
| `vercel.json` | Serverless function config, routes, CORS headers, env vars |
| `api/index.js` | Vercel entry point — re-exports companion's request handler |
| `lib/storage.js` | Storage abstraction: Vercel KV when available, local files fallback |
| `server.js` | Modified to: use `storage.*` async functions, read env vars first (`ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`), export `handler` + `server` for Vercel, `startServer()` for local `node server.js` |

---

## Frequently Asked Questions

### Q: Do I need my PC to be on to use this?

**A:** No! Once deployed to Vercel, the companion runs in the cloud. Your PC can be completely off, and you can still chat from your mobile browser.

**Exception:** Your FreeLLMAPI proxy must also be accessible from the internet. If your proxy runs on your PC only, you'll need to either:
- Host your proxy on a cloud VM, or
- Use Anthropic's official API instead

### Q: Will my conversations and settings persist?

**A:** Yes, if you enable Vercel KV (see Step 6). Conversations and settings are stored in Redis and survive across sessions, deploys, and your PC being off.

### Q: Can I use my existing `data/settings.json` and conversation files?

**A:** Yes — they work for local testing with `node server.js`. After deploying to Vercel and enabling KV, the companion migrates to cloud storage. Your local files remain untouched; they're just not used by the live deployment.

### Q: What about the `auto:default` model?

**A:** It works the same way. The companion sends `model: auto:default` to the proxy, which routes to whichever model is available. The UI shows the routing info (`opaque` means it's a router slot, the real backend isn't reported).

### Q: Does streaming work?

**A:** The companion strips thinking blocks from replies, which works better with non-streaming responses. The FreeLLMAPI proxy currently sends replies as a single block after the model finishes, which is what the app expects and handles correctly.

---

## Final Checklist Before You Deploy

- [ ] Push code to GitHub
- [ ] Create Vercel project, connect GitHub repo
- [ ] Add `ANTHROPIC_API_KEY` and `ANTHROPIC_BASE_URL` to Vercel env vars
- [ ] Enable Vercel KV (for persistent conversations/settings)
- [ ] Redeploy
- [ ] Open your Vercel URL, test: config, models, sending messages
- [ ] Change age/personality, verify settings persist
- [ ] Start a conversation, close, reopen, verify history persists
- [ ] Bookmark the URL on your mobile browser
- [ ] Tell your friends! 🎉

---

**Need help?** If you run into issues, check the Vercel logs (`vercel logs`), verify your env vars are set correctly, and ensure your FreeLLMAPI proxy is running and reachable at the URL you configured.