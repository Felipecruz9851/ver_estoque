"""
Suite de testes para o filtro de famílias de componentes (itens iniciados em 3).
"""

import sys
from pathlib import Path
import pytest

_backend_dir = str(Path(__file__).resolve().parent.parent / "backend")
if _backend_dir not in sys.path:
    sys.path.insert(0, _backend_dir)

import service


def test_obter_familias_componentes_3():
    """Valida a extração e agregação de famílias dos componentes iniciados em 3."""
    familias = service.obter_familias_componentes_3()
    assert isinstance(familias, list)
    assert len(familias) > 0

    # Verifica estrutura de cada família
    codigos = set()
    for fam in familias:
        assert "familia" in fam
        assert "grupo" in fam
        assert "total_itens" in fam
        assert fam["total_itens"] > 0
        codigos.add(fam["familia"])

    # Famílias industriais clássicas de insumos Líder (iniciados em 3)
    assert "CST" in codigos
    assert "FEC" in codigos
    assert "EMB" in codigos


def test_analisar_itens_finais_filtro_familias():
    """Valida o recálculo do MRP ao filtrar por famílias específicas de itens 3."""
    # 1. Sem filtro: cálculo padrão completo
    res_todos = service.analisar_itens_finais(filtros={}, page=0, page_size=20)
    assert "familias_componentes_3" in res_todos
    assert len(res_todos["familias_componentes_3"]) > 0

    total_geral = res_todos["metricas"]["total_itens_finais"]
    disp_geral = res_todos["metricas"]["total_disponiveis"]
    falta_geral = res_todos["metricas"]["total_com_falta"]
    assert total_geral == disp_geral + falta_geral

    # 2. Com filtro de família CST (tecidos customizados)
    res_cst = service.analisar_itens_finais(filtros={"familias": ["CST"]}, page=0, page_size=20)
    assert "metricas" in res_cst
    met_cst = res_cst["metricas"]
    assert met_cst["total_itens_finais"] == total_geral

    # O número de disponíveis considerando apenas CST deve ser significativamente maior
    # do que considerando todos os insumos (pois quem não usa CST ou tem CST fica 100% disponível)
    assert met_cst["total_disponiveis"] >= disp_geral


def test_obter_detalhes_item_com_filtro_familia():
    """Valida que a tela de detalhes de insumos respeita o filtro de famílias de itens 3."""
    # Busca um item que tenha componentes faltantes
    res = service.analisar_itens_finais(filtros={"status": "falta", "familias": ["CST"]}, page=0, page_size=5)
    if not res["itens"]:
        return

    alvo = res["itens"][0]
    detalhes = service.obter_detalhes_item_final(
        raiz_item_final=alvo["item_final"],
        raiz_pedido=alvo["pedido"],
        raiz_fabrica=alvo["fabrica"],
        familias=["CST"],
    )

    assert "gerencial_faltando" in detalhes
    ger = detalhes["gerencial_faltando"]
    mps = ger.get("materias_primas", [])

    # Todas as matérias-primas retornadas devem ser da família CST e começar com 3
    for mp in mps:
        assert str(mp["item"]).startswith("3")
        assert mp.get("eh_cst") is True or str(mp.get("familia") or "").upper() == "CST"


def test_obter_resumo_pedido_com_filtro_familia():
    """Valida que a tela de resumo de pedido respeita o filtro de famílias de itens 3."""
    res = service.analisar_itens_finais(filtros={"status": "falta", "familias": ["CST"]}, page=0, page_size=5)
    if not res["itens"]:
        return

    alvo = res["itens"][0]
    if not alvo.get("pedido"):
        return

    resumo = service.obter_resumo_pedido(
        pedido=alvo["pedido"],
        item_final=alvo["item_final"],
        fabrica=alvo["fabrica"],
        familias=["CST"],
    )

    assert "gerencial_faltando" in resumo
    ger = resumo["gerencial_faltando"]
    mps = ger.get("materias_primas", [])
    for mp in mps:
        assert str(mp["item"]).startswith("3")
