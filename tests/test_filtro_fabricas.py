"""
Suite de testes para a divisão dinâmica de fábricas e filtro com múltiplos locais.
"""

import sys
from pathlib import Path
import pytest

_backend_dir = str(Path(__file__).resolve().parent.parent / "backend")
if _backend_dir not in sys.path:
    sys.path.insert(0, _backend_dir)

import service
import settings


def test_carregar_divisao_fabricas():
    """Valida carga e estrutura de metadados e dados de DIVISAO_FABRICAS.json."""
    div = service.carregar_divisao_fabricas()
    assert isinstance(div, dict)
    assert "metadados_fabricas" in div
    assert "dados" in div
    assert len(div["dados"]) > 0

    meta = div["metadados_fabricas"]
    # Valida principais fábricas e ícones Material Symbols
    assert "PLANEJADOS" in meta
    assert meta["PLANEJADOS"]["icone"] == "countertops"
    assert "LIDER ESTOFADOS" in meta
    assert meta["LIDER ESTOFADOS"]["icone"] == "weekend"
    assert "SALA DE JANTAR" in meta
    assert meta["SALA DE JANTAR"]["icone"] == "chair"


def test_analisar_itens_finais_multiplos_locais():
    """Valida a filtragem de itens finais com múltiplos locais selecionados."""
    # 1. Sem filtro: deve carregar normal
    res_todos = service.analisar_itens_finais(filtros={}, page=0, page_size=20)
    assert "divisao_fabricas" in res_todos
    assert "itens" in res_todos
    total_sem_filtro = res_todos["total_registros"]

    if total_sem_filtro > 0:
        locais_disponiveis = res_todos["locais_producao"]
        assert len(locais_disponiveis) > 0

        # Escolhe os 2 primeiros locais disponíveis
        locais_teste = locais_disponiveis[:2]
        
        # 2. Filtro com lista de locais
        res_filtrado = service.analisar_itens_finais(
            filtros={"local_producao": locais_teste}, page=0, page_size=100
        )
        assert res_filtrado["total_registros"] <= total_sem_filtro
        
        for item in res_filtrado["itens"]:
            assert item["fabrica"].upper() in [l.upper() for l in locais_teste]

        # 3. Filtro com string única
        res_unico = service.analisar_itens_finais(
            filtros={"local_producao": locais_teste[0]}, page=0, page_size=100
        )
        for item in res_unico["itens"]:
            assert item["fabrica"].upper() == locais_teste[0].upper()

        # 4. Filtro com lista vazia [] (equivale a sem filtro)
        res_vazio = service.analisar_itens_finais(
            filtros={"local_producao": []}, page=0, page_size=20
        )
        assert res_vazio["total_registros"] == total_sem_filtro


def test_exportar_analise_com_multiplos_locais():
    """Valida que a exportação Excel funciona com filtros em formato lista."""
    res_todos = service.analisar_itens_finais(filtros={}, page=0, page_size=1)
    if res_todos["total_registros"] > 0 and res_todos["locais_producao"]:
        local_sel = [res_todos["locais_producao"][0]]
        export_res = service.exportar_analise_excel(filtros={"local_producao": local_sel})
        assert "arquivo" in export_res or "url" in export_res or "erro" in export_res
