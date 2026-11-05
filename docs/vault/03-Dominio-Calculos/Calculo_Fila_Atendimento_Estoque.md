---
modulo: "Calculo_Fila_Atendimento_Estoque"
tipo: "dominio"
data_atualizacao: 2026-11-05
tags: [regras-negocio, calculo, parametros, estoque, fifo, atendimento]
---

# Regra: Calculo_Fila_Atendimento_Estoque

**Contexto:** Determina o atendimento de insumos e matérias-primas na carteira de pedidos através de uma fila cronológica FIFO. O estoque físico disponível (Situação L) é consumido sequencialmente; havendo saldo suficiente para a quantidade requisitada pelo item final, ele é considerado disponível; caso contrário, é apontada falta de material.

## Lógica e Parâmetros

- **Variáveis de Entrada Obrigatórias:**
  - `estoque_inicial`: Float (quantidade em unidades físicas no armazém sob Situação L).
  - `consumo`: Float (quantidade requerida do insumo pela engenharia/árvore do produto).
  - `ordem_fila`: Lista ordenada cronologicamente por data de entrega e número do pedido.
- **Condicionais Críticas:**
  - **Tolerância a Arredondamento:** O saldo no ERP é mantido com 2 casas decimais, enquanto o consumo na estrutura pode ter 3 a 4 casas decimais. Se `estoque_disp_fila > 0` e `round(consumo, 2) <= round(estoque_disp_fila, 2)` (ou `(consumo - estoque_disp_fila) <= 0.01` para consumos `>= 0.05`), o item é considerado `Disponivel = True` e `Falta = 0.0`.
  - **Abatimento Cumulativo:** Quando o consumo é atendido, o saldo disponível na fila é reduzido de `round(consumo, 2)` para consumos `>= 0.01`.
  - **Status do Item Final:** Um item final só tem `Atendido = True` se 100% de seus insumos e componentes estiverem disponíveis na fila.
- **Saída Esperada:**
  - `saldo_disponivel`: Float (saldo remanescente na fila antes do abatimento deste consumo).
  - `falta`: Float (quantidade faltante se `consumo > saldo_disponivel`, caso contrário 0.0).
  - `disponivel`: Booleano (`True` se atendido, `False` se faltante).

## Dependências

**⬅️ Consumido por:** [[Servico_Orquestrador_Service]]
