@echo off
echo Setting up CardioLens (ECG Analysis Platform)...
echo.

where python >nul 2>nul
if errorlevel 1 (
    echo ERROR: Python is required but not installed. Get it from https://www.python.org/downloads/
    exit /b 1
)

echo [1/4] Creating Python virtual environment...
if exist venv (
    echo        venv already exists, skipping
) else (
    python -m venv venv
)
call venv\Scripts\activate.bat

echo [2/4] Installing Python dependencies...
pip install -r requirements.txt

echo [3/4] Creating backend .env...
if exist .env (
    echo        .env already exists, skipping
) else (
    copy .env.example .env >nul
    echo        .env created from .env.example
)

where npm >nul 2>nul
if errorlevel 1 (
    echo ERROR: Node.js is required but not installed. Get it from https://nodejs.org/
    exit /b 1
)

echo [4/4] Installing frontend dependencies...
pushd frontend
call npm install
if not exist .env.local (
    copy .env.local.example .env.local >nul
    echo        .env.local created from .env.local.example
)
popd

echo.
echo Setup complete!
echo   - Add your Gemini API key to .env as AI_API_KEY to enable AI reports
echo     optional — a rule-based report is generated without one
echo   - Run run.bat to start the platform
