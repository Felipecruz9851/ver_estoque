---
modulo: "Calculo_Saldo_OC_Ate_Abertura"
tipo: "dominio"
data_atualizacao: 2026-11-05
tags: [regras-negocio, calculo, parametros, ordens-compra, suprimentos, leadtime]
---

# Regra: Calculo_Saldo_OC_Ate_Abertura

**Contexto:** Ao analisar uma falta de matéria-prima (`Tipo == 'C'`), é fundamental saber se as Ordens de Compra já emitidas pelo setor de Compras chegarão a tempo para o início da produção da Ordem de Produção (OP) que consumirá o insumo, comparando a data de previsão da OC com a data de abertura da OP.

## Lógica e Parâmetros

- **Variáveis de Entrada Obrigatórias:**
  - `data_abertura_op`: String ISO/Data BR (data programada para início da produção do componente pai).
  - `ordens_compra_item`: Lista de OCs abertas para aquele insumo específico, com campos `saldo`, `previsao`, `prev_entrega`, `numero_oc`.
- **Condicionais Críticas:**
  - Data efetiva de previsão da OC: se `previsao` for válida (`!= '--'`), adota `previsao`; caso contrário, adota `prev_entrega`.
  - Se `data_previsao_oc <= data_abertura_op`:
    - A quantidade em saldo da OC é somada ao montante disponível para abertura.
    - Incrementa o contador de OCs válidas para o lote.
  - OCs com previsão posterior à data de abertura são computadas apenas no saldo total futuro (`oc_saldo_total_item`), gerando alerta gerencial de risco de parada de fábrica.
- **Saída Esperada:**
  - `oc_saldo_ate_abertura`: Float (volume de matéria-prima que chegará antes da fábrica começar a produzir).
  - `oc_qtd_ate_abertura`: Inteiro (número de pedidos de compras com entrega antes da abertura).
  - `oc_saldo_total_item`: Float (volume total comprado independente do prazo).

## Dependências

**⬅️ Consumido por:** [[Servico_Orquestrador_Service]]
