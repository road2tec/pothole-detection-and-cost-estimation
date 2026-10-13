# Deployment

## Local development (tested: Windows 11, Node 24, Python 3.12, MongoDB 7, CPU only)

Prerequisites: Node.js ≥ 20, Python 3.10–3.12, MongoDB 7 running locally.

```bash
# 1. Install
npm install                     # root tooling (concurrently)
npm run install:all             # server + client
cd ai-service && py -3.12 -m venv .venv && .venv/Scripts/python -m pip install -r requirements-dev.txt --extra-index-url https://download.pytorch.org/whl/cpu && cd ..

# 2. Configure
cp server/.env.example server/.env          # fill JWT secrets + AI_SERVICE_TOKEN
cp ai-service/.env.example ai-service/.env  # same AI_SERVICE_TOKEN

# 3. First administrator (no default account exists)
ADMIN_EMAIL=you@org.in ADMIN_NAME="Your Name" npm --prefix server run bootstrap:admin   # prompts for the password

# 4. Run all three services
npm run dev          # AI service :8000, API :4000, web :5173 
```

Open http://localhost:5173. The AI service downloads the pinned model weights on first start (~150 MB, once).

Optional: `npm --prefix server run seed:demo` loads 300 clearly labelled demo potholes (hidden unless the
"Live + demo" dataset is selected); remove them with `npm --prefix server run seed:demo:remove`.

## Production checklist

1. Put everything behind HTTPS (nginx/Caddy/IIS). Serve `client/dist` as static files and proxy `/api/` to the API.
   An example nginx config is `client/nginx.conf`.
2. `NODE_ENV=production`, `COOKIE_SECURE=true`, `CLIENT_ORIGIN=https://your-domain`.
3. Strong unique secrets for `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `AI_SERVICE_TOKEN`; store them in the host's
   secret manager, not in the repository.
4. Keep MongoDB and the AI service on a private network; the AI service must not be exposed publicly.
5. Use a shared persistent volume for `STORAGE_DIR` mounted by both the API and the AI service.
6. Configure SMTP for password resets, or rely on administrators resetting passwords.
7. Replace the prototype cost rates with the authorised Schedule of Rates (Configuration → Costs).
8. Back up MongoDB and `storage/` regularly.
9. Build: `npm run build` → run `node server/dist/server.js` under a process manager (systemd, PM2, NSSM on Windows) and
   `uvicorn app.main:app --host 127.0.0.1 --port 8000` for the AI service.

## Docker Compose

`docker-compose.yml` defines `mongo`, `ai`, `api` and `web` (nginx) with persistent volumes for MongoDB, storage and the
model cache. Docker was **not available** in the build environment, so the compose file and Dockerfiles have not been
run; the same services were verified natively. Set the three secrets in `.env` first.

## GPU

Install CUDA-enabled torch/torchvision wheels in the AI service environment and set `DEVICE=cuda`. No code changes are needed.

## Scaling notes

* Several API instances can share one MongoDB: job claiming is atomic and idempotent.
* Several AI service instances can sit behind a load balancer for image detection; video jobs are tracked by id on the
  instance that accepted them, so route `/jobs/*` sticky or run one video-capable instance per API instance.
* For high volumes, move the queue to Redis/Celery by replacing `server/src/jobs/worker.ts`.
