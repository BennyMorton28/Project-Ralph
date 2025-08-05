@echo off
REM Simple deployment script for Project Ralph
REM Run this from your home computer to deploy changes

echo 🚀 Deploying Project Ralph...

REM Pull latest changes first
echo 📥 Pulling latest changes...
git pull

REM Add all changes
git add .

REM Get commit message
echo Enter commit message (or press Enter for default):
set /p message=

REM Use default if no message
if "%message%"=="" set message=Update Project Ralph

REM Commit and push
git commit -m "%message%"
git push

echo ✅ Deployed! Dashboard will update in 2-5 minutes.
echo 🌐 URL: https://bennymorton28.github.io/Project-Ralph
pause 