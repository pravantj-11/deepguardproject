# DeepGuard Backend

A minimal, real backend matching exactly what the DeepGuard front-end calls today:

1. `POST /api/scan-frame` — proxies a video frame to Claude's vision API server-side (your Anthropic key never reaches the browser).
2. `POST /api/sessions` — writes a session record to a real, shared Postgres database.
3. `GET /api/sessions` — returns the audit trail.

## What this is NOT

- Not a trained deepfake-detection model. Detection accuracy is exactly what Claude's vision API already provides — this only moves the call server-side for security and adds shared storage.
- Not a production auth system. It checks one static API key header. Replace with real OAuth/JWT before handling real user data.
- Not auto-deployed. You need to run this yourself, on your own server or a hosting platform.

---

## 1. Local setup (fastest way to test it works)

**Requirements:** Python 3.11+, an Anthropic API key from https://console.anthropic.com

```bash
cd deepguard-backend
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env
# Open .env and paste in your real ANTHROPIC_API_KEY
# Generate a DEEPGUARD_API_KEY with:
python -c "import secrets; print(secrets.token_urlsafe(32))"
# paste that into .env too

# Load the .env file into your shell (or use python-dotenv, already installed)
export $(grep -v '^#' .env | xargs)   # macOS/Linux
# Windows PowerShell: Get-Content .env | ForEach-Object { if($_ -match '^(.*)=(.*)$'){ [Environment]::SetEnvironmentVariable($matches[1],$matches[2]) } }

uvicorn main:app --reload --port 8000
```

This uses SQLite by default (`DATABASE_URL=sqlite:///./deepguard.db` in `.env.example`) so you don't need Postgres running just to test it locally.

**Test it's alive:**
```bash
curl http://localhost:8000/api/health
# {"status":"ok","time":"..."}
```

**Test the scan endpoint** (replace `YOUR_KEY` and use any small JPEG, base64-encoded):
```bash
curl -X POST http://localhost:8000/api/scan-frame \
  -H "X-API-Key: YOUR_DEEPGUARD_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"image_base64\":\"$(base64 -i your_photo.jpg)\"}"
```

---

## 2. Running with real Postgres + Docker (closer to production)

**Requirements:** Docker and Docker Compose installed.

```bash
cd deepguard-backend
cp .env.example .env
# Fill in ANTHROPIC_API_KEY and DEEPGUARD_API_KEY in .env

docker compose up --build
```

This starts Postgres and the API together. The API will be at `http://localhost:8000`, using a real Postgres database (not SQLite).

---

## 3. Connecting your existing index.html to this backend

Right now your front-end calls `https://api.anthropic.com/v1/messages` directly from the browser. You need to change that one `fetch` call (inside `rtRunRealVideoScan`) to call your new backend instead.

**Find this in your index.html:**
```javascript
const res = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'claude-sonnet-4-6',
    max_tokens: 300,
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: frameB64 } },
      { type: 'text', text: prompt }
    ]}]
  })
});
```

**Replace it with:**
```javascript
const res = await fetch('https://your-backend-domain.com/api/scan-frame', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': 'YOUR_DEEPGUARD_API_KEY'   // same value as DEEPGUARD_API_KEY in .env
  },
  body: JSON.stringify({ image_base64: frameB64 })
});
```

The response shape is the same fields you already parse (`trust_score`, `verdict`, `reasoning`), so the rest of `rtRunRealVideoScan` doesn't need to change — just the URL, headers, and body structure of this one call.

**Important:** putting `DEEPGUARD_API_KEY` directly in your front-end JavaScript means anyone viewing page source can see it. That's fine for an internal demo, but before any real launch, this key should come from a logged-in user's session on a server you control — not be hardcoded in client-side JS. This backend gets you to "the Anthropic key is hidden," not yet to "the whole system is secure for production."

**To wire up the session-save call**, change `siSaveSessionRecord` similarly to POST to `https://your-backend-domain.com/api/sessions` with the same `X-API-Key` header, instead of writing to IndexedDB. You can keep both if you want local + shared persistence.

---

## 4. Deploying somewhere real

Pick one (all have free or cheap starter tiers as of early 2026 — verify current pricing yourself before committing):

- **Render** (https://render.com) — easiest: connect your GitHub repo, it detects the Dockerfile automatically, add your env vars in their dashboard, done.
- **Railway** (https://railway.app) — similar one-click flow, includes managed Postgres.
- **Fly.io** (https://fly.io) — `fly launch` in this directory, follow prompts.
- **A plain VPS** (DigitalOcean, Linode, etc.) — install Docker, copy this folder over, run `docker compose up -d`.

Whichever you choose, set `ANTHROPIC_API_KEY`, `DEEPGUARD_API_KEY`, and `DATABASE_URL` as environment variables in that platform's dashboard — never commit them to a file in git.

---

## 5. What to do next, in order

1. Get this running locally first (`uvicorn main:app --reload`) and confirm `/api/health` responds.
2. Test `/api/scan-frame` with a real photo via curl, confirm you get back a real Claude verdict.
3. Update `index.html`'s one `fetch` call as shown above, test end-to-end locally (you'll need to serve `index.html` from a local server, not `file://`, for CORS to behave — `python -m http.server` in that folder works).
4. Deploy this backend to Render or Railway.
5. Update the URL in `index.html` to point at your deployed backend instead of `localhost`.
6. Rotate your `DEEPGUARD_API_KEY` to a fresh value before any real users touch this.
