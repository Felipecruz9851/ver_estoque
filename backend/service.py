"""
Serviço ver_estoque.
Gera o DataFrame de consumo (sem filtros restritivos) a partir do snapshot mais recente
disponibilizado manualmente em `settings.SNAPSHOTS_DIR` e analisa a disponibilidade dos
itens finais (raiz_Item Final) contra o estoque em situação L.
"""

from datetime import datetime
import time
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd
import polars as pl

if __package__:
    from . import settings
    from .calculo import calc_data
    from .snapshots import carregar_snapshot, data_snapshot
else:
    import sys
    from pathlib import Path

    _backend_dir = str(Path(__file__).resolve().parent)
    if _backend_dir not in sys.path:
        sys.path.insert(0, _backend_dir)
    import settings
    from calculo import calc_data
    from snapshots import carregar_snapshot, data_snapshot

# Cache em memória para garantir respostas imediatas (< 50ms)
_cache_cons: Optional[pd.DataFrame] = None
_cache_timestamp: Optional[float] = None
_cache_data_calculo: Optional[str] = None
_cache_snapshot_nome: Optional[str] = None
_cache_data_snapshot: Optional[str] = None


def obter_info_carregamento() -> Dict[str, str]:
    """Data/hora do snapshot (base ERP) e da carga/cálculo em memória."""
    return {
        "data_carga": _cache_data_snapshot or "",
        "data_carregamento": _cache_data_calculo or "",
        "snapshot": _cache_snapshot_nome or "",
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
            df_consumo["raiz_Pedido"]
            .fillna(0)
            .astype(float)
            .astype(int)
            .astype(str)
            .replace("0", "")
        )
    else:
        df_consumo["raiz_Pedido_Str"] = ""

    if "raiz_Fábrica" in df_consumo.columns:
        df_consumo["raiz_Fábrica"] = df_consumo["raiz_Fábrica"].fillna("NÃO INFORMADO").astype(str).str.strip()

    if "Consumo" in df_consumo.columns:
        df_consumo["Consumo"] = pd.to_numeric(df_consumo["Consumo"], errors="coerce").fillna(0.0)

    if "estoque" in df_consumo.columns:
        df_consumo["estoque"] = pd.to_numeric(df_consumo["estoque"], errors="coerce").fillna(0.0)

    if salvar_excel:
        dest_excel = settings.EXPORTS_DIR / "consumo_completo.xlsx"
        print(f"Salvando DataFrame completo sem filtros em {dest_excel}...")
        df_consumo.to_excel(dest_excel, index=False)

    global _cache_cons, _cache_timestamp, _cache_data_calculo, _cache_snapshot_nome, _cache_data_snapshot
    _cache_cons = df_consumo
    _cache_timestamp = time.time()
    _cache_data_calculo = datetime.now().strftime("%d/%m/%Y %H:%M:%S")
    _cache_snapshot_nome = caminho.name
    _cache_data_snapshot = data_snapshot(caminho)

    return df_consumo


def obter_cons_com_cache(recarregar: bool = False) -> pd.DataFrame:
    """Retorna o DataFrame 'cons' com cache em memória (recarregar=True relê o snapshot)."""
    if _cache_cons is None or recarregar:
        return gerar_dataframe_cons()
    return _cache_cons

def analisar_itens_finais(
    filtros: Optional[Dict[str, Any]] = None,
    page: int = 0,
    page_size: int = 50,
    recarregar: bool = False,
) -> Dict[str, Any]:
    """
    Agrupa os dados por (raiz_Item Final, raiz_Pedido, raiz_Fábrica),
    compara consumo contra estoque em situação L e calcula disponibilidade e faltas.
    """
    df = obter_cons_com_cache(recarregar=recarregar)
    filtros = filtros or {}

    local_filtro = str(filtros.get("local_producao", "") or "").strip()
    pedido_filtro = str(filtros.get("pedido", "") or "").strip()
    codigo_filtro = str(filtros.get("codigo", "") or "").strip().upper()
    status_filtro = str(filtros.get("status", "todos") or "todos").strip().lower()
    baixa_filtro = str(filtros.get("baixa", "todos") or "todos").strip().upper()
    tipo_filtro = str(filtros.get("tipo", "todos") or "todos").strip().upper()
    col_filtros = filtros.get("col_filtros") or {}
    data_inicio_raw = filtros.get("data_inicio")
    data_fim_raw = filtros.get("data_fim")

    # Aplicação de filtros no nível de linha
    mask = pd.Series(True, index=df.index)

    if local_filtro and local_filtro.upper() != "TODOS":
        mask &= df["raiz_Fábrica"].str.upper() == local_filtro.upper()

    if pedido_filtro:
        mask &= df["raiz_Pedido_Str"].str.contains(pedido_filtro, case=False, na=False)

    if codigo_filtro:
        mask_cod = df["raiz_Item Final"].astype(str).str.upper().str.contains(codigo_filtro, na=False)
        mask_desc = df["raiz_Descricao"].astype(str).str.upper().str.contains(codigo_filtro, na=False)
        mask &= mask_cod | mask_desc

    if baixa_filtro in ["S", "N"]:
        mask &= df["Baixa"].astype(str).str.upper() == baixa_filtro

    if tipo_filtro in ["C", "P"]:
        mask &= df["Tipo"].astype(str).str.upper() == tipo_filtro

    # Janela de data para Abertura da Ordem de Produção (raiz_Data Abertura)
    if data_inicio_raw and str(data_inicio_raw).strip():
        dt_in_str = str(data_inicio_raw).strip()
        dt_in = pd.to_datetime(dt_in_str, errors="coerce", dayfirst="/" in dt_in_str)
        if pd.notna(dt_in):
            mask &= df["raiz_Data Abertura"].dt.floor("D") >= dt_in.floor("D")

    if data_fim_raw and str(data_fim_raw).strip():
        dt_fi_str = str(data_fim_raw).strip()
        dt_fi = pd.to_datetime(dt_fi_str, errors="coerce", dayfirst="/" in dt_fi_str)
        if pd.notna(dt_fi):
            mask &= df["raiz_Data Abertura"].dt.floor("D") <= dt_fi.floor("D")

    df_filtrado = df[mask]

    # Lista consolidada de locais de produção disponíveis (do conjunto total sem filtros)
    locais_producao = sorted(
        [str(x) for x in df["raiz_Fábrica"].dropna().unique() if str(x).strip()]
    )

    info_carga = obter_info_carregamento()

    if df_filtrado.empty:
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
            },
            "locais_producao": locais_producao,
            "data_carga": info_carga["data_carga"],
            "data_carregamento": info_carga["data_carregamento"],
            "snapshot": info_carga["snapshot"],
        }

    # Agrupamento por Item Final / Pedido / Fábrica
    # Um produto final dentro de uma mesma ordem tem múltiplos insumos
    group_cols = ["raiz_Item Final", "raiz_Pedido_Str", "raiz_Fábrica"]

    # Agregação rápida de insumos por produto final
    # Para cada componente único do item final, somamos o consumo e pegamos o estoque L
    comp_agg = (
        df_filtrado.groupby(group_cols + ["Item", "Tipo", "Den. Item"], as_index=False)
        .agg({
            "Consumo": "sum",
            "estoque": "first",
            "raiz_Descricao": "first",
            "raiz_Saldo": "first",
            "raiz_Entrega Pedido": "first",
            "raiz_Data Abertura": "first",
            "raiz_Cliente": "first",
        })
    )

    comp_agg["Disponivel"] = comp_agg["estoque"] >= comp_agg["Consumo"]
    comp_agg["Falta"] = (comp_agg["Consumo"] - comp_agg["estoque"]).clip(lower=0.0)

    # Agrupa agora por produto final para obter os totais
    itens_resumo = (
        comp_agg.groupby(group_cols, as_index=False)
        .agg(
            total_componentes=("Item", "count"),
            componentes_disponiveis=("Disponivel", lambda s: int(s.sum())),
            componentes_faltando=("Disponivel", lambda s: int((~s).sum())),
            raiz_Descricao=("raiz_Descricao", "first"),
            raiz_Saldo=("raiz_Saldo", "first"),
            raiz_Entrega_Pedido=("raiz_Entrega Pedido", "first"),
            raiz_Data_Abertura=("raiz_Data Abertura", "first"),
            raiz_Cliente=("raiz_Cliente", "first"),
        )
    )

    itens_resumo["perc_disponivel"] = (
        (itens_resumo["componentes_disponiveis"] / itens_resumo["total_componentes"] * 100)
        .round(1)
        .fillna(100.0)
    )
    itens_resumo["status"] = np.where(
        itens_resumo["componentes_faltando"] == 0, "Disponível", "Com Falta"
    )

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

    # Criação de colunas de texto formatadas para busca universal no backend
    itens_resumo["_dt_abertura_br"] = pd.to_datetime(
        itens_resumo["raiz_Data_Abertura"], errors="coerce"
    ).dt.strftime("%d/%m/%Y").fillna("")
    itens_resumo["_dt_entrega_br"] = pd.to_datetime(
        itens_resumo["raiz_Entrega_Pedido"], errors="coerce"
    ).dt.strftime("%d/%m/%Y").fillna("")
    itens_resumo["_saldo_str"] = itens_resumo["raiz_Saldo"].fillna(0).astype(str)

    # Aplicação dos filtros individuais por coluna no Backend sobre todo o dataset
    if col_filtros and isinstance(col_filtros, dict):
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
                mask_cols &= (m1 | m2)
            elif col_key == "entrega":
                m1 = itens_resumo["_dt_entrega_br"].str.upper().str.contains(val_clean, na=False)
                m2 = itens_resumo["raiz_Entrega_Pedido"].astype(str).str.upper().str.contains(val_clean, na=False)
                mask_cols &= (m1 | m2)
            elif col_key == "saldo":
                mask_cols &= itens_resumo["_saldo_str"].str.contains(val_clean, na=False)
            elif col_key == "status":
                m1 = itens_resumo["status"].astype(str).str.upper().str.contains(val_clean, na=False)
                m2 = itens_resumo["componentes_faltando"].astype(str).str.contains(val_clean, na=False)
                mask_cols &= (m1 | m2)

        itens_resumo = itens_resumo[mask_cols]

    total_filtrados = len(itens_resumo)
    total_paginas = (total_filtrados + page_size - 1) // page_size if page_size > 0 else 1

    # Ordenação estrita pela Data de Abertura da Ordem de Produção do Item Final
    itens_resumo["_dt_abertura_sort"] = pd.to_datetime(
        itens_resumo["raiz_Data_Abertura"], errors="coerce"
    )
    itens_resumo = itens_resumo.sort_values(
        by=["_dt_abertura_sort", "raiz_Pedido_Str", "raiz_Item Final"],
        ascending=[True, True, True],
        na_position="last",
    )

    # Paginação
    start = page * page_size
    end = start + page_size
    slice_df = itens_resumo.iloc[start:end]

    # Formatação dos registros para JSON
    registros: List[Dict[str, Any]] = []
    for _, row in slice_df.iterrows():
        abertura_str = ""
        if pd.notna(row["raiz_Data_Abertura"]):
            try:
                abertura_str = pd.to_datetime(row["raiz_Data_Abertura"]).strftime("%d/%m/%Y")
            except Exception:
                abertura_str = str(row["raiz_Data_Abertura"])

        entrega_str = ""
        if pd.notna(row["raiz_Entrega_Pedido"]):
            try:
                entrega_str = pd.to_datetime(row["raiz_Entrega_Pedido"]).strftime("%d/%m/%Y")
            except Exception:
                entrega_str = str(row["raiz_Entrega_Pedido"])

        saldo_val = 1.0
        if pd.notna(row["raiz_Saldo"]):
            try:
                saldo_val = float(row["raiz_Saldo"])
            except Exception:
                saldo_val = 1.0

        registros.append({
            "item_final": str(row["raiz_Item Final"]),
            "descricao": str(row["raiz_Descricao"] or ""),
            "pedido": str(row["raiz_Pedido_Str"] or ""),
            "fabrica": str(row["raiz_Fábrica"] or ""),
            "cliente": str(row["raiz_Cliente"] or ""),
            "saldo": saldo_val,
            "data_abertura": abertura_str,
            "entrega": entrega_str,
            "total_componentes": int(row["total_componentes"]),
            "componentes_disponiveis": int(row["componentes_disponiveis"]),
            "componentes_faltando": int(row["componentes_faltando"]),
            "perc_disponivel": float(row["perc_disponivel"]),
            "status": str(row["status"]),
        })

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
        },
        "locais_producao": locais_producao,
        "data_carga": info_carga["data_carga"],
        "data_carregamento": info_carga["data_carregamento"],
            "snapshot": info_carga["snapshot"],
    }


def obter_detalhes_item_final(
    raiz_item_final: str,
    raiz_pedido: Optional[str] = None,
    raiz_fabrica: Optional[str] = None,
    baixa: Optional[str] = None,
    tipo: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Retorna a lista analítica de todos os componentes de um item final específico,
    separando o que está disponível e o que está faltando, comparando com estoque situação L.
    Permite filtrar componentes por Baixa ('S'/'N') e Tipo ('C'/'P').
    """
    df = obter_cons_com_cache()

    mask = df["raiz_Item Final"].astype(str) == str(raiz_item_final)
    if raiz_pedido:
        mask &= df["raiz_Pedido_Str"].astype(str) == str(raiz_pedido)
    if raiz_fabrica:
        mask &= df["raiz_Fábrica"].astype(str).str.upper() == str(raiz_fabrica).upper()
    if baixa and str(baixa).strip().upper() in ["S", "N"]:
        mask &= df["Baixa"].astype(str).str.upper() == str(baixa).strip().upper()
    if tipo and str(tipo).strip().upper() in ["C", "P"]:
        mask &= df["Tipo"].astype(str).str.upper() == str(tipo).strip().upper()

    df_item = df[mask]
    if df_item.empty:
        return {"erro": "Item não encontrado no cálculo de consumo"}

    # Agrega por componente para evitar duplicatas em árvores multinível
    comp = (
        df_item.groupby(["Item", "Tipo", "Den. Item", "Baixa"], as_index=False)
        .agg({
            "Consumo": "sum",
            "estoque": "first",
            "Local Prod.": "first",
            "Ordem Prod": "first",
            "Saldo": "first",
        })
    )

    comp["Disponivel"] = comp["estoque"] >= comp["Consumo"]
    comp["Falta"] = (comp["Consumo"] - comp["estoque"]).clip(lower=0.0)

    # Separação entre Faltando e Disponíveis
    faltando_df = comp[~comp["Disponivel"]].sort_values(by=["Falta", "Tipo"], ascending=[False, True])
    disponivel_df = comp[comp["Disponivel"]].sort_values(by=["Tipo", "Item"], ascending=[True, True])

    def _formatar_lista(sub_df: pd.DataFrame) -> List[Dict[str, Any]]:
        lista = []
        for _, r in sub_df.iterrows():
            tipo_desc = "Matéria Prima (C)" if r["Tipo"] == "C" else (
                "Componente Produzido (P)" if r["Tipo"] == "P" else f"Outro ({r['Tipo']})"
            )
            op_prod = ""
            if pd.notna(r.get("Ordem Prod")):
                try:
                    op_prod = str(int(float(r["Ordem Prod"])))
                except Exception:
                    op_prod = str(r["Ordem Prod"])

            lista.append({
                "item": str(r["Item"]),
                "descricao": str(r["Den. Item"] or ""),
                "tipo": str(r["Tipo"]),
                "tipo_descricao": tipo_desc,
                "baixa": str(r.get("Baixa") or "").upper(),
                "consumo": round(float(r["Consumo"]), 4),
                "estoque_l": round(float(r["estoque"]), 4),
                "falta": round(float(r["Falta"]), 4),
                "disponivel": bool(r["Disponivel"]),
                "local_prod": str(r.get("Local Prod.") or ""),
                "ordem_prod": op_prod,
            })
        return lista

    return {
        "item_final": str(raiz_item_final),
        "pedido": str(raiz_pedido or ""),
        "fabrica": str(raiz_fabrica or ""),
        "total_componentes": len(comp),
        "total_faltando": len(faltando_df),
        "total_disponiveis": len(disponivel_df),
        "faltando": _formatar_lista(faltando_df),
        "disponiveis": _formatar_lista(disponivel_df),
    }


def exportar_analise_excel(filtros: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    Exporta a análise consolidada dos itens finais com seus status e faltas para um arquivo Excel
    no diretório de exportações, retornando a URL de download.
    """
    res = analisar_itens_finais(filtros=filtros, page=0, page_size=100000)
    itens = res.get("itens", [])
    if not itens:
        return {"erro": "Nenhum item final encontrado para exportação com os filtros aplicados."}

    df_export = pd.DataFrame(itens)
    col_names = {
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
    }
    df_export = df_export.rename(columns=col_names)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    nome_arquivo = f"analise_estoque_itens_finais_{timestamp}.xlsx"
    caminho_arquivo = settings.EXPORTS_DIR / nome_arquivo

    df_export.to_excel(caminho_arquivo, index=False)
    return {
        "status": "ok",
        "url": f"/ver_estoque/exports/{nome_arquivo}",
        "nome": nome_arquivo,
        "total": len(df_export),
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
            f"  [{it['status']}] {it['item_final']} (Pedido: {it['pedido']}, Fábrica: {it['fabrica']}) - "
            f"Disp: {it['componentes_disponiveis']}/{it['total_componentes']} ({it['perc_disponivel']}%) - "
            f"Faltam: {it['componentes_faltando']}"
        )