"""Configuração autônoma do módulo ver_estoque (sem dependência de `app`)."""

import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BACKEND_DIR.parent

DATA_DIR = Path(os.environ.get("VER_ESTOQUE_DATA_DIR", BACKEND_DIR / "data"))
# Pasta onde os snapshots são disponibilizados manualmente.
SNAPSHOTS_DIR = Path(os.environ.get("VER_ESTOQUE_SNAPSHOTS_DIR", DATA_DIR / "snapshots"))
EXPORTS_DIR = DATA_DIR / "exports"

FRONTEND_DIST = Path(
    os.environ.get(
        "FRONTEND_DIST", PROJECT_ROOT / "frontend" / "dist"
    )
)

HOST = os.environ.get("VER_ESTOQUE_HOST", "0.0.0.0")
PORT = int(os.environ.get("VER_ESTOQUE_PORT", "8687"))

SNAPSHOTS_DIR.mkdir(parents=True, exist_ok=True)
EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
