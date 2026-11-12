"""
Serviço ver_estoque.
Gera o DataFrame de consumo (sem filtros restritivos) a partir do snapshot mais recente
disponibilizado manualmente em `settings.SNAPSHOTS_DIR`, analisa a disponibilidade dos
itens finais (`raiz_Item Final`) com abatimento cumulativo de estoque (Situação L) ao longo
da fila ordenada por Data de Abertura, e gerencia a simulação/destaque de pedidos.
"""

from datetime import datetime
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
    from .calculo import calc_data, sanitizar_dataframe
    from .snapshots import carregar_snapshot, data_snapshot, sincronizar_snapshots_remotos
else:
    import sys
    from pathlib import Path

    _backend_dir = str(Path(__file__).resolve().parent)
    if _backend_dir not in sys.path:
        sys.path.insert(0, _backend_dir)
    import scraper
    import settings
    from calculo import calc_data, sanitizar_dataframe
    from snapshots import carregar_snapshot, data_snapshot, sincronizar_snapshots_remotos

# Cache em memória do snapshot base (imutável após carga)
_cache_cons: Optional[pd.DataFrame] = None
_cache_timestamp: Optional[float] = None
_cache_data_calculo: Optional[str] = None
_cache_snapshot_nome: Optional[str] = None
_cache_data_snapshot: Optional[str] = None

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
        # Cache do cálculo cumulativo de fila da sessão por (cache_ts, sim_ver, baixa, tipo)
        self.cache_filas: Dict[Tuple[Any, ...], Tuple[pd.DataFrame, pd.DataFrame, List[str]]] = {}
        self.created_at: float = time.time()
        self.last_accessed: float = time.time()
        self.lock = threading.Lock()

    def invalidar_cache_fila(self) -> None:
        self.simulacao_versao += 1
        self.cache_filas.clear()
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


def invalidar_todas_as_sessoes() -> None:
    """Invalida o cache de filas de todas as sessões ativas (ex: ao recarregar snapshot base)."""
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
    """Data/hora do snapshot (base ERP) e da carga/cálculo em memória."""
    return {
        "data_carga": _cache_data_snapshot or "",
        "data_carregamento": _cache_data_calculo or "",
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

    # 1. Apoio compras (Baixa, Descrição de comprados e Identificação da Família CST)
    itens_cst: Set[str] = set()
    raw_apoio = dfs.get("apoio_compras")
    if raw_apoio is not None:
        df_ap = raw_apoio.to_pandas() if isinstance(raw_apoio, pl.DataFrame) else raw_apoio
        col_fam = "Família" if "Família" in df_ap.columns else ("Familia" if "Familia" in df_ap.columns else None)
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

    # 2. Estoque Situação L
    raw_estoque = dfs.get("estoque")
    if raw_estoque is not None:
        df_est = sanitizar_dataframe(raw_estoque)
        if df_est is not None and "Item" in df_est.columns:
            df_est_clean = df_est.copy()
            df_est_clean["_item_norm"] = df_est_clean["Item"].apply(scraper.normalizar_cod_item)
            if "Qtde." in df_est_clean.columns:
                qt_num = pd.to_numeric(df_est_clean["Qtde."], errors="coerce").fillna(0.0).round(2)
                soma_est = qt_num.groupby(df_est_clean["_item_norm"]).sum().round(2)
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

                ped_norm = scraper.normalizar_numero_pedido(rec.get("Pedido"))
                if ped_norm == "0":
                    ped_norm = ""

                dt_ab_br, dt_ab_sort = _parse_data_br_flex(rec.get("Data Abertura"))
                dt_ent_br, dt_ent_sort = _parse_data_br_flex(rec.get("Data Entrega"))
                saldo_op = round(scraper.parse_numero_flexivel(rec.get("Saldo"), default=0.0), 2)

                op_info = {
                    "ordem_prod": op_str,
                    "data_abertura": dt_ab_br,
                    "data_entrega": dt_ent_br,
                    "saldo_op": saldo_op,
                    "fabrica": fab,
                    "pedido_op": ped_norm,
                }
                sort_key = (dt_ent_sort, dt_ab_sort, int(op_digits) if op_digits else 999999999)
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

    # 5. Ordens de Compra abertas (OC) para Matérias-Primas (ordenadas pela previsão mais antiga)
    try:
        ocs_raw = scraper.carregar_ou_atualizar_oc_abertas(forcar_intranet=forcar_oc)
    except Exception as exc:
        print(f"[Enriquecimento OC] Aviso: {exc}")
        ocs_raw = []

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
            if ped_vinc and ped_vinc != "0":
                oc_por_item_ped.setdefault((it, ped_vinc), []).append(oc_info)
                if it_vinc:
                    oc_por_item_ped_it.setdefault((it, ped_vinc, it_vinc), []).append(oc_info)
            else:
                if ped_vinc == "0" and it_vinc:
                    oc_por_item_it_sem_ped.setdefault((it, it_vinc), []).append(oc_info)
                oc_por_item_geral.setdefault(it, []).append(oc_info)

    # 5. Tecidos Customizados da Família CST (/pcp/tecidos_customizados3.php)
    tecidos_cust_raw = scraper.carregar_ou_atualizar_tecidos_customizados(forcar_intranet=forcar_oc)
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
        gerar_dataframe_cons(forcar_oc=False, sincronizar_snapshot=False)
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
    Quando forcar_oc=True, atualiza também a base de OCs abertas diretamente na Intranet.
    """
    if sincronizar_snapshot or settings.SNAPSHOTS_AUTO_SYNC:
        try:
            res_sync = sincronizar_snapshots_remotos(forcar=False)
            if res_sync.get("baixados"):
                print(
                    f"[{datetime.now().strftime('%H:%M:%S')}] Novos snapshots baixados do servidor remoto: {res_sync['baixados']}"
                )
        except Exception as e_sync:
            print(f"[SNAPSHOT] Aviso: Falha não impeditiva ao sincronizar com servidor remoto: {e_sync}")

    print(f"[{datetime.now().strftime('%H:%M:%S')}] Carregando snapshot...")
    dfs, caminho = carregar_snapshot()
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
            .replace("0", "")
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

    if salvar_excel:
        dest_excel = settings.EXPORTS_DIR / "consumo_completo.xlsx"
        print(f"Salvando DataFrame completo sem filtros em {dest_excel}...")
        df_consumo.to_excel(dest_excel, index=False)

    global _cache_cons, _cache_timestamp, _cache_data_calculo, _cache_snapshot_nome, _cache_data_snapshot, _enriquecimento, _cache_familias_3
    _enriquecimento = _construir_mapas_enriquecimento(dfs, df_consumo, forcar_oc=forcar_oc)
    _cache_cons = df_consumo
    _cache_familias_3 = None
    _cache_timestamp = time.time()
    _cache_data_calculo = datetime.now().strftime("%d/%m/%Y %H:%M:%S")
    _cache_snapshot_nome = caminho.name
    _cache_data_snapshot = data_snapshot(caminho)
    _invalidar_cache_fila()

    return df_consumo


def obter_cons_com_cache(
    recarregar: bool = False,
    forcar_oc: bool = False,
    sincronizar_snapshot: bool = False,
) -> pd.DataFrame:
    """Retorna o DataFrame 'cons' base com cache em memória (recarregar=True relê o snapshot e forcar_oc=True busca OCs frescas na Intranet)."""
    if _cache_cons is None or recarregar:
        return gerar_dataframe_cons(
            forcar_oc=forcar_oc,
            sincronizar_snapshot=sincronizar_snapshot or recarregar,
        )
    return _cache_cons


def obter_pedidos_existentes_na_tabela() -> Set[str]:
    """Conjunto de números de pedido que já possuem itens finais ativos na tabela atual do snapshot."""
    df_base = obter_cons_com_cache()
    validos = df_base.loc[df_base["raiz_Item Final"].notna(), "raiz_Pedido_Str"]
    pedidos = {str(x).strip() for x in validos.dropna().unique() if str(x).strip() and str(x).strip() != "0"}
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


def _obter_fila_calculada(
    baixa_filtro: str = "TODOS",
    tipo_filtro: str = "TODOS",
    familias_filtro: Optional[Any] = None,
    recarregar: bool = False,
    forcar_oc: bool = False,
    session_id: Optional[str] = None,
) -> Tuple[pd.DataFrame, pd.DataFrame, List[str]]:
    """
    Executa (ou recupera do cache da sessão) o cálculo de abatimento cumulativo de estoque (Situação L)
    seguindo estritamente a ordem de Data de Abertura da OP (e itens sem data ao final da lista).
    """
    if recarregar or _cache_cons is None:
        gerar_dataframe_cons(forcar_oc=forcar_oc, sincronizar_snapshot=recarregar)

    sess = obter_sessao(session_id)
    b_norm = baixa_filtro if baixa_filtro in ("S", "N") else "TODOS"
    t_norm = tipo_filtro if tipo_filtro in ("C", "P") else "TODOS"

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

    fam_tuple = tuple(sorted(fam_set)) if fam_set else ()
    cache_key = (_cache_timestamp, sess.simulacao_versao, b_norm, t_norm, fam_tuple)

    with sess.lock:
        if cache_key in sess.cache_filas:
            return sess.cache_filas[cache_key]

    df = obter_cons_efetivo(recarregar=False, session_id=session_id)

    locais_producao = sorted(
        [str(x) for x in df["raiz_Fábrica"].dropna().unique() if str(x).strip()]
    )

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
    filas = filas.sort_values(
        by=["_dt_abertura_sort", "raiz_Pedido_Str", "raiz_Item Final", "raiz_Fábrica"],
        ascending=[True, True, True, True],
        na_position="last",
    ).reset_index(drop=True)
    filas["_ordem_fila"] = filas.index

    # 2. Executa o algoritmo multinível (MRP Top-Down com Atendimento Condicional ao Saldo)
    # Garante que semiacabados em estoque não explodam componentes filhos desnecessariamente
    df_ord = df.merge(filas[group_cols + ["_ordem_fila"]], on=group_cols, how="left")

    estoque_inicial = df_ord.drop_duplicates("Item").set_index("Item")["estoque"].to_dict()
    estoque_atual = {k: float(v or 0.0) for k, v in estoque_inicial.items()}

    candidatos_cols = [
        "_ordem_fila", "Item", "item_pai", "raiz_Item Final", "Consumo",
        "Tipo", "Den. Item", "Baixa", "Local Prod.", "Ordem Prod", "Saldo",
        "Ordem Cons", "Ordem", "Familia", "raiz_Pedido_Str"
    ]
    cols_iter = [c for c in candidatos_cols if c in df_ord.columns]
    por_ordem: Dict[int, List[Dict[str, Any]]] = {}
    for r in df_ord[cols_iter].to_dict("records"):
        ord_idx = int(r["_ordem_fila"])
        por_ordem.setdefault(ord_idx, []).append(r)

    componentes_ativos: List[Dict[str, Any]] = []
    itens_cst = _enriquecimento.get("itens_cst", set())

    for ord_idx in range(len(filas)):
        rows_ord = por_ordem.get(ord_idx, [])
        if not rows_ord:
            continue

        raiz = rows_ord[0]["raiz_Item Final"]

        filhos_por_pai: Dict[str, List[Dict[str, Any]]] = {}
        for r in rows_ord:
            pai = r.get("item_pai")
            if not pai or pd.isna(pai) or pai == r.get("Item"):
                pai = raiz
            filhos_por_pai.setdefault(str(pai), []).append(r)

        # Fila de avaliação top-down: (codigo_pai, fator_necessidade)
        # Nível 1: filhos diretos da raiz, fator 1.0
        pais_a_avaliar = [(raiz, 1.0)]

        while pais_a_avaliar:
            proximos_pais = []
            for pai_cod, fator_pai in pais_a_avaliar:
                if fator_pai <= 0:
                    continue

                itens_filhos = filhos_por_pai.get(pai_cod, [])
                for comp in itens_filhos:
                    item_cod = str(comp.get("Item") or "")
                    if not item_cod:
                        continue

                    c_orig = round(float(comp.get("Consumo") or 0.0), 2)
                    consumo_efetivo = round(c_orig * fator_pai, 2)
                    if consumo_efetivo <= 0:
                        continue

                    eh_item_3 = item_cod.startswith("3")
                    eh_cst = item_cod in itens_cst or str(comp.get("Familia") or "").strip().upper() == "CST"

                    if fam_set:
                        if eh_item_3:
                            fam_comp = "CST" if eh_cst else str(comp.get("Familia") or "").strip().upper()
                            if fam_comp not in fam_set:
                                continue
                        else:
                            # Itens que NÃO começam com 3 (ex: peças produzidas tipo P iniciadas em 2, 4, etc.):
                            # Desconsiderados na avaliação de consumo e falta do produto final.
                            # Mas se for tipo P e faltar saldo, propaga a necessidade para seus filhos (que podem conter itens 3).
                            if comp.get("Tipo") == "P":
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
                        ped_cst = str(comp.get("raiz_Pedido_Str") or filas.iloc[ord_idx].get("raiz_Pedido_Str") or "").strip()
                        op_cst = comp.get("Ordem Cons") or comp.get("Ordem") or comp.get("Ordem Prod") or ""
                        it_prod_cst = str(comp.get("raiz_Item Final") or comp.get("item_pai") or "").strip()

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

                    componentes_ativos.append({
                        "_ordem_fila": ord_idx,
                        "Item": item_cod,
                        "item_pai": pai_cod,
                        "raiz_Item Final": raiz,
                        "Consumo": consumo_efetivo,
                        "estoque": 0.0 if eh_cst else round(float(estoque_inicial.get(item_cod, 0.0)), 2),
                        "estoque_disp_fila": round(saldo_fila, 2),
                        "Disponivel": disp,
                        "Falta": falta,
                        "Tipo": comp.get("Tipo"),
                        "Den_Item": comp.get("Den. Item"),
                        "Baixa": comp.get("Baixa"),
                        "Local_Prod": comp.get("Local Prod."),
                        "Ordem_Prod": comp.get("Ordem Prod"),
                        "Ordem_Cons": str(comp.get("Ordem Cons") or comp.get("Ordem") or ""),
                        "Saldo": comp.get("Saldo"),
                        "Familia": str(comp.get("Familia") or ("CST" if eh_cst else "")),
                        "eh_cst": eh_cst,
                    })

                    # Se for item produzido e teve falta, explode os filhos no próximo nível
                    if comp.get("Tipo") == "P" and fator_filho > 0:
                        proximos_pais.append((item_cod, fator_filho))

            pais_a_avaliar = proximos_pais

    if not componentes_ativos:
        comp_df = pd.DataFrame()
    else:
        comp_df = pd.DataFrame(componentes_ativos)

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

    # 4. Aplica escopo de filtros (Baixa / Tipo)
    comp_agg_escopo = comp_agg.copy() if not comp_agg.empty else pd.DataFrame()
    if not comp_agg_escopo.empty:
        if b_norm in ("S", "N"):
            comp_agg_escopo = comp_agg_escopo[comp_agg_escopo["Baixa"].astype(str).str.upper() == b_norm]
        if t_norm in ("C", "P"):
            comp_agg_escopo = comp_agg_escopo[comp_agg_escopo["Tipo"].astype(str).str.upper() == t_norm]

    # 5. Consolida métricas por Item Final mantendo exatamente a ordenação `_ordem_fila`
    if comp_agg_escopo.empty:
        totais_fila = pd.DataFrame(columns=["_ordem_fila", "total_componentes", "componentes_disponiveis", "componentes_faltando"])
    else:
        totais_fila = (
            comp_agg_escopo.groupby("_ordem_fila", as_index=False)
            .agg(
                total_componentes=("Item", "count"),
                componentes_disponiveis=("Disponivel", lambda s: int(s.sum())),
                componentes_faltando=("Disponivel", lambda s: int((~s).sum())),
            )
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

    itens_resumo["_dt_abertura_br"] = (
        pd.to_datetime(itens_resumo["raiz_Data_Abertura"], errors="coerce")
        .dt.strftime("%d/%m/%Y")
        .fillna("")
    )
    itens_resumo["_dt_entrega_br"] = (
        pd.to_datetime(itens_resumo["raiz_Entrega_Pedido"], errors="coerce")
        .dt.strftime("%d/%m/%Y")
        .fillna("")
    )
    itens_resumo["_saldo_str"] = itens_resumo["raiz_Saldo"].fillna(0).astype(str)

    itens_resumo = itens_resumo.sort_values(by="_ordem_fila", ascending=True).reset_index(drop=True)

    with sess.lock:
        if len(sess.cache_filas) >= 10:
            sess.cache_filas.clear()
        sess.cache_filas[cache_key] = (itens_resumo, comp_agg_escopo, locais_producao)
    return itens_resumo, comp_agg_escopo, locais_producao


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
    apenas_simulados = bool(filtros.get("apenas_simulados", False))
    col_filtros = filtros.get("col_filtros") or {}
    data_inicio_raw = filtros.get("data_inicio")
    data_fim_raw = filtros.get("data_fim")
    tipo_data_filtro = str(filtros.get("tipo_data", "abertura_op") or "abertura_op").strip().lower()

    itens_full, _, locais_producao = _obter_fila_calculada(
        baixa_filtro=baixa_filtro,
        tipo_filtro=tipo_filtro,
        familias_filtro=familias_filtro,
        recarregar=recarregar,
        forcar_oc=forcar_oc,
        session_id=session_id,
    )
    info_carga = obter_info_carregamento()
    pedidos_ativos = listar_pedidos_simulados_ativos(session_id=session_id)

    if itens_full.empty:
        return {
            "total_registros": 0,
            "total_paginas": 0,
            "pagina_atual": page,
            "itens": [],
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
            "divisao_fabricas": carregar_divisao_fabricas(),
            "familias_componentes_3": obter_familias_componentes_3(session_id=session_id),
            "data_carga": info_carga["data_carga"],
            "data_carregamento": info_carga["data_carregamento"],
            "snapshot": info_carga["snapshot"],
            "session_id": str(session_id or "default"),
        }

    total_simulados_global = int(itens_full["simulado"].sum())

    # Filtros globais sobre a fila já calculada (preserva disponibilidade real da posição na fila)
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
        mask &= mask_cod | mask_desc

    col_data_sort = (
        "_dt_entrega_sort"
        if tipo_data_filtro in ("entrega_pedido", "entrega") and "_dt_entrega_sort" in itens_full.columns
        else "_dt_abertura_sort"
    )

    if data_inicio_raw and str(data_inicio_raw).strip():
        dt_in_str = str(data_inicio_raw).strip()
        dt_in = pd.to_datetime(dt_in_str, errors="coerce", dayfirst="/" in dt_in_str)
        if pd.notna(dt_in) and col_data_sort in itens_full.columns:
            mask &= itens_full[col_data_sort].dt.floor("D") >= dt_in.floor("D")

    if data_fim_raw and str(data_fim_raw).strip():
        dt_fi_str = str(data_fim_raw).strip()
        dt_fi = pd.to_datetime(dt_fi_str, errors="coerce", dayfirst="/" in dt_fi_str)
        if pd.notna(dt_fi) and col_data_sort in itens_full.columns:
            mask &= itens_full[col_data_sort].dt.floor("D") <= dt_fi.floor("D")

    itens_resumo = itens_full[mask]

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

    # Filtro de Status ('disponivel', 'falta', 'todos')
    if status_filtro == "disponivel":
        itens_resumo = itens_resumo[itens_resumo["status"] == "Disponível"]
    elif status_filtro == "falta":
        itens_resumo = itens_resumo[itens_resumo["status"] == "Com Falta"]

    # Filtros individuais por título de coluna
    if col_filtros and isinstance(col_filtros, dict) and not itens_resumo.empty:
        mask_cols = pd.Series(True, index=itens_resumo.index)
        for col_key, col_val in col_filtros.items():
            if not col_val or not str(col_val).strip():
                continue
            val_clean = str(col_val).strip().upper()
            if col_key == "item_final":
                mask_cols &= itens_resumo["raiz_Item Final"].astype(str).str.upper().str.contains(val_clean, na=False)
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

    total_filtrados = len(itens_resumo)
    total_paginas = (total_filtrados + page_size - 1) // page_size if page_size > 0 else 1

    # A ordenação por `_ordem_fila` já respeita estritamente Data de Abertura (NaT por último)
    start = page * page_size
    end = start + page_size
    slice_df = itens_resumo.iloc[start:end]

    registros: List[Dict[str, Any]] = []
    for _, row in slice_df.iterrows():
        saldo_val = 1.0
        if pd.notna(row["raiz_Saldo"]):
            try:
                saldo_val = float(row["raiz_Saldo"])
            except Exception:
                saldo_val = 1.0

        registros.append(
            {
                "posicao_fila": int(row["_ordem_fila"]) + 1,
                "item_final": str(row["raiz_Item Final"]),
                "descricao": str(row["raiz_Descricao"] or ""),
                "pedido": str(row["raiz_Pedido_Str"] or ""),
                "fabrica": str(row["raiz_Fábrica"] or ""),
                "cliente": str(row["raiz_Cliente"] or ""),
                "saldo": round(saldo_val, 2) if saldo_val % 1 != 0 else int(saldo_val),
                "data_abertura": str(row["_dt_abertura_br"] or ""),
                "entrega": str(row["_dt_entrega_br"] or ""),
                "total_componentes": int(row["total_componentes"]),
                "componentes_disponiveis": int(row["componentes_disponiveis"]),
                "componentes_faltando": int(row["componentes_faltando"]),
                "perc_disponivel": float(row["perc_disponivel"]),
                "status": str(row["status"]),
                "simulado": bool(row["simulado"]),
                "origem_simulacao": str(row["origem_simulacao"] or ""),
            }
        )

    return {
        "total_registros": total_filtrados,
        "total_paginas": total_paginas,
        "pagina_atual": page,
        "itens": registros,
        "metricas": {
            "total_itens_finais": total_itens_finais,
            "total_itens_avaliados": total_itens_avaliados,
            "total_disponiveis": total_disponiveis,
            "total_com_falta": total_com_falta,
            "total_pedidos": total_pedidos,
            "total_simulados": total_simulados_global,
        },
        "pedidos_simulados_ativos": pedidos_ativos,
        "locais_producao": locais_producao,
        "divisao_fabricas": carregar_divisao_fabricas(),
        "familias_componentes_3": obter_familias_componentes_3(session_id=session_id),
        "data_carga": info_carga["data_carga"],
        "data_carregamento": info_carga["data_carregamento"],
        "snapshot": info_carga["snapshot"],
        "session_id": str(session_id or "default"),
    }


def _enriquecer_insumo_gerencial(
    comp_item: str,
    tipo_comp: str,
    local_prod_raw: Any,
    op_prod_raw: Any,
    raiz_pedido_str: str,
    raiz_item_final: str,
    raiz_data_abertura: Any = None,
    ordem_cons_raw: Any = None,
) -> Dict[str, Any]:
    """
    Resolve os metadados gerenciais de um insumo:
    - Se Tipo == 'P' (Componente Produzido): Fábrica, OP do componente, Data Abertura OP, Data Entrega OP, Saldo OP e vínculo.
    - Se Tipo == 'C' (Matéria-Prima): Previsão de Ordem de Compra (OC), priorizando OC cujo texto vincula ao Pedido (+ Item Final),
      usando a previsão mais antiga para matérias-primas em geral e calculando o saldo total em OC até a data de abertura da ordem.
    - Se Família CST: Resolve a situação na intranet /pcp/tecidos_customizados3.php (TECIDO CHEGOU / AGUARDANDO TECIDO).
    """
    it = scraper.normalizar_cod_item(comp_item)
    ped = scraper.normalizar_numero_pedido(raiz_pedido_str)
    if ped == "0":
        ped = ""
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
    op_vinculo = ""
    ops_abertas: List[Dict[str, Any]] = []

    if tipo_comp == "P":
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

    # Dados de Ordem de Compra (Matérias-Primas Tipo C)
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

    if tipo_comp == "C":
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
    1. `materias_primas`: Tipo == 'C', ordenados por falta DESC e código ASC.
    2. `componentes_por_fabrica`: Tipo == 'P', agrupados por Fábrica (`fabrica_componente` / `local_prod`).
    """
    materias_primas = [x for x in lista_insumos if x.get("tipo") == "C"]
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
    session_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Retorna a lista analítica e a camada gerencial de todos os componentes de um item final específico,
    refletindo o saldo exato disponível na posição daquele item na fila cumulativa da sessão,
    o saldo total de estoque, datas de abertura/entrega de OPs de componentes (agrupados por fábrica)
    e previsões de OCs de matérias-primas (com vínculo por pedido no texto ou previsão mais antiga).
    """
    b_norm = str(baixa or "todos").strip().upper()
    t_norm = str(tipo or "todos").strip().upper()

    itens_full, comp_agg_full, _ = _obter_fila_calculada(
        baixa_filtro=b_norm,
        tipo_filtro=t_norm,
        familias_filtro=familias,
        session_id=session_id,
    )
    if itens_full.empty or comp_agg_full.empty:
        return {"erro": "Nenhum insumo encontrado para os filtros selecionados."}

    mask_item = itens_full["raiz_Item Final"].astype(str) == str(raiz_item_final)
    if raiz_pedido is not None and str(raiz_pedido).strip() != "":
        mask_item &= itens_full["raiz_Pedido_Str"].astype(str) == str(raiz_pedido).strip()
    elif raiz_pedido == "":
        mask_item &= itens_full["raiz_Pedido_Str"].astype(str) == ""

    if raiz_fabrica:
        mask_item &= itens_full["raiz_Fábrica"].astype(str).str.upper() == str(raiz_fabrica).upper()

    alvo = itens_full[mask_item]
    if alvo.empty:
        return {"erro": "Item não encontrado no cálculo de consumo para os filtros atuais."}

    row_alvo = alvo.iloc[0]
    ordem_fila = int(row_alvo["_ordem_fila"])
    ped_str_alvo = str(row_alvo.get("raiz_Pedido_Str") or raiz_pedido or "").strip()
    item_final_alvo = str(row_alvo.get("raiz_Item Final") or raiz_item_final).strip()
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
                else ("Componente Produzido (P)" if tp == "P" else f"Outro ({tp})")
            )
            info_ger = _enriquecer_insumo_gerencial(
                comp_item=str(r["Item"]),
                tipo_comp=tp,
                local_prod_raw=r.get("Local_Prod"),
                op_prod_raw=r.get("Ordem_Prod"),
                raiz_pedido_str=ped_str_alvo,
                raiz_item_final=item_final_alvo,
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
    ped_norm = scraper.normalizar_numero_pedido(ped_raw) if ped_raw else ""
    if ped_norm == "0":
        ped_norm = ""

    item_filtro = str(item_final or "").strip().upper()
    if item_filtro in ("", "TODOS"):
        item_filtro = ""

    fab_filtro = str(fabrica or "").strip().upper()
    if fab_filtro in ("", "TODOS"):
        fab_filtro = ""

    b_norm = str(baixa or "todos").strip().upper()
    t_norm = str(tipo or "todos").strip().upper()

    itens_full, comp_agg_full, _ = _obter_fila_calculada(
        baixa_filtro=b_norm,
        tipo_filtro=t_norm,
        familias_filtro=familias,
        session_id=session_id,
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
            else ("Componente Produzido (P)" if tp == "P" else f"Outro ({tp})")
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
        "session_id": str(session_id or "default"),
    }


def exportar_analise_excel(
    filtros: Optional[Dict[str, Any]] = None,
    session_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Exporta a análise consolidada dos itens finais com seus status, faltas e marcação de simulação
    para um arquivo Excel no diretório de exportações, isolando o arquivo e a fila da sessão.
    """
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
    df_export = df_export.drop(columns=["simulado", "origem_simulacao"], errors="ignore")

    col_names = {
        "posicao_fila": "Posição na Fila",
        "item_final": "Código Item Final",
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
) -> Dict[str, Any]:
    """
    Calcula e retorna a Matriz Pivot de Componentes Produzidos Faltantes (Tipo == 'P')
    agrupada por:
      Local de Produção do Item Pai (raiz_Fábrica)
      × Local de Produção do Componente Produzido (fabrica_componente)
      × Colunas de Prazo de Expedição (calculado com base no Representante: todos os disponíveis).

    Suporta filtros marcados pelo usuário para cálculo:
      - locais_item_final: lista de locais do item final selecionados (vazio = todos)
      - locais_componente: lista de locais do componente produzido selecionados (vazio = todos)
      - baixa: 'todos' | 'S' | 'N'
      - escopo_abatimento: 'global' (respeita fila global) | 'filtrado' (abate estoque apenas entre os locais marcados)
      - data_inicio / data_fim: filtro de janela de Data de Abertura da OP do item pai
      - busca: filtro textual por código/descrição de componente, item final ou pedido
    """
    filtros = filtros or {}

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

    # Agrupamento ultra-rápido em O(N) sem iterrows() para Matriz Pivot:
    # (Local Produção Item Pai, Local Produção Componente, Código do Componente)
    faltantes_df = faltantes_df.sort_values(
        by=["raiz_Fábrica", "fabrica_componente", "Item", "_ordem_fila"],
        ascending=[True, True, True, True],
    )

    acum_por_chave: Dict[Tuple[str, str, str], Dict[str, Any]] = {}
    todos_pedidos_afetados: Set[str] = set()
    componentes_distintos_set: Set[str] = set()
    somas_gerais_por_prazo: Dict[str, float] = {k: 0.0 for k in prazos_keys}

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
    linhas_planas: List[Dict[str, Any]] = []

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
            "op_vinculo": info_ger["op_vinculo"],
            "ops_abertas": info_ger["ops_abertas"],
        }

        grupos_dict.setdefault((fab_pai_str, fab_comp_str), []).append(linha_item)
        linhas_planas.append(linha_item)

    # Monta a lista de grupos (Local Item Pai × Local Componente) ordenada por maior falta
    grupos_lista: List[Dict[str, Any]] = []
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

    return {
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
