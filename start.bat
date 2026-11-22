@echo off
cd /d %~dp0
echo Setting up SafeGuard AI (first run takes a few minutes)...
if not exist backend\.env (
  python -c "import secrets;print('SECRET_KEY='+secrets.token_hex(32))" > backend\.env
)
cd backend
if not exist .venv python -m venv .venv
call .venv\Scripts\activate.bat
pip install -q -r requirements.txt || (echo Python install failed. Check that Python 3.10+ is installed. & pause & exit /b 1)
start "SafeGuard API" cmd /k "call .venv\Scripts\activate.bat && uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload"
start "SafeGuard Video Worker" cmd /k "call .venv\Scripts\activate.bat && python -m app.workers.video_worker"
cd ..\frontend
call npm install || (echo npm install failed. Check that Node.js 18+ is installed. & pause & exit /b 1)
start "SafeGuard Web" cmd /k "npm run dev"
timeout /t 8 >nul
start http://127.0.0.1:5173
