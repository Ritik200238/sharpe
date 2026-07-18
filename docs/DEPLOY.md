# Deploying SHARPE

SHARPE ships in two halves with different runtime needs:

| Half | Needs | Host |
|---|---|---|
| **Agent + recorder** (`services/`) | always-on process, durable disk (`data/`, `_keys/`), outbound SSE | any small VPS / Railway / Fly.io — via the root `Dockerfile` |
| **Frontend** (`apps/web`) | static hosting of a Vite build | **GitHub Pages — already live** at https://ritik200238.github.io/sharpe/ (auto-deployed on push); Vercel as an alternative |

> The frontend is **already deployed and self-contained**: with no backend it loads bundled
> demo fixtures, so the public URL is a fully testable demo today. Point it at a live agent with
> `?api=<agent-url>` — no rebuild.

## 1. Agent (the always-on half)

```bash
docker build -t sharpe-agent .
docker run -d --name sharpe --restart unless-stopped -p 8787:8787 \
  -v sharpe-keys:/app/_keys -v sharpe-data:/app/data sharpe-agent

# one-time TxLINE signup inside the container (funds the wallet on devnet):
docker exec -it sharpe tsx services/recorder/src/cli.ts setup

# optional: run the recorder alongside
docker run -d --name sharpe-recorder --restart unless-stopped \
  -v sharpe-keys:/app/_keys -v sharpe-data:/app/data \
  sharpe-agent tsx services/recorder/src/bootstrap.ts
```

Expose port 8787 publicly (or behind a reverse proxy with TLS). The API is
read-only and unauthenticated by design.

Railway/Fly: point them at the repo — both auto-detect the Dockerfile. Attach a
volume mounted at `/app/data` (and `/app/_keys`) so the ledger survives deploys.

## 2. Frontend

**Already live on GitHub Pages** (`.github/workflows/` builds `apps/web` and publishes to
Pages on every push to `master`): https://ritik200238.github.io/sharpe/. With no backend it
serves the bundled demo fixtures; add `?api=<agent-url>` to point it at a live agent.

**Alternative — Vercel:**
1. vercel.com/new → Import `Ritik200238/sharpe`.
2. **Root Directory:** `apps/web` (Vite is auto-detected: build `vite build`, output `dist`).
3. Optional env var: `VITE_API_BASE = https://<your-agent-host>` to bind it to a live agent
   (without it the deployed build runs in self-contained demo mode).
4. Deploy. Every push to `master` redeploys automatically.

## 3. Judge-window checklist

- Agent container healthy: `GET /health` → `phase: "live"`.
- Frontend loads, shows live vitals, `/stream` connected.
- A replay can be started on the agent host any time for demos:
  `tsx services/agent/src/main.ts --mode replay --replay-dir data/recordings/devnet/backfill-18241006 --exec paper --port 8797`
