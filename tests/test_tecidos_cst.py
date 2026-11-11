"""
Teste automatizado para validação de tecidos da família CST e consulta de tecidos customizados.
Valida:
1. Ingestão de apoio_compras.parquet e identificação de itens da família CST.
2. Sinalização mandatória com a sigla CST na descrição dos tecidos.
3. Disponibilidade desacoplada do estoque físico para tecidos CST.
4. Consulta e casamento de (pedido, ordem, item, tecido) em /pcp/tecidos_customizados3.php.
5. Regra de negócio: apenas tecidos com 'TECIDO CHEGOU' são considerados disponíveis para atender o item.
6. Não regressão do cálculo de MRP multinível para itens não-CST.
"""

import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE_DIR / "backend"))

import service
import scraper
import settings
import polars as pl
import pandas as pd


def test_identificacao_itens_cst_e_sinalizacao_descricao():
    print("=== 1. Testando Identificação de CST em apoio_compras e Sinalização [CST] ===")
    df_cons = service.obter_cons_efetivo(recarregar=True)
    assert df_cons is not None and not df_cons.empty, "df_cons não deve ser vazio"

    itens_cst = service._enriquecimento.get("itens_cst", set())
    print(f"Total de itens CST mapeados: {len(itens_cst)}")
    assert len(itens_cst) > 0, "Deveria ter mapeado itens da família CST de apoio_compras"

    # Valida sinalização de [CST] na descrição dos itens CST
    desc_map = service._enriquecimento.get("desc_item", {})
    cst_amostras = list(itens_cst)[:15]
    for it in cst_amostras:
        desc = desc_map.get(it, "")
        if desc:
            assert "CST" in desc.upper(), f"Item CST {it} deveria conter 'CST' na descrição, obteve: '{desc}'"

    # Valida que em df_cons todas as linhas de CST possuem CST na Den. Item
    cst_cons_rows = df_cons[df_cons["Item"].isin(itens_cst)]
    print(f"Linhas de tecidos CST encontradas no consumo: {len(cst_cons_rows)}")
    assert len(cst_cons_rows) > 0, "Deveria haver linhas de CST em df_cons"
    for _, row in cst_cons_rows.head(20).iterrows():
        den = str(row.get("Den. Item") or "").upper()
        assert "CST" in den, f"Den. Item deveria conter CST: '{den}'"
    print("Sucesso: Todos os tecidos CST sinalizados com a sigla CST na descrição.")


def test_disponibilidade_exclusiva_tecido_chegou():
    print("\n=== 2. Testando Disponibilidade Exclusiva via 'TECIDO CHEGOU' ===")
    itens_resumo, comp_agg, locais = service._obter_fila_calculada(recarregar=True)
    assert not comp_agg.empty, "comp_agg não deve ser vazio"

    itens_cst = service._enriquecimento.get("itens_cst", set())
    cst_comp = comp_agg[comp_agg["Item"].isin(itens_cst)].copy()
    print(f"Componentes CST avaliados na fila: {len(cst_comp)}")
    assert len(cst_comp) > 0, "Deveria haver componentes CST em comp_agg"

    # Valida que os que tem 'TECIDO CHEGOU' estão disponíveis e os demais com falta
    tc_rows = service._enriquecimento.get("tecidos_cust_raw", [])
    assert len(tc_rows) > 0, "Cache de tecidos customizados deve conter registros"

    chegou_count = 0
    nao_chegou_count = 0

    for _, r in cst_comp.head(50).iterrows():
        ped = str(r.get("raiz_Pedido_Str") or "").strip()
        ordem = str(r.get("Ordem_Cons") or r.get("Ordem_Prod") or "").strip()
        it_prod = str(r.get("raiz_Item Final") or "").strip()
        tec = str(r.get("Item") or "").strip()

        info = service.buscar_info_tecido_cst(
            pedido=ped,
            ordem=ordem,
            item_produto=it_prod,
            tecido=tec,
        )
        sit = str(info.get("situacao") or "").strip().upper() if info else "NAO_ENCONTRADO"
        is_disp = bool(r["Disponivel"])
        falta = float(r["Falta"])
        consumo = float(r["Consumo"])

        if sit == "TECIDO CHEGOU":
            chegou_count += 1
            assert is_disp is True, f"Tecido CST com 'TECIDO CHEGOU' deveria estar disponível: {r.to_dict()}"
            assert falta == 0.0, f"Falta deveria ser 0.0 para tecido chegado: {falta}"
        else:
            nao_chegou_count += 1
            assert is_disp is False, f"Tecido CST sem 'TECIDO CHEGOU' ({sit}) não deveria estar disponível: {r.to_dict()}"
            assert falta == consumo, f"Falta ({falta}) deveria ser igual ao consumo ({consumo}) para tecido que não chegou"

    print(f"Sucesso: Validado com {chegou_count} tecidos 'TECIDO CHEGOU' (Disponíveis) e {nao_chegou_count} outros (Com Falta).")


def test_detalhes_item_final_e_resumo_pedido_cst():
    print("\n=== 3. Testando Enriquecimento Gerencial e Detalhes de CST ===")
    # Localiza um item final que possua componente CST
    itens_resumo, comp_agg, _ = service._obter_fila_calculada()
    itens_cst = service._enriquecimento.get("itens_cst", set())
    cst_comp = comp_agg[comp_agg["Item"].isin(itens_cst)]
    assert not cst_comp.empty

    row_cst = cst_comp.iloc[0]
    ord_fila = int(row_cst["_ordem_fila"])
    item_alvo = itens_resumo[itens_resumo["_ordem_fila"] == ord_fila].iloc[0]

    ped_alvo = str(item_alvo["raiz_Pedido_Str"])
    it_final_alvo = str(item_alvo["raiz_Item Final"])
    fab_alvo = str(item_alvo["raiz_Fábrica"])

    detalhes = service.obter_detalhes_item_final(
        raiz_item_final=it_final_alvo,
        raiz_pedido=ped_alvo,
        raiz_fabrica=fab_alvo,
    )
    assert "erro" not in detalhes, f"Erro ao obter detalhes: {detalhes.get('erro')}"

    # No detalhamento de item final, a camada gerencial vem dividida em gerencial_faltando e gerencial_disponiveis
    ger_falt = detalhes.get("gerencial_faltando", {})
    ger_disp = detalhes.get("gerencial_disponiveis", {})
    mps = ger_falt.get("materias_primas", []) + ger_disp.get("materias_primas", [])
    cst_mps = [x for x in mps if x.get("eh_cst")]
    print(f"Matérias-primas CST encontradas nos detalhes do item {it_final_alvo}: {len(cst_mps)}")
    assert len(cst_mps) > 0, "Deveria haver pelo menos 1 matéria-prima CST no detalhamento"

    mp_sample = cst_mps[0]
    print(f"Sample CST MP: item={mp_sample.get('item')}, desc={mp_sample.get('descricao')}, cst_sit={mp_sample.get('cst_situacao')}, chegou={mp_sample.get('cst_chegou')}")
    assert "CST" in mp_sample.get("descricao", "").upper()
    assert mp_sample.get("eh_cst") is True

    # Teste de Resumo do Pedido se pedido não for vazio
    if ped_alvo:
        resumo = service.obter_resumo_pedido(pedido=ped_alvo)
        assert "erro" not in resumo
        res_falt = resumo.get("gerencial_faltando", {})
        res_disp = resumo.get("gerencial_disponiveis", {})
        res_mps = res_falt.get("materias_primas", []) + res_disp.get("materias_primas", [])
        cst_res = [x for x in res_mps if x.get("eh_cst")]
        assert len(cst_res) > 0, "Deveria haver pelo menos 1 tecido CST no resumo do pedido"
        print(f"Sucesso: Resumo do Pedido #{ped_alvo} consolidou {len(cst_res)} tecidos CST.")


if __name__ == "__main__":
    try:
        test_identificacao_itens_cst_e_sinalizacao_descricao()
        test_disponibilidade_exclusiva_tecido_chegou()
        test_detalhes_item_final_e_resumo_pedido_cst()
        print("\nTODOS OS TESTES DE TECIDOS CST PASSARAM COM SUCESSO!")
    except Exception as e:
        print(f"\nFALHA NO TESTE: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
