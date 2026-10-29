@echo off
cd /d "%~dp0backend"
if exist "%~dp0.venv\Scripts\python.exe" (
    "%~dp0.venv\Scripts\python.exe" main.py
) else if exist "C:\AMBIENTES\COMPRAS\.venv\Scripts\python.exe" (
    "C:\AMBIENTES\COMPRAS\.venv\Scripts\python.exe" main.py
) else (
    python main.py
)
