#!/usr/bin/env bash
# One-terminal setup and start for Linux / macOS (and Git Bash).
#   bash setup.sh
# Safe to re-run: existing .env files, virtualenv and accounts are kept.
set -euo pipefail
cd "$(dirname "$0")"

step() { printf '\n\033[36m==> %s\033[0m\n' "$1"; }
fail() { printf '\033[31mERROR: %s\033[0m\n' "$1"; exit 1; }
randhex() { node -e "console.log(require('crypto').randomBytes($1).toString('hex'))"; }

step 'Checking prerequisites'
command -v node >/dev/null || fail 'Node.js 20+ is required'
echo "Node $(node -v)"
PY=""
for c in python3.12 python3.11 python3.10 python3 python; do
  if command -v "$c" >/dev/null && "$c" --version 2>&1 | grep -qE 'Python 3\.1[0-2]'; then PY="$c"; break; fi
done
[ -n "$PY" ] || fail 'Python 3.10-3.12 is required'
echo "$($PY --version)"
node -e "require('net').connect(27017,'127.0.0.1').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))" \
  || fail 'MongoDB is not running on localhost:27017'
echo 'MongoDB reachable on 27017'

step 'Installing Node packages (root, server, client)'
npm install --no-fund --no-audit
npm --prefix server install --no-fund --no-audit
npm --prefix client install --no-fund --no-audit

step 'Setting up the Python AI service'
if [ -x ai-service/.venv/Scripts/python.exe ]; then VPY=ai-service/.venv/Scripts/python.exe
else
  [ -x ai-service/.venv/bin/python ] || "$PY" -m venv ai-service/.venv
  VPY=ai-service/.venv/bin/python
fi
"$VPY" -m pip install --upgrade pip --quiet
"$VPY" -m pip install -r ai-service/requirements-dev.txt --extra-index-url https://download.pytorch.org/whl/cpu

step 'Creating configuration files'
if [ ! -f ai-service/.env ]; then
  TOKEN=$(randhex 24)
  sed "s/^AI_SERVICE_TOKEN=.*/AI_SERVICE_TOKEN=$TOKEN/" ai-service/.env.example > ai-service/.env
  echo 'Created ai-service/.env'
else
  TOKEN=$(grep '^AI_SERVICE_TOKEN=' ai-service/.env | cut -d= -f2-)
  echo 'Keeping existing ai-service/.env'
fi
if [ ! -f server/.env ]; then
  sed -e "s/^JWT_ACCESS_SECRET=.*/JWT_ACCESS_SECRET=$(randhex 48)/" \
      -e "s/^JWT_REFRESH_SECRET=.*/JWT_REFRESH_SECRET=$(randhex 48)/" \
      -e "s/^AI_SERVICE_TOKEN=.*/AI_SERVICE_TOKEN=$TOKEN/" server/.env.example > server/.env
  echo 'Created server/.env'
else
  echo 'Keeping existing server/.env'
fi

step 'Administrator account'
HAS=$(npm --prefix server run --silent has-admin 2>/dev/null | tail -1 || echo no)
if [ "$HAS" = "yes" ]; then
  echo 'An administrator already exists.'
else
  read -rp 'Admin email: ' ADMIN_EMAIL
  read -rp 'Admin full name: ' ADMIN_NAME
  ADMIN_EMAIL="$ADMIN_EMAIL" ADMIN_NAME="$ADMIN_NAME" npm --prefix server run bootstrap:admin
fi

step 'Starting AI service (:8000), API (:4000) and web app (:5173)'
printf '\033[32mOpen http://localhost:5173 - press Ctrl+C to stop everything.\033[0m\n'
npm run dev
