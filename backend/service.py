"""
Serviço ver_estoque.
Gera o DataFrame de consumo (sem filtros restritivos) a partir do snapshot mais recente
disponibilizado manualmente em `settings.SNAPSHOTS_DIR`, analisa a disponibilidade dos
itens finais (`raiz_Item Final`) com abatimento cumulativo de estoque (Situação L) ao longo
da fila ordenada por Data de Abertura, e gerencia a simulação/destaque de pedidos.
"""

from datetime import datetime, timedelta
from itertools import repeat
import json
import re
import threading
import time
from typing import Any, Dict, List, Optional, Set, Tuple
import uuid

import numpy as np
import pandas as pd
import polars as pl

if __package__:
    from . import scraper, settings
    from .calculo import calc_data, filtrar_estoque_valido, parse_numero_br_series, sanitizar_dataframe
    from .snapshots import carregar_snapshot, data_snapshot, obter_metadados_snapshot, sincronizar_snapshots_remotos
else:
    import sys
    from pathlib import Path

    _backend_dir = str(Path(__file__).resolve().parent)
    if _backend_dir not in sys.path:
        sys.path.insert(0, _backend_dir)
    import scraper
    import settings
    from calculo import calc_data, filtrar_estoque_valido, parse_numero_br_series, sanitizar_dataframe
    from snapshots import carregar_snapshot, data_snapshot, obter_metadados_snapshot, sincronizar_snapshots_remotos

# Cache em memória do snapshot base (imutável após carga)
_cache_cons: Optional[pd.DataFrame] = None
_cache_timestamp: Optional[float] = None
_cache_data_calculo: Optional[str] = None
_cache_snapshot_nome: Optional[str] = None
_cache_data_snapshot: Optional[str] = None
_cache_data_oc: Optional[str] = None

# Locks Anti-Stampede e Stale-While-Revalidate (SWR) para carga base e OCs
_cons_load_lock = threading.Lock()
_bg_refresh_lock = threading.Lock()
_bg_refresh_running = False

# Caches globais compartilhados para sessões sem simulação ativa
_global_cache_lock = threading.Lock()
_global_cache_mrp_base: Dict[Tuple[Any, ...], Tuple[pd.DataFrame, pd.DataFrame, List[str]]] = {}
_global_cache_filas: Dict[Tuple[Any, ...], Tuple[pd.DataFrame, pd.DataFrame, List[str]]] = {}
_global_cache_matriz: Dict[Tuple[Any, ...], Dict[str, Any]] = {}
_global_cache_resumo_faltantes: Dict[Tuple[Any, ...], Dict[str, Any]] = {}
_global_cache_view_itens: Dict[Tuple[Any, ...], Tuple[pd.DataFrame, Dict[str, Any], int]] = {}

_PEDIDOS_IGNORADOS_INT = getattr(settings, "PEDIDOS_DESCONSIDERADOS_INT", frozenset({0, 100, 1000}))
_PEDIDOS_IGNORADOS_STR = getattr(settings, "PEDIDOS_DESCONSIDERADOS_STR", frozenset({"0", "100", "1000"}))
_MAPA_LIMPAR_PEDIDO_STR = {p: "" for p in _PEDIDOS_IGNORADOS_STR}
_CONS_CACHE_RULES = {
    "version": 2,
    "locais_estoque_desconsiderados": sorted(
        getattr(settings, "LOCAIS_ESTOQUE_DESCONSIDERADOS", frozenset({"TERCEIROS"}))
    ),
}


def _normalizar_pedido_valido(valor: Any) -> str:
    """Normaliza número de pedido descartando códigos sem pedido/internos (0, 100, 1000)."""
    ped = scraper.normalizar_numero_pedido(valor)
    return "" if ped in _PEDIDOS_IGNORADOS_STR else ped

# Mapas auxiliares extraídos do snapshot para enriquecer pedidos novos simulados e camada gerencial
_enriquecimento: Dict[str, Any] = {
    "estoque": {},
    "tipo": {},
    "baixa": {},
    "local_prod": {},
    "fabrica_item": {},
    "desc_item": {},
    "op_por_numero": {},
    "op_por_item_pedido": {},
    "op_por_item_lote": {},
    "op_por_item_todos": {},
    "oc_por_item_ped_it": {},
    "oc_por_item_ped": {},
    "oc_por_item_it_sem_ped": {},
    "oc_por_item_geral": {},
    "oc_por_item_todas": {},
    "itens_cst": set(),
    "tc_map_4": {},
    "tc_map_3_ped": {},
    "tc_map_3_ord": {},
    "tc_map_3_item": {},
    "tecidos_cust_raw": [],
}

# Cache em memória do mapeamento de fábricas e locais (DIVISAO_FABRICAS.json)
_cache_divisao_fabricas: Optional[Dict[str, Any]] = None
_cache_divisao_fabricas_mtime: float = 0.0


def carregar_divisao_fabricas() -> Dict[str, Any]:
    """Carrega dinamicamente a divisão de fábricas e locais com metadados de ícones."""
    global _cache_divisao_fabricas, _cache_divisao_fabricas_mtime
    arquivo = getattr(settings, "DIVISAO_FABRICAS_FILE", settings.DATA_DIR / "DIVISAO_FABRICAS.json")
    if not arquivo.exists():
        return {"metadados_fabricas": {}, "dados": []}

    try:
        mtime = arquivo.stat().st_mtime
        if _cache_divisao_fabricas is not None and mtime == _cache_divisao_fabricas_mtime:
            return _cache_divisao_fabricas
        with open(arquivo, "r", encoding="utf-8") as f:
            conteudo = json.load(f)
        _cache_divisao_fabricas = conteudo
        _cache_divisao_fabricas_mtime = mtime
        return conteudo
    except Exception as e:
        print(f"[service] Erro ao carregar DIVISAO_FABRICAS.json: {e}")
        return _cache_divisao_fabricas or {"metadados_fabricas": {}, "dados": []}


# Cache das famílias dos componentes iniciados em '3'
_cache_familias_3: Optional[List[Dict[str, Any]]] = None


def obter_familias_componentes_3(session_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """
    Retorna a lista de todas as famílias distintas associadas aos componentes que começam com '3',
    incluindo o grupo predominante e a quantidade de itens únicos.
    """
    global _cache_familias_3
    if _cache_familias_3 is not None:
        return _cache_familias_3

    df = obter_cons_efetivo(recarregar=False, session_id=session_id)
    if df.empty or "Item" not in df.columns or "Familia" not in df.columns:
        return []

    # Componentes iniciados em 3
    mask_3 = df["Item"].astype(str).str.startswith("3")
    df_3 = df[mask_3].copy()
    if df_3.empty:
        return []

    # Garante que família CST esteja devidamente mapeada para tecidos CST
    itens_cst = _enriquecimento.get("itens_cst", set()) if _enriquecimento else set()
    if itens_cst:
        mask_cst = df_3["Item"].isin(itens_cst)
        df_3.loc[mask_cst, "Familia"] = "CST"

    tem_grupo = "Grupo" in df_3.columns
    familias_list = []
    for fam_val, grp_df in df_3.groupby("Familia"):
        fam_str = str(fam_val or "").strip().upper()
        if not fam_str or fam_str in ("NONE", "NAN", ""):
            continue
        grupo_str = ""
        if tem_grupo:
            val_counts = grp_df["Grupo"].dropna().astype(str).str.strip().value_counts()
            if not val_counts.empty:
                grupo_str = val_counts.index[0]
        familias_list.append({
            "familia": fam_str,
            "grupo": grupo_str,
            "total_itens": int(grp_df["Item"].nunique()),
        })

    familias_list.sort(key=lambda x: x["familia"])
    _cache_familias_3 = familias_list
    return familias_list


# ==============================================================================
# Gestão de Sessões Isoladas por Usuário / Navegador (Cookies)
# ==============================================================================


class SessionState:
    """Estado de execução isolado por sessão (identificado por cookie no navegador)."""

    def __init__(self, session_id: str):
        self.session_id: str = session_id
        # num_pedido -> {"datas_por_item": ..., "default_datas": ...}
        self.pedidos_carteira_simulados: Dict[str, Dict[str, Any]] = {}
        # num_pedido -> df_ped
        self.pedidos_simulados_novos: Dict[str, pd.DataFrame] = {}
        # num_pedido -> {"pedido": ..., "origem": ..., "data_entrega": ..., "qtd_itens_finais": ...}
        self.meta_simulados: Dict[str, Dict[str, Any]] = {}
        self.simulacao_versao: int = 0
        # Cache MRP em 2 camadas: base (pré-filtro Baixa/Tipo) e filas filtradas
        self.cache_mrp_base: Dict[Tuple[Any, ...], Tuple[pd.DataFrame, pd.DataFrame, List[str]]] = {}
        self.cache_filas: Dict[Tuple[Any, ...], Tuple[pd.DataFrame, pd.DataFrame, List[str]]] = {}
        # Caches em memória de telas pesadas por hash de filtros
        self.cache_resumo_faltantes: Dict[Tuple[Any, ...], Dict[str, Any]] = {}
        self.cache_matriz: Dict[Tuple[Any, ...], Dict[str, Any]] = {}
        self.cache_view_itens: Dict[Tuple[Any, ...], Tuple[pd.DataFrame, Dict[str, Any], int]] = {}
        self.created_at: float = time.time()
        self.last_accessed: float = time.time()
        self.lock = threading.Lock()

    def invalidar_cache_fila(self) -> None:
        self.simulacao_versao += 1
        self.cache_mrp_base.clear()
        self.cache_filas.clear()
        self.cache_resumo_faltantes.clear()
        self.cache_matriz.clear()
        self.cache_view_itens.clear()
        self.last_accessed = time.time()

    def tocar(self) -> None:
        self.last_accessed = time.time()


_sessions: Dict[str, SessionState] = {}
_sessions_lock = threading.Lock()
_last_session_cleanup: float = 0.0
_SESSION_ID_REGEX = re.compile(r"^[a-zA-Z0-9_\-]{8,64}$")


def gerar_session_id() -> str:
    """Gera um identificador criptograficamente aleatório e seguro para a sessão."""
    return uuid.uuid4().hex


def is_valid_session_id(sid: Optional[str]) -> bool:
    """Valida se o session_id segue o padrão alfanumérico seguro."""
    if not sid or not isinstance(sid, str):
        return False
    return bool(_SESSION_ID_REGEX.match(sid.strip()))


def obter_sessao(session_id: Optional[str] = None) -> SessionState:
    """
    Recupera ou inicializa a sessão isolada para o ID fornecido.
    Fallback seguro para a sessão 'default' se nenhum session_id válido for informado.
    """
    global _last_session_cleanup
    sid = str(session_id or "").strip()
    if not is_valid_session_id(sid):
        sid = "default"

    now = time.time()
    with _sessions_lock:
        if now - _last_session_cleanup > 600:
            _limpar_sessoes_expiradas_locked(now)
            _last_session_cleanup = now

        sess = _sessions.get(sid)
        if sess is None:
            sess = SessionState(session_id=sid)
            _sessions[sid] = sess
        sess.tocar()
        return sess


def _limpar_sessoes_expiradas_locked(now: float) -> None:
    ttl = getattr(settings, "SESSION_TTL_SECONDS", 86400 * 2)
    expiradas = [
        sid for sid, s in _sessions.items()
        if sid != "default" and (now - s.last_accessed) > ttl
    ]
    for sid in expiradas:
        _sessions.pop(sid, None)


def _obter_escopo_cache_sessao(sess: SessionState) -> Tuple[bool, int]:
    """Retorna (sem_simulacao, sim_ver_efetiva) de forma thread-safe."""
    with sess.lock:
        sem_sim = (
            not sess.meta_simulados
            and not sess.pedidos_carteira_simulados
            and not sess.pedidos_simulados_novos
        )
        return sem_sim, (0 if sem_sim else sess.simulacao_versao)


def _selecionar_cache(
    sess: SessionState,
    nome_cache: str,
) -> Tuple[threading.Lock, Dict[Any, Any], int]:
    """Seleciona o cache global compartilhado (sem simulação) ou o cache isolado da sessão."""
    sem_sim, sim_ver = _obter_escopo_cache_sessao(sess)
    if sem_sim:
        mapa_global = {
            "mrp_base": _global_cache_mrp_base,
            "filas": _global_cache_filas,
            "matriz": _global_cache_matriz,
            "resumo_faltantes": _global_cache_resumo_faltantes,
            "view_itens": _global_cache_view_itens,
        }
        return _global_cache_lock, mapa_global[nome_cache], sim_ver

    mapa_sess = {
        "mrp_base": sess.cache_mrp_base,
        "filas": sess.cache_filas,
        "matriz": sess.cache_matriz,
        "resumo_faltantes": sess.cache_resumo_faltantes,
        "view_itens": sess.cache_view_itens,
    }
    return sess.lock, mapa_sess[nome_cache], sim_ver


def invalidar_todas_as_sessoes() -> None:
    """Invalida o cache de filas de todas as sessões ativas e dos caches globais compartilhados."""
    with _global_cache_lock:
        _global_cache_mrp_base.clear()
        _global_cache_filas.clear()
        _global_cache_matriz.clear()
        _global_cache_resumo_faltantes.clear()
        _global_cache_view_itens.clear()
    with _sessions_lock:
        for s in _sessions.values():
            with s.lock:
                s.invalidar_cache_fila()


def _invalidar_cache_fila() -> None:
    """Alias retrocompatível para invalidação geral de caches ao recarregar snapshot."""
    invalidar_todas_as_sessoes()


def obter_info_sessao(session_id: Optional[str] = None) -> Dict[str, Any]:
    """Retorna dados diagnósticos da sessão atual."""
    sess = obter_sessao(session_id)
    with sess.lock:
        return {
            "session_id": sess.session_id,
            "qtd_pedidos_simulados": len(sess.meta_simulados),
            "pedidos_simulados": list(sess.meta_simulados.keys()),
            "versao_simulacao": sess.simulacao_versao,
            "criada_em": datetime.fromtimestamp(sess.created_at).strftime("%d/%m/%Y %H:%M:%S"),
            "ultimo_acesso": datetime.fromtimestamp(sess.last_accessed).strftime("%d/%m/%Y %H:%M:%S"),
        }


def obter_info_carregamento() -> Dict[str, str]:
    """Data/hora do snapshot (base ERP), do cálculo em memória e das OCs da Intranet."""
    return {
        "data_carga": _cache_data_snapshot or "",
        "data_carregamento": _cache_data_calculo or "",
        "data_oc": _cache_data_oc or scraper.obter_data_cache_oc(),
        "snapshot": _cache_snapshot_nome or "",
    }


def _parse_data_br_flex(valor: Any) -> Tuple[str, str]:
    """
    Normaliza uma data (Timestamp, DD/MM/YYYY, DD/MM/YYYY., YYYY-MM-DD) para
    (data_formatada_br 'DD/MM/YYYY', chave_ordenacao 'YYYY-MM-DD' ou '9999-12-31').
    """
    if valor is None or (isinstance(valor, float) and np.isnan(valor)):
        return "", "9999-12-31"
    if isinstance(valor, pd.Timestamp):
        if pd.isna(valor):
            return "", "9999-12-31"
        return valor.strftime("%d/%m/%Y"), valor.strftime("%Y-%m-%d")

    s = str(valor).strip().rstrip(".")
    if not s or s.lower() in ("nan", "nat", "none", "0"):
        return "", "9999-12-31"

    m_br = re.match(r"^(\d{2})/(\d{2})/(\d{4})", s)
    if m_br:
        d, m, y = m_br.group(1), m_br.group(2), m_br.group(3)
        return f"{d}/{m}/{y}", f"{y}-{m}-{d}"

    m_iso = re.match(r"^(\d{4})-(\d{2})-(\d{2})", s)
    if m_iso:
        y, m, d = m_iso.group(1), m_iso.group(2), m_iso.group(3)
        return f"{d}/{m}/{y}", f"{y}-{m}-{d}"

    apenas_dig = re.sub(r"[^\d]", "", s)
    if len(apenas_dig) == 8:
        d, m, y = apenas_dig[:2], apenas_dig[2:4], apenas_dig[4:8]
        return f"{d}/{m}/{y}", f"{y}-{m}-{d}"

    dt = pd.to_datetime(s, errors="coerce", dayfirst=True)
    if pd.notna(dt):
        return dt.strftime("%d/%m/%Y"), dt.strftime("%Y-%m-%d")
    return "", "9999-12-31"


def _eh_data_prioridade_2030(dt_sort: Any) -> bool:
    """Identifica datas no ano 2030, tratadas pelo ERP como itens em atraso / prioridade máxima."""
    return str(dt_sort or "").strip().startswith("2030-")


def _construir_mapas_enriquecimento(
    dfs: Dict[str, pd.DataFrame], df_consumo: pd.DataFrame, forcar_oc: bool = False
) -> Dict[str, Any]:
    """
    Indexa estoque L, Tipo (C/P), Baixa (S/N), Local Prod, Fábrica, Descrição,
    Ordens de Produção de Componentes (com Abertura e Entrega) e Ordens de Compra abertas (OC).
    """
    estoque_map: Dict[str, float] = {}
    tipo_map: Dict[str, str] = {}
    baixa_map: Dict[str, str] = {}
    local_prod_map: Dict[str, str] = {}
    fabrica_item_map: Dict[str, str] = {}
    desc_item_map: Dict[str, str] = {}

    op_por_numero: Dict[str, Dict[str, Any]] = {}
    op_por_item_pedido: Dict[Tuple[str, str], List[Dict[str, Any]]] = {}
    op_por_item_lote: Dict[str, List[Dict[str, Any]]] = {}
    op_por_item_todos: Dict[str, List[Dict[str, Any]]] = {}

    oc_por_item_ped_it: Dict[Tuple[str, str, str], List[Dict[str, Any]]] = {}
    oc_por_item_ped: Dict[Tuple[str, str], List[Dict[str, Any]]] = {}
    oc_por_item_it_sem_ped: Dict[Tuple[str, str], List[Dict[str, Any]]] = {}
    oc_por_item_geral: Dict[str, List[Dict[str, Any]]] = {}
    oc_por_item_todas: Dict[str, List[Dict[str, Any]]] = {}

    # 1. Apoio compras (Baixa, Descrição de comprados, Identificação CST e itens com OC > 0)
    itens_cst: Set[str] = set()
    itens_apoio_com_oc: List[str] = []
    itens_apoio_oc_vistos: Set[str] = set()
    raw_apoio = dfs.get("apoio_compras")
    if raw_apoio is not None:
        df_ap = raw_apoio.to_pandas() if isinstance(raw_apoio, pl.DataFrame) else raw_apoio
        col_fam = "Família" if "Família" in df_ap.columns else ("Familia" if "Familia" in df_ap.columns else None)
        tem_col_oc = "OC" in df_ap.columns
        if "Item" in df_ap.columns:
            for rec in df_ap.to_dict("records"):
                it = scraper.normalizar_cod_item(rec.get("Item"))
                if not it:
                    continue
                bx = str(rec.get("Baixa") or "").strip().upper()
                if bx in ("S", "N"):
                    baixa_map[it] = bx
                desc = str(rec.get("Descrição") or "").strip()
                if desc and it not in desc_item_map:
                    desc_item_map[it] = desc
                if col_fam and str(rec.get(col_fam) or "").strip().upper() == "CST":
                    itens_cst.add(it)
                if tem_col_oc and it not in itens_apoio_oc_vistos:
                    if scraper.parse_numero_flexivel(rec.get("OC"), default=0.0) > 0:
                        itens_apoio_oc_vistos.add(it)
                        itens_apoio_com_oc.append(it)

    # Identificação complementar de tecidos CST a partir de cons
    if "Familia" in df_consumo.columns and "Item" in df_consumo.columns:
        mask_cst_cons = df_consumo["Familia"].astype(str).str.strip().str.upper() == "CST"
        for it_raw in df_consumo.loc[mask_cst_cons, "Item"].dropna():
            it_cst = scraper.normalizar_cod_item(it_raw)
            if it_cst:
                itens_cst.add(it_cst)

    # Sinaliza sigla CST na descrição de todos os tecidos da família CST
    def _sinalizar_cst(desc_val: str) -> str:
        s = str(desc_val or "").strip()
        if not s or s == ".":
            return "[CST]"
        if re.search(r"\bCST\b", s, re.IGNORECASE):
            return s
        return f"[CST] {s}"

    for it in itens_cst:
        if it in desc_item_map:
            desc_item_map[it] = _sinalizar_cst(desc_item_map[it])

    if "Den. Item" in df_consumo.columns and "Item" in df_consumo.columns:
        mask_cst_df = df_consumo["Item"].isin(itens_cst)
        if "Familia" in df_consumo.columns:
            mask_cst_df |= df_consumo["Familia"].astype(str).str.strip().str.upper() == "CST"
        df_consumo.loc[mask_cst_df, "Den. Item"] = df_consumo.loc[mask_cst_df, "Den. Item"].apply(_sinalizar_cst)

    # 2. Estoque Situação L (saldo exclui locais desconsiderados, ex.: TERCEIROS; metadados mantêm base completa)
    raw_estoque = dfs.get("estoque")
    if raw_estoque is not None:
        df_est = raw_estoque.to_pandas() if isinstance(raw_estoque, pl.DataFrame) else raw_estoque.copy()
        if df_est is not None and "Item" in df_est.columns:
            df_est_clean = df_est.copy()
            df_est_clean["_item_norm"] = df_est_clean["Item"].apply(scraper.normalizar_cod_item)
            df_est_saldo = filtrar_estoque_valido(df_est_clean)
            if not df_est_saldo.empty and "Qtde." in df_est_saldo.columns:
                qt_num = parse_numero_br_series(df_est_saldo["Qtde."])
                soma_est = qt_num.groupby(df_est_saldo["_item_norm"]).sum().round(2)
                estoque_map = {str(k): round(float(v), 2) for k, v in soma_est.to_dict().items() if k}

            for rec in df_est_clean.drop_duplicates("_item_norm").to_dict("records"):
                it = rec.get("_item_norm")
                if not it:
                    continue
                sb = str(rec.get("Sofre Baixa?") or "").strip().upper()
                if sb.startswith("S"):
                    baixa_map[it] = "S"
                elif sb.startswith("N"):
                    baixa_map[it] = "N"

                lp = str(rec.get("Local Prod.") or "").strip()
                if lp and lp not in ("0", ".", "None", "nan"):
                    local_prod_map[it] = lp
                    if it.startswith("1"):
                        fabrica_item_map[it] = lp

                desc = str(rec.get("Descrição") or "").strip()
                if desc and desc != ".":
                    desc_item_map[it] = desc

    # 3. Ordens (Descrição comercial, Fábrica e Ordens de Produção de Componentes com Datas de Abertura e Entrega)
    raw_ordens = dfs.get("ordens")
    if raw_ordens is not None:
        df_ord = raw_ordens.to_pandas() if isinstance(raw_ordens, pl.DataFrame) else raw_ordens
        if "Item" in df_ord.columns:
            ops_temp: List[Tuple[Tuple[str, str, int], str, Dict[str, Any]]] = []
            for rec in df_ord.to_dict("records"):
                it = scraper.normalizar_cod_item(rec.get("Item"))
                if not it:
                    continue
                desc = str(rec.get("Descrição do Item") or "").strip()
                if desc and desc != ".":
                    desc_item_map[it] = desc
                fab = str(rec.get("Fábrica") or "").strip()
                if fab and fab not in ("0", ".", "None", "nan"):
                    fabrica_item_map[it] = fab
                else:
                    fab = ""

                op_raw = str(rec.get("Ordem") or "").strip().removesuffix(".0")
                op_digits = re.sub(r"[^\d]", "", op_raw)
                op_str = str(int(op_digits)) if op_digits else op_raw
                if not op_str:
                    continue

                ped_norm = _normalizar_pedido_valido(rec.get("Pedido"))

                dt_ab_br, dt_ab_sort = _parse_data_br_flex(rec.get("Data Abertura"))
                dt_ent_br, dt_ent_sort = _parse_data_br_flex(rec.get("Data Entrega"))
                saldo_op = round(scraper.parse_numero_flexivel(rec.get("Saldo"), default=0.0), 2)

                op_info = {
                    "ordem_prod": op_str,
                    "data_abertura": dt_ab_br,
                    "data_abertura_sort": dt_ab_sort,
                    "data_entrega": dt_ent_br,
                    "saldo_op": saldo_op,
                    "fabrica": fab,
                    "pedido_op": ped_norm,
                }
                eh_prio_2030 = _eh_data_prioridade_2030(dt_ab_sort) or _eh_data_prioridade_2030(dt_ent_sort)
                sort_key = (
                    0 if eh_prio_2030 else 1,
                    dt_ent_sort,
                    dt_ab_sort,
                    int(op_digits) if op_digits else 999999999,
                )
                ops_temp.append((sort_key, it, op_info))

            ops_temp.sort(key=lambda x: x[0])
            for _, it, op_info in ops_temp:
                op_num = op_info["ordem_prod"]
                ped_op = op_info["pedido_op"]
                op_por_numero[op_num] = op_info
                op_por_item_todos.setdefault(it, []).append(op_info)
                if ped_op:
                    op_por_item_pedido.setdefault((it, ped_op), []).append(op_info)
                else:
                    op_por_item_lote.setdefault(it, []).append(op_info)

    # 4. Consumo calculado (Tipo, Baixa e Local Prod reais praticados nas OPs)
    if df_consumo is not None and not df_consumo.empty and "Item" in df_consumo.columns:
        sub_cons = df_consumo.dropna(subset=["Item"]).drop_duplicates("Item")
        for rec in sub_cons.to_dict("records"):
            it = scraper.normalizar_cod_item(rec.get("Item"))
            if not it:
                continue
            tp = str(rec.get("Tipo") or "").strip().upper()
            if tp:
                tipo_map[it] = tp
            bx = str(rec.get("Baixa") or "").strip().upper()
            if bx in ("S", "N"):
                baixa_map[it] = bx
            lp = str(rec.get("Local Prod.") or "").strip()
            if lp and lp not in ("0", ".", "None", "nan"):
                local_prod_map[it] = lp

    # 5. Ordens de Compra (OCs) e Tecidos CST da Intranet (concorrente quando forcar_oc=True)
    try:
        if forcar_oc and itens_apoio_com_oc:
            ocs_raw, tecidos_cust_raw = scraper.carregar_ou_atualizar_intranet_concorrente(
                forcar_intranet=forcar_oc,
                itens_fallback_vidrosoc=itens_apoio_com_oc,
            )
        else:
            ocs_raw, tecidos_cust_raw = scraper.carregar_ou_atualizar_intranet_concorrente(
                forcar_intranet=forcar_oc
            )
    except Exception as exc:
        print(f"[Enriquecimento Intranet] Aviso na carga concorrente: {exc}")
        try:
            ocs_raw = scraper.carregar_ou_atualizar_oc_abertas(forcar_intranet=False)
        except Exception:
            ocs_raw = []
        try:
            tecidos_cust_raw = scraper.carregar_ou_atualizar_tecidos_customizados(forcar_intranet=False)
        except Exception:
            tecidos_cust_raw = []

    if ocs_raw:
        ocs_temp: List[Tuple[Tuple[int, str, str, int], str, Dict[str, Any]]] = []
        for rec in ocs_raw:
            it = scraper.normalizar_cod_item(rec.get("item"))
            oc_num = str(rec.get("oc_numero") or "").strip()
            if not it or not oc_num:
                continue
            dt_prev_br, dt_prev_sort = _parse_data_br_flex(rec.get("previsao"))
            dt_orig_br, dt_orig_sort = _parse_data_br_flex(rec.get("data_origem"))
            dt_emis_br, _ = _parse_data_br_flex(rec.get("emissao_oc"))
            saldo_oc = round(float(rec.get("saldo") or 0.0), 2)
            ped_vinc = rec.get("pedido_vinculado")
            it_vinc = rec.get("item_final_vinculado")

            oc_info = {
                "oc_numero": oc_num,
                "previsao": dt_prev_br,
                "previsao_sort": dt_prev_sort,
                "data_origem": dt_orig_br,
                "emissao_oc": dt_emis_br,
                "saldo": saldo_oc,
                "unidade": str(rec.get("unidade") or ""),
                "fornecedor": str(rec.get("fornecedor") or ""),
                "comprador": str(rec.get("comprador") or ""),
                "programador": str(rec.get("programador") or ""),
                "pedido_compra": str(rec.get("pedido_compra") or ""),
                "sit_oc": str(rec.get("sit_oc") or "P"),
                "familia": str(rec.get("familia") or ""),
                "texto": str(rec.get("texto") or ""),
                "pedido_vinculado": ped_vinc,
                "item_final_vinculado": it_vinc,
            }
            oc_digits = re.sub(r"[^\d]", "", oc_num)
            sort_key = (
                0 if saldo_oc > 0 else 1,
                dt_prev_sort,
                dt_orig_sort,
                int(oc_digits) if oc_digits else 999999999,
            )
            ocs_temp.append((sort_key, it, oc_info))

        ocs_temp.sort(key=lambda x: x[0])
        for _, it, oc_info in ocs_temp:
            ped_vinc = oc_info["pedido_vinculado"]
            it_vinc = oc_info["item_final_vinculado"]
            oc_por_item_todas.setdefault(it, []).append(oc_info)
            if ped_vinc and ped_vinc not in _PEDIDOS_IGNORADOS_STR:
                oc_por_item_ped.setdefault((it, ped_vinc), []).append(oc_info)
                if it_vinc:
                    oc_por_item_ped_it.setdefault((it, ped_vinc, it_vinc), []).append(oc_info)
            else:
                if ped_vinc in _PEDIDOS_IGNORADOS_STR and it_vinc:
                    oc_por_item_it_sem_ped.setdefault((it, it_vinc), []).append(oc_info)
                oc_por_item_geral.setdefault(it, []).append(oc_info)

    # 6. Mapeamento de Tecidos Customizados da Família CST (/pcp/tecidos_customizados3.php)
    tc_map_4: Dict[Tuple[str, str, str, str], Dict[str, Any]] = {}
    tc_map_3_ped: Dict[Tuple[str, str, str], Dict[str, Any]] = {}
    tc_map_3_ord: Dict[Tuple[str, str], Dict[str, Any]] = {}
    tc_map_3_item: Dict[Tuple[str, str, str], Dict[str, Any]] = {}

    for r in tecidos_cust_raw:
        p = scraper.normalizar_numero_pedido(r.get("pedido") or r.get("Pedido"))
        o = re.sub(r"[^\d]", "", str(r.get("ordem") or r.get("Ordem") or ""))
        it_p = scraper.normalizar_cod_item(r.get("item") or r.get("Item"))
        tec = scraper.normalizar_cod_item(r.get("tecido") or r.get("Tecido"))

        reg_dict = dict(r)
        tc_map_4[(p, o, it_p, tec)] = reg_dict
        if (p, o, tec) not in tc_map_3_ped:
            tc_map_3_ped[(p, o, tec)] = reg_dict
        if (o, tec) not in tc_map_3_ord:
            tc_map_3_ord[(o, tec)] = reg_dict
        if (p, it_p, tec) not in tc_map_3_item:
            tc_map_3_item[(p, it_p, tec)] = reg_dict

    # Garante que todos os itens CST em desc_item_map estejam sinalizados com a sigla CST
    for it in itens_cst:
        desc_cur = desc_item_map.get(it, "")
        if desc_cur:
            desc_item_map[it] = _sinalizar_cst(desc_cur)
        else:
            desc_item_map[it] = "[CST]"

    return {
        "estoque": estoque_map,
        "tipo": tipo_map,
        "baixa": baixa_map,
        "local_prod": local_prod_map,
        "fabrica_item": fabrica_item_map,
        "desc_item": desc_item_map,
        "op_por_numero": op_por_numero,
        "op_por_item_pedido": op_por_item_pedido,
        "op_por_item_lote": op_por_item_lote,
        "op_por_item_todos": op_por_item_todos,
        "oc_por_item_ped_it": oc_por_item_ped_it,
        "oc_por_item_ped": oc_por_item_ped,
        "oc_por_item_it_sem_ped": oc_por_item_it_sem_ped,
        "oc_por_item_geral": oc_por_item_geral,
        "oc_por_item_todas": oc_por_item_todas,
        "itens_cst": itens_cst,
        "tc_map_4": tc_map_4,
        "tc_map_3_ped": tc_map_3_ped,
        "tc_map_3_ord": tc_map_3_ord,
        "tc_map_3_item": tc_map_3_item,
        "tecidos_cust_raw": tecidos_cust_raw,
    }


def buscar_info_tecido_cst(
    pedido: Any,
    ordem: Any,
    item_produto: Any,
    tecido: Any,
) -> Optional[Dict[str, Any]]:
    """
    Busca na tabela /pcp/tecidos_customizados3.php a linha correspondente a (pedido, ordem, item_produto, tecido).
    Utiliza resolução em cascata (4 campos -> 3 campos -> 2 campos) para máxima tolerância operacional.
    """
    p = scraper.normalizar_numero_pedido(pedido)
    o = re.sub(r"[^\d]", "", str(ordem or ""))
    it_p = scraper.normalizar_cod_item(item_produto)
    tec = scraper.normalizar_cod_item(tecido)

    m4 = _enriquecimento.get("tc_map_4", {})
    if (p, o, it_p, tec) in m4:
        return m4[(p, o, it_p, tec)]

    m3_ped = _enriquecimento.get("tc_map_3_ped", {})
    if (p, o, tec) in m3_ped:
        return m3_ped[(p, o, tec)]

    m3_item = _enriquecimento.get("tc_map_3_item", {})
    if (p, it_p, tec) in m3_item:
        return m3_item[(p, it_p, tec)]

    m3_ord = _enriquecimento.get("tc_map_3_ord", {})
    if (o, tec) in m3_ord:
        return m3_ord[(o, tec)]

    return None


def sincronizar_base_snapshots(forcar: bool = False) -> Dict[str, Any]:
    """Sincroniza snapshots a partir da API remota (366n:8001) e recarrega o cache em memória."""
    res = sincronizar_snapshots_remotos(forcar=forcar)
    if res.get("baixados") or forcar:
        gerar_dataframe_cons(forcar_oc=True, sincronizar_snapshot=False)
    return res


def gerar_dataframe_cons(
    salvar_excel: bool = False,
    forcar_oc: bool = False,
    sincronizar_snapshot: bool = False,
) -> pd.DataFrame:
    """
    Gera o DataFrame 'cons' completo através de calc_data(dfs) sobre o snapshot mais recente,
    SEM filtros restritivos (preserva Tipo 'C', 'P', 'T', 'F' e todas as datas de entrega).
    Quando sincronizar_snapshot=True (ou settings.SNAPSHOTS_AUTO_SYNC), consulta e atualiza
    snapshots remotos via http://366n:8001/api/snapshots.
    Quando forcar_oc=True (ou quando chegar snapshot novo / cache OC expirar ou for legado),
    atualiza também a base de OCs abertas diretamente na Intranet.
    """
    baixou_snapshot = False
    if sincronizar_snapshot or settings.SNAPSHOTS_AUTO_SYNC:
        try:
            res_sync = sincronizar_snapshots_remotos(forcar=False)
            if res_sync.get("baixados"):
                baixou_snapshot = True
                print(
                    f"[{datetime.now().strftime('%H:%M:%S')}] Novos snapshots baixados do servidor remoto: {res_sync['baixados']}"
                )
        except Exception as e_sync:
            print(f"[SNAPSHOT] Aviso: Falha não impeditiva ao sincronizar com servidor remoto: {e_sync}")

    print(f"[{datetime.now().strftime('%H:%M:%S')}] Carregando snapshot...")
    dfs, caminho = carregar_snapshot()
    cache_pqt = caminho / "_cons_calculado.parquet"
    cache_meta = caminho / "_cons_calculado.meta.json"
    source_mtime = max(
        [f.stat().st_mtime for f in caminho.glob("*.parquet") if not f.name.startswith("_")],
        default=0.0,
    )
    df_consumo = None
    if not sincronizar_snapshot and cache_pqt.exists() and cache_pqt.stat().st_mtime >= source_mtime:
        _meta_valido = False
        if cache_meta.exists():
            try:
                with open(cache_meta, "r", encoding="utf-8") as f_meta:
                    meta_obj = json.load(f_meta)
                _meta_valido = meta_obj == _CONS_CACHE_RULES
            except Exception as e_meta:
                print(f"[CACHE] Aviso ao ler metadados de cache ({cache_meta.name}): {e_meta}. Recalculando...")
        if not _meta_valido:
            print(f"[CACHE] Regras de cálculo alteradas ou metadados ausentes ({cache_meta.name}). Recalculando...")
        else:
            try:
                print(f"[{datetime.now().strftime('%H:%M:%S')}] Carregando base pré-calculada '{cache_pqt.name}'...")
                df_consumo = pl.read_parquet(cache_pqt).to_pandas()
                _peds_proib_int = _PEDIDOS_IGNORADOS_INT - {0}
                _peds_proib_str = _PEDIDOS_IGNORADOS_STR - {"0"}
                _cache_tem_ignorado = False
                if "Pedido" in df_consumo.columns and pd.to_numeric(df_consumo["Pedido"], errors="coerce").isin(_peds_proib_int).any():
                    _cache_tem_ignorado = True
                elif "raiz_Pedido" in df_consumo.columns and pd.to_numeric(df_consumo["raiz_Pedido"], errors="coerce").isin(_peds_proib_int).any():
                    _cache_tem_ignorado = True
                elif "raiz_Pedido_Str" in df_consumo.columns and df_consumo["raiz_Pedido_Str"].astype(str).str.strip().isin(_peds_proib_str).any():
                    _cache_tem_ignorado = True
                if _cache_tem_ignorado:
                    print("[CACHE] Cache pré-calculado contém pedidos desconsiderados (100/1000). Recalculando...")
                    df_consumo = None
            except Exception as e_read:
                print(f"[CACHE] Aviso ao ler cache persistente: {e_read}. Recalculando...")
                df_consumo = None

    if df_consumo is None:
        print(f"[{datetime.now().strftime('%H:%M:%S')}] Snapshot '{caminho.name}' carregado. Executando calc_data...")
        df_consumo = calc_data(dfs)

        if isinstance(df_consumo, pl.DataFrame):
            df_consumo = df_consumo.to_pandas()

        # Mapeia descrição do Item Final a partir de ordens
        raw_ordens = dfs.get("ordens")
        if raw_ordens is not None and "Item" in raw_ordens.columns and "Descrição do Item" in raw_ordens.columns:
            desc_map = (
                raw_ordens.dropna(subset=["Item"])
                .drop_duplicates("Item")
                .set_index("Item")["Descrição do Item"]
                .to_dict()
            )
            df_consumo["raiz_Descricao"] = df_consumo["raiz_Item Final"].map(desc_map).fillna("")
        else:
            df_consumo["raiz_Descricao"] = ""

        # Normalizações seguras
        if "raiz_Pedido" in df_consumo.columns:
            df_consumo["raiz_Pedido_Str"] = (
                pd.to_numeric(df_consumo["raiz_Pedido"], errors="coerce")
                .fillna(0)
                .astype(int)
                .astype(str)
                .replace(_MAPA_LIMPAR_PEDIDO_STR)
            )
        else:
            df_consumo["raiz_Pedido_Str"] = ""

        if "raiz_Fábrica" in df_consumo.columns:
            df_consumo["raiz_Fábrica"] = (
                df_consumo["raiz_Fábrica"].fillna("NÃO INFORMADO").astype(str).str.strip()
            )

        if "Consumo" in df_consumo.columns:
            df_consumo["Consumo"] = (
                pd.to_numeric(df_consumo["Consumo"], errors="coerce").fillna(0.0).round(2)
            )

        if "estoque" in df_consumo.columns:
            df_consumo["estoque"] = (
                pd.to_numeric(df_consumo["estoque"], errors="coerce").fillna(0.0).round(2)
            )

        if "Saldo" in df_consumo.columns:
            df_consumo["Saldo"] = (
                pd.to_numeric(df_consumo["Saldo"], errors="coerce").fillna(0.0).round(2)
            )

        if "raiz_Saldo" in df_consumo.columns:
            df_consumo["raiz_Saldo"] = (
                pd.to_numeric(df_consumo["raiz_Saldo"], errors="coerce").fillna(0.0).round(2)
            )

        df_consumo["simulado"] = False
        df_consumo["origem_simulacao"] = ""

        try:
            pl.from_pandas(df_consumo).write_parquet(cache_pqt)
            with open(cache_meta, "w", encoding="utf-8") as f_meta:
                json.dump(_CONS_CACHE_RULES, f_meta, ensure_ascii=False, indent=2)
        except Exception as e_write:
            print(f"[CACHE] Aviso ao persistir {cache_pqt.name}: {e_write}")

    if salvar_excel:
        dest_excel = settings.EXPORTS_DIR / "consumo_completo.xlsx"
        print(f"Salvando DataFrame completo sem filtros em {dest_excel}...")
        df_consumo.to_excel(dest_excel, index=False)

    global _cache_cons, _cache_timestamp, _cache_data_calculo, _cache_snapshot_nome, _cache_data_snapshot, _cache_data_oc, _enriquecimento, _cache_familias_3
    forcar_oc_efetivo = bool(forcar_oc or baixou_snapshot)
    if not forcar_oc_efetivo:
        try:
            if scraper.cache_oc_expirado(referencia_mtime=source_mtime):
                forcar_oc_efetivo = True
        except Exception:
            pass

    _enriquecimento = _construir_mapas_enriquecimento(dfs, df_consumo, forcar_oc=forcar_oc_efetivo)
    _cache_cons = df_consumo
    _cache_familias_3 = None
    _cache_timestamp = time.time()
    _cache_data_calculo = datetime.now().strftime("%d/%m/%Y %H:%M:%S")
    _cache_snapshot_nome = caminho.name
    _cache_data_snapshot = data_snapshot(caminho)
    _cache_data_oc = scraper.obter_data_cache_oc()
    _invalidar_cache_fila()

    return df_consumo


def _agendar_refresh_oc_background() -> None:
    """Dispara atualização única em background das OCs quando o cache expira (SWR)."""
    global _bg_refresh_running
    with _bg_refresh_lock:
        if _bg_refresh_running:
            return
        _bg_refresh_running = True

    def _worker() -> None:
        global _bg_refresh_running
        try:
            with _cons_load_lock:
                gerar_dataframe_cons(forcar_oc=True, sincronizar_snapshot=False)
        except Exception as exc:
            print(f"[SWR] Aviso ao atualizar OCs em background: {exc}")
        finally:
            with _bg_refresh_lock:
                _bg_refresh_running = False

    threading.Thread(
        target=_worker,
        name="swr-refresh-oc",
        daemon=True,
    ).start()


def obter_cons_com_cache(
    recarregar: bool = False,
    forcar_oc: bool = False,
    sincronizar_snapshot: bool = False,
) -> pd.DataFrame:
    """Retorna o DataFrame 'cons' base com cache em memória (recarregar=True relê o snapshot e forcar_oc=True busca OCs frescas na Intranet)."""
    if recarregar or forcar_oc:
        with _cons_load_lock:
            return gerar_dataframe_cons(
                forcar_oc=forcar_oc,
                sincronizar_snapshot=sincronizar_snapshot or recarregar,
            )

    if _cache_cons is None:
        with _cons_load_lock:
            if _cache_cons is None:
                return gerar_dataframe_cons(
                    forcar_oc=False,
                    sincronizar_snapshot=sincronizar_snapshot,
                )

    try:
        if scraper.cache_oc_expirado():
            _agendar_refresh_oc_background()
    except Exception:
        pass
    return _cache_cons


def aquecer_cache_inicial() -> None:
    """Pré-aquece o snapshot base e a fila MRP padrão em background sem derrubar o boot."""
    try:
        obter_cons_com_cache(recarregar=False)
        _obter_fila_calculada(
            baixa_filtro="TODOS",
            tipo_filtro="TODOS",
            session_id="default",
        )
    except Exception as exc:
        print(f"[Warmup] Aviso ao aquecer cache inicial: {exc}")


def obter_pedidos_existentes_na_tabela() -> Set[str]:
    """Conjunto de números de pedido que já possuem itens finais ativos na tabela atual do snapshot."""
    df_base = obter_cons_com_cache()
    validos = df_base.loc[df_base["raiz_Item Final"].notna(), "raiz_Pedido_Str"]
    pedidos = {
        str(x).strip()
        for x in validos.dropna().unique()
        if str(x).strip() and str(x).strip() not in _PEDIDOS_IGNORADOS_STR
    }
    return pedidos


def _carregar_feriados() -> List[str]:
    """Lê lista de feriados/recessos YYYY-MM-DD de backend/feriados.txt, se existir."""
    arq = settings.BACKEND_DIR / "feriados.txt"
    if not arq.exists():
        return []
    datas: List[str] = []
    try:
        for linha in arq.read_text(encoding="utf-8").splitlines():
            s = linha.strip()
            if len(s) == 10 and s[4] == "-" and s[7] == "-":
                datas.append(s)
    except Exception:
        return []
    return sorted(set(datas))


def calcular_data_abertura_util(
    data_entrega_raw: Optional[str], cod_horizon: Any, tmp_ressup: Any
) -> Tuple[Any, Any]:
    """
    Calcula (dt_entrega, dt_abertura) onde:
      dt_abertura = dt_entrega - (cod_horizon + tmp_ressup) em dias úteis (seg-sex descontando feriados.txt).
    Se data_entrega_raw estiver em branco, retorna (pd.NaT, pd.NaT) para posicionar no fim da fila.
    """
    texto_dt = str(data_entrega_raw or "").strip()
    if not texto_dt:
        return pd.NaT, pd.NaT

    dt_entrega = pd.to_datetime(texto_dt, errors="coerce", dayfirst="/" in texto_dt)
    if pd.isna(dt_entrega):
        return pd.NaT, pd.NaT

    hz = scraper.parse_numero_flexivel(cod_horizon, default=0.0)
    rs = scraper.parse_numero_flexivel(tmp_ressup, default=0.0)
    dias_uteis = max(0, int(round(hz + rs)))

    feriados = _carregar_feriados()
    dt_iso = dt_entrega.strftime("%Y-%m-%d")
    dt_ab_np = np.busday_offset(dt_iso, -dias_uteis, roll="backward", holidays=feriados)
    return pd.Timestamp(dt_entrega).floor("D"), pd.Timestamp(dt_ab_np)


def tratar_estrutura_fantasmas(
    linhas_estrutura: List[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    """
    Remove itens fantasma (ies_tip_item == 'T') da árvore de estrutura de pedidos
    e promove seus filhos para o nível do pai do fantasma na estrutura.

    Regra de negócio:
    - O ERP / PCP da Lider não gera ordem ou reserva de estoque para itens fantasma (tipo 'T').
    - O item fantasma deve ser removido da estrutura.
    - Caso o item fantasma tenha filhos, eles devem ir para o nível do pai do fantasma
      (seu cod_item_pai passa a ser o pai do fantasma, e seu nível na árvore é decrementado
      pelo número de níveis fantasmas colapsados acima).
    """
    if not linhas_estrutura:
        return []

    from collections import defaultdict
    por_raiz: Dict[Tuple[str, str], List[Tuple[int, Dict[str, Any]]]] = defaultdict(list)
    for idx, r in enumerate(linhas_estrutura):
        ped = str(r.get("num_pedido") or "").strip()
        raiz = scraper.normalizar_cod_item(r.get("cod_item"))
        por_raiz[(ped, raiz)].append((idx, r))

    resultado_final: List[Dict[str, Any]] = []

    for (ped, raiz), indexed_rows in por_raiz.items():
        n = len(indexed_rows)
        # Identifica quais linhas são itens fantasma (tipo 'T' ou 'F')
        is_phantom = []
        codigos_fantasmas: Set[str] = set()
        for _, r in indexed_rows:
            tipo = str(r.get("ies_tip_item") or r.get("tipo_item") or r.get("tipo") or "").strip().upper()
            eh_fantasma = tipo in ("T")
            is_phantom.append(eh_fantasma)
            if eh_fantasma:
                cc = scraper.normalizar_cod_item(r.get("cod_item_compon"))
                if cc:
                    codigos_fantasmas.add(cc)

        # Se não há fantasmas nesta árvore, preserva todas as linhas
        if not any(is_phantom):
            for _, r in indexed_rows:
                resultado_final.append(r)
            continue

        # Determina o nó pai de cada linha dentro desta árvore
        parent_idx: List[Optional[int]] = [None] * n
        for j in range(n):
            _, r_j = indexed_rows[j]
            pai_cod = scraper.normalizar_cod_item(r_j.get("cod_item_pai"))
            try:
                nivel_j = int(float(r_j.get("nivel") or 1))
            except (ValueError, TypeError):
                nivel_j = 1

            if not pai_cod or pai_cod == raiz or nivel_j <= 1:
                parent_idx[j] = None
            else:
                p_cand = None
                # 1. Procura para trás na ordem da árvore (preorder) pelo pai com nivel < nivel_j
                for i in range(j - 1, -1, -1):
                    _, r_i = indexed_rows[i]
                    comp_i = scraper.normalizar_cod_item(r_i.get("cod_item_compon"))
                    try:
                        nivel_i = int(float(r_i.get("nivel") or 1))
                    except (ValueError, TypeError):
                        nivel_i = 1

                    if comp_i == pai_cod and nivel_i < nivel_j:
                        p_cand = i
                        break

                # 2. Fallback: qualquer linha anterior com cod_item_compon == pai_cod
                if p_cand is None:
                    for i in range(j - 1, -1, -1):
                        _, r_i = indexed_rows[i]
                        comp_i = scraper.normalizar_cod_item(r_i.get("cod_item_compon"))
                        if comp_i == pai_cod:
                            p_cand = i
                            break

                # 3. Fallback abrangente: qualquer linha na árvore com cod_item_compon == pai_cod
                if p_cand is None:
                    for i in range(n):
                        if i == j:
                            continue
                        _, r_i = indexed_rows[i]
                        comp_i = scraper.normalizar_cod_item(r_i.get("cod_item_compon"))
                        if comp_i == pai_cod:
                            p_cand = i
                            break

                parent_idx[j] = p_cand

        # Processa cada linha não-fantasma
        for j in range(n):
            if is_phantom[j]:
                continue  # Fantasma é removido da estrutura

            orig_idx, r_orig = indexed_rows[j]
            r_novo = dict(r_orig)

            curr_p = parent_idx[j]
            fantasmas_acima = 0
            fator_mult = 1.0
            visited = set()
            while curr_p is not None and is_phantom[curr_p]:
                if curr_p in visited:
                    break
                visited.add(curr_p)
                fantasmas_acima += 1
                _, r_f = indexed_rows[curr_p]
                q_f = scraper.parse_numero_flexivel(r_f.get("qtd_necessaria"), default=1.0)
                if q_f > 0:
                    fator_mult *= q_f
                curr_p = parent_idx[curr_p]

            if curr_p is None:
                r_novo["cod_item_pai"] = raiz
            else:
                _, r_anc = indexed_rows[curr_p]
                r_novo["cod_item_pai"] = r_anc.get("cod_item_compon")

            if fator_mult != 1.0:
                q_orig = scraper.parse_numero_flexivel(r_orig.get("qtd_necessaria"), default=0.0)
                r_novo["qtd_necessaria"] = str(round(q_orig * fator_mult, 4))

            try:
                orig_nivel = int(float(r_orig.get("nivel") or 1))
            except (ValueError, TypeError):
                orig_nivel = 1

            novo_nivel = max(1, orig_nivel - fantasmas_acima)
            r_novo["nivel"] = str(novo_nivel)

            # Sanitiza caminho_pai se presente
            if r_novo.get("caminho_pai"):
                partes = [p.strip() for p in str(r_novo["caminho_pai"]).split(">")]
                partes_limpas = [
                    p for p in partes
                    if scraper.normalizar_cod_item(p) not in codigos_fantasmas
                ]
                r_novo["caminho_pai"] = " > ".join(partes_limpas) if partes_limpas else raiz

            resultado_final.append(r_novo)

    return resultado_final


def _montar_df_pedido_simulado(
    num_pedido: str,
    linhas_estrutura: List[Dict[str, Any]],
    saldos_map: Dict[Tuple[str, str], Dict[str, Any]],
    data_entrega_raw: Optional[str],
) -> Tuple[pd.DataFrame, int]:
    """
    Converte as linhas retornadas por json-pedido-estrutura.php + situacao_pedidos2.php
    para o mesmo schema do DataFrame `df_consumo`.
    Retorna (df_pedido, qtd_itens_finais).
    """
    # 1. Trata e explode itens fantasma (tipo 'T'): remove fantasmas e promove filhos
    linhas_estrutura = tratar_estrutura_fantasmas(linhas_estrutura)
    if not linhas_estrutura:
        return pd.DataFrame(), 0

    # Agrupa linhas por cod_item (Item Final do pedido)
    por_item_final: Dict[str, List[Dict[str, Any]]] = {}
    for r in linhas_estrutura:
        cod_pai_raiz = scraper.normalizar_cod_item(r.get("cod_item"))
        if not cod_pai_raiz:
            continue
        por_item_final.setdefault(cod_pai_raiz, []).append(r)

    registros_df: List[Dict[str, Any]] = []
    ped_int = int(num_pedido) if num_pedido.isdigit() else 0

    for cod_item_final, rows_item in por_item_final.items():
        # Prioriza linha de nível 1 para extrair cod_horizon e tmp_ressup do item final
        rows_n1 = [x for x in rows_item if str(x.get("nivel") or "").strip() == "1"]
        ref_row = rows_n1[0] if rows_n1 else rows_item[0]

        dt_entrega, dt_abertura = calcular_data_abertura_util(
            data_entrega_raw=data_entrega_raw,
            cod_horizon=ref_row.get("cod_horizon"),
            tmp_ressup=ref_row.get("tmp_ressup"),
        )

        info_saldo = saldos_map.get((num_pedido, cod_item_final)) or {}
        saldo_val = round(float(info_saldo.get("quantidade") or 0.0), 2)
        if saldo_val <= 0:
            saldo_val = 1.0

        desc_final = (
            str(info_saldo.get("descricao") or "").strip()
            or _enriquecimento["desc_item"].get(cod_item_final, "")
        )
        cliente_final = str(info_saldo.get("cliente") or "").strip() or "SIMULAÇÃO"
        rep_final = str(info_saldo.get("representante") or "").strip()

        local_saldo = str(info_saldo.get("local_producao") or "").strip()
        if local_saldo and local_saldo not in ("0", ".", "-", "None", "nan"):
            fabrica_final = local_saldo
        else:
            fabrica_final = (
                _enriquecimento["fabrica_item"].get(cod_item_final)
                or _enriquecimento["local_prod"].get(cod_item_final)
                or ("PLANEJADOS" if cod_item_final.startswith(("1AMB", "1QU")) else "NÃO INFORMADO")
            )

        op_virtual = f"SIM-{num_pedido}-{cod_item_final}"

        for r in rows_item:
            comp_code = scraper.normalizar_cod_item(r.get("cod_item_compon"))
            if not comp_code:
                continue

            tipo_raw = str(r.get("ies_tip_item") or r.get("tipo_item") or r.get("tipo") or "").strip().upper()
            if tipo_raw in ("T"):
                # Salvaguarda: fantasma nunca deve entrar no consumo simulado
                continue

            qtd_unit = scraper.parse_numero_flexivel(r.get("qtd_necessaria"), default=0.0)
            consumo_total = round(qtd_unit * saldo_val, 2)

            estoque_l = round(float(_enriquecimento["estoque"].get(comp_code, 0.0)), 2)
            if tipo_raw in ("C", "P"):
                tipo_comp = tipo_raw
            else:
                tipo_comp = _enriquecimento["tipo"].get(comp_code) or (
                    "C" if comp_code.startswith("3") else "P"
                )

            baixa_raw = str(r.get("baixa") or r.get("ies_baixa") or "").strip().upper()
            if baixa_raw in ("S", "N"):
                baixa_comp = baixa_raw
            else:
                baixa_comp = _enriquecimento["baixa"].get(comp_code, "S")

            local_prod_comp = _enriquecimento["local_prod"].get(comp_code, "")
            den_comp = (
                str(r.get("den_item") or "").strip()
                or _enriquecimento["desc_item"].get(comp_code, "")
            )
            eh_cst_comp = comp_code in _enriquecimento.get("itens_cst", set())
            if eh_cst_comp:
                if not re.search(r"\bCST\b", den_comp, re.IGNORECASE):
                    den_comp = f"[CST] {den_comp}" if den_comp else "[CST]"
                estoque_l = 0.0

            registros_df.append(
                {
                    "Tipo": tipo_comp,
                    "Ordem Prod": None,
                    "Item": comp_code,
                    "Consumo": consumo_total,
                    "Ordem Cons": op_virtual,
                    "item_pai": scraper.normalizar_cod_item(r.get("cod_item_pai")) or cod_item_final,
                    "nivel": int(float(r.get("nivel") or 1)),
                    "Saldo": saldo_val,
                    "Pedido": ped_int,
                    "Representante": rep_final,
                    "Entrega Pedido": dt_entrega,
                    "Local Prod.": local_prod_comp,
                    "Familia": "CST" if eh_cst_comp else "",
                    "Cliente": cliente_final,
                    "Fábrica": fabrica_final,
                    "Ordem": op_virtual,
                    "Data Abertura": dt_abertura,
                    "Baixa": baixa_comp,
                    "Den. Item": den_comp,
                    "estoque": estoque_l,
                    "raiz_Item Final": cod_item_final,
                    "raiz_Cliente": cliente_final,
                    "raiz_Fábrica": fabrica_final,
                    "raiz_Pedido": ped_int,
                    "raiz_Representante": rep_final,
                    "raiz_Entrega Pedido": dt_entrega,
                    "raiz_Data Abertura": dt_abertura,
                    "raiz_Saldo": saldo_val,
                    "raiz_Baixa": baixa_comp,
                    "raiz_Descricao": desc_final,
                    "raiz_Pedido_Str": num_pedido,
                    "simulado": True,
                    "origem_simulacao": "intranet",
                }
            )

    if not registros_df:
        return pd.DataFrame(), 0

    return pd.DataFrame(registros_df), len(por_item_final)


def simular_pedidos(
    usuario: str,
    senha: str,
    pedidos_input: List[Dict[str, Any]],
    session_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Processa lista de pedidos [{'pedido': '188366', 'data_entrega': '2026-11-30'}, ...]:
    1. Se o pedido JÁ EXISTE na tabela atual do snapshot (em carteira):
       - Mantém 100% dos seus números, saldos e insumos originais do snapshot;
       - Atualiza a Data de Abertura (e Data de Entrega) de cada item final com base na
         Data de Entrega Desejada menos (cod_horizon + tmp_ressup) em dias úteis (ou joga
         para o final da lista se a data ficar em branco), destaca e recalcula a fila.
    2. Se o pedido NÃO EXISTE na tabela atual:
       - Consulta saldo (`situacao_pedidos2.php`) e estrutura (`json-pedido-estrutura.php`)
         na Intranet, calcula Data de Abertura em dias úteis (ou final da lista se em branco),
         multiplica pelo saldo do pedido e recalcula a fila cumulativa.
    Todas as alterações são mantidas isoladamente na sessão do usuário (cookie).
    """
    if not pedidos_input:
        raise ValueError("Adicione ao menos um número de pedido para consultar/simular.")

    sess = obter_sessao(session_id)

    # Expande eventuais pedidos separados por vírgula na mesma linha do modal
    vistos_lote: Dict[str, str] = {}
    for entrada in pedidos_input:
        raw_ped = str(entrada.get("pedido") or "").strip()
        raw_dt = str(entrada.get("data_entrega") or "").strip()
        if not raw_ped:
            continue
        for parte in raw_ped.replace(";", ",").split(","):
            pn = scraper.normalizar_numero_pedido(parte)
            if pn:
                vistos_lote[pn] = raw_dt

    if not vistos_lote:
        raise ValueError("Informe ao menos um número de pedido válido.")

    pedidos_na_tabela = obter_pedidos_existentes_na_tabela()
    df_base = obter_cons_com_cache()

    pedidos_ja_na_carteira: Dict[str, str] = {}
    pedidos_novos_para_intranet: Dict[str, str] = {}

    for ped_norm, dt_desejada in vistos_lote.items():
        if ped_norm in pedidos_na_tabela:
            pedidos_ja_na_carteira[ped_norm] = dt_desejada
        else:
            pedidos_novos_para_intranet[ped_norm] = dt_desejada

    # Consulta estrutura na Intranet apenas quando necessário:
    # - Sempre para pedidos novos (estrutura + saldos)
    # - Para pedidos já em carteira que tenham data_entrega preenchida (apenas estrutura p/ cod_horizon + tmp_ressup)
    pedidos_carteira_com_data = [
        p for p, dt_str in pedidos_ja_na_carteira.items() if str(dt_str or "").strip()
    ]
    pedidos_para_estrutura = list(pedidos_carteira_com_data) + list(pedidos_novos_para_intranet.keys())
    pedidos_para_saldo = list(pedidos_novos_para_intranet.keys())

    estrutura_por_ped: Dict[str, List[Dict[str, Any]]] = {}
    saldos_map: Dict[Tuple[str, str], Dict[str, Any]] = {}

    if pedidos_para_estrutura:
        res_scraper = scraper.consultar_pedidos_simulados(
            usuario=usuario,
            senha=senha,
            pedidos_estrutura=pedidos_para_estrutura,
            pedidos_saldo=pedidos_para_saldo,
        )
        estrutura_total = res_scraper.get("estrutura") or []
        saldos_map = res_scraper.get("saldos") or {}

        # Trata itens fantasma (tipo 'T'): elimina os fantasmas e promove os filhos
        estrutura_total = tratar_estrutura_fantasmas(estrutura_total)

        for row in estrutura_total:
            pn = scraper.normalizar_numero_pedido(row.get("num_pedido"))
            if pn:
                estrutura_por_ped.setdefault(pn, []).append(row)

    with sess.lock:
        # 1. Atualiza Data de Abertura e destaca pedidos que já constam em carteira (sem alterar números!)
        for ped_exist, dt_desejada in pedidos_ja_na_carteira.items():
            sess.pedidos_simulados_novos.pop(ped_exist, None)

            linhas_est = estrutura_por_ped.get(ped_exist) or []
            datas_por_item: Dict[str, Tuple[Any, Any]] = {}

            if dt_desejada:
                por_item: Dict[str, List[Dict[str, Any]]] = {}
                for r in linhas_est:
                    ci = scraper.normalizar_cod_item(r.get("cod_item"))
                    if ci:
                        por_item.setdefault(ci, []).append(r)

                for ci, rows_ci in por_item.items():
                    rows_n1 = [x for x in rows_ci if str(x.get("nivel") or "").strip() == "1"]
                    ref = rows_n1[0] if rows_n1 else rows_ci[0]
                    datas_por_item[ci] = calcular_data_abertura_util(
                        data_entrega_raw=dt_desejada,
                        cod_horizon=ref.get("cod_horizon"),
                        tmp_ressup=ref.get("tmp_ressup"),
                    )

                default_datas = calcular_data_abertura_util(dt_desejada, 0, 0)
            else:
                default_datas = (pd.NaT, pd.NaT)

            sess.pedidos_carteira_simulados[ped_exist] = {
                "datas_por_item": datas_por_item,
                "default_datas": default_datas,
            }

            qtd_itens_exist = int(
                df_base.loc[
                    (df_base["raiz_Pedido_Str"] == ped_exist) & df_base["raiz_Item Final"].notna(),
                    "raiz_Item Final",
                ].nunique()
            )
            dt_fmt = ""
            if dt_desejada:
                dt_parsed = pd.to_datetime(dt_desejada, errors="coerce", dayfirst="/" in dt_desejada)
                if pd.notna(dt_parsed):
                    dt_fmt = dt_parsed.strftime("%d/%m/%Y")

            sess.meta_simulados[ped_exist] = {
                "pedido": ped_exist,
                "origem": "carteira",
                "data_entrega": dt_fmt,
                "qtd_itens_finais": qtd_itens_exist,
            }

        # 2. Insere pedidos novos que NÃO existiam na tabela atual
        pedidos_inseridos_intranet: List[str] = []
        pedidos_nao_encontrados: List[str] = []

        for ped_novo, dt_desejada in pedidos_novos_para_intranet.items():
            linhas_ped = estrutura_por_ped.get(ped_novo) or []
            if not linhas_ped:
                pedidos_nao_encontrados.append(ped_novo)
                continue

            df_ped, qtd_finais = _montar_df_pedido_simulado(
                num_pedido=ped_novo,
                linhas_estrutura=linhas_ped,
                saldos_map=saldos_map,
                data_entrega_raw=dt_desejada,
            )
            if df_ped.empty or qtd_finais == 0:
                pedidos_nao_encontrados.append(ped_novo)
                continue

            sess.pedidos_carteira_simulados.pop(ped_novo, None)
            sess.pedidos_simulados_novos[ped_novo] = df_ped

            dt_fmt = ""
            if dt_desejada:
                dt_parsed = pd.to_datetime(dt_desejada, errors="coerce", dayfirst="/" in dt_desejada)
                if pd.notna(dt_parsed):
                    dt_fmt = dt_parsed.strftime("%d/%m/%Y")

            sess.meta_simulados[ped_novo] = {
                "pedido": ped_novo,
                "origem": "intranet",
                "data_entrega": dt_fmt,
                "qtd_itens_finais": qtd_finais,
            }
            pedidos_inseridos_intranet.append(ped_novo)

        sess.invalidar_cache_fila()

    if not pedidos_ja_na_carteira and not pedidos_inseridos_intranet and pedidos_nao_encontrados:
        raise ValueError(
            f"Nenhum item de estrutura encontrado na Intranet para o(s) pedido(s): {', '.join(pedidos_nao_encontrados)}."
        )

    return {
        "status": "ok",
        "pedidos_destacados_carteira": list(pedidos_ja_na_carteira.keys()),
        "pedidos_inseridos_intranet": pedidos_inseridos_intranet,
        "pedidos_nao_encontrados": pedidos_nao_encontrados,
        "pedidos_simulados_ativos": listar_pedidos_simulados_ativos(session_id=session_id),
        "session_id": sess.session_id,
    }


def remover_pedido_simulado(pedido: str, session_id: Optional[str] = None) -> Dict[str, Any]:
    """Remove um único pedido da simulação/destaque ativo da sessão, restaurando datas/estado originais."""
    sess = obter_sessao(session_id)
    with sess.lock:
        ped_norm = scraper.normalizar_numero_pedido(pedido)
        if ped_norm:
            sess.pedidos_carteira_simulados.pop(ped_norm, None)
            sess.pedidos_simulados_novos.pop(ped_norm, None)
            sess.meta_simulados.pop(ped_norm, None)
            sess.invalidar_cache_fila()
        return {
            "status": "ok",
            "pedidos_simulados_ativos": listar_pedidos_simulados_ativos(session_id=session_id),
            "session_id": sess.session_id,
        }


def limpar_simulacao(session_id: Optional[str] = None) -> Dict[str, Any]:
    """Remove todos os destaques e pedidos simulados da sessão, restaurando a fila original do snapshot."""
    sess = obter_sessao(session_id)
    with sess.lock:
        sess.pedidos_carteira_simulados.clear()
        sess.pedidos_simulados_novos.clear()
        sess.meta_simulados.clear()
        sess.invalidar_cache_fila()
        return {
            "status": "ok",
            "pedidos_simulados_ativos": [],
            "session_id": sess.session_id,
        }


def listar_pedidos_simulados_ativos(session_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """Lista ordenada dos metadados dos pedidos atualmente destacados ou simulados na sessão."""
    sess = obter_sessao(session_id)
    with sess.lock:
        return [
            sess.meta_simulados[k]
            for k in sorted(sess.meta_simulados.keys(), key=lambda x: (int(x) if x.isdigit() else 0, x))
        ]


def obter_cons_efetivo(recarregar: bool = False, session_id: Optional[str] = None) -> pd.DataFrame:
    """
    Compõe o DataFrame efetivo da fila combinando:
    - O snapshot base (`_cache_cons`), aplicando para os pedidos em `pedidos_carteira_simulados`
      da sessão apenas `simulado=True`, `origem_simulacao='carteira'` e a nova `raiz_Data Abertura` /
      `raiz_Entrega Pedido` (mantendo todos os números, saldos e consumos inalterados).
    - Os pedidos novos consultados na Intranet (`pedidos_simulados_novos`) da sessão.
    """
    df_base = obter_cons_com_cache(recarregar=recarregar)
    sess = obter_sessao(session_id)

    with sess.lock:
        carteira_sim = dict(sess.pedidos_carteira_simulados)
        novos_sim = list(sess.pedidos_simulados_novos.values())

    if not carteira_sim and not novos_sim:
        return df_base

    if carteira_sim:
        df_trab = df_base.copy()
        for ped_exist, cfg in carteira_sim.items():
            mask_ped = (df_trab["raiz_Pedido_Str"] == ped_exist) & df_trab["raiz_Item Final"].notna()
            if not mask_ped.any():
                continue

            df_trab.loc[mask_ped, "simulado"] = True
            df_trab.loc[mask_ped, "origem_simulacao"] = "carteira"

            datas_map: Dict[str, Tuple[Any, Any]] = cfg.get("datas_por_item") or {}
            def_ent, def_ab = cfg.get("default_datas", (pd.NaT, pd.NaT))

            itens_serie = df_trab.loc[mask_ped, "raiz_Item Final"].apply(scraper.normalizar_cod_item)
            novas_entregas = itens_serie.map(lambda ci: datas_map.get(ci, (def_ent, def_ab))[0])
            novas_aberturas = itens_serie.map(lambda ci: datas_map.get(ci, (def_ent, def_ab))[1])

            df_trab.loc[mask_ped, "raiz_Entrega Pedido"] = pd.to_datetime(novas_entregas, errors="coerce")
            df_trab.loc[mask_ped, "raiz_Data Abertura"] = pd.to_datetime(novas_aberturas, errors="coerce")
    else:
        df_trab = df_base

    if novos_sim:
        partes = [df_trab] + novos_sim
        return pd.concat(partes, ignore_index=True)

    return df_trab


def _normalizar_escopo_abatimento(escopo: Any) -> str:
    """Normaliza o escopo de abatimento do estoque na fila ('global' ou 'filtrado')."""
    val = str(escopo or "global").strip().lower()
    if val in ("filtrado", "apenas_filtro", "filtro"):
        return "filtrado"
    return "global"


def _extrair_filtros_escopo_abatimento(
    filtros: Optional[Dict[str, Any]],
    ignorar_col_saldo: bool = False,
) -> Dict[str, Any]:
    """
    Extrai apenas os filtros que restringem o subconjunto de itens/OPs antes do cálculo
    cumulativo da fila (escopo_abatimento='filtrado'), ignorando status pós-MRP e valores vazios.
    """
    if not filtros or not isinstance(filtros, dict):
        return {}

    limpos: Dict[str, Any] = {}

    local_raw = filtros.get("local_producao")
    locais_norm: List[str] = []
    if isinstance(local_raw, (list, tuple, set)):
        locais_set = {str(x).strip().upper() for x in local_raw if str(x).strip()}
        if locais_set and "TODOS" not in locais_set:
            locais_norm = sorted(locais_set)
    elif isinstance(local_raw, str):
        s_loc = local_raw.strip()
        if s_loc and s_loc.upper() != "TODOS":
            locais_set = {x.strip().upper() for x in s_loc.split(",") if x.strip()}
            if locais_set and "TODOS" not in locais_set:
                locais_norm = sorted(locais_set)
    if locais_norm:
        limpos["local_producao"] = locais_norm

    ped = str(filtros.get("pedido") or "").strip()
    if ped:
        limpos["pedido"] = ped

    cod = str(filtros.get("codigo") or "").strip().upper()
    if cod:
        limpos["codigo"] = cod

    if bool(filtros.get("apenas_simulados", False)):
        limpos["apenas_simulados"] = True

    dt_in = str(filtros.get("data_inicio") or "").strip()
    dt_fim = str(filtros.get("data_fim") or "").strip()
    if dt_in:
        limpos["data_inicio"] = dt_in
    if dt_fim:
        limpos["data_fim"] = dt_fim
    if dt_in or dt_fim:
        tp_dt = str(filtros.get("tipo_data") or "abertura_op").strip().lower()
        limpos["tipo_data"] = "entrega_pedido" if tp_dt in ("entrega_pedido", "entrega") else "abertura_op"

    col_raw = filtros.get("col_filtros")
    if isinstance(col_raw, dict):
        ignorados = {"status", "saldo"} if ignorar_col_saldo else {"status"}
        col_limpo = {
            str(k): str(v).strip()
            for k, v in sorted(col_raw.items(), key=lambda kv: str(kv[0]))
            if str(k) not in ignorados and v is not None and str(v).strip()
        }
        if col_limpo:
            limpos["col_filtros"] = col_limpo

    return limpos


def _chave_filtros_escopo(filtros_efetivos: Dict[str, Any]) -> str:
    if not filtros_efetivos:
        return ""
    return json.dumps(filtros_efetivos, sort_keys=True, ensure_ascii=False, default=str)


def _aplicar_filtro_escopo_filas(
    filas: pd.DataFrame,
    filtros_escopo: Optional[Dict[str, Any]],
) -> pd.DataFrame:
    """Popula colunas de exibição pré-MRP, aplica filtro de escopo opcional e reindexa `_ordem_fila`."""
    filas["_dt_abertura_br"] = (
        pd.to_datetime(filas["raiz_Data_Abertura"], errors="coerce")
        .dt.strftime("%d/%m/%Y")
        .fillna("")
    )
    filas["_dt_entrega_br"] = (
        pd.to_datetime(filas["raiz_Entrega_Pedido"], errors="coerce")
        .dt.strftime("%d/%m/%Y")
        .fillna("")
    )
    filas["_saldo_str"] = filas["raiz_Saldo"].fillna(0).astype(str)
    if filtros_escopo:
        filas = _filtrar_itens_finais_base(filas, filtros_escopo)
        filas = _aplicar_col_filtros(filas, filtros_escopo.get("col_filtros"))
        filas = filas.reset_index(drop=True)
    filas["_ordem_fila"] = filas.index
    return filas


def _aplicar_camada2_fila(
    filas: pd.DataFrame,
    comp_agg: pd.DataFrame,
    locais_producao: List[str],
    b_norm: str,
    t_norm: str,
) -> Tuple[pd.DataFrame, pd.DataFrame, List[str]]:
    """
    Camada 2 do cache MRP: aplica filtros de Baixa (`S`/`N`) e Tipo (`C`/`P`) sobre `comp_agg`
    já calculado e consolida `totais_fila` e `itens_resumo` sem reexecutar o loop MRP.
    """
    if filas.empty:
        itens_resumo = filas.copy()
        for col_int in ("total_componentes", "componentes_disponiveis", "componentes_faltando"):
            if col_int not in itens_resumo.columns:
                itens_resumo[col_int] = pd.Series(dtype=int)
        if "perc_disponivel" not in itens_resumo.columns:
            itens_resumo["perc_disponivel"] = pd.Series(dtype=float)
        if "status" not in itens_resumo.columns:
            itens_resumo["status"] = pd.Series(dtype=str)
        return itens_resumo, pd.DataFrame(), locais_producao

    if comp_agg.empty:
        comp_agg_escopo = pd.DataFrame()
    else:
        mask_escopo = None
        if b_norm in ("S", "N"):
            mask_escopo = comp_agg["Baixa"].astype(str).str.upper() == b_norm
        if t_norm in ("C", "P"):
            m_t = comp_agg["Tipo"].astype(str).str.upper() == t_norm
            mask_escopo = m_t if mask_escopo is None else (mask_escopo & m_t)
        comp_agg_escopo = comp_agg[mask_escopo].copy() if mask_escopo is not None else comp_agg.copy()

    if comp_agg_escopo.empty:
        totais_fila = pd.DataFrame(
            columns=["_ordem_fila", "total_componentes", "componentes_disponiveis", "componentes_faltando"]
        )
    else:
        totais_fila = (
            comp_agg_escopo.assign(_disp_int=comp_agg_escopo["Disponivel"].astype(int))
            .groupby("_ordem_fila", as_index=False, sort=False)
            .agg(
                total_componentes=("Item", "count"),
                componentes_disponiveis=("_disp_int", "sum"),
            )
        )
        totais_fila["componentes_faltando"] = (
            totais_fila["total_componentes"] - totais_fila["componentes_disponiveis"]
        )

    itens_resumo = filas.merge(totais_fila, on="_ordem_fila", how="left")
    itens_resumo["total_componentes"] = itens_resumo["total_componentes"].fillna(0).astype(int)
    itens_resumo["componentes_disponiveis"] = itens_resumo["componentes_disponiveis"].fillna(0).astype(int)
    itens_resumo["componentes_faltando"] = itens_resumo["componentes_faltando"].fillna(0).astype(int)
    itens_resumo["perc_disponivel"] = np.where(
        itens_resumo["total_componentes"] > 0,
        (itens_resumo["componentes_disponiveis"] / itens_resumo["total_componentes"] * 100).round(1),
        100.0,
    )
    itens_resumo["status"] = np.where(
        itens_resumo["componentes_faltando"] == 0, "Disponível", "Com Falta"
    )
    itens_resumo = itens_resumo.sort_values(by="_ordem_fila", ascending=True).reset_index(drop=True)
    return itens_resumo, comp_agg_escopo, locais_producao


def _calcular_mrp_base_todas_ops(
    df: pd.DataFrame,
    fam_set: Set[str],
    filtros_escopo: Optional[Dict[str, Any]] = None,
) -> Tuple[pd.DataFrame, pd.DataFrame, List[str]]:
    """
    Calcula a base MRP (Camada 1, antes de Baixa/Tipo) em 1 nível por OP (`Ordem Cons`),
    listando todas as OPs abertas sem re-explodir subárvores.
    """
    if df is None or df.empty:
        return pd.DataFrame(), pd.DataFrame(), []

    df_w = df.copy()
    if "Ordem Cons" in df_w.columns:
        ordem_raw = df_w["Ordem Cons"]
        if "Ordem" in df_w.columns:
            ordem_raw = ordem_raw.fillna(df_w["Ordem"])
    elif "Ordem" in df_w.columns:
        ordem_raw = df_w["Ordem"]
    else:
        return pd.DataFrame(), pd.DataFrame(), []

    df_w["_ordem_op_str"] = (
        ordem_raw.fillna("").astype(str).str.strip().str.removesuffix(".0")
    )
    df_w = df_w[df_w["_ordem_op_str"] != ""].copy()
    if df_w.empty:
        return pd.DataFrame(), pd.DataFrame(), []

    item_op_raw = (
        df_w["item_pai"].fillna(df_w["raiz_Item Final"])
        if "item_pai" in df_w.columns
        else df_w["raiz_Item Final"]
    )
    df_w["_item_op"] = item_op_raw.fillna("").astype(str).str.strip()
    df_w = df_w[df_w["_item_op"] != ""].copy()
    if df_w.empty:
        return pd.DataFrame(), pd.DataFrame(), []

    raiz_item_col = df_w["raiz_Item Final"].fillna("").astype(str).str.strip()
    raiz_ped_col = df_w["raiz_Pedido_Str"].fillna("").astype(str).str.strip().replace(_MAPA_LIMPAR_PEDIDO_STR)
    raiz_fab_col = (
        df_w["raiz_Fábrica"]
        .fillna("NÃO INFORMADO")
        .astype(str)
        .str.strip()
        .replace({"": "NÃO INFORMADO", "0": "NÃO INFORMADO"})
    )

    sim_mask = df_w["simulado"].fillna(False).astype(bool)
    sim_intranet = df_w["origem_simulacao"].fillna("").astype(str) == "intranet"

    ped_real = (
        pd.to_numeric(df_w.get("Pedido", 0), errors="coerce")
        .fillna(0)
        .astype(int)
        .astype(str)
        .replace(_MAPA_LIMPAR_PEDIDO_STR)
    )
    df_w["_ped_op_str"] = np.where(sim_intranet, raiz_ped_col, ped_real)

    fab_real = (
        df_w.get("Fábrica", pd.Series("NÃO INFORMADO", index=df_w.index))
        .fillna("NÃO INFORMADO")
        .astype(str)
        .str.strip()
        .replace({"": "NÃO INFORMADO", "0": "NÃO INFORMADO"})
    )
    df_w["_fab_op"] = np.where(sim_intranet, raiz_fab_col, fab_real)

    df_w["_eh_raiz"] = df_w["_item_op"] == raiz_item_col
    usa_data_raiz = sim_intranet | (sim_mask & df_w["_eh_raiz"])

    dt_ab_orig = df_w["Data Abertura"] if "Data Abertura" in df_w.columns else df_w["raiz_Data Abertura"]
    dt_ent_orig = df_w["Entrega Pedido"] if "Entrega Pedido" in df_w.columns else df_w["raiz_Entrega Pedido"]
    df_w["_dt_ab_op"] = dt_ab_orig.where(~usa_data_raiz, df_w["raiz_Data Abertura"])
    dt_ent_op = dt_ent_orig.where(~usa_data_raiz, df_w["raiz_Entrega Pedido"])
    mask_ent_na_com_ped = dt_ent_op.isna() & (df_w["_ped_op_str"] != "")
    if mask_ent_na_com_ped.any():
        mesmo_ped = mask_ent_na_com_ped & (df_w["_ped_op_str"] == raiz_ped_col)
        if mesmo_ped.any():
            dt_ent_op = dt_ent_op.where(~mesmo_ped, df_w["raiz_Entrega Pedido"])
        ainda_na = dt_ent_op.isna() & (df_w["_ped_op_str"] != "")
        if ainda_na.any():
            ped_ent_map = (
                df_w.loc[
                    df_w["raiz_Entrega Pedido"].notna() & (raiz_ped_col != ""),
                    ["raiz_Pedido_Str", "raiz_Entrega Pedido"],
                ]
                .drop_duplicates("raiz_Pedido_Str")
                .set_index("raiz_Pedido_Str")["raiz_Entrega Pedido"]
            )
            if not ped_ent_map.empty:
                dt_ent_op = dt_ent_op.where(~ainda_na, df_w["_ped_op_str"].map(ped_ent_map))
    df_w["_dt_ent_op"] = dt_ent_op

    desc_map = _enriquecimento.get("desc_item", {})
    desc_op = df_w["_item_op"].map(scraper.normalizar_cod_item).map(desc_map).fillna("")
    raiz_desc = df_w["raiz_Descricao"].fillna("").astype(str)
    df_w["_desc_op"] = np.where((desc_op == "") & df_w["_eh_raiz"], raiz_desc, desc_op)

    df_w["_item_final_pai"] = np.where(df_w["_eh_raiz"], "", raiz_item_col)
    df_w["_fabrica_pai"] = np.where(df_w["_eh_raiz"], "", raiz_fab_col)

    locais_producao = sorted(
        {str(x).strip() for x in df_w["_fab_op"].dropna().unique() if str(x).strip()}
    )

    saldo_col = "Saldo" if "Saldo" in df_w.columns else "raiz_Saldo"
    cli_col = "Cliente" if "Cliente" in df_w.columns else "raiz_Cliente"
    rep_col = "Representante" if "Representante" in df_w.columns else "raiz_Representante"

    filas = (
        df_w.groupby("_ordem_op_str", as_index=False, sort=False)
        .agg(
            raiz_Item_Final=("_item_op", "first"),
            raiz_Descricao=("_desc_op", "first"),
            raiz_Pedido_Str=("_ped_op_str", "first"),
            raiz_Fábrica=("_fab_op", "first"),
            raiz_Saldo=(saldo_col, "first"),
            raiz_Entrega_Pedido=("_dt_ent_op", "first"),
            raiz_Data_Abertura=("_dt_ab_op", "first"),
            raiz_Cliente=(cli_col, "first"),
            raiz_Representante=(rep_col, "first"),
            simulado=("simulado", "any"),
            origem_simulacao=("origem_simulacao", "first"),
            eh_raiz=("_eh_raiz", "first"),
            item_final_pai=("_item_final_pai", "first"),
            fabrica_pai=("_fabrica_pai", "first"),
        )
        .rename(columns={"_ordem_op_str": "ordem_op", "raiz_Item_Final": "raiz_Item Final"})
    )

    filas["prazo_expedicao"] = filas["raiz_Representante"].apply(settings.prazo_por_representante)
    filas["_dt_abertura_sort"] = pd.to_datetime(filas["raiz_Data_Abertura"], errors="coerce")
    filas["_dt_entrega_sort"] = pd.to_datetime(filas["raiz_Entrega_Pedido"], errors="coerce")
    filas["_prioridade_2030"] = np.where(filas["_dt_abertura_sort"].dt.year == 2030, 0, 1)
    filas = filas.sort_values(
        by=["_prioridade_2030", "_dt_abertura_sort", "raiz_Pedido_Str", "raiz_Item Final", "ordem_op"],
        ascending=[True, True, True, True, True],
        na_position="last",
    ).reset_index(drop=True)
    filas = _aplicar_filtro_escopo_filas(filas, filtros_escopo)
    if filtros_escopo and filas.empty:
        for col_int in ("total_componentes", "componentes_disponiveis", "componentes_faltando"):
            filas[col_int] = pd.Series(dtype=int)
        filas["perc_disponivel"] = pd.Series(dtype=float)
        filas["status"] = pd.Series(dtype=str)
        return filas, pd.DataFrame(), locais_producao

    # Abatimento 1-nível vetorizado diretamente sobre os filhos diretos de cada OP
    df_comp = df_w.copy()
    df_comp["Item"] = df_comp["Item"].fillna("").astype(str).str.strip()
    df_comp["Consumo"] = pd.to_numeric(df_comp["Consumo"], errors="coerce").fillna(0.0).round(2)
    df_comp = df_comp[(df_comp["Item"] != "") & (df_comp["Consumo"] > 0)].copy()

    if df_comp.empty:
        comp_agg = pd.DataFrame()
    else:
        itens_cst = _enriquecimento.get("itens_cst", set())
        df_comp["eh_cst"] = (
            df_comp["Item"].isin(itens_cst)
            | (df_comp["Familia"].fillna("").astype(str).str.strip().str.upper() == "CST")
        )
        if fam_set:
            fam_efetiva = np.where(
                df_comp["eh_cst"],
                "CST",
                df_comp["Familia"].fillna("").astype(str).str.strip().str.upper(),
            )
            mask_fam = df_comp["Item"].str.startswith("3") & pd.Series(fam_efetiva, index=df_comp.index).isin(fam_set)
            df_comp = df_comp[mask_fam].copy()

    if df_comp.empty:
        comp_agg = pd.DataFrame()
    else:
        df_comp = df_comp.merge(
            filas[
                [
                    "ordem_op",
                    "_ordem_fila",
                    "raiz_Item Final",
                    "raiz_Pedido_Str",
                    "raiz_Fábrica",
                    "raiz_Representante",
                    "prazo_expedicao",
                    "item_final_pai",
                ]
            ],
            left_on="_ordem_op_str",
            right_on="ordem_op",
            how="inner",
            suffixes=("_orig", ""),
        )
        df_comp["estoque"] = pd.to_numeric(df_comp.get("estoque", 0.0), errors="coerce").fillna(0.0).round(2)

        comp_agg = (
            df_comp.groupby(["_ordem_fila", "Item"], as_index=False, sort=False)
            .agg(
                Consumo=("Consumo", "sum"),
                estoque=("estoque", "first"),
                Tipo=("Tipo", "first"),
                Den_Item=("Den. Item", "first"),
                Baixa=("Baixa", "first"),
                Local_Prod=("Local Prod.", "first"),
                Ordem_Prod=("Ordem Prod", "first"),
                Ordem_Cons=("Ordem Cons", "first"),
                Saldo=("Saldo", "first"),
                Familia=("Familia", "first"),
                eh_cst=("eh_cst", "any"),
                raiz_Item_Final=("raiz_Item Final", "first"),
                raiz_Pedido_Str=("raiz_Pedido_Str", "first"),
                raiz_Fábrica=("raiz_Fábrica", "first"),
                raiz_Representante=("raiz_Representante", "first"),
                prazo_expedicao=("prazo_expedicao", "first"),
                item_final_pai=("item_final_pai", "first"),
            )
            .rename(columns={"raiz_Item_Final": "raiz_Item Final"})
        )
        comp_agg["Consumo"] = comp_agg["Consumo"].round(2)
        comp_agg = comp_agg.sort_values(["Item", "_ordem_fila"], ascending=[True, True]).reset_index(drop=True)

        mask_cst = comp_agg["eh_cst"].astype(bool)
        comp_agg["estoque_disp_fila"] = 0.0
        comp_agg["Disponivel"] = False
        comp_agg["Falta"] = 0.0

        if (~mask_cst).any():
            sub_idx = comp_agg.index[~mask_cst]
            cons_sub = comp_agg.loc[sub_idx, "Consumo"]
            est_sub = comp_agg.loc[sub_idx, "estoque"]
            cons_acum = cons_sub.groupby(comp_agg.loc[sub_idx, "Item"]).cumsum().round(2)
            cons_ant = (cons_acum - cons_sub).round(2)
            disp_fila = (est_sub - cons_ant).clip(lower=0.0).round(2)
            disponivel = (disp_fila + 1e-6) >= cons_sub
            falta = np.where(disponivel, 0.0, (cons_sub - disp_fila).clip(lower=0.0).round(2))
            comp_agg.loc[sub_idx, "estoque_disp_fila"] = disp_fila
            comp_agg.loc[sub_idx, "Disponivel"] = disponivel
            comp_agg.loc[sub_idx, "Falta"] = falta

        if mask_cst.any():
            for idx in comp_agg.index[mask_cst]:
                ped_cst = str(comp_agg.at[idx, "raiz_Pedido_Str"] or "").strip()
                op_cst = str(comp_agg.at[idx, "Ordem_Cons"] or comp_agg.at[idx, "Ordem_Prod"] or "").strip()
                it_prod_cst = str(comp_agg.at[idx, "item_final_pai"] or comp_agg.at[idx, "raiz_Item Final"] or "").strip()
                tec_cst = str(comp_agg.at[idx, "Item"] or "").strip()
                info_cst = buscar_info_tecido_cst(
                    pedido=ped_cst,
                    ordem=op_cst,
                    item_produto=it_prod_cst,
                    tecido=tec_cst,
                )
                sit_cst = str(info_cst.get("situacao") or "").strip().upper() if info_cst else ""
                chegou = sit_cst == "TECIDO CHEGOU"
                cons_v = round(float(comp_agg.at[idx, "Consumo"] or 0.0), 2)
                comp_agg.at[idx, "estoque"] = 0.0
                comp_agg.at[idx, "estoque_disp_fila"] = 0.0
                comp_agg.at[idx, "Disponivel"] = chegou
                comp_agg.at[idx, "Falta"] = 0.0 if chegou else cons_v

        comp_agg = comp_agg.drop(columns=["item_final_pai"], errors="ignore")
        comp_agg = comp_agg.sort_values(["_ordem_fila", "Item"], ascending=[True, True]).reset_index(drop=True)

    return filas, comp_agg, locais_producao


def _calcular_fila_todas_ops(
    df: pd.DataFrame,
    b_norm: str,
    t_norm: str,
    fam_set: Set[str],
    filtros_escopo: Optional[Dict[str, Any]] = None,
) -> Tuple[pd.DataFrame, pd.DataFrame, List[str]]:
    """Wrapper retrocompatível que executa Camada 1 + Camada 2 para `todas_ops=True`."""
    filas, comp_agg, locais_producao = _calcular_mrp_base_todas_ops(
        df=df,
        fam_set=fam_set,
        filtros_escopo=filtros_escopo,
    )
    return _aplicar_camada2_fila(filas, comp_agg, locais_producao, b_norm, t_norm)


def _obter_fila_calculada(
    baixa_filtro: str = "TODOS",
    tipo_filtro: str = "TODOS",
    familias_filtro: Optional[Any] = None,
    recarregar: bool = False,
    forcar_oc: bool = False,
    todas_ops: bool = False,
    session_id: Optional[str] = None,
    escopo_abatimento: str = "global",
    filtros_escopo: Optional[Dict[str, Any]] = None,
) -> Tuple[pd.DataFrame, pd.DataFrame, List[str]]:
    """
    Executa (ou recupera do cache em 2 camadas) o cálculo de abatimento cumulativo de estoque (Situação L)
    seguindo estritamente a ordem de Data de Abertura da OP (e itens sem data ao final da lista).
    Quando todas_ops=True, avalia cada OP (com ou sem item pai) em 1 nível sem dupla contagem.
    Quando escopo_abatimento='filtrado', restringe a fila aos filtros informados antes do abatimento.
    """
    if recarregar or forcar_oc:
        with _cons_load_lock:
            gerar_dataframe_cons(
                forcar_oc=bool(forcar_oc),
                sincronizar_snapshot=bool(recarregar),
            )
    elif _cache_cons is None:
        with _cons_load_lock:
            if _cache_cons is None:
                gerar_dataframe_cons(
                    forcar_oc=False,
                    sincronizar_snapshot=False,
                )
    else:
        try:
            if scraper.cache_oc_expirado():
                _agendar_refresh_oc_background()
        except Exception:
            pass

    sess = obter_sessao(session_id)
    b_norm = baixa_filtro if baixa_filtro in ("S", "N") else "TODOS"
    t_norm = tipo_filtro if tipo_filtro in ("C", "P") else "TODOS"
    todas_ops_flag = bool(todas_ops)

    fam_set: Set[str] = set()
    if familias_filtro:
        if isinstance(familias_filtro, (list, tuple, set)):
            fam_set = {str(x).strip().upper() for x in familias_filtro if str(x).strip()}
        elif isinstance(familias_filtro, str):
            fam_set = {str(x).strip().upper() for x in familias_filtro.split(",") if str(x).strip()}
        if "TODOS" in fam_set:
            fam_set = set()

    todas_fam_3 = {f["familia"] for f in obter_familias_componentes_3(session_id=session_id)}
    if fam_set and todas_fam_3 and fam_set >= todas_fam_3:
        fam_set = set()

    escopo_norm = _normalizar_escopo_abatimento(escopo_abatimento)
    filtros_efetivos = (
        _extrair_filtros_escopo_abatimento(filtros_escopo)
        if escopo_norm == "filtrado"
        else {}
    )
    escopo_chave = "filtrado" if filtros_efetivos else "global"
    chave_escopo = _chave_filtros_escopo(filtros_efetivos)

    fam_tuple = tuple(sorted(fam_set)) if fam_set else ()

    lock_filas, cache_filas_map, sim_ver = _selecionar_cache(sess, "filas")
    lock_base, cache_base_map, _ = _selecionar_cache(sess, "mrp_base")

    cache_key = (
        _cache_timestamp,
        sim_ver,
        b_norm,
        t_norm,
        fam_tuple,
        todas_ops_flag,
        escopo_chave,
        chave_escopo,
    )
    base_key = (
        _cache_timestamp,
        sim_ver,
        fam_tuple,
        todas_ops_flag,
        escopo_chave,
        chave_escopo,
    )

    with lock_filas:
        if cache_key in cache_filas_map:
            return cache_filas_map[cache_key]

    base_entry: Optional[Tuple[pd.DataFrame, pd.DataFrame, List[str]]] = None
    with lock_base:
        base_entry = cache_base_map.get(base_key)

    if base_entry is not None:
        filas_base, comp_agg_base, locais_producao = base_entry
    else:
        df = obter_cons_efetivo(recarregar=False, session_id=session_id)

        if todas_ops_flag:
            filas_base, comp_agg_base, locais_producao = _calcular_mrp_base_todas_ops(
                df=df,
                fam_set=fam_set,
                filtros_escopo=filtros_efetivos or None,
            )
        else:
            filas_base, comp_agg_base, locais_producao = _calcular_mrp_base_padrao(
                df=df,
                fam_set=fam_set,
                filtros_escopo=filtros_efetivos or None,
            )

        with lock_base:
            if len(cache_base_map) >= 15:
                cache_base_map.clear()
            cache_base_map[base_key] = (filas_base, comp_agg_base, locais_producao)

    itens_resumo, comp_agg_escopo, locais_producao = _aplicar_camada2_fila(
        filas_base, comp_agg_base, locais_producao, b_norm, t_norm
    )

    with lock_filas:
        if len(cache_filas_map) >= 30:
            cache_filas_map.clear()
        cache_filas_map[cache_key] = (itens_resumo, comp_agg_escopo, locais_producao)
    return itens_resumo, comp_agg_escopo, locais_producao


def _calcular_mrp_base_padrao(
    df: pd.DataFrame,
    fam_set: Set[str],
    filtros_escopo: Optional[Dict[str, Any]] = None,
) -> Tuple[pd.DataFrame, pd.DataFrame, List[str]]:
    """
    Calcula a base MRP multinível Top-Down (Camada 1, antes dos filtros Baixa/Tipo)
    retornando `(filas, comp_agg, locais_producao)`.
    """
    locais_producao = sorted(
        [str(x) for x in df["raiz_Fábrica"].dropna().unique() if str(x).strip()]
    )
    estoque_inicial = df.drop_duplicates("Item").set_index("Item")["estoque"].to_dict()

    group_cols = ["raiz_Item Final", "raiz_Pedido_Str", "raiz_Fábrica"]

    # 1. Define a ordem global estrita da fila de produção
    filas = (
        df.groupby(group_cols, as_index=False)
        .agg(
            raiz_Descricao=("raiz_Descricao", "first"),
            raiz_Saldo=("raiz_Saldo", "first"),
            raiz_Entrega_Pedido=("raiz_Entrega Pedido", "first"),
            raiz_Data_Abertura=("raiz_Data Abertura", "first"),
            raiz_Cliente=("raiz_Cliente", "first"),
            raiz_Representante=("raiz_Representante", "first"),
            simulado=("simulado", "any"),
            origem_simulacao=("origem_simulacao", "first"),
        )
    )
    filas["prazo_expedicao"] = filas["raiz_Representante"].apply(settings.prazo_por_representante)
    filas["_dt_abertura_sort"] = pd.to_datetime(filas["raiz_Data_Abertura"], errors="coerce")
    filas["_dt_entrega_sort"] = pd.to_datetime(filas["raiz_Entrega_Pedido"], errors="coerce")
    filas["_prioridade_2030"] = np.where(filas["_dt_abertura_sort"].dt.year == 2030, 0, 1)
    filas = filas.sort_values(
        by=["_prioridade_2030", "_dt_abertura_sort", "raiz_Pedido_Str", "raiz_Item Final", "raiz_Fábrica"],
        ascending=[True, True, True, True, True],
        na_position="last",
    ).reset_index(drop=True)
    filas = _aplicar_filtro_escopo_filas(filas, filtros_escopo)
    filas["ordem_op"] = ""
    filas["eh_raiz"] = True
    filas["item_final_pai"] = ""
    filas["fabrica_pai"] = ""

    if filtros_escopo and filas.empty:
        return filas, pd.DataFrame(), locais_producao

    # 2. Executa o algoritmo multinível (MRP Top-Down com Atendimento Condicional ao Saldo)
    # Garante que semiacabados em estoque não explodam componentes filhos desnecessariamente
    df_ord = df.merge(filas[group_cols + ["_ordem_fila"]], on=group_cols, how="inner")

    estoque_atual = {k: float(v or 0.0) for k, v in estoque_inicial.items()}

    candidatos_cols = [
        "_ordem_fila", "Item", "item_pai", "raiz_Item Final", "Consumo",
        "Tipo", "Den. Item", "Baixa", "Local Prod.", "Ordem Prod", "Saldo",
        "Ordem Cons", "Ordem", "Familia", "raiz_Pedido_Str"
    ]
    por_ordem: Dict[int, List[Tuple[Any, ...]]] = {}
    for tup in zip(*(
        df_ord[c].to_numpy() if c in df_ord.columns else repeat(None)
        for c in candidatos_cols
    )):
        por_ordem.setdefault(int(tup[0]), []).append(tup)

    # Listas colunares evitam construir centenas de milhares de dicts intermediários
    col_ordem_fila: List[int] = []
    col_item: List[str] = []
    col_item_pai: List[str] = []
    col_raiz_item_final: List[Any] = []
    col_consumo: List[float] = []
    col_estoque: List[float] = []
    col_estoque_disp_fila: List[float] = []
    col_disponivel: List[bool] = []
    col_falta: List[float] = []
    col_tipo: List[Any] = []
    col_den_item: List[Any] = []
    col_baixa: List[Any] = []
    col_local_prod: List[Any] = []
    col_ordem_prod: List[Any] = []
    col_ordem_cons: List[str] = []
    col_saldo: List[Any] = []
    col_familia: List[str] = []
    col_eh_cst: List[bool] = []

    itens_cst = _enriquecimento.get("itens_cst", set())
    pedidos_fila = filas["raiz_Pedido_Str"].to_numpy()

    for ord_idx in range(len(filas)):
        rows_ord = por_ordem.get(ord_idx)
        if not rows_ord:
            continue

        raiz = rows_ord[0][3]
        ped_fila_fallback = pedidos_fila[ord_idx]

        filhos_por_pai: Dict[str, List[Tuple[Any, ...]]] = {}
        for r in rows_ord:
            pai = r[2]
            if not pai or (not isinstance(pai, str) and pd.isna(pai)) or pai == r[1]:
                pai_str = str(raiz)
            else:
                pai_str = str(pai)
            filhos_por_pai.setdefault(pai_str, []).append(r)

        # Fila de avaliação top-down: (codigo_pai, fator_necessidade)
        # Nível 1: filhos diretos da raiz, fator 1.0
        pais_a_avaliar = [(str(raiz), 1.0)]

        while pais_a_avaliar:
            proximos_pais = []
            for pai_cod, fator_pai in pais_a_avaliar:
                if fator_pai <= 0:
                    continue

                itens_filhos = filhos_por_pai.get(pai_cod, [])
                for comp in itens_filhos:
                    raw_item = comp[1]
                    item_cod = (
                        ""
                        if raw_item is None or (not isinstance(raw_item, str) and pd.isna(raw_item))
                        else str(raw_item)
                    )
                    if not item_cod:
                        continue

                    raw_cons = comp[4]
                    c_orig = round(float(raw_cons or 0.0), 2) if raw_cons is not None and raw_cons == raw_cons else 0.0
                    consumo_efetivo = round(c_orig * fator_pai, 2)
                    if consumo_efetivo <= 0:
                        continue

                    raw_fam = comp[13]
                    fam_str = (
                        ""
                        if raw_fam is None or (not isinstance(raw_fam, str) and pd.isna(raw_fam))
                        else str(raw_fam).strip().upper()
                    )
                    eh_item_3 = item_cod.startswith("3")
                    eh_cst = item_cod in itens_cst or fam_str == "CST"
                    tipo_val = comp[5]

                    if fam_set:
                        if eh_item_3:
                            fam_comp = "CST" if eh_cst else fam_str
                            if fam_comp not in fam_set:
                                continue
                        else:
                            # Itens que NÃO começam com 3 (ex: peças produzidas tipo P iniciadas em 2, 4, etc.):
                            # Desconsiderados na avaliação de consumo e falta do produto final.
                            # Mas se for tipo P e faltar saldo, propaga a necessidade para seus filhos (que podem conter itens 3).
                            if tipo_val == "P":
                                saldo_est = estoque_atual.get(item_cod, 0.0)
                                if (saldo_est + 1e-6) >= consumo_efetivo:
                                    estoque_atual[item_cod] = round(saldo_est - consumo_efetivo, 2)
                                    fator_filho = 0.0
                                else:
                                    estoque_atual[item_cod] = 0.0
                                    falta = round(max(0.0, consumo_efetivo - saldo_est), 2)
                                    fator_filho = round(falta / consumo_efetivo, 4) if consumo_efetivo > 0 else 0.0
                                if fator_filho > 0:
                                    proximos_pais.append((item_cod, fator_filho))
                            continue

                    if eh_cst:
                        # Exclusivo CST: disponibilidade NÃO é verificada no estoque.
                        # O tecido na linha referente a (pedido, ordem, item) deve retornar 'TECIDO CHEGOU'
                        # na consulta tecidos_customizados3.php. Apenas tecidos com 'TECIDO CHEGOU'
                        # são considerados disponíveis para atender o item.
                        ped_cst = str(comp[14] or ped_fila_fallback or "").strip()
                        op_cst = comp[11] or comp[12] or comp[9] or ""
                        it_prod_cst = str(comp[3] or comp[2] or "").strip()

                        info_cst = buscar_info_tecido_cst(
                            pedido=ped_cst,
                            ordem=op_cst,
                            item_produto=it_prod_cst,
                            tecido=item_cod,
                        )
                        sit_cst = str(info_cst.get("situacao") or "").strip().upper() if info_cst else ""
                        chegou = sit_cst == "TECIDO CHEGOU"

                        if chegou:
                            disp = True
                            falta = 0.0
                        else:
                            disp = False
                            falta = consumo_efetivo

                        saldo_fila = 0.0
                        fator_filho = 0.0
                    else:
                        saldo_est = estoque_atual.get(item_cod, 0.0)

                        if (saldo_est + 1e-6) >= consumo_efetivo:
                            disp = True
                            falta = 0.0
                            saldo_fila = saldo_est
                            estoque_atual[item_cod] = round(saldo_est - consumo_efetivo, 2)
                            fator_filho = 0.0
                        else:
                            disp = False
                            saldo_fila = saldo_est
                            falta = round(max(0.0, consumo_efetivo - saldo_est), 2)
                            estoque_atual[item_cod] = 0.0
                            fator_filho = round(falta / consumo_efetivo, 4) if consumo_efetivo > 0 else 0.0

                    col_ordem_fila.append(ord_idx)
                    col_item.append(item_cod)
                    col_item_pai.append(pai_cod)
                    col_raiz_item_final.append(raiz)
                    col_consumo.append(consumo_efetivo)
                    col_estoque.append(0.0 if eh_cst else round(float(estoque_inicial.get(item_cod, 0.0)), 2))
                    col_estoque_disp_fila.append(round(saldo_fila, 2))
                    col_disponivel.append(disp)
                    col_falta.append(falta)
                    col_tipo.append(tipo_val)
                    col_den_item.append(comp[6])
                    col_baixa.append(comp[7])
                    col_local_prod.append(comp[8])
                    col_ordem_prod.append(comp[9])
                    col_ordem_cons.append(str(comp[11] or comp[12] or ""))
                    col_saldo.append(comp[10])
                    col_familia.append(str(raw_fam or ("CST" if eh_cst else "")))
                    col_eh_cst.append(eh_cst)

                    # Se for item produzido e teve falta, explode os filhos no próximo nível
                    if tipo_val == "P" and fator_filho > 0:
                        proximos_pais.append((item_cod, fator_filho))

            pais_a_avaliar = proximos_pais

    if not col_ordem_fila:
        comp_df = pd.DataFrame()
    else:
        comp_df = pd.DataFrame({
            "_ordem_fila": col_ordem_fila,
            "Item": col_item,
            "item_pai": col_item_pai,
            "raiz_Item Final": col_raiz_item_final,
            "Consumo": col_consumo,
            "estoque": col_estoque,
            "estoque_disp_fila": col_estoque_disp_fila,
            "Disponivel": col_disponivel,
            "Falta": col_falta,
            "Tipo": col_tipo,
            "Den_Item": col_den_item,
            "Baixa": col_baixa,
            "Local_Prod": col_local_prod,
            "Ordem_Prod": col_ordem_prod,
            "Ordem_Cons": col_ordem_cons,
            "Saldo": col_saldo,
            "Familia": col_familia,
            "eh_cst": col_eh_cst,
        })

    # 3. Agrega componentes idênticos por (Ordem na fila, Item)
    if comp_df.empty:
        comp_agg = pd.DataFrame()
    else:
        comp_agg = (
            comp_df.groupby(["_ordem_fila", "Item"], as_index=False)
            .agg(
                Consumo=("Consumo", "sum"),
                estoque=("estoque", "first"),
                estoque_disp_fila=("estoque_disp_fila", "first"),
                Falta=("Falta", "sum"),
                Tipo=("Tipo", "first"),
                Den_Item=("Den_Item", "first"),
                Baixa=("Baixa", "first"),
                Local_Prod=("Local_Prod", "first"),
                Ordem_Prod=("Ordem_Prod", "first"),
                Ordem_Cons=("Ordem_Cons", "first"),
                Saldo=("Saldo", "first"),
                Familia=("Familia", "first"),
                eh_cst=("eh_cst", "any"),
            )
            .merge(
                filas[group_cols + ["_ordem_fila", "raiz_Representante", "prazo_expedicao"]],
                on="_ordem_fila",
                how="left",
            )
        )
        comp_agg["Consumo"] = comp_agg["Consumo"].round(2)
        comp_agg["Falta"] = comp_agg["Falta"].round(2)
        comp_agg["Disponivel"] = comp_agg["Falta"] <= 1e-6

    return filas, comp_agg, locais_producao


def _filtrar_itens_finais_base(itens_full: pd.DataFrame, filtros: Optional[Dict[str, Any]] = None) -> pd.DataFrame:
    """Aplica sobre a fila calculada os filtros de visualização dos itens finais (exceto status e colunas)."""
    filtros = filtros or {}
    local_filtro = filtros.get("local_producao")
    pedido_filtro = str(filtros.get("pedido", "") or "").strip()
    codigo_filtro = str(filtros.get("codigo", "") or "").strip().upper()
    apenas_simulados = bool(filtros.get("apenas_simulados", False))
    data_inicio_raw = filtros.get("data_inicio")
    data_fim_raw = filtros.get("data_fim")
    tipo_data_filtro = str(filtros.get("tipo_data", "abertura_op") or "abertura_op").strip().lower()

    mask = pd.Series(True, index=itens_full.index)

    if apenas_simulados:
        mask &= itens_full["simulado"] == True  # noqa: E712

    if local_filtro:
        if isinstance(local_filtro, (list, tuple, set)):
            locais_set = {str(x).strip().upper() for x in local_filtro if str(x).strip()}
            if locais_set and "TODOS" not in locais_set:
                mask &= itens_full["raiz_Fábrica"].astype(str).str.upper().isin(locais_set)
        elif isinstance(local_filtro, str):
            s_limpo = local_filtro.strip()
            if s_limpo and s_limpo.upper() != "TODOS":
                locais_set = {x.strip().upper() for x in s_limpo.split(",") if x.strip()}
                if len(locais_set) == 1:
                    mask &= itens_full["raiz_Fábrica"].astype(str).str.upper() == list(locais_set)[0]
                elif len(locais_set) > 1:
                    mask &= itens_full["raiz_Fábrica"].astype(str).str.upper().isin(locais_set)

    if pedido_filtro:
        mask &= itens_full["raiz_Pedido_Str"].str.contains(pedido_filtro, case=False, na=False)

    if codigo_filtro:
        mask_cod = itens_full["raiz_Item Final"].astype(str).str.upper().str.contains(codigo_filtro, na=False)
        mask_desc = itens_full["raiz_Descricao"].astype(str).str.upper().str.contains(codigo_filtro, na=False)
        mask_op = (
            itens_full["ordem_op"].astype(str).str.upper().str.contains(codigo_filtro, na=False)
            if "ordem_op" in itens_full.columns
            else pd.Series(False, index=itens_full.index)
        )
        mask &= mask_cod | mask_desc | mask_op

    col_data_sort = (
        "_dt_entrega_sort"
        if tipo_data_filtro in ("entrega_pedido", "entrega") and "_dt_entrega_sort" in itens_full.columns
        else "_dt_abertura_sort"
    )
    mask_2030 = (
        itens_full["_dt_abertura_sort"].dt.year == 2030
        if col_data_sort == "_dt_abertura_sort" and "_dt_abertura_sort" in itens_full.columns
        else pd.Series(False, index=itens_full.index)
    )

    if data_inicio_raw and str(data_inicio_raw).strip():
        dt_in_str = str(data_inicio_raw).strip()
        dt_in = pd.to_datetime(dt_in_str, errors="coerce", dayfirst="/" in dt_in_str)
        if pd.notna(dt_in) and col_data_sort in itens_full.columns:
            mask &= (itens_full[col_data_sort].dt.floor("D") >= dt_in.floor("D")) | mask_2030

    if data_fim_raw and str(data_fim_raw).strip():
        dt_fi_str = str(data_fim_raw).strip()
        dt_fi = pd.to_datetime(dt_fi_str, errors="coerce", dayfirst="/" in dt_fi_str)
        if pd.notna(dt_fi) and col_data_sort in itens_full.columns:
            mask &= (itens_full[col_data_sort].dt.floor("D") <= dt_fi.floor("D")) | mask_2030

    return itens_full[mask]


def _aplicar_col_filtros(itens_resumo: pd.DataFrame, col_filtros: Any) -> pd.DataFrame:
    """Aplica filtros individuais por título de coluna da tabela de itens finais."""
    if col_filtros and isinstance(col_filtros, dict) and not itens_resumo.empty:
        mask_cols = pd.Series(True, index=itens_resumo.index)
        for col_key, col_val in col_filtros.items():
            if not col_val or not str(col_val).strip():
                continue
            val_clean = str(col_val).strip().upper()
            if col_key == "item_final":
                m_it = itens_resumo["raiz_Item Final"].astype(str).str.upper().str.contains(val_clean, na=False)
                if "ordem_op" in itens_resumo.columns:
                    m_it |= itens_resumo["ordem_op"].astype(str).str.upper().str.contains(val_clean, na=False)
                mask_cols &= m_it
            elif col_key == "ordem_op" and "ordem_op" in itens_resumo.columns:
                mask_cols &= itens_resumo["ordem_op"].astype(str).str.upper().str.contains(val_clean, na=False)
            elif col_key == "descricao":
                mask_cols &= itens_resumo["raiz_Descricao"].astype(str).str.upper().str.contains(val_clean, na=False)
            elif col_key == "pedido":
                mask_cols &= itens_resumo["raiz_Pedido_Str"].astype(str).str.upper().str.contains(val_clean, na=False)
            elif col_key == "fabrica":
                mask_cols &= itens_resumo["raiz_Fábrica"].astype(str).str.upper().str.contains(val_clean, na=False)
            elif col_key == "data_abertura":
                m1 = itens_resumo["_dt_abertura_br"].str.upper().str.contains(val_clean, na=False)
                m2 = itens_resumo["raiz_Data_Abertura"].astype(str).str.upper().str.contains(val_clean, na=False)
                mask_cols &= m1 | m2
            elif col_key == "entrega":
                m1 = itens_resumo["_dt_entrega_br"].str.upper().str.contains(val_clean, na=False)
                m2 = itens_resumo["raiz_Entrega_Pedido"].astype(str).str.upper().str.contains(val_clean, na=False)
                mask_cols &= m1 | m2
            elif col_key == "saldo":
                mask_cols &= itens_resumo["_saldo_str"].str.contains(val_clean, na=False)
            elif col_key == "status":
                m1 = itens_resumo["status"].astype(str).str.upper().str.contains(val_clean, na=False)
                m2 = itens_resumo["componentes_faltando"].astype(str).str.contains(val_clean, na=False)
                mask_cols &= m1 | m2

        itens_resumo = itens_resumo[mask_cols]
    return itens_resumo


def analisar_itens_finais(
    filtros: Optional[Dict[str, Any]] = None,
    page: int = 0,
    page_size: int = 50,
    recarregar: bool = False,
    forcar_oc: bool = False,
    session_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Retorna os itens finais paginados após o abatimento cumulativo de estoque na fila,
    aplicando filtros de visualização e retornando métricas e estado da simulação da sessão.
    Quando recarregar=True, se forcar_oc=True (ou padrão na recarga manual), sincroniza OCs frescas da Intranet.
    """
    filtros = filtros or {}

    local_filtro = filtros.get("local_producao")
    pedido_filtro = str(filtros.get("pedido", "") or "").strip()
    codigo_filtro = str(filtros.get("codigo", "") or "").strip().upper()
    status_filtro = str(filtros.get("status", "todos") or "todos").strip().lower()
    baixa_filtro = str(filtros.get("baixa", "todos") or "todos").strip().upper()
    tipo_filtro = str(filtros.get("tipo", "todos") or "todos").strip().upper()
    familias_filtro = filtros.get("familias")
    todas_ops = bool(filtros.get("todas_ops", False))
    apenas_simulados = bool(filtros.get("apenas_simulados", False))
    col_filtros = filtros.get("col_filtros") or {}
    data_inicio_raw = filtros.get("data_inicio")
    data_fim_raw = filtros.get("data_fim")
    tipo_data_filtro = str(filtros.get("tipo_data", "abertura_op") or "abertura_op").strip().lower()
    escopo_abatimento = _normalizar_escopo_abatimento(filtros.get("escopo_abatimento"))

    itens_full, _, locais_producao = _obter_fila_calculada(
        baixa_filtro=baixa_filtro,
        tipo_filtro=tipo_filtro,
        familias_filtro=familias_filtro,
        recarregar=recarregar,
        forcar_oc=forcar_oc,
        todas_ops=todas_ops,
        session_id=session_id,
        escopo_abatimento=escopo_abatimento,
        filtros_escopo=filtros if escopo_abatimento == "filtrado" else None,
    )
    info_carga = obter_info_carregamento()
    pedidos_ativos = listar_pedidos_simulados_ativos(session_id=session_id)

    if itens_full.empty:
        resp_vazia: Dict[str, Any] = {
            "total_registros": 0,
            "total_paginas": 0,
            "pagina_atual": page,
            "itens": [],
            "todas_ops": todas_ops,
            "escopo_abatimento": escopo_abatimento,
            "metricas": {
                "total_itens_finais": 0,
                "total_itens_avaliados": 0,
                "total_disponiveis": 0,
                "total_com_falta": 0,
                "total_pedidos": 0,
                "total_simulados": 0,
            },
            "pedidos_simulados_ativos": pedidos_ativos,
            "locais_producao": locais_producao,
            "data_carga": info_carga["data_carga"],
            "data_carregamento": info_carga["data_carregamento"],
            "data_oc": info_carga["data_oc"],
            "snapshot": info_carga["snapshot"],
            "session_id": str(session_id or "default"),
        }
        if page == 0:
            resp_vazia["divisao_fabricas"] = carregar_divisao_fabricas()
            resp_vazia["familias_componentes_3"] = obter_familias_componentes_3(session_id=session_id)
        return resp_vazia

    sess = obter_sessao(session_id)
    lock_view, cache_view_map, sim_ver = _selecionar_cache(sess, "view_itens")

    if isinstance(local_filtro, (list, tuple, set)):
        local_norm_key = sorted({str(x).strip().upper() for x in local_filtro if str(x).strip()})
    elif isinstance(local_filtro, str):
        local_norm_key = sorted({x.strip().upper() for x in local_filtro.split(",") if x.strip()})
    else:
        local_norm_key = []

    if isinstance(familias_filtro, (list, tuple, set)):
        fam_norm_key = sorted({str(x).strip().upper() for x in familias_filtro if str(x).strip()})
    elif isinstance(familias_filtro, str):
        fam_norm_key = sorted({x.strip().upper() for x in familias_filtro.split(",") if x.strip()})
    else:
        fam_norm_key = []

    col_norm_key = (
        {
            str(k): str(v).strip()
            for k, v in sorted(col_filtros.items(), key=lambda kv: str(kv[0]))
            if v is not None and str(v).strip()
        }
        if isinstance(col_filtros, dict)
        else {}
    )
    view_filtros_json = json.dumps(
        {
            "local_producao": local_norm_key,
            "pedido": pedido_filtro,
            "codigo": codigo_filtro,
            "status": status_filtro,
            "baixa": baixa_filtro,
            "tipo": tipo_filtro,
            "familias": fam_norm_key,
            "todas_ops": todas_ops,
            "apenas_simulados": apenas_simulados,
            "col_filtros": col_norm_key,
            "data_inicio": str(data_inicio_raw or "").strip(),
            "data_fim": str(data_fim_raw or "").strip(),
            "tipo_data": tipo_data_filtro,
            "escopo_abatimento": escopo_abatimento,
        },
        sort_keys=True,
        ensure_ascii=False,
        default=str,
    )
    view_key = (_cache_timestamp, sim_ver, view_filtros_json)

    cached_view: Optional[Tuple[pd.DataFrame, Dict[str, Any], int]] = None
    with lock_view:
        cached_view = cache_view_map.get(view_key)

    if cached_view is not None:
        itens_resumo, metricas_dict, total_simulados_global = cached_view
    else:
        total_simulados_global = int(itens_full["simulado"].sum())

        itens_resumo = _filtrar_itens_finais_base(itens_full, filtros)

        # Métricas consolidadas antes dos filtros de status e coluna
        total_itens_finais = len(itens_resumo)
        total_disponiveis = int((itens_resumo["status"] == "Disponível").sum())
        total_com_falta = int((itens_resumo["status"] == "Com Falta").sum())
        total_pedidos = int(itens_resumo["raiz_Pedido_Str"].replace("", np.nan).dropna().nunique())
        total_itens_avaliados_raw = round(
            float(pd.to_numeric(itens_resumo["raiz_Saldo"], errors="coerce").fillna(0.0).sum()),
            2,
        )
        total_itens_avaliados = (
            int(total_itens_avaliados_raw)
            if total_itens_avaliados_raw % 1 == 0
            else total_itens_avaliados_raw
        )
        metricas_dict = {
            "total_itens_finais": total_itens_finais,
            "total_itens_avaliados": total_itens_avaliados,
            "total_disponiveis": total_disponiveis,
            "total_com_falta": total_com_falta,
            "total_pedidos": total_pedidos,
            "total_simulados": total_simulados_global,
        }

        # Filtro de Status ('disponivel', 'falta', 'todos')
        if status_filtro == "disponivel":
            itens_resumo = itens_resumo[itens_resumo["status"] == "Disponível"]
        elif status_filtro == "falta":
            itens_resumo = itens_resumo[itens_resumo["status"] == "Com Falta"]

        itens_resumo = _aplicar_col_filtros(itens_resumo, col_filtros)

        # Exibição na tela principal organizada cronologicamente por Data de Abertura (mantendo `_ordem_fila` para cálculo)
        if not itens_resumo.empty:
            sort_cols = ["_dt_abertura_sort", "raiz_Pedido_Str", "raiz_Item Final", "raiz_Fábrica"]
            if "ordem_op" in itens_resumo.columns:
                sort_cols.append("ordem_op")
            itens_resumo = itens_resumo.sort_values(
                by=sort_cols,
                ascending=[True] * len(sort_cols),
                na_position="last",
            )

        with lock_view:
            if len(cache_view_map) >= 30:
                cache_view_map.clear()
            cache_view_map[view_key] = (itens_resumo, metricas_dict, total_simulados_global)

    total_filtrados = len(itens_resumo)
    total_paginas = (total_filtrados + page_size - 1) // page_size if page_size > 0 else 1

    start = page * page_size
    end = start + page_size
    slice_df = itens_resumo.iloc[start:end]

    registros: List[Dict[str, Any]] = []
    if not slice_df.empty:
        n_slice = len(slice_df)
        s_ordem_fila = slice_df["_ordem_fila"].to_numpy()
        s_ordem_op = slice_df["ordem_op"].to_numpy() if "ordem_op" in slice_df.columns else repeat("", n_slice)
        s_eh_raiz = slice_df["eh_raiz"].to_numpy() if "eh_raiz" in slice_df.columns else repeat(True, n_slice)
        s_item_pai = slice_df["item_final_pai"].to_numpy() if "item_final_pai" in slice_df.columns else repeat("", n_slice)
        s_fab_pai = slice_df["fabrica_pai"].to_numpy() if "fabrica_pai" in slice_df.columns else repeat("", n_slice)
        s_item = slice_df["raiz_Item Final"].to_numpy()
        s_desc = slice_df["raiz_Descricao"].to_numpy()
        s_ped = slice_df["raiz_Pedido_Str"].to_numpy()
        s_fab = slice_df["raiz_Fábrica"].to_numpy()
        s_cli = slice_df["raiz_Cliente"].to_numpy()
        s_saldo = slice_df["raiz_Saldo"].to_numpy()
        s_dt_ab = slice_df["_dt_abertura_br"].to_numpy()
        s_dt_ent = slice_df["_dt_entrega_br"].to_numpy()
        s_tot_comp = slice_df["total_componentes"].to_numpy()
        s_comp_disp = slice_df["componentes_disponiveis"].to_numpy()
        s_comp_falt = slice_df["componentes_faltando"].to_numpy()
        s_perc = slice_df["perc_disponivel"].to_numpy()
        s_status = slice_df["status"].to_numpy()
        s_sim = slice_df["simulado"].to_numpy()
        s_orig_sim = slice_df["origem_simulacao"].to_numpy()

        for (
            of_v, op_v, eh_r_v, it_p_v, fb_p_v, it_v, desc_v, ped_v, fab_v, cli_v,
            sal_v, ab_v, ent_v, tc_v, cd_v, cf_v, perc_v, st_v, sim_v, os_v,
        ) in zip(
            s_ordem_fila, s_ordem_op, s_eh_raiz, s_item_pai, s_fab_pai, s_item, s_desc, s_ped, s_fab, s_cli,
            s_saldo, s_dt_ab, s_dt_ent, s_tot_comp, s_comp_disp, s_comp_falt, s_perc, s_status, s_sim, s_orig_sim,
        ):
            saldo_val = 1.0
            if pd.notna(sal_v):
                try:
                    saldo_val = float(sal_v)
                except Exception:
                    saldo_val = 1.0

            registros.append(
                {
                    "posicao_fila": int(of_v) + 1,
                    "ordem_op": str(op_v or ""),
                    "eh_raiz": bool(eh_r_v),
                    "item_final_pai": str(it_p_v or ""),
                    "fabrica_pai": str(fb_p_v or ""),
                    "item_final": str(it_v),
                    "descricao": str(desc_v or ""),
                    "pedido": str(ped_v or ""),
                    "fabrica": str(fab_v or ""),
                    "cliente": str(cli_v or ""),
                    "saldo": round(saldo_val, 2) if saldo_val % 1 != 0 else int(saldo_val),
                    "data_abertura": str(ab_v or ""),
                    "entrega": str(ent_v or ""),
                    "total_componentes": int(tc_v),
                    "componentes_disponiveis": int(cd_v),
                    "componentes_faltando": int(cf_v),
                    "perc_disponivel": float(perc_v),
                    "status": str(st_v),
                    "simulado": bool(sim_v),
                    "origem_simulacao": str(os_v or ""),
                }
            )

    resposta: Dict[str, Any] = {
        "total_registros": total_filtrados,
        "total_paginas": total_paginas,
        "pagina_atual": page,
        "itens": registros,
        "todas_ops": todas_ops,
        "escopo_abatimento": escopo_abatimento,
        "metricas": dict(metricas_dict),
        "pedidos_simulados_ativos": pedidos_ativos,
        "locais_producao": locais_producao,
        "data_carga": info_carga["data_carga"],
        "data_carregamento": info_carga["data_carregamento"],
        "data_oc": info_carga["data_oc"],
        "snapshot": info_carga["snapshot"],
        "session_id": str(session_id or "default"),
    }
    if page == 0:
        resposta["divisao_fabricas"] = carregar_divisao_fabricas()
        resposta["familias_componentes_3"] = obter_familias_componentes_3(session_id=session_id)
    return resposta


def _calcular_saldos_ops_abertura_d1(
    comp_item: str,
    data_corte_iso: Optional[str] = None,
) -> Tuple[float, float]:
    """
    Calcula para um componente (Tipo P) os saldos somados de OPs abertas divididos pelo corte hoje + 1:
    - saldo_ate_d1: OPs com data de abertura <= hoje + 1 (exceto ano 2030)
    - saldo_apos_d1: OPs com data de abertura > hoje + 1, incluindo OPs no ano 2030
      (prioritárias no consumo, porém ainda fora de produção por pendência de componentes)
      e OPs sem data válida.
    """
    it = scraper.normalizar_cod_item(comp_item)
    if not it:
        return 0.0, 0.0

    corte = data_corte_iso or (datetime.now().date() + timedelta(days=1)).isoformat()
    ops_todas = _enriquecimento.get("op_por_item_todos", {}).get(it, [])

    saldo_ate_d1 = 0.0
    saldo_apos_d1 = 0.0
    for op in ops_todas:
        saldo_op = float(op.get("saldo_op") or 0.0)
        if saldo_op <= 0:
            continue
        dt_ab_sort = str(op.get("data_abertura_sort") or "").strip()
        if not dt_ab_sort or dt_ab_sort == "9999-12-31":
            _, dt_ab_sort = _parse_data_br_flex(op.get("data_abertura"))
        if (
            dt_ab_sort
            and dt_ab_sort != "9999-12-31"
            and not _eh_data_prioridade_2030(dt_ab_sort)
            and dt_ab_sort <= corte
        ):
            saldo_ate_d1 += saldo_op
        else:
            saldo_apos_d1 += saldo_op

    return round(saldo_ate_d1, 2), round(saldo_apos_d1, 2)


def _enriquecer_insumo_gerencial(
    comp_item: str,
    tipo_comp: str,
    local_prod_raw: Any,
    op_prod_raw: Any,
    raiz_pedido_str: str,
    raiz_item_final: str,
    raiz_data_abertura: Any = None,
    ordem_cons_raw: Any = None,
    saldos_d1_cache: Optional[Dict[str, Tuple[float, float]]] = None,
    data_corte_d1_iso: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Resolve os metadados gerenciais de um insumo:
    - Se Tipo == 'P' (Componente Produzido): Fábrica, OP do componente, Data Abertura OP, Data Entrega OP, Saldo OP e vínculo.
    - Se Tipo == 'C' (Matéria-Prima): Previsão de Ordem de Compra (OC), priorizando OC cujo texto vincula ao Pedido (+ Item Final),
      usando a previsão mais antiga para matérias-primas em geral e calculando o saldo total em OC até a data de abertura da ordem.
    - Se Família CST: Resolve a situação na intranet /pcp/tecidos_customizados3.php (TECIDO CHEGOU / AGUARDANDO TECIDO).
    """
    it = scraper.normalizar_cod_item(comp_item)
    ped = _normalizar_pedido_valido(raiz_pedido_str)
    it_final = scraper.normalizar_cod_item(raiz_item_final)
    dt_ab_ordem_br, dt_ab_ordem_sort = _parse_data_br_flex(raiz_data_abertura)

    lp = str(local_prod_raw or "").strip()
    if lp in ("", "0", ".", "None", "nan"):
        lp = (
            _enriquecimento.get("local_prod", {}).get(it)
            or _enriquecimento.get("fabrica_item", {}).get(it)
            or ""
        )

    op_prod_str = ""
    if op_prod_raw is not None and pd.notna(op_prod_raw):
        s_op = str(op_prod_raw).strip().removesuffix(".0")
        dig_op = re.sub(r"[^\d]", "", s_op)
        op_prod_str = str(int(dig_op)) if dig_op else s_op
        if op_prod_str in ("0", "nan", "None"):
            op_prod_str = ""

    # Dados de Ordem de Produção (Componentes Tipo P)
    ordem_prod = op_prod_str
    op_data_abertura = ""
    op_data_entrega = ""
    op_saldo = 0.0
    op_saldo_ate_d1 = 0.0
    op_saldo_apos_d1 = 0.0
    op_vinculo = ""
    ops_abertas: List[Dict[str, Any]] = []

    if tipo_comp == "P":
        if saldos_d1_cache is not None:
            if it not in saldos_d1_cache:
                saldos_d1_cache[it] = _calcular_saldos_ops_abertura_d1(
                    it, data_corte_iso=data_corte_d1_iso
                )
            op_saldo_ate_d1, op_saldo_apos_d1 = saldos_d1_cache[it]
        else:
            op_saldo_ate_d1, op_saldo_apos_d1 = _calcular_saldos_ops_abertura_d1(
                it, data_corte_iso=data_corte_d1_iso
            )
        op_por_item_pedido = _enriquecimento.get("op_por_item_pedido", {})
        op_por_numero = _enriquecimento.get("op_por_numero", {})
        op_por_item_lote = _enriquecimento.get("op_por_item_lote", {})
        op_por_item_todos = _enriquecimento.get("op_por_item_todos", {})

        ops_ped = op_por_item_pedido.get((it, ped), []) if ped else []
        ops_lote = op_por_item_lote.get(it, [])
        ops_todas = op_por_item_todos.get(it, [])

        op_principal: Optional[Dict[str, Any]] = None
        if ops_ped:
            op_principal = ops_ped[0]
            op_vinculo = "PEDIDO"
        elif op_prod_str and op_prod_str in op_por_numero:
            op_principal = op_por_numero[op_prod_str]
            ped_op = op_principal.get("pedido_op") or ""
            op_vinculo = "PEDIDO" if (ped and ped_op == ped) else ("LOTE" if not ped_op else "GERAL")
        elif ops_lote:
            op_principal = ops_lote[0]
            op_vinculo = "LOTE"
        elif ops_todas:
            op_principal = ops_todas[0]
            op_vinculo = "GERAL"

        if op_principal:
            ordem_prod = str(op_principal.get("ordem_prod") or op_prod_str)
            op_data_abertura = str(op_principal.get("data_abertura") or "")
            op_data_entrega = str(op_principal.get("data_entrega") or "")
            op_saldo = float(op_principal.get("saldo_op") or 0.0)
            if not lp and op_principal.get("fabrica"):
                lp = str(op_principal["fabrica"])

        cands_op = ops_ped + [x for x in ops_lote if x not in ops_ped]
        if not cands_op:
            cands_op = ops_todas
        ops_abertas = cands_op[:5]

    if not lp:
        lp = "NÃO INFORMADO" if tipo_comp == "P" else "COMPRAS"

    # Dados de Ordem de Compra (Matérias-Primas Tipo C e Ferramentas/Insumos Tipo F)
    oc_numero = ""
    oc_previsao = ""
    oc_data_origem = ""
    oc_emissao = ""
    oc_saldo = 0.0
    oc_saldo_ate_abertura = 0.0
    oc_qtd_ate_abertura = 0
    oc_saldo_total_item = 0.0
    oc_qtd_total_item = 0
    oc_data_abertura_ref = dt_ab_ordem_br
    oc_fornecedor = ""
    oc_comprador = ""
    oc_pedido_compra = ""
    oc_sit = ""
    oc_texto = ""
    oc_vinculo = ""
    oc_vinculada_pedido = False
    ocs_abertas: List[Dict[str, Any]] = []

    if tipo_comp in ("C", "F"):
        oc_por_item_ped_it = _enriquecimento.get("oc_por_item_ped_it", {})
        oc_por_item_ped = _enriquecimento.get("oc_por_item_ped", {})
        oc_por_item_it_sem_ped = _enriquecimento.get("oc_por_item_it_sem_ped", {})
        oc_por_item_geral = _enriquecimento.get("oc_por_item_geral", {})
        oc_por_item_todas = _enriquecimento.get("oc_por_item_todas", {})

        oc_principal: Optional[Dict[str, Any]] = None
        ocs_vinc_lista: List[Dict[str, Any]] = []

        if ped and it_final and (it, ped, it_final) in oc_por_item_ped_it:
            ocs_vinc_lista = oc_por_item_ped_it[(it, ped, it_final)]
            oc_principal = ocs_vinc_lista[0]
            oc_vinculo = "PEDIDO + ITEM"
            oc_vinculada_pedido = True
        elif ped and (it, ped) in oc_por_item_ped:
            cands_ped = oc_por_item_ped[(it, ped)]
            sem_conflito = [
                x for x in cands_ped
                if not x.get("item_final_vinculado") or x.get("item_final_vinculado") == it_final
            ]
            ocs_vinc_lista = sem_conflito if sem_conflito else cands_ped
            oc_principal = ocs_vinc_lista[0]
            oc_vinculo = "PEDIDO"
            oc_vinculada_pedido = True
        elif not ped and it_final and (it, it_final) in oc_por_item_it_sem_ped:
            ocs_vinc_lista = oc_por_item_it_sem_ped[(it, it_final)]
            oc_principal = ocs_vinc_lista[0]
            oc_vinculo = "ITEM"
            oc_vinculada_pedido = True
        else:
            cands_geral = oc_por_item_geral.get(it) or oc_por_item_todas.get(it) or []
            if cands_geral:
                oc_principal = cands_geral[0]
                oc_vinculo = "MAIS ANTIGA"
                oc_vinculada_pedido = False

        if oc_principal:
            oc_numero = str(oc_principal.get("oc_numero") or "")
            oc_previsao = str(oc_principal.get("previsao") or "")
            oc_data_origem = str(oc_principal.get("data_origem") or "")
            oc_emissao = str(oc_principal.get("emissao_oc") or "")
            oc_saldo = float(oc_principal.get("saldo") or 0.0)
            oc_fornecedor = str(oc_principal.get("fornecedor") or "")
            oc_comprador = str(oc_principal.get("comprador") or "")
            oc_pedido_compra = str(oc_principal.get("pedido_compra") or "")
            oc_sit = str(oc_principal.get("sit_oc") or "")
            oc_texto = str(oc_principal.get("texto") or "")

        todas_it = oc_por_item_todas.get(it, [])
        oc_qtd_total_item = len(todas_it)
        oc_saldo_total_item = sum(float(x.get("saldo") or 0.0) for x in todas_it)

        if dt_ab_ordem_sort and dt_ab_ordem_sort != "9999-12-31":
            for x in todas_it:
                p_sort = str(x.get("previsao_sort") or "")
                if not p_sort or p_sort == "9999-12-31":
                    _, p_sort = _parse_data_br_flex(x.get("previsao"))
                if not p_sort or p_sort == "9999-12-31":
                    _, p_sort = _parse_data_br_flex(x.get("data_origem"))
                if p_sort and p_sort != "9999-12-31" and p_sort <= dt_ab_ordem_sort:
                    oc_saldo_ate_abertura += float(x.get("saldo") or 0.0)
                    oc_qtd_ate_abertura += 1

        if ocs_vinc_lista:
            ocs_abertas = (ocs_vinc_lista + [x for x in todas_it if x not in ocs_vinc_lista])[:5]
        else:
            ocs_abertas = todas_it[:5]

    itens_cst = _enriquecimento.get("itens_cst", set())
    eh_cst = it in itens_cst
    cst_situacao = ""
    cst_chegou = False
    cst_fornecedor = ""
    cst_prev_entrega = ""
    cst_pedido_interno = ""
    cst_data_chegada = ""
    cst_observacao = ""

    if eh_cst:
        op_ref = op_prod_str or re.sub(r"[^\d]", "", str(ordem_cons_raw or ""))
        info_cst = buscar_info_tecido_cst(
            pedido=ped,
            ordem=op_ref,
            item_produto=it_final,
            tecido=it,
        )
        if info_cst:
            cst_situacao = str(info_cst.get("situacao") or "").strip().upper()
            cst_chegou = cst_situacao == "TECIDO CHEGOU"
            cst_fornecedor = str(info_cst.get("fornecedor") or "").strip()
            cst_prev_entrega = str(info_cst.get("prev_entrega") or "").strip()
            cst_pedido_interno = str(info_cst.get("pedido_interno") or "").strip()
            cst_data_chegada = str(info_cst.get("data_chegada") or "").strip()
            cst_observacao = str(info_cst.get("observacao") or "").strip()
        else:
            cst_situacao = "SEM REGISTRO"
            cst_chegou = False

        if not oc_fornecedor and cst_fornecedor:
            oc_fornecedor = cst_fornecedor
        if not oc_previsao and cst_prev_entrega:
            oc_previsao = cst_prev_entrega
        if not oc_pedido_compra and cst_pedido_interno:
            oc_pedido_compra = cst_pedido_interno
        if not oc_sit and cst_situacao:
            oc_sit = cst_situacao

    return {
        "fabrica_componente": lp,
        "ordem_prod": ordem_prod,
        "op_data_abertura": op_data_abertura,
        "op_data_entrega": op_data_entrega,
        "op_saldo": round(op_saldo, 2),
        "op_saldo_ate_d1": round(op_saldo_ate_d1, 2),
        "op_saldo_apos_d1": round(op_saldo_apos_d1, 2),
        "op_vinculo": op_vinculo,
        "ops_abertas": ops_abertas,
        "oc_numero": oc_numero,
        "oc_previsao": oc_previsao,
        "oc_data_origem": oc_data_origem,
        "oc_emissao": oc_emissao,
        "oc_saldo": round(oc_saldo, 2),
        "oc_saldo_ate_abertura": round(oc_saldo_ate_abertura, 2),
        "oc_qtd_ate_abertura": oc_qtd_ate_abertura,
        "oc_saldo_total_item": round(oc_saldo_total_item, 2),
        "oc_qtd_total_item": oc_qtd_total_item,
        "oc_data_abertura_ref": oc_data_abertura_ref,
        "oc_fornecedor": oc_fornecedor,
        "oc_comprador": oc_comprador,
        "oc_pedido_compra": oc_pedido_compra,
        "oc_sit": oc_sit,
        "oc_texto": oc_texto,
        "oc_vinculo": oc_vinculo,
        "oc_vinculada_pedido": oc_vinculada_pedido,
        "ocs_abertas": ocs_abertas,
        "eh_cst": eh_cst,
        "cst_situacao": cst_situacao,
        "cst_chegou": cst_chegou,
        "cst_fornecedor": cst_fornecedor,
        "cst_prev_entrega": cst_prev_entrega,
        "cst_pedido_interno": cst_pedido_interno,
        "cst_data_chegada": cst_data_chegada,
        "cst_observacao": cst_observacao,
    }


def _organizar_insumos_gerencial(lista_insumos: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Separa a lista de insumos em:
    1. `materias_primas`: Tipo in ('C', 'F'), ordenados por falta DESC e código ASC.
    2. `componentes_por_fabrica`: Tipo == 'P', agrupados por Fábrica (`fabrica_componente` / `local_prod`).
    """
    materias_primas = [x for x in lista_insumos if x.get("tipo") in ("C", "F")]
    componentes = [x for x in lista_insumos if x.get("tipo") == "P"]

    materias_primas.sort(
        key=lambda x: (-float(x.get("falta") or 0.0), str(x.get("item") or ""))
    )

    por_fab: Dict[str, List[Dict[str, Any]]] = {}
    for comp in componentes:
        fab = str(comp.get("fabrica_componente") or comp.get("local_prod") or "NÃO INFORMADO").strip()
        if not fab or fab == "0":
            fab = "NÃO INFORMADO"
        por_fab.setdefault(fab, []).append(comp)

    grupos_fabrica: List[Dict[str, Any]] = []
    for fab_nome, itens_fab in por_fab.items():
        itens_fab.sort(
            key=lambda x: (-float(x.get("falta") or 0.0), str(x.get("item") or ""))
        )
        faltando_cnt = sum(1 for x in itens_fab if not x.get("disponivel", False))
        com_op_cnt = sum(1 for x in itens_fab if bool(x.get("ordem_prod")))
        grupos_fabrica.append(
            {
                "fabrica": fab_nome,
                "total_itens": len(itens_fab),
                "total_faltando": faltando_cnt,
                "total_com_op": com_op_cnt,
                "itens": itens_fab,
            }
        )

    grupos_fabrica.sort(
        key=lambda g: (-g["total_faltando"], -g["total_itens"], g["fabrica"])
    )

    mp_faltando = [x for x in materias_primas if not x.get("disponivel", False)]
    comp_faltando = [x for x in componentes if not x.get("disponivel", False)]

    return {
        "materias_primas": materias_primas,
        "componentes_por_fabrica": grupos_fabrica,
        "resumo": {
            "total_materias_primas": len(materias_primas),
            "materias_primas_faltando": len(mp_faltando),
            "mp_com_oc": sum(1 for x in materias_primas if bool(x.get("oc_numero"))),
            "mp_vinculadas_pedido": sum(1 for x in materias_primas if bool(x.get("oc_vinculada_pedido"))),
            "total_componentes": len(componentes),
            "componentes_faltando": len(comp_faltando),
            "comp_com_op": sum(1 for x in componentes if bool(x.get("ordem_prod"))),
            "total_fabricas": len(grupos_fabrica),
        },
    }


def obter_detalhes_item_final(
    raiz_item_final: str,
    raiz_pedido: Optional[str] = None,
    raiz_fabrica: Optional[str] = None,
    baixa: Optional[str] = None,
    tipo: Optional[str] = None,
    familias: Optional[Any] = None,
    ordem_op: Optional[str] = None,
    todas_ops: bool = False,
    session_id: Optional[str] = None,
    escopo_abatimento: str = "global",
    filtros_escopo: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Retorna a lista analítica e a camada gerencial de todos os componentes de um item final específico (ou OP específica),
    refletindo o saldo exato disponível na posição daquele item na fila cumulativa da sessão,
    o saldo total de estoque, datas de abertura/entrega de OPs de componentes (agrupados por fábrica)
    e previsões de OCs de matérias-primas (com vínculo por pedido no texto ou previsão mais antiga).
    """
    b_norm = str(baixa or "todos").strip().upper()
    t_norm = str(tipo or "todos").strip().upper()
    todas_ops_flag = bool(todas_ops)
    op_filtro = str(ordem_op or "").strip()
    escopo_norm = _normalizar_escopo_abatimento(escopo_abatimento)

    itens_full, comp_agg_full, _ = _obter_fila_calculada(
        baixa_filtro=b_norm,
        tipo_filtro=t_norm,
        familias_filtro=familias,
        todas_ops=todas_ops_flag,
        session_id=session_id,
        escopo_abatimento=escopo_norm,
        filtros_escopo=filtros_escopo if escopo_norm == "filtrado" else None,
    )
    if itens_full.empty or comp_agg_full.empty:
        return {"erro": "Nenhum insumo encontrado para os filtros selecionados."}

    alvo = pd.DataFrame()
    if op_filtro and "ordem_op" in itens_full.columns:
        alvo = itens_full[itens_full["ordem_op"].astype(str) == op_filtro]

    if alvo.empty:
        mask_item = itens_full["raiz_Item Final"].astype(str) == str(raiz_item_final)
        if raiz_pedido is not None:
            ped_param = _normalizar_pedido_valido(raiz_pedido)
            mask_item &= itens_full["raiz_Pedido_Str"].astype(str) == ped_param

        if raiz_fabrica:
            mask_item &= itens_full["raiz_Fábrica"].astype(str).str.upper() == str(raiz_fabrica).upper()

        alvo = itens_full[mask_item]

    if alvo.empty:
        return {"erro": "Item não encontrado no cálculo de consumo para os filtros atuais."}

    row_alvo = alvo.iloc[0]
    ordem_fila = int(row_alvo["_ordem_fila"])
    ped_str_alvo = _normalizar_pedido_valido(row_alvo.get("raiz_Pedido_Str") or raiz_pedido or "")
    item_final_alvo = str(row_alvo.get("raiz_Item Final") or raiz_item_final).strip()
    item_pai_cst = str(row_alvo.get("item_final_pai") or item_final_alvo).strip()
    dt_abertura_alvo = str(row_alvo.get("_dt_abertura_br") or "").strip()

    comp = comp_agg_full[comp_agg_full["_ordem_fila"] == ordem_fila].copy()

    faltando_df = comp[~comp["Disponivel"]].sort_values(
        by=["Falta", "Tipo", "Item"], ascending=[False, True, True]
    )
    disponivel_df = comp[comp["Disponivel"]].sort_values(
        by=["Tipo", "Item"], ascending=[True, True]
    )

    def _formatar_lista(sub_df: pd.DataFrame) -> List[Dict[str, Any]]:
        lista = []
        for _, r in sub_df.iterrows():
            tp = str(r["Tipo"] or "").strip().upper()
            tipo_desc = (
                "Matéria Prima (C)"
                if tp == "C"
                else (
                    "Componente Produzido (P)"
                    if tp == "P"
                    else ("Ferramenta / Insumo (F)" if tp == "F" else f"Outro ({tp})")
                )
            )
            info_ger = _enriquecer_insumo_gerencial(
                comp_item=str(r["Item"]),
                tipo_comp=tp,
                local_prod_raw=r.get("Local_Prod"),
                op_prod_raw=r.get("Ordem_Prod"),
                raiz_pedido_str=ped_str_alvo,
                raiz_item_final=item_pai_cst,
                raiz_data_abertura=dt_abertura_alvo,
                ordem_cons_raw=r.get("Ordem_Cons") or r.get("Ordem"),
            )
            est_total = round(float(r["estoque"]), 2)
            lista.append(
                {
                    "item": str(r["Item"]),
                    "descricao": str(r["Den_Item"] or ""),
                    "tipo": tp,
                    "tipo_descricao": tipo_desc,
                    "baixa": str(r.get("Baixa") or "").upper(),
                    "consumo": round(float(r["Consumo"]), 2),
                    "estoque_l": est_total,
                    "estoque_total": est_total,
                    "saldo_fila": round(float(r["estoque_disp_fila"]), 2),
                    "falta": round(float(r["Falta"]), 2),
                    "disponivel": bool(r["Disponivel"]),
                    "local_prod": info_ger["fabrica_componente"],
                    **info_ger,
                }
            )
        return lista

    faltando_list = _formatar_lista(faltando_df)
    disponiveis_list = _formatar_lista(disponivel_df)

    return {
        "posicao_fila": ordem_fila + 1,
        "ordem_op": str(row_alvo.get("ordem_op") or op_filtro),
        "eh_raiz": bool(row_alvo.get("eh_raiz", True)),
        "item_final_pai": str(row_alvo.get("item_final_pai") or ""),
        "fabrica_pai": str(row_alvo.get("fabrica_pai") or ""),
        "todas_ops": todas_ops_flag,
        "item_final": item_final_alvo,
        "descricao": str(row_alvo.get("raiz_Descricao") or ""),
        "pedido": ped_str_alvo,
        "fabrica": str(row_alvo.get("raiz_Fábrica") or raiz_fabrica or ""),
        "cliente": str(row_alvo.get("raiz_Cliente") or ""),
        "data_abertura": str(row_alvo.get("_dt_abertura_br") or ""),
        "entrega": str(row_alvo.get("_dt_entrega_br") or ""),
        "simulado": bool(row_alvo["simulado"]),
        "origem_simulacao": str(row_alvo["origem_simulacao"] or ""),
        "total_componentes": len(comp),
        "total_faltando": len(faltando_list),
        "total_disponiveis": len(disponiveis_list),
        "faltando": faltando_list,
        "disponiveis": disponiveis_list,
        "gerencial_faltando": _organizar_insumos_gerencial(faltando_list),
        "gerencial_disponiveis": _organizar_insumos_gerencial(disponiveis_list),
        "escopo_abatimento": escopo_norm,
        "session_id": str(session_id or "default"),
    }


def obter_resumo_pedido(
    pedido: Optional[str] = None,
    item_final: Optional[str] = None,
    fabrica: Optional[str] = None,
    baixa: Optional[str] = None,
    tipo: Optional[str] = None,
    familias: Optional[Any] = None,
    session_id: Optional[str] = None,
    escopo_abatimento: str = "global",
    filtros_escopo: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Tela Gerencial de Resumo de Pedido / Item ("O que falta para resolver o pedido ou o item"):
    - Consolida todos os itens finais pertencentes ao `pedido` (ou a um `item_final` específico caso o pedido seja vazio/filtrado).
    - Permite visualizar tanto o consolidado do pedido inteiro quanto filtrar por um item final específico do pedido.
    - Separa os insumos em:
      1. Matérias-Primas (Tipo == 'C'), trazendo Saldo Total de Estoque, Saldo na Fila, Falta e Previsão de OC
         (vinculada pelo número do pedido no texto da OC ou a previsão mais antiga).
      2. Componentes Produzidos (Tipo == 'P') agrupados por Fábrica, trazendo Saldo Total de Estoque, Saldo na Fila,
         Falta, OP do componente, Data de Abertura e Data de Entrega da OP.
    """
    ped_raw = str(pedido or "").strip()
    ped_norm = _normalizar_pedido_valido(ped_raw) if ped_raw else ""

    item_filtro = str(item_final or "").strip().upper()
    if item_filtro in ("", "TODOS"):
        item_filtro = ""

    fab_filtro = str(fabrica or "").strip().upper()
    if fab_filtro in ("", "TODOS"):
        fab_filtro = ""

    b_norm = str(baixa or "todos").strip().upper()
    t_norm = str(tipo or "todos").strip().upper()
    escopo_norm = _normalizar_escopo_abatimento(escopo_abatimento)

    itens_full, comp_agg_full, _ = _obter_fila_calculada(
        baixa_filtro=b_norm,
        tipo_filtro=t_norm,
        familias_filtro=familias,
        session_id=session_id,
        escopo_abatimento=escopo_norm,
        filtros_escopo=filtros_escopo if escopo_norm == "filtrado" else None,
    )
    if itens_full.empty or comp_agg_full.empty:
        return {"erro": "Nenhum dado encontrado na fila para os filtros informados."}

    if ped_norm:
        mask_ped = itens_full["raiz_Pedido_Str"].astype(str) == ped_norm
        itens_ped_df = itens_full[mask_ped].copy()
        if itens_ped_df.empty:
            # Tenta busca parcial caso o usuário tenha digitado parte do número
            mask_parcial = itens_full["raiz_Pedido_Str"].astype(str).str.contains(ped_norm, na=False)
            itens_ped_df = itens_full[mask_parcial].copy()
            if not itens_ped_df.empty:
                ped_norm = str(itens_ped_df.iloc[0]["raiz_Pedido_Str"])
                itens_ped_df = itens_full[itens_full["raiz_Pedido_Str"].astype(str) == ped_norm].copy()
    elif item_filtro:
        mask_it = itens_full["raiz_Item Final"].astype(str).str.upper() == item_filtro
        if fab_filtro:
            mask_it &= itens_full["raiz_Fábrica"].astype(str).str.upper() == fab_filtro
        itens_ped_df = itens_full[mask_it].copy()
    else:
        return {"erro": "Informe o número do pedido ou selecione um item para visualizar o resumo gerencial."}

    if itens_ped_df.empty:
        return {"erro": f"Pedido '{ped_raw or item_filtro}' não encontrado na fila atual."}

    itens_ped_df = itens_ped_df.sort_values(by="_ordem_fila", ascending=True).reset_index(drop=True)

    # Lista de todos os itens finais pertencentes a este pedido (para seletor de escopo Pedido vs Item)
    itens_do_pedido: List[Dict[str, Any]] = []
    for _, r_it in itens_ped_df.iterrows():
        s_val = 1.0
        if pd.notna(r_it["raiz_Saldo"]):
            try:
                s_val = float(r_it["raiz_Saldo"])
            except Exception:
                s_val = 1.0
        itens_do_pedido.append(
            {
                "posicao_fila": int(r_it["_ordem_fila"]) + 1,
                "ordem_fila_idx": int(r_it["_ordem_fila"]),
                "item_final": str(r_it["raiz_Item Final"]),
                "descricao": str(r_it["raiz_Descricao"] or ""),
                "pedido": str(r_it["raiz_Pedido_Str"] or ""),
                "fabrica": str(r_it["raiz_Fábrica"] or ""),
                "cliente": str(r_it["raiz_Cliente"] or ""),
                "saldo": round(s_val, 2) if s_val % 1 != 0 else int(s_val),
                "data_abertura": str(r_it["_dt_abertura_br"] or ""),
                "entrega": str(r_it["_dt_entrega_br"] or ""),
                "total_componentes": int(r_it["total_componentes"]),
                "componentes_disponiveis": int(r_it["componentes_disponiveis"]),
                "componentes_faltando": int(r_it["componentes_faltando"]),
                "perc_disponivel": float(r_it["perc_disponivel"]),
                "status": str(r_it["status"]),
                "simulado": bool(r_it["simulado"]),
                "origem_simulacao": str(r_it["origem_simulacao"] or ""),
            }
        )

    # Filtra escopo alvo (Pedido Completo vs Item Final específico do pedido)
    if item_filtro:
        alvo_df = itens_ped_df[itens_ped_df["raiz_Item Final"].astype(str).str.upper() == item_filtro]
        if fab_filtro and len(alvo_df) > 1:
            alvo_fab = alvo_df[alvo_df["raiz_Fábrica"].astype(str).str.upper() == fab_filtro]
            if not alvo_fab.empty:
                alvo_df = alvo_fab
        if alvo_df.empty:
            alvo_df = itens_ped_df
            item_filtro = ""
    else:
        alvo_df = itens_ped_df

    ordens_fila_alvo = alvo_df["_ordem_fila"].astype(int).tolist()
    mapa_info_fila = {
        int(r["_ordem_fila"]): {
            "item_final": str(r["raiz_Item Final"]),
            "descricao": str(r["raiz_Descricao"] or ""),
            "fabrica": str(r["raiz_Fábrica"] or ""),
            "posicao_fila": int(r["_ordem_fila"]) + 1,
            "pedido": str(r["raiz_Pedido_Str"] or ""),
            "data_abertura": str(r.get("_dt_abertura_br") or ""),
        }
        for _, r in alvo_df.iterrows()
    }

    comp_sub = comp_agg_full[comp_agg_full["_ordem_fila"].isin(ordens_fila_alvo)].copy()
    comp_sub = comp_sub.sort_values(by=["Item", "_ordem_fila"], ascending=[True, True])

    # Consolida por insumo (`Item`) dentro do escopo selecionado (Pedido inteiro ou Item específico)
    insumos_consolidados: List[Dict[str, Any]] = []
    for comp_code, grp in comp_sub.groupby("Item", sort=False):
        r_first = grp.iloc[0]
        tp = str(r_first["Tipo"] or "").strip().upper()
        tipo_desc = (
            "Matéria Prima (C)"
            if tp == "C"
            else (
                "Componente Produzido (P)"
                if tp == "P"
                else ("Ferramenta / Insumo (F)" if tp == "F" else f"Outro ({tp})")
            )
        )

        consumo_total_escopo = round(float(grp["Consumo"].sum()), 2)
        falta_total_escopo = round(float(grp["Falta"].sum()), 2)
        estoque_total = round(float(r_first["estoque"]), 2)
        # Saldo na fila no momento do primeiro item do pedido que consome este insumo
        saldo_fila_ref = round(float(r_first["estoque_disp_fila"]), 2)
        disponivel_escopo = falta_total_escopo <= 1e-6

        itens_finais_afetados: List[Dict[str, Any]] = []
        item_final_com_falta_principal = ""
        dt_abertura_ref_principal = ""
        for _, r_g in grp.iterrows():
            of_idx = int(r_g["_ordem_fila"])
            meta_f = mapa_info_fila.get(of_idx, {})
            falta_i = round(float(r_g["Falta"]), 2)
            if falta_i > 0 and not item_final_com_falta_principal:
                item_final_com_falta_principal = meta_f.get("item_final", "")
                dt_abertura_ref_principal = meta_f.get("data_abertura", "")
            itens_finais_afetados.append(
                {
                    "item_final": meta_f.get("item_final", ""),
                    "descricao": meta_f.get("descricao", ""),
                    "fabrica": meta_f.get("fabrica", ""),
                    "posicao_fila": meta_f.get("posicao_fila", of_idx + 1),
                    "data_abertura": meta_f.get("data_abertura", ""),
                    "consumo": round(float(r_g["Consumo"]), 2),
                    "saldo_fila": round(float(r_g["estoque_disp_fila"]), 2),
                    "falta": falta_i,
                    "disponivel": bool(r_g["Disponivel"]),
                }
            )

        ref_item_final = (
            item_filtro
            or item_final_com_falta_principal
            or (itens_finais_afetados[0]["item_final"] if itens_finais_afetados else "")
        )
        ref_dt_abertura = (
            dt_abertura_ref_principal
            or (itens_finais_afetados[0].get("data_abertura", "") if itens_finais_afetados else "")
            or primeiro_it.get("data_abertura", "")
        )

        info_ger = _enriquecer_insumo_gerencial(
            comp_item=str(comp_code),
            tipo_comp=tp,
            local_prod_raw=r_first.get("Local_Prod"),
            op_prod_raw=r_first.get("Ordem_Prod"),
            raiz_pedido_str=ped_norm,
            raiz_item_final=ref_item_final,
            raiz_data_abertura=ref_dt_abertura,
            ordem_cons_raw=r_first.get("Ordem_Cons") or r_first.get("Ordem"),
        )

        insumos_consolidados.append(
            {
                "item": str(comp_code),
                "descricao": str(r_first["Den_Item"] or ""),
                "tipo": tp,
                "tipo_descricao": tipo_desc,
                "baixa": str(r_first.get("Baixa") or "").upper(),
                "consumo": consumo_total_escopo,
                "estoque_l": estoque_total,
                "estoque_total": estoque_total,
                "saldo_fila": saldo_fila_ref,
                "falta": falta_total_escopo,
                "disponivel": disponivel_escopo,
                "local_prod": info_ger["fabrica_componente"],
                "itens_finais_afetados": itens_finais_afetados,
                "qtd_itens_finais_afetados": len(itens_finais_afetados),
                "qtd_itens_finais_com_falta": sum(1 for x in itens_finais_afetados if x["falta"] > 0),
                **info_ger,
            }
        )

    faltando_list = [x for x in insumos_consolidados if not x["disponivel"]]
    disponiveis_list = [x for x in insumos_consolidados if x["disponivel"]]

    faltando_list.sort(key=lambda x: (-x["falta"], x["tipo"], x["item"]))
    disponiveis_list.sort(key=lambda x: (x["tipo"], x["item"]))

    gerencial_faltando = _organizar_insumos_gerencial(faltando_list)
    gerencial_disponiveis = _organizar_insumos_gerencial(disponiveis_list)

    primeiro_it = itens_do_pedido[0]
    total_itens_ped = len(itens_do_pedido)
    itens_disp_ped = sum(1 for x in itens_do_pedido if x["status"] == "Disponível")
    itens_falta_ped = total_itens_ped - itens_disp_ped

    return {
        "pedido": ped_norm,
        "escopo_item_final": item_filtro or "TODOS",
        "cliente": primeiro_it.get("cliente", ""),
        "data_abertura": primeiro_it.get("data_abertura", ""),
        "entrega": primeiro_it.get("entrega", ""),
        "simulado": any(x["simulado"] for x in itens_do_pedido),
        "origem_simulacao": primeiro_it.get("origem_simulacao", ""),
        "total_itens_pedido": total_itens_ped,
        "itens_pedido_disponiveis": itens_disp_ped,
        "itens_pedido_com_falta": itens_falta_ped,
        "status_pedido": "Disponível" if itens_falta_ped == 0 else "Com Falta",
        "itens_do_pedido": itens_do_pedido,
        "total_insumos": len(insumos_consolidados),
        "total_faltando": len(faltando_list),
        "total_disponiveis": len(disponiveis_list),
        "faltando": faltando_list,
        "disponiveis": disponiveis_list,
        "gerencial_faltando": gerencial_faltando,
        "gerencial_disponiveis": gerencial_disponiveis,
        "escopo_abatimento": escopo_norm,
        "session_id": str(session_id or "default"),
    }


def exportar_analise_excel(
    filtros: Optional[Dict[str, Any]] = None,
    session_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Exporta a análise consolidada dos itens finais (ou todas as OPs) com seus status, faltas e marcação de simulação
    para um arquivo Excel no diretório de exportações, isolando o arquivo e a fila da sessão.
    """
    todas_ops = bool((filtros or {}).get("todas_ops", False))
    res = analisar_itens_finais(filtros=filtros, page=0, page_size=200000, session_id=session_id)
    itens = res.get("itens", [])
    if not itens:
        return {"erro": "Nenhum item final encontrado para exportação com os filtros aplicados."}

    df_export = pd.DataFrame(itens)
    df_export["origem_label"] = np.where(
        df_export["simulado"],
        np.where(
            df_export["origem_simulacao"] == "carteira",
            "Ordem Criada",
            "Simulado (Intranet)",
        ),
        "Carteira ERP",
    )
    if todas_ops:
        df_export["tipo_ordem_label"] = np.where(df_export["eh_raiz"], "Item Final", "Subcomponente")
        df_export = df_export.drop(columns=["simulado", "origem_simulacao", "eh_raiz"], errors="ignore")
    else:
        df_export = df_export.drop(
            columns=["simulado", "origem_simulacao", "ordem_op", "eh_raiz", "item_final_pai", "fabrica_pai"],
            errors="ignore",
        )

    col_names = {
        "posicao_fila": "Posição na Fila",
        "ordem_op": "OP",
        "tipo_ordem_label": "Tipo Ordem",
        "item_final_pai": "Item Final Pai",
        "fabrica_pai": "Fábrica Pai",
        "item_final": "Código Item" if todas_ops else "Código Item Final",
        "descricao": "Descrição",
        "pedido": "Pedido",
        "fabrica": "Local Produção / Fábrica",
        "cliente": "Cliente",
        "saldo": "Saldo Pedido",
        "data_abertura": "Data Abertura OP",
        "entrega": "Data Entrega",
        "total_componentes": "Total Insumos",
        "componentes_disponiveis": "Insumos Disponíveis",
        "componentes_faltando": "Insumos Faltando",
        "perc_disponivel": "% Disponibilidade",
        "status": "Status",
        "origem_label": "Origem Registro",
    }
    df_export = df_export.rename(columns=col_names)

    sess_tag = (session_id[:8] if session_id and session_id != "default" else "export")
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    nome_arquivo = f"analise_estoque_{sess_tag}_{timestamp}.xlsx"
    caminho_arquivo = settings.EXPORTS_DIR / nome_arquivo

    df_export.to_excel(caminho_arquivo, index=False)
    return {
        "status": "ok",
        "url": f"/ver_estoque/exports/{nome_arquivo}",
        "nome": nome_arquivo,
        "total": len(df_export),
        "session_id": str(session_id or "default"),
    }


def _resolver_local_prod_componente(comp_item: Any, local_prod_raw: Any) -> str:
    """Resolve o local de produção (fábrica) de um componente produzido (Tipo P)."""
    it = scraper.normalizar_cod_item(comp_item)
    lp = str(local_prod_raw or "").strip()
    if lp in ("", "0", ".", "None", "nan"):
        lp = (
            _enriquecimento.get("local_prod", {}).get(it)
            or _enriquecimento.get("fabrica_item", {}).get(it)
            or ""
        )
    return lp if lp else "NÃO INFORMADO"


def obter_opcoes_filtros_faltantes(session_id: Optional[str] = None) -> Dict[str, Any]:
    """
    Retorna as listas de opções disponíveis para o menu de filtros de cálculo da Matriz Pivot:
    - locais_item_final: Todos os Locais de Produção do Item Final (raiz_Fábrica) que possuem estrutura
    - locais_componente: Todos os Locais de Produção de Componentes Produzidos (Tipo == 'P')
    - prazos_disponiveis: Todos os prazos de expedição disponíveis (calculados pelo Representante)
    """
    itens_full, comp_agg_full, locais_producao = _obter_fila_calculada(
        baixa_filtro="TODOS",
        tipo_filtro="P",
        session_id=session_id,
    )

    if not comp_agg_full.empty and "raiz_Fábrica" in comp_agg_full.columns:
        locais_item_final = sorted(
            {
                str(x).strip()
                for x in comp_agg_full["raiz_Fábrica"].dropna().unique()
                if str(x).strip() and str(x).strip() != "0"
            }
        )
    else:
        locais_item_final = sorted(
            {str(x).strip() for x in locais_producao if str(x).strip() and str(x).strip() != "0"}
        )

    locais_comp_set: Set[str] = set()
    prazos_set: Set[int] = {3, 8, 10}

    if not comp_agg_full.empty:
        sub_p = comp_agg_full[comp_agg_full["Tipo"].astype(str).str.upper() == "P"]
        for rec in sub_p[["Item", "Local_Prod"]].drop_duplicates().to_dict("records"):
            lp = _resolver_local_prod_componente(rec.get("Item"), rec.get("Local_Prod"))
            if lp:
                locais_comp_set.add(lp)

        if "prazo_expedicao" in comp_agg_full.columns:
            for p_val in comp_agg_full["prazo_expedicao"].dropna().unique():
                try:
                    prazos_set.add(int(p_val))
                except (ValueError, TypeError):
                    pass

    prazos_ordenados = sorted(prazos_set)
    prazos_meta = [
        {
            "prazo": int(p),
            "key": str(int(p)),
            "label": settings.nome_prazo_expedicao(int(p)),
        }
        for p in prazos_ordenados
    ]

    return {
        "locais_item_final": locais_item_final,
        "locais_componente": sorted(locais_comp_set),
        "prazos_disponiveis": prazos_ordenados,
        "prazos_colunas": prazos_meta,
        "session_id": str(session_id or "default"),
    }


def obter_matriz_faltantes_producao(
    filtros: Optional[Dict[str, Any]] = None,
    session_id: Optional[str] = None,
    slim: bool = False,
) -> Dict[str, Any]:
    """
    Calcula e retorna a Matriz Pivot de Componentes Produzidos Faltantes (Tipo == 'P')
    agrupada por:
      Local de Produção do Item Pai (raiz_Fábrica)
      × Local de Produção do Componente Produzido (fabrica_componente)
      × Colunas de Prazo de Expedição (calculado com base no Representante: todos os disponíveis).

    Quando `slim=True`, consolida diretamente por `(fabrica_componente, item)` omitindo `grupos` e
    metadados pesados por ocorrência para reduzir drasticamente o payload HTTP.

    Suporta filtros marcados pelo usuário para cálculo:
      - locais_item_final: lista de locais do item final selecionados (vazio = todos)
      - locais_componente: lista de locais do componente produzido selecionados (vazio = todos)
      - baixa: 'todos' | 'S' | 'N'
      - escopo_abatimento: 'global' (respeita fila global) | 'filtrado' (abate estoque apenas entre os locais marcados)
      - data_inicio / data_fim: filtro de janela de Data de Abertura da OP do item pai
      - busca: filtro textual por código/descrição de componente, item final ou pedido
    """
    filtros = filtros or {}
    slim_flag = bool(slim)
    sess = obter_sessao(session_id)
    lock_matriz, cache_matriz_map, sim_ver = _selecionar_cache(sess, "matriz")
    filtros_json = json.dumps(filtros, sort_keys=True, default=str)
    hoje_d1_iso = (datetime.now().date() + timedelta(days=1)).isoformat()
    cache_key = (_cache_timestamp, sim_ver, hoje_d1_iso, slim_flag, filtros_json)
    with lock_matriz:
        if cache_key in cache_matriz_map:
            return cache_matriz_map[cache_key]

    raw_locais_pai = filtros.get("locais_item_final") or []
    if isinstance(raw_locais_pai, str):
        raw_locais_pai = [x.strip() for x in raw_locais_pai.split(",") if x.strip()]
    locais_pai_sel = {str(x).strip().upper() for x in raw_locais_pai if str(x).strip()}

    raw_locais_comp = filtros.get("locais_componente") or []
    if isinstance(raw_locais_comp, str):
        raw_locais_comp = [x.strip() for x in raw_locais_comp.split(",") if x.strip()]
    locais_comp_sel = {str(x).strip().upper() for x in raw_locais_comp if str(x).strip()}

    baixa_filtro = str(filtros.get("baixa", "todos") or "todos").strip().upper()
    escopo_abatimento = str(filtros.get("escopo_abatimento", "global") or "global").strip().lower()
    data_inicio_raw = filtros.get("data_inicio")
    data_fim_raw = filtros.get("data_fim")
    busca_filtro = str(filtros.get("busca", "") or "").strip().upper()

    opcoes_base = obter_opcoes_filtros_faltantes(session_id=session_id)

    itens_full, comp_agg_full, _ = _obter_fila_calculada(
        baixa_filtro=baixa_filtro,
        tipo_filtro="P",
        session_id=session_id,
    )

    if itens_full.empty or comp_agg_full.empty:
        return {
            "grupos": [],
            "linhas_planas": [],
            "prazos_colunas": opcoes_base["prazos_colunas"],
            "totais_gerais": {
                "total_grupos": 0,
                "total_componentes_distintos": 0,
                "total_linhas_matriz": 0,
                "soma_falta_geral": 0.0,
                "somas_por_prazo": {c["key"]: 0.0 for c in opcoes_base["prazos_colunas"]},
                "total_pedidos_afetados": 0,
            },
            "opcoes_filtros": opcoes_base,
            "session_id": str(session_id or "default"),
        }

    # Prepara DataFrame de trabalho apenas para componentes produzidos (Tipo == 'P')
    comp_p = comp_agg_full[comp_agg_full["Tipo"].astype(str).str.upper() == "P"].copy()
    if comp_p.empty:
        return {
            "grupos": [],
            "linhas_planas": [],
            "prazos_colunas": opcoes_base["prazos_colunas"],
            "totais_gerais": {
                "total_grupos": 0,
                "total_componentes_distintos": 0,
                "total_linhas_matriz": 0,
                "soma_falta_geral": 0.0,
                "somas_por_prazo": {c["key"]: 0.0 for c in opcoes_base["prazos_colunas"]},
                "total_pedidos_afetados": 0,
            },
            "opcoes_filtros": opcoes_base,
            "session_id": str(session_id or "default"),
        }

    # Resolve local de produção de cada componente produzido de forma vetorizada via mapa único
    pares_comp = comp_p[["Item", "Local_Prod"]].drop_duplicates().to_dict("records")
    mapa_local_comp = {
        (r["Item"], r["Local_Prod"]): _resolver_local_prod_componente(r["Item"], r["Local_Prod"])
        for r in pares_comp
    }
    comp_p["fabrica_componente"] = [
        mapa_local_comp.get((it, lp), "NÃO INFORMADO")
        for it, lp in zip(comp_p["Item"], comp_p["Local_Prod"])
    ]

    # Enriquecimento com metadados da fila do item pai (descrição, datas, saldo, cliente)
    cols_meta_pai = [
        "_ordem_fila",
        "_dt_abertura_sort",
        "_dt_entrega_sort",
        "_dt_abertura_br",
        "_dt_entrega_br",
        "raiz_Descricao",
        "raiz_Cliente",
        "raiz_Saldo",
        "simulado",
        "origem_simulacao",
    ]
    cols_meta_exist = [c for c in cols_meta_pai if c in itens_full.columns]
    comp_p = comp_p.merge(
        itens_full[cols_meta_exist],
        on="_ordem_fila",
        how="left",
    )

    # Aplica filtros de Local do Item Final, Local do Componente Produzido e Janela de Entrega do Pedido
    mask = pd.Series(True, index=comp_p.index)

    if locais_pai_sel:
        mask &= comp_p["raiz_Fábrica"].astype(str).str.strip().str.upper().isin(locais_pai_sel)

    if locais_comp_sel:
        mask &= comp_p["fabrica_componente"].astype(str).str.strip().str.upper().isin(locais_comp_sel)

    if data_inicio_raw and str(data_inicio_raw).strip():
        dt_in_str = str(data_inicio_raw).strip()
        dt_in = pd.to_datetime(dt_in_str, errors="coerce", dayfirst="/" in dt_in_str)
        if pd.notna(dt_in) and "_dt_entrega_sort" in comp_p.columns:
            mask &= comp_p["_dt_entrega_sort"].dt.floor("D") >= dt_in.floor("D")

    if data_fim_raw and str(data_fim_raw).strip():
        dt_fi_str = str(data_fim_raw).strip()
        dt_fi = pd.to_datetime(dt_fi_str, errors="coerce", dayfirst="/" in dt_fi_str)
        if pd.notna(dt_fi) and "_dt_entrega_sort" in comp_p.columns:
            mask &= comp_p["_dt_entrega_sort"].dt.floor("D") <= dt_fi.floor("D")

    comp_filtrado = comp_p[mask].copy()

    # Se escopo_abatimento == 'filtrado', recalcula o abatimento cumulativo de estoque
    # considerando exclusivamente as ordens que passaram pelos filtros de cálculo marcados
    if escopo_abatimento == "filtrado" and not comp_filtrado.empty:
        comp_filtrado = comp_filtrado.sort_values(
            by=["Item", "_ordem_fila"], ascending=[True, True]
        ).reset_index(drop=True)
        comp_filtrado["Consumo"] = comp_filtrado["Consumo"].round(2)
        comp_filtrado["estoque"] = comp_filtrado["estoque"].round(2)
        cons_acum = comp_filtrado.groupby("Item")["Consumo"].cumsum().round(2)
        cons_ant = (cons_acum - comp_filtrado["Consumo"]).round(2)
        comp_filtrado["estoque_disp_fila"] = (
            (comp_filtrado["estoque"] - cons_ant).clip(lower=0.0).round(2)
        )
        comp_filtrado["Disponivel"] = (
            comp_filtrado["estoque_disp_fila"] + 1e-6
        ) >= comp_filtrado["Consumo"]
        comp_filtrado["Falta"] = np.where(
            comp_filtrado["Disponivel"],
            0.0,
            (comp_filtrado["Consumo"] - comp_filtrado["estoque_disp_fila"]).clip(lower=0.0).round(2),
        )

    # Seleciona apenas os itens produzidos FALTANTES (Falta > 0)
    faltantes_df = comp_filtrado[(~comp_filtrado["Disponivel"]) & (comp_filtrado["Falta"] > 0)].copy()

    # Filtro textual de busca (se informado)
    if busca_filtro and not faltantes_df.empty:
        m_item = faltantes_df["Item"].astype(str).str.upper().str.contains(busca_filtro, na=False)
        m_desc = faltantes_df["Den_Item"].astype(str).str.upper().str.contains(busca_filtro, na=False)
        m_pai = faltantes_df["raiz_Item Final"].astype(str).str.upper().str.contains(busca_filtro, na=False)
        m_ped = faltantes_df["raiz_Pedido_Str"].astype(str).str.upper().str.contains(busca_filtro, na=False)
        m_rep = faltantes_df["raiz_Representante"].astype(str).str.upper().str.contains(busca_filtro, na=False)
        faltantes_df = faltantes_df[m_item | m_desc | m_pai | m_ped | m_rep].copy()

    prazos_colunas = opcoes_base["prazos_colunas"]
    prazos_keys = [c["key"] for c in prazos_colunas]

    if faltantes_df.empty:
        return {
            "grupos": [],
            "linhas_planas": [],
            "prazos_colunas": prazos_colunas,
            "totais_gerais": {
                "total_grupos": 0,
                "total_componentes_distintos": 0,
                "total_linhas_matriz": 0,
                "soma_falta_geral": 0.0,
                "somas_por_prazo": {k: 0.0 for k in prazos_keys},
                "total_pedidos_afetados": 0,
            },
            "opcoes_filtros": opcoes_base,
            "session_id": str(session_id or "default"),
        }

    faltantes_df["prazo_expedicao"] = (
        pd.to_numeric(faltantes_df["prazo_expedicao"], errors="coerce").fillna(0).astype(int)
    )

    # Garante que qualquer prazo presente nos faltantes esteja representado nas colunas
    prazos_presentes = sorted(
        set(opcoes_base["prazos_disponiveis"]) | set(faltantes_df["prazo_expedicao"].unique())
    )
    prazos_colunas = [
        {
            "prazo": int(p),
            "key": str(int(p)),
            "label": settings.nome_prazo_expedicao(int(p)),
        }
        for p in prazos_presentes
    ]
    prazos_keys = [c["key"] for c in prazos_colunas]

    saldos_d1_cache: Dict[str, Tuple[float, float]] = {}
    todos_pedidos_afetados: Set[str] = set()
    componentes_distintos_set: Set[str] = set()
    somas_gerais_por_prazo: Dict[str, float] = {k: 0.0 for k in prazos_keys}

    if slim_flag:
        acum_slim: Dict[Tuple[str, str], Dict[str, Any]] = {}
        for fab_comp_raw, item_raw, den_raw, falta_raw, prazo_raw, ped_raw in zip(
            faltantes_df["fabrica_componente"].to_numpy(),
            faltantes_df["Item"].to_numpy(),
            faltantes_df["Den_Item"].to_numpy(),
            faltantes_df["Falta"].to_numpy(),
            faltantes_df["prazo_expedicao"].to_numpy(),
            faltantes_df["raiz_Pedido_Str"].to_numpy(),
        ):
            fab_comp_str = str(fab_comp_raw or "NÃO INFORMADO").strip()
            comp_str = str(item_raw or "").strip()
            falta_val = round(float(falta_raw or 0.0), 2)
            prazo_k = str(int(prazo_raw or 0))
            ped_s = str(ped_raw or "").strip()
            if ped_s:
                todos_pedidos_afetados.add(ped_s)

            chave_slim = (fab_comp_str, comp_str)
            acc = acum_slim.get(chave_slim)
            if acc is None:
                componentes_distintos_set.add(comp_str)
                acc = {
                    "fabrica_componente": fab_comp_str,
                    "item": comp_str,
                    "descricao": str(den_raw or ""),
                    "falta_por_prazo": {k: 0.0 for k in prazos_keys},
                    "falta_total": falta_val,
                }
                acc["falta_por_prazo"][prazo_k] = falta_val
                acum_slim[chave_slim] = acc
            else:
                acc["falta_total"] = round(acc["falta_total"] + falta_val, 2)
                acc["falta_por_prazo"][prazo_k] = round(
                    acc["falta_por_prazo"].get(prazo_k, 0.0) + falta_val, 2
                )

            somas_gerais_por_prazo[prazo_k] = round(
                somas_gerais_por_prazo.get(prazo_k, 0.0) + falta_val, 2
            )

        linhas_planas = []
        for (fab_comp_str, comp_str), acc in acum_slim.items():
            comp_norm = scraper.normalizar_cod_item(comp_str)
            if comp_norm not in saldos_d1_cache:
                saldos_d1_cache[comp_norm] = _calcular_saldos_ops_abertura_d1(
                    comp_norm, data_corte_iso=hoje_d1_iso
                )
            op_saldo_ate_d1, op_saldo_apos_d1 = saldos_d1_cache[comp_norm]
            linhas_planas.append(
                {
                    "fabrica_componente": fab_comp_str,
                    "item": comp_str,
                    "descricao": acc["descricao"],
                    "falta_por_prazo": acc["falta_por_prazo"],
                    "falta_total": acc["falta_total"],
                    "op_saldo_ate_d1": op_saldo_ate_d1,
                    "op_saldo_apos_d1": op_saldo_apos_d1,
                }
            )

        linhas_planas.sort(
            key=lambda x: (
                x["fabrica_componente"],
                -x["falta_total"],
                x["item"],
            )
        )
        grupos_lista: List[Dict[str, Any]] = []
    else:
        # Agrupamento ultra-rápido em O(N) sem iterrows() para Matriz Pivot:
        # (Local Produção Item Pai, Local Produção Componente, Código do Componente)
        faltantes_df = faltantes_df.sort_values(
            by=["raiz_Fábrica", "fabrica_componente", "Item", "_ordem_fila"],
            ascending=[True, True, True, True],
        )

        acum_por_chave: Dict[Tuple[str, str, str], Dict[str, Any]] = {}

        for r_row in faltantes_df.to_dict("records"):
            fab_pai_str = str(r_row.get("raiz_Fábrica") or "NÃO INFORMADO").strip()
            fab_comp_str = str(r_row.get("fabrica_componente") or "NÃO INFORMADO").strip()
            comp_str = str(r_row.get("Item") or "").strip()
            chave = (fab_pai_str, fab_comp_str, comp_str)

            falta_val = round(float(r_row.get("Falta") or 0.0), 2)
            consumo_val = round(float(r_row.get("Consumo") or 0.0), 2)
            est_disp_val = round(float(r_row.get("estoque_disp_fila") or 0.0), 2)
            prazo_int = int(r_row.get("prazo_expedicao") or 0)
            prazo_k = str(prazo_int)

            ped_s = str(r_row.get("raiz_Pedido_Str") or "").strip()
            if ped_s:
                todos_pedidos_afetados.add(ped_s)

            rep_raw = r_row.get("raiz_Representante")
            rep_str = ""
            if rep_raw is not None and pd.notna(rep_raw):
                try:
                    rep_int = int(float(str(rep_raw).strip().rstrip(".")))
                    rep_str = str(rep_int) if rep_int > 0 else ""
                except Exception:
                    rep_str = str(rep_raw).strip()

            ocorrencia = {
                "posicao_fila": int(r_row["_ordem_fila"]) + 1,
                "pedido": ped_s,
                "item_final": str(r_row.get("raiz_Item Final") or ""),
                "descricao_pai": str(r_row.get("raiz_Descricao") or ""),
                "cliente": str(r_row.get("raiz_Cliente") or ""),
                "representante": rep_str,
                "prazo_expedicao": prazo_int,
                "data_abertura": str(r_row.get("_dt_abertura_br") or ""),
                "entrega": str(r_row.get("_dt_entrega_br") or ""),
                "consumo": consumo_val,
                "saldo_fila": est_disp_val,
                "falta": falta_val,
            }

            acc = acum_por_chave.get(chave)
            if acc is None:
                componentes_distintos_set.add(comp_str)
                acc = {
                    "fabrica_pai": fab_pai_str,
                    "fabrica_componente": fab_comp_str,
                    "item": comp_str,
                    "descricao": str(r_row.get("Den_Item") or ""),
                    "baixa": str(r_row.get("Baixa") or "").upper(),
                    "estoque_total": round(float(r_row.get("estoque") or 0.0), 2),
                    "saldo_fila_min": est_disp_val,
                    "consumo_total": consumo_val,
                    "falta_por_prazo": {k: 0.0 for k in prazos_keys},
                    "falta_total": falta_val,
                    "ordem_prod_raw": r_row.get("Ordem_Prod"),
                    "pedidos_set": {ped_s} if ped_s else set(),
                    "representantes_list": [rep_str] if rep_str else [],
                    "itens_pais_afetados": [ocorrencia],
                }
                acc["falta_por_prazo"][prazo_k] = falta_val
                acum_por_chave[chave] = acc
            else:
                acc["consumo_total"] = round(acc["consumo_total"] + consumo_val, 2)
                acc["falta_total"] = round(acc["falta_total"] + falta_val, 2)
                if est_disp_val < acc["saldo_fila_min"]:
                    acc["saldo_fila_min"] = est_disp_val
                acc["falta_por_prazo"][prazo_k] = round(
                    acc["falta_por_prazo"].get(prazo_k, 0.0) + falta_val, 2
                )
                if ped_s:
                    acc["pedidos_set"].add(ped_s)
                if rep_str and rep_str not in acc["representantes_list"]:
                    acc["representantes_list"].append(rep_str)
                acc["itens_pais_afetados"].append(ocorrencia)

            somas_gerais_por_prazo[prazo_k] = round(
                somas_gerais_por_prazo.get(prazo_k, 0.0) + falta_val, 2
            )

        grupos_dict: Dict[Tuple[str, str], List[Dict[str, Any]]] = {}
        linhas_planas = []

        for (fab_pai_str, fab_comp_str, comp_str), acc in acum_por_chave.items():
            itens_pais_afetados = acc["itens_pais_afetados"]
            ped_ref = itens_pais_afetados[0]["pedido"] if itens_pais_afetados else ""
            it_pai_ref = itens_pais_afetados[0]["item_final"] if itens_pais_afetados else ""
            dt_ab_ref = itens_pais_afetados[0]["data_abertura"] if itens_pais_afetados else ""

            info_ger = _enriquecer_insumo_gerencial(
                comp_item=comp_str,
                tipo_comp="P",
                local_prod_raw=fab_comp_str,
                op_prod_raw=acc["ordem_prod_raw"],
                raiz_pedido_str=ped_ref,
                raiz_item_final=it_pai_ref,
                raiz_data_abertura=dt_ab_ref,
                saldos_d1_cache=saldos_d1_cache,
                data_corte_d1_iso=hoje_d1_iso,
            )

            pedidos_sorted = sorted(acc["pedidos_set"])
            reps_list = acc.get("representantes_list") or []
            linha_item = {
                "fabrica_pai": fab_pai_str,
                "fabrica_componente": fab_comp_str,
                "item": comp_str,
                "descricao": acc["descricao"],
                "representante": ", ".join(reps_list) if reps_list else "-",
                "representantes_afetados": reps_list,
                "baixa": acc["baixa"],
                "estoque_total": acc["estoque_total"],
                "saldo_fila_min": acc["saldo_fila_min"],
                "consumo_total": acc["consumo_total"],
                "falta_por_prazo": acc["falta_por_prazo"],
                "falta_total": acc["falta_total"],
                "qtd_ocorrencias": len(itens_pais_afetados),
                "qtd_pedidos_afetados": len(pedidos_sorted),
                "pedidos_afetados": pedidos_sorted,
                "itens_pais_afetados": itens_pais_afetados[:15],
                "ordem_prod": info_ger["ordem_prod"],
                "op_data_abertura": info_ger["op_data_abertura"],
                "op_data_entrega": info_ger["op_data_entrega"],
                "op_saldo": info_ger["op_saldo"],
                "op_saldo_ate_d1": info_ger["op_saldo_ate_d1"],
                "op_saldo_apos_d1": info_ger["op_saldo_apos_d1"],
                "op_vinculo": info_ger["op_vinculo"],
                "ops_abertas": info_ger["ops_abertas"],
            }

            grupos_dict.setdefault((fab_pai_str, fab_comp_str), []).append(linha_item)
            linhas_planas.append(linha_item)

        # Monta a lista de grupos (Local Item Pai × Local Componente) ordenada por maior falta
        grupos_lista = []
        for (fab_pai_str, fab_comp_str), itens_grp in grupos_dict.items():
            itens_grp.sort(key=lambda x: (-x["falta_total"], x["item"]))
            somas_prazo_grp = {
                k: round(sum(x["falta_por_prazo"].get(k, 0.0) for x in itens_grp), 2)
                for k in prazos_keys
            }
            falta_total_grp = round(sum(x["falta_total"] for x in itens_grp), 2)
            com_op_grp = sum(1 for x in itens_grp if bool(x.get("ordem_prod")))

            grupos_lista.append(
                {
                    "fabrica_pai": fab_pai_str,
                    "fabrica_componente": fab_comp_str,
                    "total_componentes": len(itens_grp),
                    "total_com_op": com_op_grp,
                    "falta_total_grupo": falta_total_grp,
                    "somas_por_prazo": somas_prazo_grp,
                    "itens": itens_grp,
                }
            )

        grupos_lista.sort(
            key=lambda g: (
                g["fabrica_pai"],
                -g["falta_total_grupo"],
                g["fabrica_componente"],
            )
        )
        linhas_planas.sort(
            key=lambda x: (
                x["fabrica_pai"],
                x["fabrica_componente"],
                -x["falta_total"],
                x["item"],
            )
        )

    soma_falta_geral = round(sum(somas_gerais_por_prazo.values()), 2)

    resultado = {
        "grupos": grupos_lista,
        "linhas_planas": linhas_planas,
        "prazos_colunas": prazos_colunas,
        "totais_gerais": {
            "total_grupos": len(grupos_lista),
            "total_componentes_distintos": len(componentes_distintos_set),
            "total_linhas_matriz": len(linhas_planas),
            "soma_falta_geral": soma_falta_geral,
            "somas_por_prazo": somas_gerais_por_prazo,
            "total_pedidos_afetados": len(todos_pedidos_afetados),
        },
        "opcoes_filtros": opcoes_base,
        "session_id": str(session_id or "default"),
    }

    with lock_matriz:
        if len(cache_matriz_map) >= 20:
            cache_matriz_map.clear()
        cache_matriz_map[cache_key] = resultado

    return resultado


def exportar_matriz_faltantes_excel(
    filtros: Optional[Dict[str, Any]] = None,
    session_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Exporta a Matriz Pivot de Componentes Produzidos Faltantes (Local Pai × Local Componente × Prazos de Expedição)
    para um arquivo Excel (.xlsx) no diretório de exportações.
    """
    res = obter_matriz_faltantes_producao(filtros=filtros, session_id=session_id)
    linhas = res.get("linhas_planas") or []
    prazos_colunas = res.get("prazos_colunas") or []

    if not linhas:
        return {"erro": "Nenhum componente produzido faltante encontrado para os filtros selecionados."}

    registros_excel: List[Dict[str, Any]] = []
    for row in linhas:
        reg: Dict[str, Any] = {
            "Local Produção Item Pai": row["fabrica_pai"],
            "Local Produção Componente": row["fabrica_componente"],
            "Código Componente": row["item"],
            "Descrição Componente": row["descricao"],
            "Representante": row.get("representante") or "-",
            "Baixa": row["baixa"],
            "Estoque Físico Total (L)": row["estoque_total"],
            "Consumo no Grupo": row["consumo_total"],
        }
        for col_p in prazos_colunas:
            k = col_p["key"]
            lbl = f"Falta {col_p['label']}"
            reg[lbl] = row["falta_por_prazo"].get(k, 0.0)

        reg["Total Faltante"] = row["falta_total"]
        reg["Saldo da ops do item com abertura menor ou igual a hoje+1"] = row.get("op_saldo_ate_d1", 0.0)
        reg["Saldo das OPs com abertura maior que hoje+1"] = row.get("op_saldo_apos_d1", 0.0)
        reg["OP Aberta"] = row["ordem_prod"] or ""
        reg["Vínculo OP"] = row["op_vinculo"] or ""
        reg["Saldo OP"] = row["op_saldo"]
        reg["Abertura OP"] = row["op_data_abertura"] or ""
        reg["Entrega OP"] = row["op_data_entrega"] or ""
        reg["Qtd Pedidos Afetados"] = row["qtd_pedidos_afetados"]
        reg["Pedidos Afetados"] = ", ".join(row.get("pedidos_afetados") or [])
        registros_excel.append(reg)

    df_export = pd.DataFrame(registros_excel)
    sess_tag = (session_id[:8] if session_id and session_id != "default" else "export")
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    nome_arquivo = f"matriz_faltantes_producao_{sess_tag}_{timestamp}.xlsx"
    caminho_arquivo = settings.EXPORTS_DIR / nome_arquivo

    df_export.to_excel(caminho_arquivo, index=False)
    return {
        "status": "ok",
        "url": f"/ver_estoque/exports/{nome_arquivo}",
        "nome": nome_arquivo,
        "total": len(df_export),
        "session_id": str(session_id or "default"),
    }

def _resumo_faltantes_vazio(
    session_id: Optional[str] = None,
    visao: str = "por_insumo",
    todas_ops: bool = False,
    escopo_abatimento: str = "global",
) -> Dict[str, Any]:
    info_carga = obter_info_carregamento()
    return {
        "visao": visao,
        "todas_ops": bool(todas_ops),
        "escopo_abatimento": _normalizar_escopo_abatimento(escopo_abatimento),
        "grupos_produzidos": [],
        "grupos_comprados": [],
        "grupos_por_local_item": [],
        "totais": {
            "itens_finais_com_falta": 0,
            "pedidos_afetados": 0,
            "p_itens": 0,
            "p_falta_total": 0.0,
            "p_com_op": 0,
            "p_locais": 0,
            "c_itens": 0,
            "c_falta_total": 0.0,
            "c_com_oc": 0,
            "c_locais": 0,
        },
        "data_carga": info_carga["data_carga"],
        "data_oc": info_carga["data_oc"],
        "snapshot": info_carga["snapshot"],
        "session_id": str(session_id or "default"),
    }


_CAMPOS_ENRIQUECIMENTO_RESUMO = (
    "ordem_prod",
    "op_data_abertura",
    "op_data_entrega",
    "op_saldo",
    "op_vinculo",
    "oc_numero",
    "oc_previsao",
    "oc_saldo",
    "oc_saldo_ate_abertura",
    "oc_fornecedor",
    "oc_sit",
    "oc_vinculo",
    "oc_vinculada_pedido",
    "eh_cst",
    "cst_situacao",
    "cst_chegou",
)


def _construir_grupos_por_local_item(
    comp: pd.DataFrame,
    itens_sel: pd.DataFrame,
) -> List[Dict[str, Any]]:
    """
    Agrupa os insumos faltantes por Local de Produção do Item/OP (`raiz_Fábrica`) ->
    cada Item/Pedido/OP (`_ordem_fila`) -> lista de insumos faltantes.
    """
    if comp.empty or itens_sel.empty:
        return []

    ordem_ids_faltantes = set(comp["_ordem_fila"].unique())
    itens_com_falta = itens_sel[itens_sel["_ordem_fila"].isin(ordem_ids_faltantes)].copy()
    if itens_com_falta.empty:
        return []

    sort_cols = ["_dt_abertura_sort", "raiz_Pedido_Str", "raiz_Item Final", "raiz_Fábrica"]
    if "ordem_op" in itens_com_falta.columns:
        sort_cols.append("ordem_op")
    itens_com_falta = itens_com_falta.sort_values(
        by=sort_cols,
        ascending=[True] * len(sort_cols),
        na_position="last",
    )

    meta_por_ordem: Dict[int, Dict[str, Any]] = {}
    ordens_por_local: Dict[str, List[int]] = {}
    for row in itens_com_falta.to_dict("records"):
        of_idx = int(row["_ordem_fila"])
        loc = str(row.get("raiz_Fábrica") or "NÃO INFORMADO").strip()
        if not loc or loc == "0":
            loc = "NÃO INFORMADO"
        saldo_val = 0.0
        try:
            saldo_val = float(row.get("raiz_Saldo") or 0.0)
        except Exception:
            saldo_val = 0.0
        meta_por_ordem[of_idx] = {
            "posicao_fila": of_idx + 1,
            "ordem_op": str(row.get("ordem_op") or ""),
            "eh_raiz": bool(row.get("eh_raiz", True)),
            "item_final_pai": str(row.get("item_final_pai") or ""),
            "fabrica_pai": str(row.get("fabrica_pai") or ""),
            "item_final": str(row.get("raiz_Item Final") or ""),
            "descricao": str(row.get("raiz_Descricao") or ""),
            "pedido": str(row.get("raiz_Pedido_Str") or ""),
            "fabrica": loc,
            "cliente": str(row.get("raiz_Cliente") or ""),
            "saldo": round(saldo_val, 2) if saldo_val % 1 != 0 else int(saldo_val),
            "data_abertura": str(row.get("_dt_abertura_br") or ""),
            "entrega": str(row.get("_dt_entrega_br") or ""),
            "simulado": bool(row.get("simulado", False)),
            "origem_simulacao": str(row.get("origem_simulacao") or ""),
        }
        ordens_por_local.setdefault(loc, []).append(of_idx)

    itens_cst = _enriquecimento.get("itens_cst", set())
    oc_ped_it = _enriquecimento.get("oc_por_item_ped_it", {})
    oc_ped = _enriquecimento.get("oc_por_item_ped", {})
    oc_it_sem = _enriquecimento.get("oc_por_item_it_sem_ped", {})
    op_ped = _enriquecimento.get("op_por_item_pedido", {})
    enriq_cache: Dict[Tuple[Any, ...], Dict[str, Any]] = {}

    faltantes_por_ordem: Dict[int, List[Dict[str, Any]]] = {}
    comp_sorted = comp.sort_values(by=["_ordem_fila", "Falta", "Tipo", "Item"], ascending=[True, False, True, True])

    cols_comp = ["_ordem_fila", "Item", "Den_Item", "Tipo", "Baixa", "Local_Prod", "Ordem_Prod", "Ordem_Cons", "estoque", "estoque_disp_fila", "Consumo", "Falta"]
    for tup in comp_sorted[cols_comp].itertuples(index=False):
        of_idx = int(tup[0])
        meta = meta_por_ordem.get(of_idx)
        if not meta:
            continue

        it_raw = str(tup[1] or "")
        it_norm = scraper.normalizar_cod_item(it_raw)
        tp = str(tup[3] or "").upper()
        lp_raw = tup[5]
        op_prod_raw = tup[6]
        ord_cons_raw = tup[7]
        ped = _normalizar_pedido_valido(meta["pedido"])
        it_fin_ref = scraper.normalizar_cod_item(meta["item_final_pai"] or meta["item_final"])

        if it_norm in itens_cst:
            cache_k: Tuple[Any, ...] = ("CST", tp, it_norm, ped, it_fin_ref, str(ord_cons_raw or ""), str(op_prod_raw or ""))
        elif tp == "P":
            has_op_ped = bool(ped and (it_norm, ped) in op_ped)
            cache_k = ("P", it_norm, ped if has_op_ped else "", str(op_prod_raw or ""), str(lp_raw or ""))
        else:
            has_ped_oc = bool(ped and ((it_norm, ped) in oc_ped or (it_norm, ped, it_fin_ref) in oc_ped_it))
            has_it_oc = bool(
                (ped and (it_norm, ped, it_fin_ref) in oc_ped_it)
                or (ped and (it_norm, ped) in oc_ped)
                or (not ped and (it_norm, it_fin_ref) in oc_it_sem)
            )
            cache_k = ("C", it_norm, ped if has_ped_oc else "", it_fin_ref if has_it_oc else "")

        info = enriq_cache.get(cache_k)
        if info is None:
            info = _enriquecer_insumo_gerencial(
                comp_item=it_raw,
                tipo_comp=tp,
                local_prod_raw=lp_raw,
                op_prod_raw=op_prod_raw,
                raiz_pedido_str=meta["pedido"],
                raiz_item_final=meta["item_final_pai"] or meta["item_final"],
                raiz_data_abertura="",
                ordem_cons_raw=ord_cons_raw,
            )
            enriq_cache[cache_k] = info

        faltantes_por_ordem.setdefault(of_idx, []).append(
            {
                "item": it_raw,
                "descricao": str(tup[2] or ""),
                "tipo": tp,
                "baixa": str(tup[4] or "").upper(),
                "local_comp": str(info.get("fabrica_componente") or ""),
                "estoque_total": round(float(tup[8] or 0.0), 2),
                "saldo_fila": round(float(tup[9] or 0.0), 2),
                "consumo": round(float(tup[10] or 0.0), 2),
                "falta": round(float(tup[11] or 0.0), 2),
                "ordem_prod": info.get("ordem_prod") or "",
                "op_data_abertura": info.get("op_data_abertura") or "",
                "op_data_entrega": info.get("op_data_entrega") or "",
                "oc_numero": info.get("oc_numero") or "",
                "oc_previsao": info.get("oc_previsao") or "",
                "oc_fornecedor": info.get("oc_fornecedor") or "",
                "eh_cst": bool(info.get("eh_cst", False)),
                "cst_situacao": info.get("cst_situacao") or "",
            }
        )

    grupos_saida: List[Dict[str, Any]] = []
    for loc, of_list in ordens_por_local.items():
        itens_loc: List[Dict[str, Any]] = []
        pedidos_loc: Set[str] = set()
        total_linhas_loc = 0
        total_falta_loc = 0.0

        for of_idx in of_list:
            falt_it = faltantes_por_ordem.get(of_idx)
            if not falt_it:
                continue
            meta = meta_por_ordem[of_idx]
            if meta["pedido"]:
                pedidos_loc.add(meta["pedido"])
            qtd_p = sum(1 for f in falt_it if f["tipo"] == "P")
            qtd_c = len(falt_it) - qtd_p
            falta_sum_it = round(sum(f["falta"] for f in falt_it), 2)
            total_linhas_loc += len(falt_it)
            total_falta_loc += falta_sum_it
            itens_loc.append(
                {
                    **meta,
                    "total_faltando": len(falt_it),
                    "total_faltando_p": qtd_p,
                    "total_faltando_c": qtd_c,
                    "falta_total": falta_sum_it,
                    "faltantes": falt_it,
                }
            )

        if itens_loc:
            grupos_saida.append(
                {
                    "local": loc,
                    "total_itens_pedido": len(itens_loc),
                    "total_pedidos": len(pedidos_loc),
                    "total_faltas_linhas": total_linhas_loc,
                    "total_falta_qtd": round(total_falta_loc, 2),
                    "itens": itens_loc,
                }
            )

    grupos_saida.sort(key=lambda g: (-g["total_itens_pedido"], g["local"]))
    return grupos_saida


def obter_resumo_faltantes(
    filtros: Optional[Dict[str, Any]] = None,
    session_id: Optional[str] = None,
    recarregar: bool = False,
    forcar_oc: bool = False,
) -> Dict[str, Any]:
    """
    Resumo consolidado de TUDO o que falta (insumos com Falta > 0) para os itens finais (ou todas as OPs)
    que atendem aos mesmos filtros da tela principal (local, famílias, datas, pedido, código, baixa, tipo...).
    O filtro de status do item final é ignorado de propósito: aqui o foco é o que falta.

    - Visão `por_insumo` (padrão):
      - Componentes produzidos (Tipo P): agrupados pelo local de produção do componente.
      - Itens comprados (Tipo C): agrupados pela fábrica consumidora (local do item final).
    - Visão `por_item_pedido`:
      - Agrupa por Local de Produção do item/OP (`grupos_por_local_item`) -> cada Item/Pedido/OP -> insumos faltantes.
    """
    filtros = filtros or {}
    todas_ops = bool(filtros.get("todas_ops", False))
    visao_raw = str(filtros.get("visao", "por_insumo") or "por_insumo").strip().lower()
    visao = visao_raw if visao_raw in ("por_insumo", "por_item_pedido") else "por_insumo"
    escopo_abatimento = _normalizar_escopo_abatimento(filtros.get("escopo_abatimento"))

    obter_cons_com_cache(
        recarregar=bool(recarregar),
        forcar_oc=bool(forcar_oc),
        sincronizar_snapshot=bool(recarregar),
    )

    sess = obter_sessao(session_id)
    lock_resumo, cache_resumo_map, sim_ver = _selecionar_cache(sess, "resumo_faltantes")
    filtros_json = json.dumps(
        {
            **filtros,
            "visao": visao,
            "todas_ops": todas_ops,
            "escopo_abatimento": escopo_abatimento,
        },
        sort_keys=True,
        default=str,
    )
    hoje_d1_iso = (datetime.now().date() + timedelta(days=1)).isoformat()
    cache_key = (_cache_timestamp, sim_ver, hoje_d1_iso, filtros_json)
    with lock_resumo:
        if cache_key in cache_resumo_map:
            return cache_resumo_map[cache_key]

    baixa = str(filtros.get("baixa", "todos") or "todos").strip().upper()
    tipo = str(filtros.get("tipo", "todos") or "todos").strip().upper()
    col_f = {
        k: v for k, v in (filtros.get("col_filtros") or {}).items() if k not in ("status", "saldo")
    }
    filtros_escopo_falt = (
        {**filtros, "col_filtros": col_f}
        if escopo_abatimento == "filtrado"
        else None
    )

    itens_full, comp_agg, _ = _obter_fila_calculada(
        baixa_filtro=baixa,
        tipo_filtro=tipo,
        familias_filtro=filtros.get("familias"),
        todas_ops=todas_ops,
        session_id=session_id,
        escopo_abatimento=escopo_abatimento,
        filtros_escopo=filtros_escopo_falt,
    )
    if itens_full.empty or comp_agg.empty:
        return _resumo_faltantes_vazio(
            session_id,
            visao=visao,
            todas_ops=todas_ops,
            escopo_abatimento=escopo_abatimento,
        )

    itens_sel = _aplicar_col_filtros(_filtrar_itens_finais_base(itens_full, filtros), col_f)
    if itens_sel.empty:
        return _resumo_faltantes_vazio(
            session_id,
            visao=visao,
            todas_ops=todas_ops,
            escopo_abatimento=escopo_abatimento,
        )

    mapa_abertura = dict(zip(itens_sel["_ordem_fila"], itens_sel["_dt_abertura_br"]))
    comp = comp_agg[
        comp_agg["_ordem_fila"].isin(set(itens_sel["_ordem_fila"]))
        & (comp_agg["Falta"] > 1e-6)
        & comp_agg["Tipo"].astype(str).str.upper().isin(["P", "C"])
    ].copy()
    if comp.empty:
        return _resumo_faltantes_vazio(
            session_id,
            visao=visao,
            todas_ops=todas_ops,
            escopo_abatimento=escopo_abatimento,
        )

    comp = comp.sort_values("_ordem_fila", kind="stable")
    comp["Tipo"] = comp["Tipo"].astype(str).str.upper()
    comp["_dt_abertura_br"] = comp["_ordem_fila"].map(mapa_abertura).fillna("")

    pares = comp.loc[comp["Tipo"] == "P", ["Item", "Local_Prod"]].drop_duplicates().to_dict("records")
    mapa_local_p = {
        (r["Item"], r["Local_Prod"]): _resolver_local_prod_componente(r["Item"], r["Local_Prod"])
        for r in pares
    }

    def _grupo(r_tipo, r_item, r_lp, r_fab) -> str:
        if r_tipo == "P":
            g = mapa_local_p.get((r_item, r_lp), "")
        else:
            g = str(r_fab or "")
        g = str(g or "").strip()
        return g if g and g != "0" else "NÃO INFORMADO"

    comp["grupo_local"] = [
        _grupo(t, i, lp, fb)
        for t, i, lp, fb in zip(comp["Tipo"], comp["Item"], comp["Local_Prod"], comp["raiz_Fábrica"])
    ]

    if visao == "por_item_pedido":
        gp: List[Dict[str, Any]] = []
        gc: List[Dict[str, Any]] = []
        grupos_por_local_item = _construir_grupos_por_local_item(comp, itens_sel)

        agg_tot = comp.groupby(["Tipo", "grupo_local", "Item"], sort=False, as_index=False).agg(
            Local_Prod=("Local_Prod", "first"),
            Ordem_Prod=("Ordem_Prod", "first"),
            raiz_Pedido_Str=("raiz_Pedido_Str", "first"),
            raiz_Item_Final=("raiz_Item Final", "first"),
            dt_abertura_br=("_dt_abertura_br", "first"),
            Ordem_Cons=("Ordem_Cons", "first"),
            Falta=("Falta", "sum"),
        )
        p_itens = 0
        p_com_op = 0
        p_locais_falta: Dict[str, float] = {}
        c_itens = 0
        c_com_oc = 0
        c_locais_falta: Dict[str, float] = {}

        for row in agg_tot.itertuples(index=False):
            tp = str(row.Tipo)
            grupo = str(row.grupo_local)
            falta_it = round(float(row.Falta or 0.0), 2)
            info = _enriquecer_insumo_gerencial(
                comp_item=str(row.Item),
                tipo_comp=tp,
                local_prod_raw=row.Local_Prod,
                op_prod_raw=row.Ordem_Prod,
                raiz_pedido_str=str(row.raiz_Pedido_Str or ""),
                raiz_item_final=str(row.raiz_Item_Final or ""),
                raiz_data_abertura=row.dt_abertura_br,
                ordem_cons_raw=row.Ordem_Cons,
            )
            if tp == "P":
                p_itens += 1
                p_locais_falta[grupo] = p_locais_falta.get(grupo, 0.0) + falta_it
                if info.get("ordem_prod"):
                    p_com_op += 1
            else:
                c_itens += 1
                c_locais_falta[grupo] = c_locais_falta.get(grupo, 0.0) + falta_it
                if info.get("oc_numero"):
                    c_com_oc += 1

        totais_dict = {
            "itens_finais_com_falta": int(comp["_ordem_fila"].nunique()),
            "pedidos_afetados": int(comp["raiz_Pedido_Str"].astype(str).replace("", np.nan).dropna().nunique()),
            "p_itens": p_itens,
            "p_falta_total": round(sum(round(v, 2) for v in p_locais_falta.values()), 2),
            "p_com_op": p_com_op,
            "p_locais": len(p_locais_falta),
            "c_itens": c_itens,
            "c_falta_total": round(sum(round(v, 2) for v in c_locais_falta.values()), 2),
            "c_com_oc": c_com_oc,
            "c_locais": len(c_locais_falta),
        }
    else:
        agg_df = comp.groupby(["Tipo", "grupo_local", "Item"], sort=False, as_index=False).agg(
            Den_Item=("Den_Item", "first"),
            Baixa=("Baixa", "first"),
            Local_Prod=("Local_Prod", "first"),
            Ordem_Prod=("Ordem_Prod", "first"),
            raiz_Pedido_Str=("raiz_Pedido_Str", "first"),
            raiz_Item_Final=("raiz_Item Final", "first"),
            dt_abertura_br=("_dt_abertura_br", "first"),
            Ordem_Cons=("Ordem_Cons", "first"),
            estoque=("estoque", "first"),
            estoque_disp_fila=("estoque_disp_fila", "first"),
            Consumo=("Consumo", "sum"),
            Falta=("Falta", "sum"),
            pedidos_list=("raiz_Pedido_Str", lambda s: [str(p) for p in set(s.dropna()) if str(p).strip()][:20]),
            qtd_itens_finais=("_ordem_fila", "nunique"),
            prazos_list=("prazo_expedicao", lambda s: sorted({int(x) for x in s.dropna().tolist()})),
        )

        grupos_p: Dict[str, List[Dict[str, Any]]] = {}
        grupos_c: Dict[str, List[Dict[str, Any]]] = {}

        for row in agg_df.itertuples(index=False):
            tp = str(row.Tipo)
            grupo = str(row.grupo_local)
            item = str(row.Item)
            pedidos = row.pedidos_list
            info = _enriquecer_insumo_gerencial(
                comp_item=item,
                tipo_comp=tp,
                local_prod_raw=row.Local_Prod,
                op_prod_raw=row.Ordem_Prod,
                raiz_pedido_str=str(row.raiz_Pedido_Str or ""),
                raiz_item_final=str(row.raiz_Item_Final or ""),
                raiz_data_abertura=row.dt_abertura_br,
                ordem_cons_raw=row.Ordem_Cons,
            )
            reg = {
                "item": item,
                "descricao": str(row.Den_Item or ""),
                "tipo": tp,
                "baixa": str(row.Baixa or "").upper(),
                "local": grupo,
                "estoque_total": round(float(row.estoque or 0.0), 2),
                "saldo_fila": round(float(row.estoque_disp_fila or 0.0), 2),
                "consumo": round(float(row.Consumo or 0.0), 2),
                "falta": round(float(row.Falta or 0.0), 2),
                "qtd_pedidos": len(pedidos),
                "pedidos": pedidos,
                "qtd_itens_finais": int(row.qtd_itens_finais or 0),
                "prazos": row.prazos_list,
                "setor_origem": info.get("fabrica_componente", "") if tp == "C" else "",
            }
            for campo in _CAMPOS_ENRIQUECIMENTO_RESUMO:
                reg[campo] = info.get(campo)
            (grupos_p if tp == "P" else grupos_c).setdefault(grupo, []).append(reg)

        def _montar(grupos: Dict[str, List[Dict[str, Any]]], chave_enriq: str) -> List[Dict[str, Any]]:
            saida = []
            for nome, itens in grupos.items():
                itens.sort(key=lambda x: (-x["falta"], x["item"]))
                saida.append(
                    {
                        "local": nome,
                        "total_itens": len(itens),
                        "total_falta": round(sum(x["falta"] for x in itens), 2),
                        "total_com_enriquecimento": sum(1 for x in itens if x.get(chave_enriq)),
                        "itens": itens,
                    }
                )
            saida.sort(key=lambda g: (-g["total_itens"], g["local"]))
            return saida

        gp = _montar(grupos_p, "ordem_prod")
        gc = _montar(grupos_c, "oc_numero")
        grupos_por_local_item = []
        totais_dict = {
            "itens_finais_com_falta": int(comp["_ordem_fila"].nunique()),
            "pedidos_afetados": int(comp["raiz_Pedido_Str"].astype(str).replace("", np.nan).dropna().nunique()),
            "p_itens": sum(g["total_itens"] for g in gp),
            "p_falta_total": round(sum(g["total_falta"] for g in gp), 2),
            "p_com_op": sum(g["total_com_enriquecimento"] for g in gp),
            "p_locais": len(gp),
            "c_itens": sum(g["total_itens"] for g in gc),
            "c_falta_total": round(sum(g["total_falta"] for g in gc), 2),
            "c_com_oc": sum(g["total_com_enriquecimento"] for g in gc),
            "c_locais": len(gc),
        }

    info_carga = obter_info_carregamento()
    resultado = {
        "visao": visao,
        "todas_ops": todas_ops,
        "escopo_abatimento": escopo_abatimento,
        "grupos_produzidos": gp,
        "grupos_comprados": gc,
        "grupos_por_local_item": grupos_por_local_item,
        "totais": totais_dict,
        "data_carga": info_carga["data_carga"],
        "data_oc": info_carga["data_oc"],
        "snapshot": info_carga["snapshot"],
        "session_id": str(session_id or "default"),
    }

    with lock_resumo:
        if len(cache_resumo_map) >= 20:
            cache_resumo_map.clear()
        cache_resumo_map[cache_key] = resultado

    return resultado


def exportar_resumo_faltantes_excel(
    filtros: Optional[Dict[str, Any]] = None,
    session_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Exporta o resumo de itens faltantes em .xlsx (por insumo em P/C ou por Local x Item/Pedido)."""
    res = obter_resumo_faltantes(filtros=filtros, session_id=session_id)

    sess_tag = session_id[:8] if session_id and session_id != "default" else "export"
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    nome_arquivo = f"resumo_faltantes_{sess_tag}_{timestamp}.xlsx"

    if res.get("visao") == "por_item_pedido":
        linhas_detalhadas = []
        for grp in res.get("grupos_por_local_item") or []:
            for it in grp.get("itens") or []:
                for f in it.get("faltantes") or []:
                    linhas_detalhadas.append(
                        {
                            "Local de Produção": grp["local"],
                            "OP": it.get("ordem_op") or "",
                            "Item / Produto": it.get("item_final") or "",
                            "Descrição Item": it.get("descricao") or "",
                            "Pedido": it.get("pedido") or "",
                            "Cliente": it.get("cliente") or "",
                            "Abertura OP": it.get("data_abertura") or "",
                            "Entrega": it.get("entrega") or "",
                            "Tipo Insumo": f.get("tipo") or "",
                            "Código Insumo": f.get("item") or "",
                            "Descrição Insumo": f.get("descricao") or "",
                            "Local Comp.": f.get("local_comp") or "",
                            "Baixa": f.get("baixa") or "",
                            "Estoque Total": f.get("estoque_total", 0.0),
                            "Saldo na Fila": f.get("saldo_fila", 0.0),
                            "Consumo": f.get("consumo", 0.0),
                            "Falta": f.get("falta", 0.0),
                            "OP Comp.": f.get("ordem_prod") or "",
                            "Abertura OP Comp.": f.get("op_data_abertura") or "",
                            "Entrega OP Comp.": f.get("op_data_entrega") or "",
                            "OC": f.get("oc_numero") or "",
                            "Previsão OC": f.get("oc_previsao") or "",
                            "Fornecedor": f.get("oc_fornecedor") or "",
                        }
                    )
        if not linhas_detalhadas:
            return {"erro": "Nenhum item faltante encontrado para os filtros selecionados."}
        with pd.ExcelWriter(settings.EXPORTS_DIR / nome_arquivo) as xw:
            pd.DataFrame(linhas_detalhadas).to_excel(
                xw, sheet_name="Por Local e Item-Pedido", index=False
            )
        return {
            "status": "ok",
            "url": f"/ver_estoque/exports/{nome_arquivo}",
            "nome": nome_arquivo,
            "total": len(linhas_detalhadas),
            "session_id": str(session_id or "default"),
        }

    def _linhas(grupos, rotulo_local):
        out = []
        for g in grupos:
            for it in g["itens"]:
                out.append(
                    {
                        rotulo_local: g["local"],
                        "Código": it["item"],
                        "Descrição": it["descricao"],
                        "Baixa": it["baixa"],
                        "Estoque Total": it["estoque_total"],
                        "Saldo na Fila": it["saldo_fila"],
                        "Consumo": it["consumo"],
                        "Falta": it["falta"],
                        "Qtd Pedidos": it["qtd_pedidos"],
                        "Pedidos (até 20)": ", ".join(it["pedidos"]),
                        "OP": it.get("ordem_prod") or "",
                        "Abertura OP": it.get("op_data_abertura") or "",
                        "Entrega OP": it.get("op_data_entrega") or "",
                        "OC": it.get("oc_numero") or "",
                        "Previsão OC": it.get("oc_previsao") or "",
                        "Fornecedor": it.get("oc_fornecedor") or "",
                    }
                )
        return out

    lin_p = _linhas(res["grupos_produzidos"], "Local de Produção")
    lin_c = _linhas(res["grupos_comprados"], "Fábrica Consumidora")
    if not lin_p and not lin_c:
        return {"erro": "Nenhum item faltante encontrado para os filtros selecionados."}

    with pd.ExcelWriter(settings.EXPORTS_DIR / nome_arquivo) as xw:
        pd.DataFrame(lin_p or [{"Aviso": "Sem itens produzidos faltantes"}]).to_excel(
            xw, sheet_name="Produzidos (P)", index=False
        )
        pd.DataFrame(lin_c or [{"Aviso": "Sem itens comprados faltantes"}]).to_excel(
            xw, sheet_name="Comprados (C)", index=False
        )
    return {
        "status": "ok",
        "url": f"/ver_estoque/exports/{nome_arquivo}",
        "nome": nome_arquivo,
        "total": len(lin_p) + len(lin_c),
        "session_id": str(session_id or "default"),
    }


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Análise de Estoque e Disponibilidade dos Itens Finais")
    parser.add_argument("--export", action="store_true", help="Salva consumo_completo.xlsx na pasta de exports")
    parser.add_argument("--local", type=str, default="", help="Filtrar por local de produção")
    parser.add_argument("--pedido", type=str, default="", help="Filtrar por pedido")
    parser.add_argument("--codigo", type=str, default="", help="Filtrar por código de item final")
    parser.add_argument("--dt-inicio", type=str, default="", help="Início da abertura da OP (YYYY-MM-DD ou DD/MM/YYYY)")
    parser.add_argument("--dt-fim", type=str, default="", help="Fim da abertura da OP (YYYY-MM-DD ou DD/MM/YYYY)")
    args = parser.parse_args()

    print("Iniciando ver_estoque...")
    df_cons = gerar_dataframe_cons(salvar_excel=args.export)
    print(f"DataFrame 'cons' gerado com sucesso: {df_cons.shape[0]} linhas, {df_cons.shape[1]} colunas.")

    filtros = {}
    if args.local:
        filtros["local_producao"] = args.local
    if args.pedido:
        filtros["pedido"] = args.pedido
    if args.codigo:
        filtros["codigo"] = args.codigo
    if args.dt_inicio:
        filtros["data_inicio"] = args.dt_inicio
    if args.dt_fim:
        filtros["data_fim"] = args.dt_fim

    res = analisar_itens_finais(filtros=filtros, page=0, page_size=10)
    print("\n--- Métricas Gerais ---")
    for k, v in res["metricas"].items():
        print(f"  {k}: {v}")

    print(f"\nPrimeiros itens ({len(res['itens'])} exibidos):")
    for it in res["itens"]:
        print(
            f"  #{it['posicao_fila']} [{it['status']}] {it['item_final']} (Pedido: {it['pedido']}, Fábrica: {it['fabrica']}) - "
            f"Disp: {it['componentes_disponiveis']}/{it['total_componentes']} ({it['perc_disponivel']}%) - "
            f"Faltam: {it['componentes_faltando']}"
        )
