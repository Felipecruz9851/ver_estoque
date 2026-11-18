from datetime import datetime, timedelta
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend import service, settings  # noqa: E402


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
            if dt_sort and dt_sort != "9999-12-31" and dt_sort <= corte:
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
