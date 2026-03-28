@echo off
REM Windows Quick Start Script

echo.
echo 🚀 SentinelSOC Week 1 Setup
echo.

REM Check Node.js
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ❌ Node.js not found. Please install Node.js ^>= 16
    exit /b 1
)

for /f "tokens=*" %%i in ('node --version') do set NODE_VERSION=%%i
for /f "tokens=*" %%i in ('npm --version') do set NPM_VERSION=%%i

echo ✅ Node.js: %NODE_VERSION%
echo ✅ npm: %NPM_VERSION%
echo.

REM Install dependencies
echo 📦 Installing dependencies...
call npm install

REM Build TypeScript
echo 🔨 Building TypeScript...
call npm run build

REM Check environment
if not exist .env (
    echo.
    echo ⚠️  .env file not found
    echo 📝 Creating .env from .env.example...
    copy .env.example .env
    echo ⚠️  Please edit .env and add your Infura/Alchemy API key
    echo.
)

echo.
echo ✅ Setup complete!
echo.
echo Available commands:
echo   npm run mempool:listen    - Listen to pending transactions
echo   npm run tx:parse          - Parse transaction call data
echo   npm run db:init           - Initialize database
echo.
echo Next steps:
echo   1. Edit .env with your API key
echo   2. Run: npm run mempool:listen
echo.
