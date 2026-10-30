"""
Serviço ver_estoque.
Gera o DataFrame de consumo (sem filtros restritivos) a partir do snapshot mais recente
disponibilizado manualmente em `settings.SNAPSHOTS_DIR`, analisa a disponibilidade dos
itens finais (`raiz_Item Final`) com abatimento cumulativo de estoque (Situação L) ao longo
da fila ordenada por Data de Abertura, e gerencia a simulação/destaque de pedidos.
"""

from datetime import datetime
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
    from .snapshots import carregar_snapshot, data_snapshot
else:
    import sys
    from pathlib import Path

    _backend_dir = str(Path(__file__).resolve().parent)
    if _backend_dir not in sys.path:
        sys.path.insert(0, _backend_dir)
    import scraper
    import settings
    from calculo import calc_data, sanitizar_dataframe
    from snapshots import carregar_snapshot, data_snapshot

# Cache em memória do snapshot base (imutável após carga)
_cache_cons: Optional[pd.DataFrame] = None
_cache_timestamp: Optional[float] = None
_cache_data_calculo: Optional[str] = None
_cache_snapshot_nome: Optional[str] = None
_cache_data_snapshot: Optional[str] = None

# Mapas auxiliares extraídos do snapshot para enriquecer pedidos novos simulados
_enriquecimento: Dict[str, Dict[str, Any]] = {
    "estoque": {},
    "tipo": {},
    "baixa": {},
    "local_prod": {},
    "fabrica_item": {},
    "desc_item": {},
}

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


def _construir_mapas_enriquecimento(
    dfs: Dict[str, pd.DataFrame], df_consumo: pd.DataFrame
) -> Dict[str, Dict[str, Any]]:
    """Indexa estoque L, Tipo (C/P), Baixa (S/N), Local Prod, Fábrica e Descrição a partir do snapshot."""
    estoque_map: Dict[str, float] = {}
    tipo_map: Dict[str, str] = {}
    baixa_map: Dict[str, str] = {}
    local_prod_map: Dict[str, str] = {}
    fabrica_item_map: Dict[str, str] = {}
    desc_item_map: Dict[str, str] = {}

    # 1. Apoio compras (Baixa e Descrição de comprados)
    raw_apoio = dfs.get("apoio_compras")
    if raw_apoio is not None:
        df_ap = raw_apoio.to_pandas() if isinstance(raw_apoio, pl.DataFrame) else raw_apoio
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

    # 2. Estoque Situação L
    raw_estoque = dfs.get("estoque")
    if raw_estoque is not None:
        df_est = sanitizar_dataframe(raw_estoque)
        if df_est is not None and "Item" in df_est.columns:
            df_est_clean = df_est.copy()
            df_est_clean["_item_norm"] = df_est_clean["Item"].apply(scraper.normalizar_cod_item)
            if "Qtde." in df_est_clean.columns:
                qt_num = pd.to_numeric(df_est_clean["Qtde."], errors="coerce").fillna(0.0)
                soma_est = qt_num.groupby(df_est_clean["_item_norm"]).sum()
                estoque_map = {str(k): float(v) for k, v in soma_est.to_dict().items() if k}

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

    # 3. Ordens (Descrição comercial e Fábrica de itens finais / produzidos)
    raw_ordens = dfs.get("ordens")
    if raw_ordens is not None:
        df_ord = raw_ordens.to_pandas() if isinstance(raw_ordens, pl.DataFrame) else raw_ordens
        if "Item" in df_ord.columns:
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

    return {
        "estoque": estoque_map,
        "tipo": tipo_map,
        "baixa": baixa_map,
        "local_prod": local_prod_map,
        "fabrica_item": fabrica_item_map,
        "desc_item": desc_item_map,
    }


def gerar_dataframe_cons(salvar_excel: bool = False) -> pd.DataFrame:
    """
    Gera o DataFrame 'cons' completo através de calc_data(dfs) sobre o snapshot mais recente,
    SEM filtros restritivos (preserva Tipo 'C', 'P', 'T', 'F' e todas as datas de entrega).
    """
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
        df_consumo["Consumo"] = pd.to_numeric(df_consumo["Consumo"], errors="coerce").fillna(0.0)

    if "estoque" in df_consumo.columns:
        df_consumo["estoque"] = pd.to_numeric(df_consumo["estoque"], errors="coerce").fillna(0.0)

    df_consumo["simulado"] = False
    df_consumo["origem_simulacao"] = ""

    if salvar_excel:
        dest_excel = settings.EXPORTS_DIR / "consumo_completo.xlsx"
        print(f"Salvando DataFrame completo sem filtros em {dest_excel}...")
        df_consumo.to_excel(dest_excel, index=False)

    global _cache_cons, _cache_timestamp, _cache_data_calculo, _cache_snapshot_nome, _cache_data_snapshot, _enriquecimento
    _enriquecimento = _construir_mapas_enriquecimento(dfs, df_consumo)
    _cache_cons = df_consumo
    _cache_timestamp = time.time()
    _cache_data_calculo = datetime.now().strftime("%d/%m/%Y %H:%M:%S")
    _cache_snapshot_nome = caminho.name
    _cache_data_snapshot = data_snapshot(caminho)
    _invalidar_cache_fila()

    return df_consumo


def obter_cons_com_cache(recarregar: bool = False) -> pd.DataFrame:
    """Retorna o DataFrame 'cons' base com cache em memória (recarregar=True relê o snapshot)."""
    if _cache_cons is None or recarregar:
        return gerar_dataframe_cons()
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
            visited = set()
            while curr_p is not None and is_phantom[curr_p]:
                if curr_p in visited:
                    break
                visited.add(curr_p)
                fantasmas_acima += 1
                curr_p = parent_idx[curr_p]

            if curr_p is None:
                r_novo["cod_item_pai"] = raiz
            else:
                _, r_anc = indexed_rows[curr_p]
                r_novo["cod_item_pai"] = r_anc.get("cod_item_compon")

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
        saldo_val = float(info_saldo.get("quantidade") or 0.0)
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
            consumo_total = qtd_unit * saldo_val

            estoque_l = float(_enriquecimento["estoque"].get(comp_code, 0.0))
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

            registros_df.append(
                {
                    "Tipo": tipo_comp,
                    "Ordem Prod": None,
                    "Item": comp_code,
                    "Consumo": consumo_total,
                    "Ordem Cons": op_virtual,
                    "item_pai": scraper.normalizar_cod_item(r.get("cod_item_pai")) or cod_item_final,
                    "Saldo": saldo_val,
                    "Pedido": ped_int,
                    "Representante": rep_final,
                    "Entrega Pedido": dt_entrega,
                    "Local Prod.": local_prod_comp,
                    "Familia": "",
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
    recarregar: bool = False,
    session_id: Optional[str] = None,
) -> Tuple[pd.DataFrame, pd.DataFrame, List[str]]:
    """
    Executa (ou recupera do cache da sessão) o cálculo de abatimento cumulativo de estoque (Situação L)
    seguindo estritamente a ordem de Data de Abertura da OP (e itens sem data ao final da lista).
    """
    if recarregar or _cache_cons is None:
        gerar_dataframe_cons()

    sess = obter_sessao(session_id)
    b_norm = baixa_filtro if baixa_filtro in ("S", "N") else "TODOS"
    t_norm = tipo_filtro if tipo_filtro in ("C", "P") else "TODOS"
    cache_key = (_cache_timestamp, sess.simulacao_versao, b_norm, t_norm)

    with sess.lock:
        if cache_key in sess.cache_filas:
            return sess.cache_filas[cache_key]

    df = obter_cons_efetivo(recarregar=False, session_id=session_id)

    locais_producao = sorted(
        [str(x) for x in df["raiz_Fábrica"].dropna().unique() if str(x).strip()]
    )

    mask_escopo = df["raiz_Item Final"].notna()
    if b_norm in ("S", "N"):
        mask_escopo &= df["Baixa"].astype(str).str.upper() == b_norm
    if t_norm in ("C", "P"):
        mask_escopo &= df["Tipo"].astype(str).str.upper() == t_norm

    df_escopo = df[mask_escopo]
    if df_escopo.empty:
        vazio = pd.DataFrame()
        with sess.lock:
            sess.cache_filas[cache_key] = (vazio, vazio, locais_producao)
        return vazio, vazio, locais_producao

    group_cols = ["raiz_Item Final", "raiz_Pedido_Str", "raiz_Fábrica"]

    # 1. Define a ordem global estrita da fila de produção
    filas = (
        df_escopo.groupby(group_cols, as_index=False)
        .agg(
            raiz_Descricao=("raiz_Descricao", "first"),
            raiz_Saldo=("raiz_Saldo", "first"),
            raiz_Entrega_Pedido=("raiz_Entrega Pedido", "first"),
            raiz_Data_Abertura=("raiz_Data Abertura", "first"),
            raiz_Cliente=("raiz_Cliente", "first"),
            simulado=("simulado", "any"),
            origem_simulacao=("origem_simulacao", "first"),
        )
    )
    filas["_dt_abertura_sort"] = pd.to_datetime(filas["raiz_Data_Abertura"], errors="coerce")
    filas = filas.sort_values(
        by=["_dt_abertura_sort", "raiz_Pedido_Str", "raiz_Item Final", "raiz_Fábrica"],
        ascending=[True, True, True, True],
        na_position="last",
    ).reset_index(drop=True)
    filas["_ordem_fila"] = filas.index

    # 2. Agrega consumo por (Item Final na fila, Componente único)
    comp_agg = (
        df_escopo.groupby(group_cols + ["Item"], as_index=False)
        .agg(
            Consumo=("Consumo", "sum"),
            estoque=("estoque", "first"),
            Tipo=("Tipo", "first"),
            Den_Item=("Den. Item", "first"),
            Baixa=("Baixa", "first"),
            Local_Prod=("Local Prod.", "first"),
            Ordem_Prod=("Ordem Prod", "first"),
            Saldo=("Saldo", "first"),
        )
        .merge(filas[group_cols + ["_ordem_fila"]], on=group_cols, how="left")
        .sort_values(by=["Item", "_ordem_fila"], ascending=[True, True])
        .reset_index(drop=True)
    )

    # 3. Abatimento cumulativo vetorizado do estoque Situação L na ordem da fila
    consumo_acumulado = comp_agg.groupby("Item")["Consumo"].cumsum()
    consumo_anterior = consumo_acumulado - comp_agg["Consumo"]
    comp_agg["estoque_disp_fila"] = (comp_agg["estoque"] - consumo_anterior).clip(lower=0.0)
    comp_agg["Disponivel"] = (comp_agg["estoque_disp_fila"] + 1e-6) >= comp_agg["Consumo"]
    comp_agg["Falta"] = (comp_agg["Consumo"] - comp_agg["estoque_disp_fila"]).clip(lower=0.0)

    # 4. Consolida métricas por Item Final mantendo exatamente a ordenação `_ordem_fila`
    totais_fila = (
        comp_agg.groupby("_ordem_fila", as_index=False)
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
        sess.cache_filas[cache_key] = (itens_resumo, comp_agg, locais_producao)
    return itens_resumo, comp_agg, locais_producao


def analisar_itens_finais(
    filtros: Optional[Dict[str, Any]] = None,
    page: int = 0,
    page_size: int = 50,
    recarregar: bool = False,
    session_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Retorna os itens finais paginados após o abatimento cumulativo de estoque na fila,
    aplicando filtros de visualização e retornando métricas e estado da simulação da sessão.
    """
    filtros = filtros or {}

    local_filtro = str(filtros.get("local_producao", "") or "").strip()
    pedido_filtro = str(filtros.get("pedido", "") or "").strip()
    codigo_filtro = str(filtros.get("codigo", "") or "").strip().upper()
    status_filtro = str(filtros.get("status", "todos") or "todos").strip().lower()
    baixa_filtro = str(filtros.get("baixa", "todos") or "todos").strip().upper()
    tipo_filtro = str(filtros.get("tipo", "todos") or "todos").strip().upper()
    apenas_simulados = bool(filtros.get("apenas_simulados", False))
    col_filtros = filtros.get("col_filtros") or {}
    data_inicio_raw = filtros.get("data_inicio")
    data_fim_raw = filtros.get("data_fim")

    itens_full, _, locais_producao = _obter_fila_calculada(
        baixa_filtro=baixa_filtro,
        tipo_filtro=tipo_filtro,
        recarregar=recarregar,
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
                "total_disponiveis": 0,
                "total_com_falta": 0,
                "total_pedidos": 0,
                "total_simulados": 0,
            },
            "pedidos_simulados_ativos": pedidos_ativos,
            "locais_producao": locais_producao,
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

    if local_filtro and local_filtro.upper() != "TODOS":
        mask &= itens_full["raiz_Fábrica"].str.upper() == local_filtro.upper()

    if pedido_filtro:
        mask &= itens_full["raiz_Pedido_Str"].str.contains(pedido_filtro, case=False, na=False)

    if codigo_filtro:
        mask_cod = itens_full["raiz_Item Final"].astype(str).str.upper().str.contains(codigo_filtro, na=False)
        mask_desc = itens_full["raiz_Descricao"].astype(str).str.upper().str.contains(codigo_filtro, na=False)
        mask &= mask_cod | mask_desc

    if data_inicio_raw and str(data_inicio_raw).strip():
        dt_in_str = str(data_inicio_raw).strip()
        dt_in = pd.to_datetime(dt_in_str, errors="coerce", dayfirst="/" in dt_in_str)
        if pd.notna(dt_in):
            mask &= itens_full["_dt_abertura_sort"].dt.floor("D") >= dt_in.floor("D")

    if data_fim_raw and str(data_fim_raw).strip():
        dt_fi_str = str(data_fim_raw).strip()
        dt_fi = pd.to_datetime(dt_fi_str, errors="coerce", dayfirst="/" in dt_fi_str)
        if pd.notna(dt_fi):
            mask &= itens_full["_dt_abertura_sort"].dt.floor("D") <= dt_fi.floor("D")

    itens_resumo = itens_full[mask]

    # Métricas consolidadas antes dos filtros de status e coluna
    total_itens_finais = len(itens_resumo)
    total_disponiveis = int((itens_resumo["status"] == "Disponível").sum())
    total_com_falta = int((itens_resumo["status"] == "Com Falta").sum())
    total_pedidos = int(itens_resumo["raiz_Pedido_Str"].replace("", np.nan).dropna().nunique())

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
                "saldo": round(saldo_val, 4) if saldo_val % 1 != 0 else int(saldo_val),
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
            "total_disponiveis": total_disponiveis,
            "total_com_falta": total_com_falta,
            "total_pedidos": total_pedidos,
            "total_simulados": total_simulados_global,
        },
        "pedidos_simulados_ativos": pedidos_ativos,
        "locais_producao": locais_producao,
        "data_carga": info_carga["data_carga"],
        "data_carregamento": info_carga["data_carregamento"],
        "snapshot": info_carga["snapshot"],
        "session_id": str(session_id or "default"),
    }


def obter_detalhes_item_final(
    raiz_item_final: str,
    raiz_pedido: Optional[str] = None,
    raiz_fabrica: Optional[str] = None,
    baixa: Optional[str] = None,
    tipo: Optional[str] = None,
    session_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Retorna a lista analítica de todos os componentes de um item final específico,
    refletindo o saldo exato disponível na posição daquele item na fila cumulativa da sessão.
    """
    b_norm = str(baixa or "todos").strip().upper()
    t_norm = str(tipo or "todos").strip().upper()

    itens_full, comp_agg_full, _ = _obter_fila_calculada(
        baixa_filtro=b_norm,
        tipo_filtro=t_norm,
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

    ordem_fila = int(alvo.iloc[0]["_ordem_fila"])
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
            tipo_desc = (
                "Matéria Prima (C)"
                if r["Tipo"] == "C"
                else ("Componente Produzido (P)" if r["Tipo"] == "P" else f"Outro ({r['Tipo']})")
            )
            op_prod = ""
            if pd.notna(r.get("Ordem_Prod")):
                try:
                    op_prod = str(int(float(r["Ordem_Prod"])))
                except Exception:
                    op_prod = str(r["Ordem_Prod"])

            lista.append(
                {
                    "item": str(r["Item"]),
                    "descricao": str(r["Den_Item"] or ""),
                    "tipo": str(r["Tipo"]),
                    "tipo_descricao": tipo_desc,
                    "baixa": str(r.get("Baixa") or "").upper(),
                    "consumo": round(float(r["Consumo"]), 4),
                    "estoque_l": round(float(r["estoque"]), 4),
                    "saldo_fila": round(float(r["estoque_disp_fila"]), 4),
                    "falta": round(float(r["Falta"]), 4),
                    "disponivel": bool(r["Disponivel"]),
                    "local_prod": str(r.get("Local_Prod") or ""),
                    "ordem_prod": op_prod,
                }
            )
        return lista

    return {
        "posicao_fila": ordem_fila + 1,
        "item_final": str(raiz_item_final),
        "pedido": str(raiz_pedido or ""),
        "fabrica": str(raiz_fabrica or ""),
        "simulado": bool(alvo.iloc[0]["simulado"]),
        "origem_simulacao": str(alvo.iloc[0]["origem_simulacao"] or ""),
        "total_componentes": len(comp),
        "total_faltando": len(faltando_df),
        "total_disponiveis": len(disponivel_df),
        "faltando": _formatar_lista(faltando_df),
        "disponiveis": _formatar_lista(disponivel_df),
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
