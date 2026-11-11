---
modulo: "Calculo_Fila_Atendimento_Estoque"
tipo: "dominio"
data_atualizacao: 2026-11-11
tags: [regras-negocio, calculo, parametros, estoque, fifo, atendimento, multinivel, mrp]
---

# Regra: Calculo_Fila_Atendimento_Estoque

**Contexto:** Determina o atendimento de insumos e matérias-primas na carteira de pedidos através de uma fila cronológica FIFO com avaliação hierárquica multinível top-down (MRP). O estoque físico disponível (Situação L) é consumido sequencialmente na ordem da fila; havendo saldo suficiente do semiacabado no Nível 1 para suprir a OP do item final, seus nós descendentes (Nível 2 em diante) são cortados da demanda. Componentes filhos só são ativados e demandados caso haja falta líquida do item pai produzido (Tipo 'P').

## Lógica e Parâmetros

- **Variáveis de Entrada Obrigatórias:**
  - `estoque_inicial`: Float (quantidade em unidades físicas no armazém sob Situação L).
  - `consumo`: Float (quantidade requerida do insumo pela engenharia/árvore do produto).
  - `ordem_fila`: Lista ordenada cronologicamente por data de abertura/entrega e número do pedido.
- **Condicionais Críticas:**
  - **Padronização Pré-Cálculo (2 Casas Decimais):** Todos os dados de entrada de estoque, ordens, saldo e consumo da estrutura são estritamente padronizados e arredondados com 2 casas decimais (`round(2)`) antes de qualquer cálculo ou merge.
  - **Avaliação Hierárquica Top-Down (Corte de Ramo por Saldo):**
    - A avaliação inicia no **Nível 1** (filhos diretos da raiz `raiz_Item Final`).
    - Para cada componente, se `(estoque_disp_fila + 1e-6) >= consumo`:
      - Marcado como `Disponivel = True` e `Falta = 0.0`.
      - O estoque do item é abatido na fila.
      - **Corte de Ramo:** Seus componentes filhos (Níveis 2, 3...) **não são demandados** para este pedido.
    - Se `estoque_disp_fila < consumo`:
      - Marcado como `Disponivel = False` e `Falta = round(consumo - estoque_disp_fila, 2)`.
      - O estoque do item zera na fila.
      - Se o item for produzido (`Tipo == 'P'`), calcula-se o fator de necessidade proporcional `fator_filho = Falta / Consumo`, ativando os componentes filhos no nível subsequente apenas para suprir a carência líquida.
  - **Tratamento Prévio de Fantasmas em Simulações:** Na simulação de pedidos, executa-se primeiramente `tratar_estrutura_fantasmas` (expurgando tipo 'T', promovendo os filhos e multiplicando as quantidades) antes de submeter a estrutura ao motor de atendimento.
  - **Status do Item Final:** Um item final só tem `status = "Disponível"` se 100% dos seus componentes ativos na estrutura estiverem disponíveis na fila.
- **Saída Esperada:**
  - `saldo_disponivel`: Float (saldo remanescente na fila antes do abatimento deste consumo).
  - `falta`: Float (quantidade faltante se `consumo > saldo_disponivel`, caso contrário 0.0).
  - `disponivel`: Booleano (`True` se atendido, `False` se faltante).

## Dependências

**⬅️ Consumido por:** [[Servico_Orquestrador_Service]]
