"""
Módulo de snapshots do projeto Ver Estoque.

Suporta leitura e sincronização automática/sob demanda a partir do endpoint remoto:
  http://366n:8001/api/snapshots

Formatos aceitos:
  - `snapshot_<nome>.pkl`  -> pickle com dict[str, DataFrame] (ordens, cons, estoque, ...)
  - `snapshot_<nome>/`     -> diretório com `<tabela>.parquet`

Seleciona o snapshot mais recente (por data de modificação).
"""

from datetime import datetime
from email.utils import parsedate_to_datetime
import json
import os
from pathlib import Path
import pickle
import shutil
import time
from typing import Any, Dict, List, Optional, Tuple
import urllib.error
import urllib.parse
import urllib.request

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


def desempacotar_snapshot_parquet(pkl_path: Path) -> Path:
    """
    Desempacota um arquivo snapshot .pkl em um diretório com arquivos .parquet.
    Cria ou atualiza `_sync_meta.json` para rastreamento de integridade e versão.
    """
    dest_dir = pkl_path.parent / pkl_path.stem
    dest_dir.mkdir(parents=True, exist_ok=True)

    with open(pkl_path, "rb") as f:
        raw = pickle.load(f)

    pkl_mtime = pkl_path.stat().st_mtime
    pkl_size = pkl_path.stat().st_size

    for nome_tabela, df_val in raw.items():
        if df_val is None:
            continue
        try:
            target_parquet = dest_dir / f"{nome_tabela}.parquet"
            if isinstance(df_val, pl.DataFrame):
                df_val.write_parquet(target_parquet)
            elif isinstance(df_val, pd.DataFrame):
                pl.from_pandas(df_val).write_parquet(target_parquet)
            else:
                continue

            if pkl_mtime > 0:
                os.utime(target_parquet, (pkl_mtime, pkl_mtime))
        except Exception as e:
            print(f"[SNAPSHOT DESEMPACOTAR] Aviso ao salvar tabela '{nome_tabela}': {e}")

    meta = {
        "pkl_name": pkl_path.name,
        "pkl_mtime": pkl_mtime,
        "pkl_size": pkl_size,
        "desempacotado_em": datetime.now().isoformat(),
    }
    with open(dest_dir / "_sync_meta.json", "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)

    return dest_dir


def sincronizar_snapshots_remotos(
    url: Optional[str] = None,
    forcar: bool = False,
    desempacotar: bool = True,
    timeout_sec: int = 20,
) -> Dict[str, Any]:
    """
    Consome os snapshots disponibilizados no endpoint remoto (ex: http://366n:8001/api/snapshots).
    Compara cabeçalhos (Last-Modified, Content-Length) com o diretório local `settings.SNAPSHOTS_DIR`.
    Baixa somente arquivos novos ou modificados de forma atômica e segura.
    """
    remote_url = (url or settings.SNAPSHOTS_REMOTE_URL).strip().rstrip("/")
    resultado: Dict[str, Any] = {
        "sucesso": False,
        "url": remote_url,
        "total_remotos": 0,
        "baixados": [],
        "ja_atualizados": [],
        "erros": [],
        "mensagem": "",
    }

    try:
        req_lista = urllib.request.Request(
            remote_url,
            headers={"User-Agent": "VerEstoque/1.0 (+http://localhost)", "Accept": "application/json"},
        )
        with urllib.request.urlopen(req_lista, timeout=timeout_sec) as resp:
            data = json.loads(resp.read().decode("utf-8"))

        arquivos_remotos = data.get("arquivos", [])
        if not isinstance(arquivos_remotos, list):
            resultado["mensagem"] = f"Resposta inesperada do endpoint: {data}"
            return resultado

        # Seleciona apenas arquivos baixáveis (.pkl)
        candidatos = [
            arq
            for arq in arquivos_remotos
            if isinstance(arq, str) and arq.lower().endswith(".pkl") and not arq.startswith(".")
        ]
        resultado["total_remotos"] = len(candidatos)

        for nome_arquivo in candidatos:
            file_url = f"{remote_url}/{urllib.parse.quote(nome_arquivo)}"
            local_path = settings.SNAPSHOTS_DIR / nome_arquivo

            try:
                req_file = urllib.request.Request(
                    file_url,
                    headers={"User-Agent": "VerEstoque/1.0"},
                )
                with urllib.request.urlopen(req_file, timeout=timeout_sec) as res:
                    headers = dict(res.headers)
                    raw_len = headers.get("content-length")
                    remote_size = int(raw_len) if raw_len and raw_len.isdigit() else None
                    raw_lm = headers.get("last-modified")
                    remote_dt = parsedate_to_datetime(raw_lm) if raw_lm else None
                    remote_mtime = remote_dt.timestamp() if remote_dt else None

                    # Verifica se o arquivo local já está sincronizado
                    precisa_baixar = False
                    if not local_path.exists() or forcar:
                        precisa_baixar = True
                    else:
                        local_size = local_path.stat().st_size
                        local_mtime = local_path.stat().st_mtime
                        if remote_size is not None and local_size != remote_size:
                            precisa_baixar = True
                        elif remote_mtime is not None and (remote_mtime - local_mtime) > 2.0:
                            precisa_baixar = True

                    if not precisa_baixar:
                        resultado["ja_atualizados"].append(nome_arquivo)
                        continue

                    # Download com escrita atômica via .tmp
                    temp_path = local_path.with_suffix(".tmp")
                    print(
                        f"[{datetime.now().strftime('%H:%M:%S')}] Baixando '{nome_arquivo}' de {file_url} "
                        f"({(remote_size or 0) / (1024 * 1024):.1f} MB)..."
                    )
                    with open(temp_path, "wb") as f_out:
                        shutil.copyfileobj(res, f_out, length=1024 * 1024)

                    if temp_path.exists():
                        temp_path.replace(local_path)
                        if remote_mtime is not None:
                            os.utime(local_path, (remote_mtime, remote_mtime))

                        if desempacotar:
                            try:
                                desempacotar_snapshot_parquet(local_path)
                            except Exception as e_unpack:
                                print(f"[SNAPSHOT SYNC] Aviso ao desempacotar '{nome_arquivo}': {e_unpack}")

                        resultado["baixados"].append(nome_arquivo)
                        print(
                            f"[{datetime.now().strftime('%H:%M:%S')}] Snapshot '{nome_arquivo}' sincronizado com sucesso."
                        )

            except Exception as e_file:
                resultado["erros"].append({"arquivo": nome_arquivo, "erro": str(e_file)})
                print(f"[SNAPSHOT SYNC] Erro ao sincronizar '{nome_arquivo}': {e_file}")

        resultado["sucesso"] = True
        resultado["mensagem"] = (
            f"Sincronização concluída: {len(resultado['baixados'])} baixado(s), "
            f"{len(resultado['ja_atualizados'])} já atualizado(s), {len(resultado['erros'])} erro(s)."
        )

    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, ConnectionError) as e_net:
        resultado["sucesso"] = False
        resultado["erro"] = str(e_net)
        resultado["mensagem"] = (
            f"Servidor remoto ({remote_url}) inacessível no momento ({e_net}). "
            "Mantendo e utilizando snapshots locais existentes."
        )
        print(f"[SNAPSHOT SYNC] {resultado['mensagem']}")
    except Exception as e_geral:
        resultado["sucesso"] = False
        resultado["erro"] = str(e_geral)
        resultado["mensagem"] = f"Falha na sincronização remota: {e_geral}"
        print(f"[SNAPSHOT SYNC] {resultado['mensagem']}")

    return resultado


def listar_snapshots(deduplicar: bool = True) -> List[Path]:
    """Snapshots válidos, do mais recente para o mais antigo."""
    cands: List[Path] = []
    for p in settings.SNAPSHOTS_DIR.glob("snapshot_*"):
        if p.is_file() and p.suffix.lower() == ".pkl":
            cands.append(p)
        elif p.is_dir() and any(p.glob("*.parquet")):
            cands.append(p)

    cands_sorted = sorted(cands, key=_mtime, reverse=True)

    if not deduplicar:
        return cands_sorted

    # Deduplicação inteligente: se existir pasta e arquivo .pkl com mesmo radical,
    # prefere o diretório parquet se atualizado, ou o item com maior _mtime.
    unicos: Dict[str, Path] = {}
    for p in cands_sorted:
        stem = p.stem
        if stem not in unicos:
            unicos[stem] = p
        else:
            atual = unicos[stem]
            if p.is_dir() and abs(_mtime(p) - _mtime(atual)) < 5.0:
                unicos[stem] = p
            elif _mtime(p) > _mtime(atual):
                unicos[stem] = p

    return sorted(unicos.values(), key=_mtime, reverse=True)


def localizar_snapshot(nome: Optional[str] = None, tentar_sync: bool = True) -> Path:
    """Localiza o snapshot a ser utilizado. Se nenhum existir localmente, tenta sincronizar da API remota."""
    cands = listar_snapshots()
    if not cands and tentar_sync:
        print("[SNAPSHOT] Nenhum snapshot local encontrado. Tentando sincronizar com servidor remoto...")
        sincronizar_snapshots_remotos()
        cands = listar_snapshots()

    if not cands:
        raise FileNotFoundError(
            f"Nenhum snapshot encontrado em {settings.SNAPSHOTS_DIR} e o servidor remoto não retornou arquivos. "
            "Verifique a conectividade com http://366n:8001/api/snapshots."
        )

    if nome:
        for p in cands:
            if p.name == nome or p.stem == nome:
                return p

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
