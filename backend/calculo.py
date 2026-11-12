"""Cálculo de consumo com resolução do Item Final (raiz) em grafo BFS.

Cópia autônoma da lógica de calc_data, sem dependência do projeto de análise de compras.
"""

import numpy as np
import pandas as pd
import polars as pl


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

        # Tratamento rigoroso para números no padrão brasileiro:
        # Ponto (.) é separador de milhar e vírgula (,) é separador decimal.
        # Remove pontos residuais no final da string (ex: '180,90.' -> '180,90', '0.' -> '0')
        serie_limpa = serie.str.replace(r"\.+$", "", regex=True).str.strip()
        has_comma = serie_limpa.str.contains(",", regex=False)
        has_dot = serie_limpa.str.contains(r"\.", regex=True)

        serie_num = serie_limpa.copy()

        # Onde tem vírgula: a vírgula é o separador decimal. Todo ponto é milhar e é removido.
        if has_comma.any():
            serie_num[has_comma] = (
                serie_limpa[has_comma]
                .str.replace(".", "", regex=False)
                .str.replace(",", ".", regex=False)
            )

        # Onde tem apenas ponto (sem vírgula):
        # Se for milhar brasileiro puro (ex: '1.000', '10.000', '1.250.000') com blocos de 3 dígitos:
        only_dot = (~has_comma) & has_dot
        if only_dot.any():
            is_milhar = only_dot & serie_limpa.str.match(r"^[1-9]\d{0,2}(\.\d{3})+$")
            if is_milhar.any():
                serie_num[is_milhar] = serie_limpa[is_milhar].str.replace(".", "", regex=False)

        tentativa_num = pd.to_numeric(serie_num, errors="coerce")
        if tentativa_num.notna().mean() > limite:
            df_pd[col] = tentativa_num.round(2)
            continue

        df_pd[col] = serie.replace({"": None})

    return df_pd


def calc_data(dfs):
    print("calculando dados...")

    ## Ajuste Ordens ##
    raw_ordens = dfs.get("ordens")
    if isinstance(raw_ordens, pl.DataFrame):
        raw_ordens = raw_ordens.to_pandas()
    ordens = sanitizar_dataframe(raw_ordens)

    ordens = ordens[
        [
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
    ]
    ordens = ordens.rename(
        columns={"Ordem": "Ordem Prod", "Saldo": "Saldo Prod"}
    )
    ordens["Saldo Prod"] = (
        pd.to_numeric(ordens["Saldo Prod"], errors="coerce")
        .fillna(0.0)
        .round(2)
    )

    colunas = ["Entrega Pedido", "Data Abertura"]
    for col in colunas:
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
    consumo = sanitizar_dataframe(raw_cons)

    consumo["Item"] = consumo["Item"].str.split("-").str[0].str.strip()
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
    if "Grupo" in consumo.columns:
        cols_cons.append("Grupo")
    consumo = consumo[cols_cons]
    consumo = consumo.rename(columns={"OP": "Ordem Cons"})
    consumo["Consumo"] = (
        pd.to_numeric(consumo["Consumo"], errors="coerce")
        .fillna(0.0)
        .round(2)
    )

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
    ordens_op = ordens[["Item", "Ordem Prod", "Pedido"]].copy()

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
    estoque = sanitizar_dataframe(raw_estoque)
    if "Qtde." in estoque.columns:
        estoque["Qtde."] = (
            pd.to_numeric(estoque["Qtde."], errors="coerce")
            .fillna(0.0)
            .round(2)
        )
    consumo["estoque"] = (
        consumo["Item"].map(estoque.groupby("Item")["Qtde."].sum()).fillna(0.0)
    ).round(2)

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
