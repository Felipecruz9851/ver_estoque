import sys
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend import main, scraper, service, settings  # noqa: E402


def test_divisao_fabricas_nome_unilider_corrigido():
    div = service.carregar_divisao_fabricas()
    assert div["metadados_fabricas"]["UNILIDER ACABADOS"]["nome"] == "Unilíder Acabados"


def test_matriz_faltantes_paridade_slim_false_vs_true():
    res_full = service.obter_matriz_faltantes_producao({}, session_id="t_perf_matriz_full", slim=False)
    res_slim = service.obter_matriz_faltantes_producao({}, session_id="t_perf_matriz_slim", slim=True)

    assert res_slim["grupos"] == []
    assert res_slim["totais_gerais"]["total_componentes_distintos"] == res_full["totais_gerais"]["total_componentes_distintos"]
    assert res_slim["totais_gerais"]["soma_falta_geral"] == res_full["totais_gerais"]["soma_falta_geral"]
    assert res_slim["totais_gerais"]["somas_por_prazo"] == res_full["totais_gerais"]["somas_por_prazo"]
    assert res_slim["totais_gerais"]["total_pedidos_afetados"] == res_full["totais_gerais"]["total_pedidos_afetados"]

    # Consolida manualmente res_full por (fabrica_componente, item) como faz o frontend
    esperado = {}
    for row in res_full["linhas_planas"]:
        chave = (row["fabrica_componente"], row["item"])
        if chave not in esperado:
            esperado[chave] = {
                "fabrica_componente": row["fabrica_componente"],
                "item": row["item"],
                "descricao": row["descricao"],
                "falta_por_prazo": dict(row["falta_por_prazo"]),
                "falta_total": round(float(row["falta_total"]), 2),
                "op_saldo_ate_d1": round(float(row["op_saldo_ate_d1"]), 2),
                "op_saldo_apos_d1": round(float(row["op_saldo_apos_d1"]), 2),
            }
        else:
            acc = esperado[chave]
            for pk, pv in row["falta_por_prazo"].items():
                acc["falta_por_prazo"][pk] = round(acc["falta_por_prazo"].get(pk, 0.0) + float(pv), 2)
            acc["falta_total"] = round(acc["falta_total"] + float(row["falta_total"]), 2)
            # Saldo OP D+1 pertence ao item e não deve ser somado/duplicado por fábrica-pai
            assert acc["op_saldo_ate_d1"] == round(float(row["op_saldo_ate_d1"]), 2)
            assert acc["op_saldo_apos_d1"] == round(float(row["op_saldo_apos_d1"]), 2)

    obtido = {(r["fabrica_componente"], r["item"]): r for r in res_slim["linhas_planas"]}
    assert set(obtido.keys()) == set(esperado.keys())
    for chave, exp_row in esperado.items():
        got_row = obtido[chave]
        assert set(got_row.keys()) == {
            "fabrica_componente",
            "item",
            "descricao",
            "falta_por_prazo",
            "falta_total",
            "op_saldo_ate_d1",
            "op_saldo_apos_d1",
        }
        assert got_row == exp_row


def test_cache_mrp_2_camadas_baixa_e_tipo_paridade():
    service.obter_cons_com_cache(recarregar=False)
    itens_base, comp_base, _ = service._obter_fila_calculada(
        baixa_filtro="TODOS",
        tipo_filtro="TODOS",
        session_id="t_perf_camada2_a",
    )
    assert not itens_base.empty
    assert not comp_base.empty

    for baixa in ("S", "N"):
        for tipo in ("P", "C"):
            itens_f, comp_f, _ = service._obter_fila_calculada(
                baixa_filtro=baixa,
                tipo_filtro=tipo,
                session_id="t_perf_camada2_b",
            )
            esp_comp = comp_base[
                (comp_base["Baixa"].astype(str).str.upper() == baixa)
                & (comp_base["Tipo"].astype(str).str.upper() == tipo)
            ]
            assert len(comp_f) == len(esp_comp)
            assert int(itens_f["total_componentes"].sum()) == len(esp_comp)
            assert int(itens_f["componentes_disponiveis"].sum()) == int(esp_comp["Disponivel"].sum())
            assert int(itens_f["componentes_faltando"].sum()) == int((~esp_comp["Disponivel"]).sum())


def test_resumo_faltantes_visao_por_item_pedido_mantem_totais_sem_grupos_insumo():
    res_insumo = service.obter_resumo_faltantes(
        {"visao": "por_insumo"},
        session_id="t_perf_resumo_insumo",
    )
    res_pedido = service.obter_resumo_faltantes(
        {"visao": "por_item_pedido"},
        session_id="t_perf_resumo_pedido",
    )

    assert res_pedido["visao"] == "por_item_pedido"
    assert res_pedido["grupos_produzidos"] == []
    assert res_pedido["grupos_comprados"] == []
    assert res_pedido["grupos_por_local_item"]
    assert res_pedido["totais"] == res_insumo["totais"]


def test_analisar_itens_finais_paginacao_e_cache_view():
    p0 = service.analisar_itens_finais(filtros={}, page=0, page_size=10, session_id="t_perf_pag")
    p1 = service.analisar_itens_finais(filtros={}, page=1, page_size=10, session_id="t_perf_pag")

    assert "divisao_fabricas" in p0
    assert "familias_componentes_3" in p0
    assert "divisao_fabricas" not in p1
    assert "familias_componentes_3" not in p1
    assert p0["metricas"] == p1["metricas"]
    assert p0["total_registros"] == p1["total_registros"]
    assert len(p0["itens"]) == 10
    assert len(p1["itens"]) == 10
    assert p0["itens"][-1]["posicao_fila"] != p1["itens"][0]["posicao_fila"]


def test_gzip_cache_control_e_cookie_httponly_via_testclient():
    client = TestClient(main.app)

    # 1. Rota index / e /ver_estoque -> Cache-Control: no-cache e cookie HttpOnly
    index_html = settings.FRONTEND_DIST / "index.html"
    if index_html.exists():
        r_root = client.get("/", headers={"Accept-Encoding": "gzip"})
        assert r_root.status_code == 200
        assert r_root.headers.get("cache-control") == "no-cache"
        set_cookie_hdr = r_root.headers.get("set-cookie", "").lower()
        assert "ver_estoque_session=" in set_cookie_hdr
        assert "httponly" in set_cookie_hdr

        r_ve = client.get("/ver_estoque", headers={"Accept-Encoding": "gzip"})
        assert r_ve.status_code == 200
        assert r_ve.headers.get("cache-control") == "no-cache"

    # 2. Assets estáticos -> Cache-Control imutável e GZip quando >= 1000 bytes
    assets_dir = settings.FRONTEND_DIST / "assets"
    js_assets = sorted(assets_dir.glob("*.js")) if assets_dir.exists() else []
    if js_assets:
        r_asset = client.get(f"/assets/{js_assets[0].name}", headers={"Accept-Encoding": "gzip"})
        assert r_asset.status_code == 200
        assert r_asset.headers.get("cache-control") == "public, max-age=31536000, immutable"
        assert r_asset.headers.get("content-encoding") == "gzip"

    # 3. Endpoint /api/call/obter_estoque_itens_finais -> GZip para payload > 1000 bytes + HttpOnly
    r_api = client.post(
        "/api/call/obter_estoque_itens_finais",
        json={"payload": {"filtros": {}, "page": 0, "page_size": 25}},
        headers={"Accept-Encoding": "gzip"},
    )
    assert r_api.status_code == 200
    assert r_api.headers.get("content-encoding") == "gzip"
    data_api = r_api.json()
    assert len(data_api.get("itens", [])) == 25

    # 4. Endpoint /api/call/obter_matriz_faltantes_producao usa slim=True
    r_mat = client.post(
        "/api/call/obter_matriz_faltantes_producao",
        json={"payload": {"filtros": {}}},
        headers={"Accept-Encoding": "gzip"},
    )
    assert r_mat.status_code == 200
    data_mat = r_mat.json()
    assert data_mat.get("grupos") == []
    assert "linhas_planas" in data_mat


def test_swr_retorna_cache_imediato_e_dispara_background(monkeypatch):
    service.obter_cons_com_cache(recarregar=False)
    chamadas_bg = []

    monkeypatch.setattr(scraper, "cache_oc_expirado", lambda *a, **kw: True)
    monkeypatch.setattr(
        service,
        "_agendar_refresh_oc_background",
        lambda: chamadas_bg.append(True),
    )

    df = service.obter_cons_com_cache(recarregar=False, forcar_oc=False)
    assert not df.empty
    assert chamadas_bg == [True]
