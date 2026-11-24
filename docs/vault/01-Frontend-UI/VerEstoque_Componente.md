---
modulo: "VerEstoque.jsx"
tipo: "frontend"
linguagem: "javascript"
data_atualizacao: 2026-11-24
tags: [codigo, frontend, javascript, react, ui]
---

# Módulo: VerEstoque.jsx

**Responsabilidade:** Componente principal da interface em React/Vite do Ver Estoque, apresentando a listagem paginada de itens finais (ou todas as OPs com e sem item pai via `filtroTodasOps`), status de atendimento cumulativo, tela de Itens Faltantes (com visão consolidada por insumo ou por Local × Item/Pedido), detalhamento gerencial de insumos por fábrica, resumo executivo de pedidos e Matriz Pivot de Componentes Produzidos Faltantes por fábrica.

## Principais Funções / Métodos
* `carregarDados(resetar, paginaAlvo, recarregarCache)`: Dispara busca paginada com filtros ativos (incluindo `todas_ops` para alternar entre Itens Finais e Todas as OPs em 1 nível), recarga fresca ou paginação sob demanda.
* `carregarFaltantes()`: Consulta `obter_resumo_faltantes` com os filtros espelhados (incluindo `todas_ops` e `visao` em [[Tela_Itens_Faltantes]]).
* `abrirModalSimulador()` / `fecharModalSimulador()`: Controla a exibição do diálogo modal `<dialog>` para inserção de pedidos de teste para simulação em fila.
* `handleConfirmarSimulacao()`: Envia lista de pedidos para simulação temporária na sessão ativa e atualiza a fila de atendimento.
* `handleRemoverPedidoSimulado(numPedido)`: Remove um pedido simulado individualmente da sessão corrente.
* `handleLimparSimulacao()`: Reseta todas as simulações ativas da sessão, restaurando a visão original do estoque.
* `handleExportarExcel()`: Solicita a geração e download da planilha Excel com a análise completa de atendimento e insumos.
* `abrirResumoPedido(numPedido, itemFinalOpcional)`: Consulta o endpoint gerencial e exibe o modal `<dialog>` com KPIs do pedido, faltas de MP e componentes por fábrica.
* `abrirMatrizFaltantes()` / `carregarMatrizFaltantes()` / `handleExportarMatrizExcel()`: Controla a tela da Matriz Pivot de Componentes Produzidos Faltantes (`Tipo == 'P'` em `MatrizFaltasProduzidos.jsx`), com menu de seleção de filtros para cálculo (`locais_item_final`, `locais_componente`, `escopo_abatimento`, `baixa`), tabelas por fábrica do componente com linha de subtotal no topo fixada no `<thead>`, colunas de prazo de expedição, `Total Faltante`, `Saldo da ops do item com abertura menor ou igual a hoje+1`, `Saldo das OPs com abertura maior que hoje+1` e exportação em Excel e imagem PNG Retina 2x via Canvas.
* `exportarTabelaMatrizComoImagem()`: Renderiza em Canvas HTML5 (`exportarImagemMatriz.js`) a tabela de componentes faltantes da fábrica selecionada com cabeçalho institucional (suportando quebra automática de títulos longos), subtotal no topo, colunas de prazo, `Total Faltante` e as duas colunas de saldo de OPs (`op_saldo_ate_d1` e `op_saldo_apos_d1`), exportando em PNG de alta resolução.
* `abrirModalDetalhes(item)`: Abre a inspeção detalhada de todos os insumos consumidos por um item final específico.

## Dependências (Grafo)
**⬅️ Quem chama este módulo (Entrada):**
* [[Main_Montagem_React]]

**➡️ Quem este módulo chama (Saída/Uso):**
* [[API_Client_Frontend]]
* [[API_FastAPI_Main]]
* [[Servico_Orquestrador_Service]]
* **Bibliotecas Externas:** `react`, `lucide-react`, `tailwindcss`.
