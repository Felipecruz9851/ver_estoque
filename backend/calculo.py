"""Cálculo de consumo com resolução do Item Final (raiz) em grafo BFS.

Cópia autônoma da lógica de calc_data, sem dependência do projeto de análise de compras.
"""

import numpy as np
import pandas as pd
import polars as pl


def parse_numero_br_series(serie: pd.Series) -> pd.Series:
    """Converte série textual ou numérica no formato brasileiro para float arredondado a 2 casas."""
    if serie is None or serie.empty:
        return pd.Series(dtype=float)
    if pd.api.types.is_numeric_dtype(serie):
        return serie.fillna(0.0).round(2)
    s = serie.astype(str).str.strip().str.replace(r"\.+$", "", regex=True)
    has_comma = s.str.contains(",", regex=False)
    has_dot = s.str.contains(r"\.", regex=True)
    s_num = s.copy()
    if has_comma.any():
        s_num[has_comma] = (
            s[has_comma]
            .str.replace(".", "", regex=False)
            .str.replace(",", ".", regex=False)
        )
    only_dot = (~has_comma) & has_dot
    if only_dot.any():
        is_milhar = only_dot & s.str.match(r"^[1-9]\d{0,2}(\.\d{3})+$")
        if is_milhar.any():
            s_num[is_milhar] = s[is_milhar].str.replace(".", "", regex=False)
    return pd.to_numeric(s_num, errors="coerce").fillna(0.0).round(2)


def sanitizar_dataframe(df, limite=0.8):
    """
    Sanitiza DataFrame tratando dados brasileiros e formatos numéricos/datas.
    Padroniza todas as colunas numéricas para 2 casas decimais antes dos cálculos.
    Aceita tanto Polars DataFrame quanto Pandas DataFrame de forma transparente.
    """
    if df is None:
        return None

    if isinstance(df, pl.DataFrame):
        df_pd = df.to_pandas()
    else:
        df_pd = df.copy()

    for col in df_pd.columns:
        if pd.api.types.is_numeric_dtype(df_pd[col]):
            if pd.api.types.is_float_dtype(df_pd[col]):
                df_pd[col] = df_pd[col].round(2)
            continue

        serie = df_pd[col].astype(str).str.strip()

        tentativa_data = pd.to_datetime(
            serie, errors="coerce", dayfirst=True, format="%d/%m/%Y"
        )
        if tentativa_data.notna().mean() > limite:
            df_pd[col] = tentativa_data
            continue

        df_pd[col] = parse_numero_br_series(serie)

    return df_pd


def calc_data(dfs):
    print("calculando dados...")

    ## Ajuste Ordens ##
    raw_ordens = dfs.get("ordens")
    if isinstance(raw_ordens, pl.DataFrame):
        raw_ordens = raw_ordens.to_pandas()

    cols_ord = [
        "Cliente",
        "Fábrica",
        "Ordem",
        "Pedido",
        "Item",
        "Saldo",
        "Representante",
        "Entrega Pedido",
        "Data Abertura",
    ]
    ordens = raw_ordens[[c for c in cols_ord if c in raw_ordens.columns]].copy()
    ordens = ordens.rename(
        columns={"Ordem": "Ordem Prod", "Saldo": "Saldo Prod"}
    )
    ordens["Saldo Prod"] = parse_numero_br_series(ordens.get("Saldo Prod", pd.Series()))
    ordens["Pedido"] = pd.to_numeric(ordens.get("Pedido", pd.Series()), errors="coerce").fillna(0).astype(int)
    if "Ordem Prod" in ordens.columns:
        ordens["Ordem Prod"] = ordens["Ordem Prod"].astype(str).str.strip().str.removesuffix(".0")
    if "Item" in ordens.columns:
        ordens["Item"] = ordens["Item"].astype(str).str.strip()

    colunas = ["Entrega Pedido", "Data Abertura"]
    for col in colunas:
        if col in ordens.columns:
            ordens[col] = (
                ordens[col]
                .astype(str)
                .str.strip()
                .str.replace(r"[^\d]", "", regex=True)
                .pipe(
                    lambda s: pd.to_datetime(s, format="%d%m%Y", errors="coerce")
                )
            )

    ## Ajuste Consumo ##
    raw_cons = dfs.get("cons")
    if isinstance(raw_cons, pl.DataFrame):
        raw_cons = raw_cons.to_pandas()

    cols_cons = [
        "Tipo",
        "Item",
        "Baixa",
        "Consumo",
        "Local Prod.",
        "OP",
        "Familia",
        "Den. Item",
    ]
    if "Grupo" in raw_cons.columns:
        cols_cons.append("Grupo")

    consumo = raw_cons[[c for c in cols_cons if c in raw_cons.columns]].copy()
    consumo["Item"] = consumo["Item"].astype(str).str.split("-").str[0].str.strip()
    consumo = consumo.rename(columns={"OP": "Ordem Cons"})
    consumo["Ordem Cons"] = consumo["Ordem Cons"].astype(str).str.strip().str.removesuffix(".0")
    consumo["Consumo"] = parse_numero_br_series(consumo.get("Consumo", pd.Series()))

    ######## Item Pai ##########
    consumo["item_pai"] = consumo["Ordem Cons"].map(
        ordens.set_index("Ordem Prod")["Item"]
    )

    ######## Merge 1: traz Pedido/Cliente/etc via Ordem Cons ##########
    consumo = consumo.merge(
        ordens[
            [
                "Cliente",
                "Fábrica",
                "Ordem Prod",
                "Pedido",
                "Saldo Prod",
                "Representante",
                "Entrega Pedido",
                "Data Abertura",
            ]
        ].rename(columns={"Ordem Prod": "Ordem", "Saldo Prod": "Saldo"}),
        left_on="Ordem Cons",
        right_on="Ordem",
        how="left",
    )

    ######## Merge 2: Ordem Prod do componente ##########
    ordens_op = ordens[["Item", "Ordem Prod", "Pedido", "Data Abertura"]].copy()
    ordens_op["_prio_2030"] = np.where(ordens_op["Data Abertura"].dt.year == 2030, 0, 1)
    ordens_op = (
        ordens_op.sort_values(
            by=["_prio_2030", "Data Abertura"],
            ascending=[True, True],
            na_position="last",
        )[["Item", "Ordem Prod", "Pedido"]]
        .copy()
    )

    consumo_com_pedido = consumo[consumo["Pedido"] > 0]
    consumo_sem_pedido = consumo[consumo["Pedido"] == 0]

    # Deduplica ordens_op por (Item, Pedido) para evitar produto cartesiano
    # que multiplicava indevidamente as linhas de consumo quando havia mais de uma OP aberta
    ordens_op_com_pedido = ordens_op[ordens_op["Pedido"] > 0].drop_duplicates(
        subset=["Item", "Pedido"]
    )
    consumo_com_pedido = consumo_com_pedido.merge(
        ordens_op_com_pedido,
        on=["Item", "Pedido"],
        how="left",
    )

    consumo_sem_pedido = consumo_sem_pedido.merge(
        ordens_op.drop_duplicates("Item")[["Item", "Ordem Prod"]],
        on="Item",
        how="left",
    )

    consumo = pd.concat([consumo_com_pedido, consumo_sem_pedido]).sort_index()

    ######## Ordena as colunas ##########
    cols_finais = [
        "Tipo",
        "Ordem Prod",
        "Item",
        "Consumo",
        "Ordem Cons",
        "item_pai",
        "Saldo",
        "Pedido",
        "Representante",
        "Entrega Pedido",
        "Local Prod.",
        "Familia",
        "Cliente",
        "Fábrica",
        "Ordem",
        "Data Abertura",
        "Baixa",
        "Den. Item",
    ]
    if "Grupo" in consumo.columns:
        cols_finais.append("Grupo")
    consumo = consumo[cols_finais]

    ######## Calculos Baseados em estoque ##########
    raw_estoque = dfs.get("estoque")
    if isinstance(raw_estoque, pl.DataFrame):
        raw_estoque = raw_estoque.to_pandas()
    if raw_estoque is not None and "Item" in raw_estoque.columns:
        qt_clean = parse_numero_br_series(raw_estoque.get("Qtde.", pd.Series()))
        soma_estoque = qt_clean.groupby(raw_estoque["Item"]).sum().round(2)
        consumo["estoque"] = consumo["Item"].map(soma_estoque).fillna(0.0).round(2)
    else:
        consumo["estoque"] = 0.0

    ######## Propagação dos atributos da raiz ##########

    CAMPOS_RAIZ = [
        "Cliente",
        "Fábrica",
        "Pedido",
        "Representante",
        "Entrega Pedido",
        "Data Abertura",
        "Saldo",
        "Baixa",
    ]
    CAMPOS_RAIZ_COMPLETO = ["Item Final"] + CAMPOS_RAIZ

    itens_existentes = set(consumo["Item"].unique())
    raizes = set(consumo["item_pai"].dropna()) - itens_existentes

    # Nível 0: item_pai aqui É o produto final (raiz real) - otimizado com to_dict("records")
    cache_raiz = {}
    itens_nivel_0 = (
        consumo[consumo["item_pai"].isin(raizes)]
        .drop_duplicates("Ordem Cons")
        .to_dict("records")
    )
    for row in itens_nivel_0:
        cache_raiz[row["Ordem Cons"]] = {
            "Item Final": row["item_pai"],
            **{c: row[c] for c in CAMPOS_RAIZ},
        }

    # Mapa Ordem Prod → [(Ordem Cons, Pedido_Ordem, Pedido_Contexto)]
    mapa_raw = (
        ordens[["Ordem Prod", "Item", "Pedido"]]
        .rename(columns={"Pedido": "Pedido_Ordem"})
        .merge(
            consumo[["Item", "Ordem Cons", "Pedido"]].drop_duplicates(
                ["Item", "Ordem Cons"]
            ),
            on="Item",
        )
    )

    mapa_op_para_pais = {}
    for row in mapa_raw.to_dict("records"):
        op = row["Ordem Prod"]
        if op not in mapa_op_para_pais:
            mapa_op_para_pais[op] = []
        mapa_op_para_pais[op].append(
            (row["Ordem Cons"], row["Pedido_Ordem"], row["Pedido"])
        )

    def achar_pai_no_cache(ordem_cons_filho, pedido_filho):
        pais = mapa_op_para_pais.get(ordem_cons_filho, [])
        pais_no_cache = [
            (oc, po, pc) for oc, po, pc in pais if oc in cache_raiz
        ]
        if not pais_no_cache:
            return None
        if len(pais_no_cache) == 1:
            return cache_raiz[pais_no_cache[0][0]]
        match = [(oc, po, pc) for oc, po, pc in pais_no_cache if po == pc]
        if len(match) == 1:
            return cache_raiz[match[0][0]]
        match2 = [
            (oc, po, pc) for oc, po, pc in pais_no_cache if pc == pedido_filho
        ]
        if match2:
            return cache_raiz[match2[0][0]]
        return cache_raiz[pais_no_cache[0][0]]

    # BFS top-down ultra-otimizada sem iterrows()
    for nivel in range(1, 12):
        pendentes_recs = (
            consumo[~consumo["Ordem Cons"].isin(cache_raiz)]
            .drop_duplicates("Ordem Cons")[["Ordem Cons", "Pedido"]]
            .to_dict("records")
        )

        novos = 0
        for row in pendentes_recs:
            resultado = achar_pai_no_cache(row["Ordem Cons"], row["Pedido"])
            if resultado:
                cache_raiz[row["Ordem Cons"]] = resultado
                novos += 1
        print(f"Nível {nivel}: {novos} novas entradas resolvidas")
        if novos == 0:
            break

    raiz_df = (
        consumo["Ordem Cons"]
        .map(cache_raiz)
        .apply(
            lambda x: (
                x
                if isinstance(x, dict)
                else {c: None for c in CAMPOS_RAIZ_COMPLETO}
            )
        )
    )
    raiz_df = pd.DataFrame(raiz_df.tolist(), index=consumo.index)
    raiz_df.columns = [f"raiz_{c}" for c in CAMPOS_RAIZ_COMPLETO]
    consumo = pd.concat([consumo, raiz_df], axis=1)

    if "raiz_Saldo" in consumo.columns:
        consumo["raiz_Saldo"] = (
            pd.to_numeric(consumo["raiz_Saldo"], errors="coerce")
            .fillna(0.0)
            .round(2)
        )
    if "Saldo" in consumo.columns:
        consumo["Saldo"] = (
            pd.to_numeric(consumo["Saldo"], errors="coerce")
            .fillna(0.0)
            .round(2)
        )
    if "Consumo" in consumo.columns:
        consumo["Consumo"] = (
            pd.to_numeric(consumo["Consumo"], errors="coerce")
            .fillna(0.0)
            .round(2)
        )
    if "estoque" in consumo.columns:
        consumo["estoque"] = (
            pd.to_numeric(consumo["estoque"], errors="coerce")
            .fillna(0.0)
            .round(2)
        )

    return consumo
