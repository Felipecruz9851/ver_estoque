"""Configuração autônoma do módulo ver_estoque (sem dependência de `app`)."""

import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BACKEND_DIR.parent

DATA_DIR = Path(os.environ.get("VER_ESTOQUE_DATA_DIR", BACKEND_DIR / "data"))
# Pasta onde os snapshots são armazenados e consumidos.
SNAPSHOTS_DIR = Path(os.environ.get("VER_ESTOQUE_SNAPSHOTS_DIR", DATA_DIR / "snapshots"))
# Endereço remoto fornecedor dos snapshots oficiais
SNAPSHOTS_REMOTE_URL = os.environ.get(
    "VER_ESTOQUE_SNAPSHOTS_REMOTE_URL", "http://366n:8001/api/snapshots"
)
SNAPSHOTS_AUTO_SYNC = os.environ.get(
    "VER_ESTOQUE_SNAPSHOTS_AUTO_SYNC", "true"
).lower() in ("1", "true", "yes")
EXPORTS_DIR = DATA_DIR / "exports"
OC_CACHE_FILE = DATA_DIR / "oc_abertas_cache.pkl"

INTRANET_DEFAULT_USER = os.environ.get("VER_ESTOQUE_INTRANET_USER", "felipe.cruz")
INTRANET_DEFAULT_PASS = os.environ.get("VER_ESTOQUE_INTRANET_PASS", "#Gladoscruz.9851")

FRONTEND_DIST = Path(
    os.environ.get(
        "FRONTEND_DIST", PROJECT_ROOT / "frontend" / "dist"
    )
)

HOST = os.environ.get("VER_ESTOQUE_HOST", "0.0.0.0")
PORT = int(os.environ.get("VER_ESTOQUE_PORT", "8687"))

# Configurações de Sessão e Isolamento por Cookies
SESSION_COOKIE_NAME = os.environ.get("VER_ESTOQUE_SESSION_COOKIE", "ver_estoque_session")
SESSION_COOKIE_MAX_AGE = int(os.environ.get("VER_ESTOQUE_SESSION_MAX_AGE", str(86400 * 30)))  # 30 dias
SESSION_TTL_SECONDS = int(os.environ.get("VER_ESTOQUE_SESSION_TTL", str(86400 * 2)))  # 48h inatividade

SNAPSHOTS_DIR.mkdir(parents=True, exist_ok=True)
EXPORTS_DIR.mkdir(parents=True, exist_ok=True)

# =====================================================================
# Regras de Prazo de Expedição por Representante
# =====================================================================
PRAZOS_EXPEDICAO = [
    # valores únicos
    {"tipo": "valores", "itens": [7, 9, 95, 762, 724], "prazo": 3},
    {"tipo": "valores", "itens": [201, 202, 203, 241, 261], "prazo": 3},
    {"tipo": "valores", "itens": [700], "prazo": 3},
    {"tipo": "valores", "itens": [601, 602, 603], "prazo": 10},
    # intervalos
    {"tipo": "intervalo", "de": 50, "ate": 90, "prazo": 3},
    {"tipo": "intervalo", "de": 1000, "ate": 1999, "prazo": 3},
    {"tipo": "intervalo", "de": 2000, "ate": 2999, "prazo": 3},
    {"tipo": "intervalo", "de": 3000, "ate": 3999, "prazo": 8},
    {"tipo": "intervalo", "de": 4000, "ate": 5999, "prazo": 8},
    {"tipo": "intervalo", "de": 6000, "ate": 6999, "prazo": 8},
    {"tipo": "intervalo", "de": 7000, "ate": 7999, "prazo": 8},
    {"tipo": "intervalo", "de": 9000, "ate": 9999, "prazo": 8},
    {"tipo": "intervalo", "de": 300, "ate": 499, "prazo": 10},
    {"tipo": "intervalo", "de": 8000, "ate": 8999, "prazo": 10},
]


def prazo_por_representante(rep) -> int:
    """
    Calcula o prazo de expedição (em dias) com base no código do Representante.
    Retorna 0 quando o representante é ausente, NaN ou 0.
    """
    if rep is None:
        return 0
    try:
        if isinstance(rep, float) and (rep != rep):  # NaN check
            return 0
        s = str(rep).strip().rstrip(".")
        if not s or s.lower() in ("nan", "none", "nat", ""):
            return 0
        rep_int = int(float(s))
    except (ValueError, TypeError):
        return 0

    if rep_int <= 0:
        return 0

    # Valores específicos primeiro
    for regra in PRAZOS_EXPEDICAO:
        if regra["tipo"] == "valores" and rep_int in regra["itens"]:
            return int(regra["prazo"])

    # Depois intervalos
    for regra in PRAZOS_EXPEDICAO:
        if regra["tipo"] == "intervalo" and regra["de"] <= rep_int <= regra["ate"]:
            return int(regra["prazo"])

    return 10  # fallback consistente


NOMES_PRAZO_EXPEDICAO = {
    3: "MG e franquia",
    8: "Fora de MG",
    10: "Revenda e Nordeste",
    0: "Sem Rep.",
}


def nome_prazo_expedicao(prazo: int) -> str:
    """
    Traduz o código numérico de prazo de expedição para a nomenclatura comercial:
      3  -> 'MG e franquia'
      8  -> 'Fora de MG'
      10 -> 'Revenda e Nordeste'
      0  -> 'Sem Rep.'
    """
    try:
        p = int(prazo)
    except (ValueError, TypeError):
        p = 0
    return NOMES_PRAZO_EXPEDICAO.get(p, f"{p} dias")
