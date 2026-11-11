"""
Módulo de snapshots do projeto Ver Estoque.

Suporta leitura e sincronização automática/sob demanda de arquivos Parquet
a partir das pastas de snapshot disponibilizadas no endpoint remoto:
  http://366n:8001/api/snapshots

Consome diretamente apenas as tabelas essenciais para a ferramenta:
  - `ordens.parquet`
  - `cons.parquet`
  - `estoque.parquet`
  - `_sync_meta.json` (metadados de versão e integridade)

Não consome nem descompacta arquivos monolíticos `.pkl`, reduzindo drasticamente
o tráfego de rede (de centenas de MB para ~2.5 MB) e acelerando o tempo de carga.
"""

from datetime import datetime
from email.utils import parsedate_to_datetime
import json
import os
from pathlib import Path
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

TABELAS_NECESSARIAS: Tuple[str, ...] = ("ordens", "cons", "estoque")
TABELAS_SINCRONIZAR: Tuple[str, ...] = ("ordens", "cons", "estoque", "apoio_compras")
ARQUIVOS_SINCRONIZAR: Tuple[str, ...] = tuple(f"{t}.parquet" for t in TABELAS_SINCRONIZAR) + ("_sync_meta.json",)


def _mtime(p: Path) -> float:
    """Retorna o timestamp da modificação mais recente entre os arquivos Parquet de uma pasta ou arquivo."""
    if p.is_dir():
        arquivos = [f.stat().st_mtime for f in p.glob("*.parquet")]
        return max(arquivos) if arquivos else p.stat().st_mtime
    return p.stat().st_mtime


def limpar_arquivos_desnecessarios(snapshot_dir: Optional[Path] = None) -> List[str]:
    """
    Remove arquivos .pkl legados e tabelas .parquet não consumidas pelo Ver Estoque
    (mantendo estritamente ordens.parquet, cons.parquet, estoque.parquet e _sync_meta.json).
    Libera espaço em disco eliminando centenas de MBs desnecessários.
    """
    base_dir = snapshot_dir or settings.SNAPSHOTS_DIR
    removidos: List[str] = []

    if not base_dir.exists():
        return removidos

    # 1. Remove qualquer .pkl da raiz do diretório de snapshots
    for f in base_dir.glob("*.pkl"):
        try:
            f.unlink()
            removidos.append(f.name)
            print(f"[LIMPEZA] Arquivo .pkl legado removido: {f.name}")
        except Exception as e:
            print(f"[LIMPEZA] Aviso ao remover {f.name}: {e}")

    # 2. Em cada pasta snapshot_*, remove tabelas e arquivos não utilizados
    for pasta in base_dir.glob("snapshot_*"):
        if not pasta.is_dir():
            continue
        for arq in list(pasta.iterdir()):
            if arq.is_file() and arq.name not in ARQUIVOS_SINCRONIZAR:
                try:
                    arq.unlink()
                    removidos.append(f"{pasta.name}/{arq.name}")
                    print(f"[LIMPEZA] Arquivo desnecessário removido: {pasta.name}/{arq.name}")
                except Exception as e:
                    print(f"[LIMPEZA] Aviso ao remover {pasta.name}/{arq.name}: {e}")

    return removidos


def _abrir_requisicao_arquivo(remote_url: str, pasta: str, nome_arquivo: str, timeout_sec: int = 20):
    """
    Abre a requisição para um arquivo remoto testando rotas RESTful compatíveis:
    1. POSIX standard: `/api/snapshots/{pasta}/{nome_arquivo}`
    2. Fallback Windows: `/api/snapshots/{pasta}%5C{nome_arquivo}` (para Starlette sem :path)
    """
    caminho_win = f"{pasta}\\{nome_arquivo}"
    url_posix = f"{remote_url}/{urllib.parse.quote(pasta)}/{urllib.parse.quote(nome_arquivo)}"
    url_win = f"{remote_url}/{urllib.parse.quote(caminho_win)}"

    erros = []
    for u in (url_posix, url_win):
        try:
            req = urllib.request.Request(
                u,
                headers={"User-Agent": "VerEstoque/1.0 (+http://localhost)", "Accept": "*/*"},
            )
            resp = urllib.request.urlopen(req, timeout=timeout_sec)
            return resp, u
        except urllib.error.HTTPError as e:
            erros.append(f"{u} -> {e.code}")
            if e.code == 404 and u != url_win:
                continue
            raise
        except Exception as e:
            erros.append(f"{u} -> {e}")
            if u != url_win:
                continue
            raise

    raise FileNotFoundError(f"Arquivo '{pasta}/{nome_arquivo}' não acessível nas rotas tentadas: {erros}")


def sincronizar_snapshots_remotos(
    url: Optional[str] = None,
    forcar: bool = False,
    timeout_sec: int = 20,
    limpar_desnecessarios: bool = True,
    **kwargs: Any,
) -> Dict[str, Any]:
    """
    Consome os snapshots disponibilizados no endpoint remoto (ex: http://366n:8001/api/snapshots).
    Localiza as pastas de snapshot disponíveis e sincroniza exclusivamente os arquivos .parquet
    essenciais ('ordens', 'cons', 'estoque') e metadados '_sync_meta.json'.

    Compara cabeçalhos HTTP (Last-Modified, Content-Length) com os arquivos locais.
    Baixa somente arquivos novos ou modificados de forma atômica e segura.
    Não baixa nem utiliza arquivos monolíticos .pkl.
    """
    remote_url = (url or settings.SNAPSHOTS_REMOTE_URL).strip().rstrip("/")
    resultado: Dict[str, Any] = {
        "sucesso": False,
        "url": remote_url,
        "pastas_remotas": [],
        "total_pastas": 0,
        "baixados": [],
        "ja_atualizados": [],
        "removidos": [],
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

        # Seleciona pastas de snapshots (prefixo 'snapshot_' e sem extensões de arquivos avulsos)
        pastas_candidatas = [
            arq
            for arq in arquivos_remotos
            if isinstance(arq, str)
            and arq.startswith("snapshot_")
            and not arq.lower().endswith((".pkl", ".tmp", ".txt", ".json", ".bak"))
        ]
        resultado["pastas_remotas"] = pastas_candidatas
        resultado["total_pastas"] = len(pastas_candidatas)

        for pasta_nome in pastas_candidatas:
            local_pasta = settings.SNAPSHOTS_DIR / pasta_nome
            local_pasta.mkdir(parents=True, exist_ok=True)

            for nome_arquivo in ARQUIVOS_SINCRONIZAR:
                local_path = local_pasta / nome_arquivo
                eh_obrigatorio = nome_arquivo.replace(".parquet", "") in TABELAS_NECESSARIAS

                try:
                    res_file, file_url = _abrir_requisicao_arquivo(
                        remote_url=remote_url,
                        pasta=pasta_nome,
                        nome_arquivo=nome_arquivo,
                        timeout_sec=timeout_sec,
                    )
                    with res_file as res:
                        headers = dict(res.headers)
                        raw_len = headers.get("content-length")
                        remote_size = int(raw_len) if raw_len and raw_len.isdigit() else None
                        raw_lm = headers.get("last-modified")
                        remote_dt = parsedate_to_datetime(raw_lm) if raw_lm else None
                        remote_mtime = remote_dt.timestamp() if remote_dt else None

                        precisa_baixar = False
                        if not local_path.exists() or forcar:
                            precisa_baixar = True
                        else:
                            local_size = local_path.stat().st_size
                            local_mtime = local_path.stat().st_mtime
                            if remote_size is not None and local_size != remote_size:
                                precisa_baixar = True
                            elif remote_mtime is not None and abs(remote_mtime - local_mtime) > 2.0:
                                precisa_baixar = True

                        if not precisa_baixar:
                            resultado["ja_atualizados"].append(f"{pasta_nome}/{nome_arquivo}")
                            continue

                        # Download atômico com verificação de integridade
                        temp_path = local_path.with_name(f"_{nome_arquivo}.tmp")
                        print(
                            f"[{datetime.now().strftime('%H:%M:%S')}] Baixando '{pasta_nome}/{nome_arquivo}' "
                            f"({(remote_size or 0) / 1024:.1f} KB)..."
                        )
                        with open(temp_path, "wb") as f_out:
                            shutil.copyfileobj(res, f_out, length=1024 * 512)

                        # Validação de integridade para arquivos Parquet
                        if nome_arquivo.endswith(".parquet"):
                            try:
                                _ = pl.read_parquet(temp_path, n_rows=1)
                            except Exception as e_pqt:
                                if temp_path.exists():
                                    temp_path.unlink()
                                raise ValueError(f"Arquivo Parquet baixado corrompido: {e_pqt}")

                        if temp_path.exists():
                            temp_path.replace(local_path)
                            if remote_mtime is not None:
                                os.utime(local_path, (remote_mtime, remote_mtime))

                            resultado["baixados"].append(f"{pasta_nome}/{nome_arquivo}")
                            print(
                                f"[{datetime.now().strftime('%H:%M:%S')}] Tabela '{pasta_nome}/{nome_arquivo}' "
                                "sincronizada com sucesso."
                            )

                except urllib.error.HTTPError as e_http:
                    if e_http.code == 404:
                        if eh_obrigatorio:
                            resultado["erros"].append(
                                {"arquivo": f"{pasta_nome}/{nome_arquivo}", "erro": "Tabela obrigatória ausente (404)"}
                            )
                        # Se não for obrigatório (ex: metadados opcionais), ignora silenciosamente
                    else:
                        resultado["erros"].append({"arquivo": f"{pasta_nome}/{nome_arquivo}", "erro": str(e_http)})
                except Exception as e_file:
                    resultado["erros"].append({"arquivo": f"{pasta_nome}/{nome_arquivo}", "erro": str(e_file)})
                    print(f"[SNAPSHOT SYNC] Erro ao sincronizar '{pasta_nome}/{nome_arquivo}': {e_file}")

        # Limpeza de arquivos desnecessários se requisitado
        if limpar_desnecessarios:
            resultado["removidos"] = limpar_arquivos_desnecessarios(settings.SNAPSHOTS_DIR)

        resultado["sucesso"] = True
        resultado["mensagem"] = (
            f"Sincronização Parquet concluída: {len(resultado['baixados'])} baixado(s), "
            f"{len(resultado['ja_atualizados'])} já atualizado(s), "
            f"{len(resultado['removidos'])} arquivo(s) desnecessário(s) removido(s), "
            f"{len(resultado['erros'])} erro(s)."
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
    """
    Retorna a lista de diretórios de snapshots válidos contendo as tabelas Parquet necessárias,
    ordenados do mais recente para o mais antigo.
    """
    cands: List[Path] = []
    if not settings.SNAPSHOTS_DIR.exists():
        return cands

    for p in settings.SNAPSHOTS_DIR.glob("snapshot_*"):
        if p.is_dir():
            tabelas_locais = {f.stem for f in p.glob("*.parquet")}
            if all(t in tabelas_locais for t in TABELAS_NECESSARIAS):
                cands.append(p)

    return sorted(cands, key=_mtime, reverse=True)


def localizar_snapshot(nome: Optional[str] = None, tentar_sync: bool = True) -> Path:
    """Localiza o diretório de snapshot a ser utilizado. Se nenhum existir, tenta sincronizar da API remota."""
    cands = listar_snapshots()
    if not cands and tentar_sync:
        print("[SNAPSHOT] Nenhum snapshot Parquet local encontrado. Tentando sincronizar com servidor remoto...")
        sincronizar_snapshots_remotos()
        cands = listar_snapshots()

    if not cands:
        raise FileNotFoundError(
            f"Nenhum snapshot Parquet válido encontrado em {settings.SNAPSHOTS_DIR}. "
            "Verifique a conectividade com http://366n:8001/api/snapshots."
        )

    if nome:
        for p in cands:
            if p.name == nome or p.stem == nome:
                return p

    return cands[0]


def data_snapshot(path: Optional[Path] = None) -> str:
    """Retorna a data e hora formatada do snapshot."""
    path = path or localizar_snapshot()
    return datetime.fromtimestamp(_mtime(path)).strftime("%d/%m/%Y %H:%M:%S")


def carregar_snapshot(path: Optional[Path] = None) -> Tuple[Dict[str, pd.DataFrame], Path]:
    """
    Carrega as tabelas essenciais do snapshot como dicionário de DataFrames Pandas
    lidos diretamente de arquivos Parquet via Polars. Retorna (dfs, caminho_usado).
    """
    path = path or localizar_snapshot()
    if not path.is_dir():
        raise ValueError(f"O snapshot em '{path}' deve ser um diretório com arquivos Parquet.")

    dfs: Dict[str, pd.DataFrame] = {}
    for t in TABELAS_NECESSARIAS:
        pqt_file = path / f"{t}.parquet"
        if not pqt_file.exists():
            raise FileNotFoundError(f"Snapshot '{path.name}' incompleto: tabela '{t}.parquet' não encontrada.")
        dfs[t] = pl.read_parquet(pqt_file).to_pandas()

    # Tabelas adicionais sincronizadas disponíveis no snapshot (ex: apoio_compras)
    for pqt_file in path.glob("*.parquet"):
        stem = pqt_file.stem
        if stem not in dfs and not stem.startswith("_"):
            try:
                dfs[stem] = pl.read_parquet(pqt_file).to_pandas()
            except Exception as exc_extra:
                print(f"[SNAPSHOT] Aviso ao carregar tabela adicional '{pqt_file.name}': {exc_extra}")

    return dfs, path
