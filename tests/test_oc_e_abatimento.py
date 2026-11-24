import pickle
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend import scraper, service, settings  # noqa: E402


def test_parse_saldo_intranet_nao_infla_decimais():
    assert scraper._parse_saldo_intranet("1.000") == 1.0
    assert scraper._parse_saldo_intranet("12.000") == 12.0
    assert scraper._parse_saldo_intranet("250.500") == 250.5
    assert scraper._parse_saldo_intranet("0.750") == 0.75
    assert scraper._parse_saldo_intranet("1.234,56") == 1234.56
    assert scraper._parse_saldo_intranet("1,234.56") == 1234.56


def test_parse_vidrosoc_html_extrai_oc_e_saldo():
    html = """
    <html><body>
      <table>
        <tr>
          <th>OC</th><th>Item</th><th>Saldo</th><th>Pedido</th>
          <th>Emissão</th><th>Dt Origem</th><th>Dt Entrega</th><th>Fornecedor</th>
        </tr>
        <tr>
          <td>197843</td><td>3ALKIR30X50AV</td><td>4.000</td><td>48120</td>
          <td>10/11/2026</td><td>25/11/2026</td><td>30/11/2026</td><td>VIDROS ALPHA ,</td>
        </tr>
      </table>
    </body></html>
    """
    regs = scraper.parse_vidrosoc_html(html, cod_item_esperado="3ALKIR30X50AV")
    assert len(regs) == 1
    reg = regs[0]
    assert reg["oc_numero"] == "197843"
    assert reg["item"] == "3ALKIR30X50AV"
    assert reg["saldo"] == 4.0
    assert reg["pedido_compra"] == "48120"
    assert reg["emissao_oc"] == "10/11/2026"
    assert reg["data_origem"] == "25/11/2026"
    assert reg["previsao"] == "30/11/2026"
    assert reg["fornecedor"] == "VIDROS ALPHA"
    assert reg["sit_oc"] == "P"


def test_falha_consulta_principal_preserva_cache_anterior(tmp_path, monkeypatch):
    cache_tmp = tmp_path / "oc_abertas_cache.pkl"
    dados_antigos = [
        {
            "oc_numero": "99999",
            "item": "3TESTECACHE",
            "saldo": 5.0,
            "unidade": "UN",
            "sit_oc": "P",
        }
    ]
    with open(cache_tmp, "wb") as f:
        pickle.dump(dados_antigos, f)

    monkeypatch.setattr(settings, "OC_CACHE_FILE", cache_tmp)
    monkeypatch.setattr(scraper, "_oc_cache_validado_mtime", None)
    monkeypatch.setattr(scraper, "_oc_ultima_tentativa_falha_ts", 0.0)

    def _falhar(*args, **kwargs):
        raise RuntimeError("falha simulada na intranet")

    monkeypatch.setattr(scraper, "consultar_oc_abertas_intranet", _falhar)

    res = scraper.carregar_ou_atualizar_oc_abertas(forcar_intranet=True)
    assert res == dados_antigos
    assert cache_tmp.exists()
    assert not cache_tmp.with_suffix(".pkl.tmp").exists()


def test_tipo_f_enriquecido_e_organizado_em_materias_primas(monkeypatch):
    service.obter_cons_com_cache(recarregar=False)
    oc_falsa = {
        "oc_numero": "777001",
        "previsao": "20/12/2026",
        "previsao_sort": "2026-12-20",
        "data_origem": "15/12/2026",
        "emissao_oc": "10/11/2026",
        "saldo": 3.0,
        "fornecedor": "FORNECEDOR F",
        "comprador": "COMPRADOR",
        "pedido_compra": "55100",
        "sit_oc": "P",
        "texto": "",
        "pedido_vinculado": None,
        "item_final_vinculado": None,
    }
    monkeypatch.setitem(service._enriquecimento["oc_por_item_geral"], "3TESTETIPOF", [oc_falsa])
    monkeypatch.setitem(service._enriquecimento["oc_por_item_todas"], "3TESTETIPOF", [oc_falsa])

    info = service._enriquecer_insumo_gerencial(
        comp_item="3TESTETIPOF",
        tipo_comp="F",
        local_prod_raw="",
        op_prod_raw=None,
        raiz_pedido_str="",
        raiz_item_final="1PAI",
    )
    assert info["oc_numero"] == "777001"
    assert info["oc_saldo"] == 3.0
    assert info["oc_previsao"] == "20/12/2026"

    org = service._organizar_insumos_gerencial(
        [
            {
                "item": "3TESTETIPOF",
                "tipo": "F",
                "falta": 1.0,
                "disponivel": False,
                "oc_numero": info["oc_numero"],
                "oc_vinculada_pedido": info["oc_vinculada_pedido"],
            }
        ]
    )
    assert [x["item"] for x in org["materias_primas"]] == ["3TESTETIPOF"]
    assert org["resumo"]["total_materias_primas"] == 1
    assert org["resumo"]["mp_com_oc"] == 1


def test_sync_oc_intranet_saldos_corretos_e_vidrosoc():
    service.gerar_dataframe_cons(forcar_oc=True, sincronizar_snapshot=False)
    oc_map = service._enriquecimento.get("oc_por_item_todas", {})

    ocs_insu = oc_map.get("3INSU079925RV", [])
    assert ocs_insu, "3INSU079925RV sem OCs sincronizadas apos recarga da Intranet"
    assert any(oc.get("saldo") == 1.0 for oc in ocs_insu), f"Saldos inesperados para 3INSU079925RV: {ocs_insu}"
    assert all(oc.get("saldo", 0.0) < 100.0 for oc in ocs_insu), f"Possivel inflacao x1000 em 3INSU079925RV: {ocs_insu}"

    ocs_alkir = oc_map.get("3ALKIR30X50AV", [])
    assert ocs_alkir, "3ALKIR30X50AV nao encontrado via fallback /sup/vidrosoc.php"
    assert any(float(oc.get("saldo") or 0.0) > 0 for oc in ocs_alkir)
    assert service.obter_info_carregamento().get("data_oc")


def _achar_insumo_lista(lista, codigo):
    return next((it for it in lista if str(it.get("item")) == codigo), None)


def test_3PUXCRETA64RS_abatimento_global_vs_filtrado_itens_finais():
    filtros_2026 = {
        "tipo_data": "entrega_pedido",
        "data_fim": "2026-12-31",
        "escopo_abatimento": "filtrado",
    }

    det_global = service.obter_detalhes_item_final(
        raiz_item_final="1AMCOZI757794B",
        raiz_pedido="204583",
        escopo_abatimento="global",
        session_id="t_3pux_itens_finais",
    )
    assert "erro" not in det_global
    assert det_global["escopo_abatimento"] == "global"
    ins_glob = _achar_insumo_lista(det_global["faltando"], "3PUXCRETA64RS")
    assert ins_glob is not None
    assert ins_glob["disponivel"] is False
    assert ins_glob["falta"] == 1.0
    assert ins_glob["saldo_fila"] == 0.0

    det_filt = service.obter_detalhes_item_final(
        raiz_item_final="1AMCOZI757794B",
        raiz_pedido="204583",
        escopo_abatimento="filtrado",
        filtros_escopo=filtros_2026,
        session_id="t_3pux_itens_finais",
    )
    assert "erro" not in det_filt
    assert det_filt["escopo_abatimento"] == "filtrado"
    assert _achar_insumo_lista(det_filt["faltando"], "3PUXCRETA64RS") is None
    ins_filt = _achar_insumo_lista(det_filt["disponiveis"], "3PUXCRETA64RS")
    assert ins_filt is not None
    assert ins_filt["disponivel"] is True
    assert ins_filt["falta"] == 0.0
    assert ins_filt["saldo_fila"] == 1.0

    res_falt = service.obter_resumo_faltantes(filtros_2026, session_id="t_3pux_itens_finais")
    assert res_falt["escopo_abatimento"] == "filtrado"
    itens_falt = [
        it["item"]
        for g in res_falt["grupos_comprados"] + res_falt["grupos_produzidos"]
        for it in g["itens"]
    ]
    assert "3PUXCRETA64RS" not in itens_falt


def test_3PUXCRETA64RS_abatimento_filtrado_todas_ops():
    filtros_2026 = {
        "tipo_data": "entrega_pedido",
        "data_fim": "2026-12-31",
        "todas_ops": True,
        "escopo_abatimento": "filtrado",
    }

    _, comp_glob, _ = service._obter_fila_calculada(
        todas_ops=True,
        escopo_abatimento="global",
        session_id="t_3pux_todas_ops",
    )
    row_glob = comp_glob[
        (comp_glob["Item"] == "3PUXCRETA64RS")
        & (comp_glob["raiz_Pedido_Str"].astype(str) == "204583")
    ]
    assert not row_glob.empty
    assert bool(row_glob.iloc[0]["Disponivel"]) is False
    assert float(row_glob.iloc[0]["Falta"]) == 1.0

    _, comp_filt, _ = service._obter_fila_calculada(
        todas_ops=True,
        escopo_abatimento="filtrado",
        filtros_escopo=filtros_2026,
        session_id="t_3pux_todas_ops",
    )
    row_filt = comp_filt[
        (comp_filt["Item"] == "3PUXCRETA64RS")
        & (comp_filt["raiz_Pedido_Str"].astype(str) == "204583")
    ]
    assert not row_filt.empty
    assert bool(row_filt.iloc[0]["Disponivel"]) is True
    assert float(row_filt.iloc[0]["Falta"]) == 0.0
    assert float(row_filt.iloc[0]["estoque_disp_fila"]) == 1.0
