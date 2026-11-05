"""
Teste de integração e regressão para o novo mecanismo nativo de snapshots Parquet.
Valida:
1. Sincronização remota granular a partir de http://366n:8001/api/snapshots.
2. Limpeza automática de arquivos .pkl e tabelas não utilizadas.
3. Leitura e integridade das tabelas via Polars.
4. Funcionamento de calc_data(dfs) do motor de regras de negócio.
"""

import sys
from pathlib import Path

# Adiciona backend ao sys.path
BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE_DIR / "backend"))

from snapshots import (
    sincronizar_snapshots_remotos,
    listar_snapshots,
    carregar_snapshot,
    data_snapshot,
    limpar_arquivos_desnecessarios,
    TABELAS_NECESSARIAS,
    ARQUIVOS_SINCRONIZAR,
)
import settings
from calculo import calc_data


def test_sincronizacao_e_limpeza():
    print("=== 1. Testando Sincronização Remota Parquet e Limpeza ===")
    res = sincronizar_snapshots_remotos(forcar=False, limpar_desnecessarios=True)
    print("Resultado da Sincronização:", res)

    assert res["sucesso"] is True, f"Falha na sincronização: {res.get('erro')}"
    print(f"Pastas remotas encontradas: {res['pastas_remotas']}")
    print(f"Arquivos baixados: {len(res['baixados'])}")
    print(f"Arquivos já atualizados: {len(res['ja_atualizados'])}")
    print(f"Arquivos desnecessários removidos: {len(res['removidos'])}")

    # Verifica se existem arquivos .pkl na pasta de snapshots
    pkls_restantes = list(settings.SNAPSHOTS_DIR.glob("*.pkl")) + list(settings.SNAPSHOTS_DIR.glob("*/*.pkl"))
    assert len(pkls_restantes) == 0, f"Ainda restam arquivos .pkl: {pkls_restantes}"
    print("Sucesso: Nenhum arquivo .pkl remanescente no diretório de snapshots.")


def test_validacao_cache():
    print("\n=== 2. Testando Verificação de Cache (Idempotência) ===")
    res = sincronizar_snapshots_remotos(forcar=False, limpar_desnecessarios=False)
    assert res["sucesso"] is True
    assert len(res["baixados"]) == 0, f"Esperava 0 downloads na segunda chamada, mas baixou: {res['baixados']}"
    assert len(res["ja_atualizados"]) > 0, "Deveria ter identificado arquivos já atualizados."
    print(f"Sucesso: Cache validado com {len(res['ja_atualizados'])} arquivos mantidos sem novo download.")


def test_listagem_e_carregamento():
    print("\n=== 3. Testando Listagem e Carregamento de Snapshot ===")
    snaps = listar_snapshots()
    print("Snapshots Parquet válidos disponíveis:", [p.name for p in snaps])
    assert len(snaps) > 0, "Nenhum snapshot Parquet válido encontrado."

    dfs, caminho = carregar_snapshot()
    print(f"Snapshot carregado: {caminho.name}")
    print(f"Data formatada do snapshot: {data_snapshot(caminho)}")

    for t in TABELAS_NECESSARIAS:
        assert t in dfs, f"Tabela '{t}' não encontrada nos DataFrames carregados."
        df = dfs[t]
        assert len(df) > 0, f"Tabela '{t}' está vazia."
        print(f" - Tabela '{t}': {len(df)} linhas x {len(df.columns)} colunas.")


def test_motor_de_calculo():
    print("\n=== 4. Testando Execução do Motor de Cálculo (calc_data) ===")
    dfs, _ = carregar_snapshot()
    df_consumo = calc_data(dfs)
    assert df_consumo is not None
    assert len(df_consumo) > 0, "DataFrame de consumo retornado por calc_data está vazio."
    print(f"Sucesso: calc_data processado com sucesso gerando {len(df_consumo)} linhas de consumo.")


if __name__ == "__main__":
    try:
        test_sincronizacao_e_limpeza()
        test_validacao_cache()
        test_listagem_e_carregamento()
        test_motor_de_calculo()
        print("\nTODOS OS TESTES FORAM CONCLUÍDOS COM SUCESSO!")
    except Exception as e:
        print(f"\nFALHA NO TESTE: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
