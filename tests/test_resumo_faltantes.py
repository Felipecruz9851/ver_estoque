import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend import service  # noqa: E402


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
