#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
[ -f backend/.env ] || echo "SECRET_KEY=$(python3 -c 'import secrets;print(secrets.token_hex(32))')" > backend/.env
cd backend
[ -d .venv ] || python3 -m venv .venv
. .venv/bin/activate && pip install -q -r requirements.txt
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload & API=$!
.venv/bin/python -m app.workers.video_worker & WORKER=$!
trap "kill $API $WORKER" EXIT
cd ../frontend && npm install && (sleep 4; (xdg-open http://127.0.0.1:5173 || open http://127.0.0.1:5173) 2>/dev/null) & 
cd "$(dirname "$0")/frontend"
npm run dev
