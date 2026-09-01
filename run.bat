@echo off
echo Starting CardioLens (ECG Analysis Platform)...
echo.
echo   Backend:  http://localhost:8000   (API docs: http://localhost:8000/docs)
echo   Frontend: http://localhost:3000
echo.
echo   Close both windows to stop the platform.
echo.

cd /d "%~dp0"

rem Use the project venv when present, otherwise the system Python
set "PY=python"
if exist venv\Scripts\python.exe set "PY=venv\Scripts\python.exe"

start "CardioLens Backend" cmd /k "cd /d %~dp0 && %PY% -m uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000"
start "CardioLens Frontend" cmd /k "cd /d %~dp0frontend && npm run dev"
