from datetime import datetime, timedelta
import sys
from pathlib import Path

import pandas as pd
import polars as pl

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend import service, settings, snapshots  # noqa: E402


def _todos_itens(res):
    return [it for g in res["grupos_produzidos"] + res["grupos_comprados"] for it in g["itens"]]


def test_resumo_sem_filtros_separa_tipos_e_so_traz_faltas():
    res = service.obter_resumo_faltantes({}, session_id="t_resumo")
    assert all(it["falta"] > 0 for it in _todos_itens(res))
    assert all(it["tipo"] == "P" for g in res["grupos_produzidos"] for it in g["itens"])
    assert all(it["tipo"] == "C" for g in res["grupos_comprados"] for it in g["itens"])
    t = res["totais"]
    assert t["p_itens"] == sum(g["total_itens"] for g in res["grupos_produzidos"])
    assert t["c_itens"] == sum(g["total_itens"] for g in res["grupos_comprados"])


def test_resumo_respeita_filtro_local_do_item_final():
    base = service.obter_resumo_faltantes({}, session_id="t_resumo")
    assert base["grupos_comprados"], "snapshot sem itens comprados faltantes"
    alvo = base["grupos_comprados"][0]["local"]
    res = service.obter_resumo_faltantes({"local_producao": [alvo]}, session_id="t_resumo")
    # Itens comprados são agrupados pela fábrica consumidora => só o local filtrado
    assert {g["local"] for g in res["grupos_comprados"]} <= {alvo}
    assert res["totais"]["c_itens"] <= base["totais"]["c_itens"]


def test_resumo_ignora_filtro_de_status():
    a = service.obter_resumo_faltantes({}, session_id="t_resumo")
    b = service.obter_resumo_faltantes({"status": "disponivel"}, session_id="t_resumo")
    assert a["totais"] == b["totais"]


def test_resumo_filtro_familias_reduz_itens_comprados():
    fams = service.obter_familias_componentes_3(session_id="t_resumo")
    assert fams
    base = service.obter_resumo_faltantes({}, session_id="t_resumo")
    cod = fams[0].get("familia") or fams[0].get("grupo") or fams[0].get("codigo")
    res = service.obter_resumo_faltantes({"familias": [cod]}, session_id="t_resumo")
    assert res["totais"]["c_itens"] <= base["totais"]["c_itens"]


def test_exportar_resumo_gera_xlsx():
    res = service.exportar_resumo_faltantes_excel({}, session_id="t_resumo")
    assert res.get("status") == "ok"
    assert res["nome"].endswith(".xlsx")


def test_matriz_faltantes_retorna_saldos_ops_abertura_d1():
    res = service.obter_matriz_faltantes_producao({}, session_id="t_matriz_ops")
    linhas = res.get("linhas_planas") or []
    assert linhas, "snapshot sem componentes produzidos faltantes na matriz"

    corte = (datetime.now().date() + timedelta(days=1)).isoformat()
    ops_map = service._enriquecimento.get("op_por_item_todos", {})

    verificados = 0
    for row in linhas[:30]:
        assert "op_saldo_ate_d1" in row
        assert "op_saldo_apos_d1" in row
        it = row["item"]
        ops = ops_map.get(it, [])
        esp_ate = 0.0
        esp_apos = 0.0
        for op in ops:
            s = float(op.get("saldo_op") or 0.0)
            if s <= 0:
                continue
            dt_sort = str(op.get("data_abertura_sort") or "")
            if dt_sort and dt_sort != "9999-12-31" and (dt_sort <= corte or dt_sort.startswith("2030-")):
                esp_ate += s
            else:
                esp_apos += s
        assert row["op_saldo_ate_d1"] == round(esp_ate, 2)
        assert row["op_saldo_apos_d1"] == round(esp_apos, 2)
        verificados += 1

    assert verificados > 0


def test_exportar_matriz_excel_inclui_colunas_saldo_ops():
    res = service.exportar_matriz_faltantes_excel({}, session_id="t_matriz_ops")
    assert res.get("status") == "ok"
    arq = settings.EXPORTS_DIR / res["nome"]
    assert arq.exists()
    df_xlsx = pd.read_excel(arq)
    cols = list(df_xlsx.columns)
    col_ate = "Saldo da ops do item com abertura menor ou igual a hoje+1"
    col_apos = "Saldo das OPs com abertura maior que hoje+1"
    assert "Total Faltante" in cols
    assert col_ate in cols
    assert col_apos in cols
    idx_tot = cols.index("Total Faltante")
    assert cols.index(col_ate) == idx_tot + 1
    assert cols.index(col_apos) == idx_tot + 2


def test_prioridade_2030_fila_e_filtro_abertura():
    itens_full, _, _ = service._obter_fila_calculada(session_id="t_prio_2030")
    mask_2030 = itens_full["_dt_abertura_sort"].dt.year == 2030
    qtd_2030 = int(mask_2030.sum())
    assert qtd_2030 > 0, "snapshot sem OPs em 2030 para validar prioridade"

    # Todos os itens com abertura em 2030 devem ocupar as primeiras posições da fila
    assert bool(mask_2030.iloc[:qtd_2030].all())
    assert not bool(mask_2030.iloc[qtd_2030:].any())

    # Filtro por abertura_op com data_fim anterior a 2030 deve incluir os itens 2030 (atraso),
    # mantendo a exibicao da pagina ordenada cronologicamente por Data de Abertura
    res_filt = service.analisar_itens_finais(
        filtros={"tipo_data": "abertura_op", "data_fim": "2026-12-31"},
        page=0,
        page_size=20000,
        session_id="t_prio_2030",
    )
    assert res_filt["metricas"]["total_itens_finais"] >= qtd_2030
    itens_exib = res_filt["itens"]
    assert sum(1 for it in itens_exib if str(it.get("data_abertura") or "").endswith("2030")) == qtd_2030

    datas_exib = [
        datetime.strptime(it["data_abertura"], "%d/%m/%Y")
        for it in itens_exib
        if it.get("data_abertura")
    ]
    assert datas_exib == sorted(datas_exib)
    assert datas_exib[0].year < 2030


def test_analisar_todas_ops_inclui_kit_5KITASAH1FEB11_sem_dupla_contagem():
    res_padrao = service.analisar_itens_finais(
        filtros={"todas_ops": False, "codigo": "5KITASAH1FEB11"},
        page=0,
        page_size=50,
        session_id="t_todas_ops",
    )
    assert res_padrao["total_registros"] == 0

    res_todas = service.analisar_itens_finais(
        filtros={"todas_ops": True, "codigo": "5KITASAH1FEB11"},
        page=0,
        page_size=50,
        session_id="t_todas_ops",
    )
    assert res_todas["todas_ops"] is True
    assert res_todas["total_registros"] >= 1
    hit = next((it for it in res_todas["itens"] if it["ordem_op"] == "2003104"), None)
    assert hit is not None
    assert hit["item_final"] == "5KITASAH1FEB11"
    assert hit["fabrica"] == "KIT"
    assert hit["eh_raiz"] is False
    assert hit["item_final_pai"] == "1QUCASA187270H"
    assert hit["total_componentes"] == 66

    res_all_count = service.analisar_itens_finais(
        filtros={"todas_ops": True},
        page=0,
        page_size=10,
        session_id="t_todas_ops",
    )
    assert res_all_count["total_registros"] > 10000

    det = service.obter_detalhes_item_final(
        raiz_item_final="5KITASAH1FEB11",
        raiz_pedido="195425",
        raiz_fabrica="KIT",
        ordem_op="2003104",
        todas_ops=True,
        session_id="t_todas_ops",
    )
    assert "erro" not in det
    assert det["ordem_op"] == "2003104"
    assert det["total_componentes"] == 66
    assert det["todas_ops"] is True

    exp = service.exportar_analise_excel(
        filtros={"todas_ops": True, "local_producao": ["KIT"]},
        session_id="t_todas_ops",
    )
    assert exp.get("status") == "ok"
    df_xlsx = pd.read_excel(settings.EXPORTS_DIR / exp["nome"])
    assert "OP" in df_xlsx.columns
    assert "Tipo Ordem" in df_xlsx.columns


def test_resumo_faltantes_visao_por_local_item_pedido():
    res = service.obter_resumo_faltantes(
        {"visao": "por_item_pedido", "local_producao": ["PLANEJADOS"]},
        session_id="t_visao_local",
    )
    assert res["visao"] == "por_item_pedido"
    grupos = res.get("grupos_por_local_item") or []
    assert grupos
    assert {g["local"] for g in grupos} == {"PLANEJADOS"}
    for g in grupos:
        for it in g["itens"]:
            assert it["faltantes"]
            assert all(f["falta"] > 0 for f in it["faltantes"])

    res_kit = service.obter_resumo_faltantes(
        {
            "visao": "por_item_pedido",
            "todas_ops": True,
            "local_producao": ["KIT"],
            "codigo": "5KITASAH1FEB11",
        },
        session_id="t_visao_local",
    )
    grupos_kit = res_kit.get("grupos_por_local_item") or []
    assert len(grupos_kit) == 1
    assert grupos_kit[0]["local"] == "KIT"
    item_5k = next(
        (x for x in grupos_kit[0]["itens"] if x["item_final"] == "5KITASAH1FEB11" and x["ordem_op"] == "2003104"),
        None,
    )
    assert item_5k is not None
    assert item_5k["pedido"] == "195425"
    assert len(item_5k["faltantes"]) == item_5k["total_faltando"] > 0

    exp = service.exportar_resumo_faltantes_excel(
        {"visao": "por_item_pedido", "todas_ops": True, "local_producao": ["KIT"], "codigo": "5KITASAH1FEB11"},
        session_id="t_visao_local",
    )
    assert exp.get("status") == "ok"
    xl = pd.ExcelFile(settings.EXPORTS_DIR / exp["nome"])
    assert "Por Local e Item-Pedido" in xl.sheet_names


def test_pedidos_100_e_1000_desconsiderados_em_todos_os_escopos():
    df_base = service.obter_cons_com_cache(recarregar=False)
    peds_proib_int = {100, 1000}
    peds_proib_str = {"100", "1000"}

    if "Pedido" in df_base.columns:
        assert not pd.to_numeric(df_base["Pedido"], errors="coerce").isin(peds_proib_int).any()
    if "raiz_Pedido" in df_base.columns:
        assert not pd.to_numeric(df_base["raiz_Pedido"], errors="coerce").isin(peds_proib_int).any()
    assert not df_base["raiz_Pedido_Str"].astype(str).str.strip().isin(peds_proib_str).any()

    itens_padrao, _, _ = service._obter_fila_calculada(todas_ops=False, session_id="t_ped_ign")
    itens_todas, _, _ = service._obter_fila_calculada(todas_ops=True, session_id="t_ped_ign")
    assert not itens_padrao["raiz_Pedido_Str"].astype(str).str.strip().isin(peds_proib_str).any()
    assert not itens_todas["raiz_Pedido_Str"].astype(str).str.strip().isin(peds_proib_str).any()

    # Confirma que as OPs originalmente com pedido 100/1000 continuam presentes, apenas com pedido vazio
    snap_dir = snapshots.localizar_snapshot(tentar_sync=False)
    df_ord = pl.read_parquet(snap_dir / "ordens.parquet").to_pandas()
    df_cons = pl.read_parquet(snap_dir / "cons.parquet").to_pandas()
    col_ord = "Ordem" if "Ordem" in df_ord.columns else "Ordem Prod"
    col_op = "OP" if "OP" in df_cons.columns else "Ordem Cons"
    ops_cons_validas = set(df_cons[col_op].fillna("").astype(str).str.strip().str.removesuffix(".0"))
    mask_100_1000 = pd.to_numeric(df_ord["Pedido"], errors="coerce").isin(peds_proib_int)
    ops_100_1000 = {
        op
        for op in df_ord.loc[mask_100_1000, col_ord].fillna("").astype(str).str.strip().str.removesuffix(".0")
        if op and op in ops_cons_validas
    }
    assert len(ops_100_1000) > 0, "snapshot sem OPs 100/1000 com consumo para validar preservacao"

    sub_preservadas = itens_todas[itens_todas["ordem_op"].astype(str).isin(ops_100_1000)]
    assert ops_100_1000 <= set(sub_preservadas["ordem_op"].astype(str))
    assert (sub_preservadas["raiz_Pedido_Str"].astype(str).str.strip() == "").all()

    exemplo = sub_preservadas.iloc[0]
    det = service.obter_detalhes_item_final(
        raiz_item_final=str(exemplo["raiz_Item Final"]),
        raiz_pedido="",
        ordem_op=str(exemplo["ordem_op"]),
        todas_ops=True,
        session_id="t_ped_ign",
    )
    assert "erro" not in det
    assert det["pedido"] == ""

    assert not any(
        ped in peds_proib_str for (_, ped) in service._enriquecimento.get("op_por_item_pedido", {}).keys()
    )

    assert "erro" in service.obter_resumo_pedido(pedido="100", session_id="t_ped_ign")
    assert "erro" in service.obter_resumo_pedido(pedido="1000", session_id="t_ped_ign")

    res_falt = service.obter_resumo_faltantes(
        {"visao": "por_item_pedido", "todas_ops": True},
        session_id="t_ped_ign",
    )
    for grp in res_falt.get("grupos_por_local_item") or []:
        for it in grp.get("itens") or []:
            assert it.get("pedido") not in peds_proib_str
