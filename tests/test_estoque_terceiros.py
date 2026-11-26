import json
import os
import sys
from pathlib import Path

import pandas as pd
import polars as pl
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend import calculo, scraper, service, settings, snapshots  # noqa: E402


def test_filtrar_estoque_valido_exclui_terceiros_preserva_hifens_e_nulos():
    df = pd.DataFrame(
        {
            "Item": ["I1", "I2", "I3", "I4", "I5", "I6", "I7", "I8"],
            "Local - Sit": [
                "TERCEIROS  - L",
                "TERCEIROS - B",
                "terceiros",
                "UL-ALMOX05 - L",
                "UL-ALMOX05",
                "PRODUTO    - L",
                None,
                float("nan"),
            ],
            "Qtde.": ["10,00", "5,00", "3,00", "7,00", "8,00", "9,00", "1,00", "2,00"],
        }
    )

    res = calculo.filtrar_estoque_valido(df)
    assert list(res["Item"]) == ["I4", "I5", "I6", "I7", "I8"]

    # Também aceita Polars DataFrame
    res_pl = calculo.filtrar_estoque_valido(pl.from_pandas(df))
    assert isinstance(res_pl, pd.DataFrame)
    assert list(res_pl["Item"]) == ["I4", "I5", "I6", "I7", "I8"]


def test_filtrar_estoque_valido_sem_coluna_local_e_none():
    assert calculo.filtrar_estoque_valido(None).empty

    df_sem_local = pd.DataFrame({"Item": ["A", "B"], "Qtde.": ["10,00", "20,00"]})
    res = calculo.filtrar_estoque_valido(df_sem_local)
    assert len(res) == 2
    assert list(res["Item"]) == ["A", "B"]

    # Fallback para coluna "Local Estoque" / "Local"
    df_alt = pd.DataFrame(
        {
            "Item": ["A", "B"],
            "Local Estoque": ["TERCEIROS  - L", "UL-ALMOX05 - L"],
            "Qtde.": ["10,00", "20,00"],
        }
    )
    res_alt = calculo.filtrar_estoque_valido(df_alt)
    assert list(res_alt["Item"]) == ["B"]


def test_calc_data_exclui_terceiros_de_estoque_e_preserva_outros_locais():
    ordens = pd.DataFrame(
        {
            "Cliente": ["CLI1"],
            "Fábrica": ["FAB1"],
            "Ordem": ["100"],
            "Pedido": [50001],
            "Item": ["1PAI"],
            "Saldo": ["1,00"],
            "Representante": [1],
            "Entrega Pedido": ["20/12/2026"],
            "Data Abertura": ["10/11/2026"],
        }
    )
    cons = pd.DataFrame(
        {
            "Tipo": ["C", "C", "C"],
            "Item": ["3MISTO", "3SOTERC", "3ALMOX"],
            "Baixa": ["S", "S", "S"],
            "Consumo": ["2,00", "3,00", "4,00"],
            "Local Prod.": ["FAB1", "FAB1", "FAB1"],
            "OP": ["100", "100", "100"],
            "Familia": ["F1", "F1", "F1"],
            "Den. Item": ["ITEM MISTO", "ITEM SO TERCEIROS", "ITEM ALMOX HIFEN"],
        }
    )
    estoque = pd.DataFrame(
        {
            "Item": ["3MISTO-UN", "3MISTO", "3SOTERC", "3ALMOX"],
            "Local - Sit": [
                "UL-ALMOX05 - L",
                "TERCEIROS  - L",
                "TERCEIROS  - L",
                "UL-ALMOX05 - L",
            ],
            "Qtde.": ["10,00", "25,00", "40,00", "7,50"],
        }
    )

    df_consumo = calculo.calc_data({"ordens": ordens, "cons": cons, "estoque": estoque})
    est_por_item = df_consumo.set_index("Item")["estoque"].to_dict()

    assert est_por_item["3MISTO"] == 10.0
    assert est_por_item["3SOTERC"] == 0.0
    assert est_por_item["3ALMOX"] == 7.5


def test_construir_mapas_enriquecimento_exclui_saldo_terceiros_preserva_metadados(monkeypatch):
    monkeypatch.setattr(
        scraper,
        "carregar_ou_atualizar_intranet_concorrente",
        lambda *args, **kwargs: ([], []),
    )

    estoque = pd.DataFrame(
        {
            "Item": ["3MISTO", "3MISTO", "3SOTERC"],
            "Local - Sit": ["UL-ALMOX05 - L", "TERCEIROS  - L", "TERCEIROS  - L"],
            "Qtde.": ["12,00", "8,00", "15,00"],
            "Descrição": ["DESC MISTO", "DESC MISTO", "ITEM APENAS TERCEIROS"],
            "Local Prod.": ["FAB1", "FAB1", "FAB_TERC"],
            "Sofre Baixa?": ["Sim", "Sim", "Não"],
        }
    )
    df_consumo = pd.DataFrame(columns=["Item", "Tipo", "Baixa", "Local Prod.", "Familia", "Den. Item"])

    enr = service._construir_mapas_enriquecimento(
        {"estoque": estoque},
        df_consumo,
        forcar_oc=False,
    )

    assert enr["estoque"]["3MISTO"] == 12.0
    assert enr["estoque"].get("3SOTERC", 0.0) == 0.0
    assert enr["desc_item"]["3SOTERC"] == "ITEM APENAS TERCEIROS"
    assert enr["local_prod"]["3SOTERC"] == "FAB_TERC"
    assert enr["baixa"]["3SOTERC"] == "N"


def test_cache_cons_invalida_quando_meta_ausente_ou_desatualizada(tmp_path, monkeypatch):
    snap_dir = tmp_path / "snapshot_teste"
    snap_dir.mkdir(parents=True, exist_ok=True)

    ordens = pd.DataFrame(
        {
            "Cliente": ["CLI1"],
            "Fábrica": ["FAB1"],
            "Ordem": ["100"],
            "Pedido": [50001],
            "Item": ["1PAI"],
            "Descrição do Item": ["PRODUTO PAI"],
            "Saldo": ["1,00"],
            "Representante": [1],
            "Entrega Pedido": ["20/12/2026"],
            "Data Abertura": ["10/11/2026"],
            "Data Entrega": ["20/12/2026"],
        }
    )
    cons = pd.DataFrame(
        {
            "Tipo": ["C"],
            "Item": ["3COMP"],
            "Baixa": ["S"],
            "Consumo": ["2,00"],
            "Local Prod.": ["FAB1"],
            "OP": ["100"],
            "Familia": ["F1"],
            "Den. Item": ["COMPONENTE"],
        }
    )
    estoque = pd.DataFrame(
        {
            "Item": ["3COMP", "3COMP"],
            "Local - Sit": ["UL-ALMOX05 - L", "TERCEIROS  - L"],
            "Qtde.": ["6,00", "30,00"],
            "Descrição": ["COMPONENTE", "COMPONENTE"],
            "Local Prod.": ["FAB1", "FAB1"],
            "Sofre Baixa?": ["Sim", "Sim"],
        }
    )

    pl.from_pandas(ordens).write_parquet(snap_dir / "ordens.parquet")
    pl.from_pandas(cons).write_parquet(snap_dir / "cons.parquet")
    pl.from_pandas(estoque).write_parquet(snap_dir / "estoque.parquet")
    dfs_fake = {"ordens": ordens, "cons": cons, "estoque": estoque}

    # Preserva e restaura estado global do serviço após o teste isolado
    for attr in (
        "_cache_cons",
        "_cache_timestamp",
        "_cache_data_calculo",
        "_cache_snapshot_nome",
        "_cache_data_snapshot",
        "_cache_data_oc",
        "_enriquecimento",
        "_cache_familias_3",
    ):
        monkeypatch.setattr(service, attr, getattr(service, attr))

    monkeypatch.setattr(settings, "SNAPSHOTS_AUTO_SYNC", False)
    monkeypatch.setattr(service, "carregar_snapshot", lambda: (dfs_fake, snap_dir))
    monkeypatch.setattr(service, "data_snapshot", lambda p: "26/11/2026 12:00:00")
    monkeypatch.setattr(scraper, "cache_oc_expirado", lambda *a, **kw: False)
    monkeypatch.setattr(scraper, "obter_data_cache_oc", lambda: "26/11/2026 12:00:00")
    monkeypatch.setattr(
        scraper,
        "carregar_ou_atualizar_intranet_concorrente",
        lambda *args, **kwargs: ([], []),
    )

    cache_pqt = snap_dir / "_cons_calculado.parquet"
    cache_meta = snap_dir / "_cons_calculado.meta.json"

    def _escrever_cache_stale(valor_estoque: float) -> None:
        df_stale = calculo.calc_data(dfs_fake)
        df_stale["raiz_Descricao"] = "PRODUTO PAI"
        df_stale["raiz_Pedido_Str"] = "50001"
        df_stale["estoque"] = valor_estoque
        df_stale["simulado"] = False
        df_stale["origem_simulacao"] = ""
        pl.from_pandas(df_stale).write_parquet(cache_pqt)
        src_max = max(f.stat().st_mtime for f in snap_dir.glob("*.parquet") if not f.name.startswith("_"))
        os.utime(cache_pqt, (src_max + 5.0, src_max + 5.0))

    # Caso 1: _cons_calculado.meta.json ausente -> deve recalcular e gravar meta.json
    _escrever_cache_stale(999.0)
    assert not cache_meta.exists()

    df_res1 = service.gerar_dataframe_cons(sincronizar_snapshot=False)
    assert float(df_res1.loc[df_res1["Item"] == "3COMP", "estoque"].iloc[0]) == 6.0
    assert cache_meta.exists()
    with open(cache_meta, "r", encoding="utf-8") as f:
        assert json.load(f) == service._CONS_CACHE_RULES

    # Caso 2: _cons_calculado.meta.json com versão antiga -> deve recalcular e atualizar meta.json
    _escrever_cache_stale(888.0)
    with open(cache_meta, "w", encoding="utf-8") as f:
        json.dump({"version": 1, "locais_estoque_desconsiderados": []}, f)

    df_res2 = service.gerar_dataframe_cons(sincronizar_snapshot=False)
    assert float(df_res2.loc[df_res2["Item"] == "3COMP", "estoque"].iloc[0]) == 6.0
    with open(cache_meta, "r", encoding="utf-8") as f:
        assert json.load(f) == service._CONS_CACHE_RULES

    # Caso 3: cache e meta.json válidos -> reutiliza cache sem chamar calc_data
    def _nao_deve_recalcular(*args, **kwargs):
        raise AssertionError("calc_data não deveria ser chamado quando o cache e meta.json são válidos")

    monkeypatch.setattr(service, "calc_data", _nao_deve_recalcular)
    df_res3 = service.gerar_dataframe_cons(sincronizar_snapshot=False)
    assert float(df_res3.loc[df_res3["Item"] == "3COMP", "estoque"].iloc[0]) == 6.0


def test_integracao_snapshot_real_exclui_estoque_terceiros():
    # Gera/atualiza antes de carregar os parquets para garantir que ambos leiam o mesmo snapshot
    df_consumo = service.gerar_dataframe_cons(sincronizar_snapshot=False)
    dfs, caminho = snapshots.carregar_snapshot()
    raw_est = dfs["estoque"]
    df_est = raw_est.to_pandas() if isinstance(raw_est, pl.DataFrame) else raw_est.copy()
    raw_cons = dfs["cons"]
    df_cons_raw = raw_cons.to_pandas() if isinstance(raw_cons, pl.DataFrame) else raw_cons.copy()

    df_est["_item_norm"] = df_est["Item"].astype(str).str.split("-").str[0].str.strip()
    df_est["_qt"] = calculo.parse_numero_br_series(df_est["Qtde."])
    cons_items = set(df_cons_raw["Item"].astype(str).str.split("-").str[0].str.strip())

    mask_terc = df_est["Local - Sit"].fillna("").astype(str).str.strip().str.upper().str.startswith("TERCEIROS")
    itens_terc_pos = set(df_est.loc[mask_terc & (df_est["_qt"] > 0), "_item_norm"])
    itens_alvo = sorted(cons_items & itens_terc_pos)
    assert itens_alvo, "Snapshot real não possui itens em comum entre cons e TERCEIROS  - L com saldo > 0"

    soma_bruta = df_est.groupby("_item_norm")["_qt"].sum().round(2).to_dict()
    df_est_sem_terc = calculo.filtrar_estoque_valido(df_est)
    soma_filtrada = df_est_sem_terc.groupby("_item_norm")["_qt"].sum().round(2).to_dict()

    est_df_map = df_consumo.drop_duplicates("Item").set_index("Item")["estoque"].to_dict()
    enr_est_map = service._enriquecimento["estoque"]

    verificados = 0
    for item in itens_alvo:
        esp_filtrado = round(float(soma_filtrada.get(item, 0.0)), 2)
        esp_bruto = round(float(soma_bruta.get(item, 0.0)), 2)
        assert esp_filtrado < esp_bruto

        if item in est_df_map:
            assert round(float(est_df_map[item]), 2) == esp_filtrado
            assert round(float(est_df_map[item]), 2) < esp_bruto
            verificados += 1

        item_norm_enr = scraper.normalizar_cod_item(item)
        assert round(float(enr_est_map.get(item_norm_enr, 0.0)), 2) == esp_filtrado
        assert round(float(enr_est_map.get(item_norm_enr, 0.0)), 2) < esp_bruto

    assert verificados > 0, "Nenhum item de TERCEIROS apareceu no df_consumo calculado"

    # Valida também na fila calculada (_obter_fila_calculada)
    _, comp_agg, _ = service._obter_fila_calculada(
        todas_ops=True,
        session_id="t_integracao_terceiros",
    )
    if not comp_agg.empty:
        comp_nao_cst = comp_agg[~comp_agg["eh_cst"].astype(bool)] if "eh_cst" in comp_agg.columns else comp_agg
        comp_alvo = comp_nao_cst[comp_nao_cst["Item"].isin(itens_alvo)].drop_duplicates("Item")
        assert not comp_alvo.empty, "Nenhum item não-CST com estoque em TERCEIROS apareceu na fila"
        for _, row in comp_alvo.iterrows():
            it = row["Item"]
            esp_filtrado = round(float(soma_filtrada.get(it, 0.0)), 2)
            esp_bruto = round(float(soma_bruta.get(it, 0.0)), 2)
            assert round(float(row["estoque"]), 2) == esp_filtrado
            assert round(float(row["estoque"]), 2) < esp_bruto

    meta_path = caminho / "_cons_calculado.meta.json"
    assert meta_path.exists()
