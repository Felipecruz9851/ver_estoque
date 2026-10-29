"""
Leitura dos snapshots disponibilizados manualmente em `SNAPSHOTS_DIR`.

Formatos aceitos (os mesmos usados pela análise de compras):
  - `snapshot_<nome>.pkl`  -> pickle com dict[str, DataFrame] (ordens, cons, estoque, ...)
  - `snapshot_<nome>/`     -> diretório com `<tabela>.parquet`

Seleciona o snapshot mais recente (por data de modificação). Nada é gravado em disco.
"""

import pickle
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import pandas as pd
import polars as pl

if __package__:
    from . import settings
else:
    import settings

TABELAS_NECESSARIAS = ("ordens", "cons", "estoque")


def _mtime(p: Path) -> float:
    if p.is_dir():
        arquivos = [f.stat().st_mtime for f in p.glob("*.parquet")]
        return max(arquivos) if arquivos else p.stat().st_mtime
    return p.stat().st_mtime


def listar_snapshots() -> List[Path]:
    """Snapshots válidos, do mais recente para o mais antigo."""
    cands: List[Path] = []
    for p in settings.SNAPSHOTS_DIR.glob("snapshot_*"):
        if p.is_file() and p.suffix.lower() == ".pkl":
            cands.append(p)
        elif p.is_dir() and any(p.glob("*.parquet")):
            cands.append(p)
    return sorted(cands, key=_mtime, reverse=True)


def localizar_snapshot() -> Path:
    cands = listar_snapshots()
    if not cands:
        raise FileNotFoundError(
            f"Nenhum snapshot encontrado em {settings.SNAPSHOTS_DIR}. "
            "Copie um 'snapshot_<nome>.pkl' ou diretório 'snapshot_<nome>/' (parquet) para essa pasta."
        )
    return cands[0]


def data_snapshot(path: Optional[Path] = None) -> str:
    path = path or localizar_snapshot()
    return datetime.fromtimestamp(_mtime(path)).strftime("%d/%m/%Y %H:%M:%S")


def carregar_snapshot(path: Optional[Path] = None) -> Tuple[Dict[str, pd.DataFrame], Path]:
    """Carrega o snapshot como dict de DataFrames pandas. Retorna (dfs, caminho_usado)."""
    path = path or localizar_snapshot()
    if path.is_dir():
        dfs = {p.stem: pl.read_parquet(p).to_pandas() for p in path.glob("*.parquet") if not p.name.startswith("_")}
    else:
        with open(path, "rb") as f:
            raw = pickle.load(f)
        dfs = {k: (v.to_pandas() if isinstance(v, pl.DataFrame) else v) for k, v in raw.items()}

    faltando = [t for t in TABELAS_NECESSARIAS if dfs.get(t) is None]
    if faltando:
        raise ValueError(f"Snapshot '{path.name}' incompleto: faltam as tabelas {faltando}.")
    return dfs, path
