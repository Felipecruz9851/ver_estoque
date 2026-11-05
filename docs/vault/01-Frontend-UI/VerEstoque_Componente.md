---
modulo: "VerEstoque.jsx"
tipo: "frontend"
linguagem: "javascript"
data_atualizacao: 2026-11-05
tags: [codigo, frontend, javascript, react, ui]
---

# Módulo: VerEstoque.jsx

**Responsabilidade:** Componente principal da interface em React/Vite do Ver Estoque, apresentando a listagem paginada de itens finais, status de atendimento cumulativo, detalhamento gerencial de insumos por fábrica e modal nativo com resumo executivo de pedidos.

## Principais Funções / Métodos
* `carregarDados(resetar, recarregar, paginaAlvo)`: Dispara busca paginada de itens finais com filtros ativos, recarga fresca ou paginação sob demanda.
* `abrirModalSimulador()` / `fecharModalSimulador()`: Controla a exibição do diálogo modal `<dialog>` para inserção de pedidos de teste para simulação em fila.
* `handleConfirmarSimulacao()`: Envia lista de pedidos para simulação temporária na sessão ativa e atualiza a fila de atendimento.
* `handleRemoverPedidoSimulado(numPedido)`: Remove um pedido simulado individualmente da sessão corrente.
* `handleLimparSimulacao()`: Reseta todas as simulações ativas da sessão, restaurando a visão original do estoque.
* `handleExportarExcel()`: Solicita a geração e download da planilha Excel com a análise completa de atendimento e insumos.
* `abrirResumoPedido(numPedido, itemFinalOpcional)`: Consulta o endpoint gerencial e exibe o modal `<dialog>` com KPIs do pedido, faltas de MP e componentes por fábrica.
* `abrirModalDetalhes(item)`: Abre a inspeção detalhada de todos os insumos consumidos por um item final específico.

## Dependências (Grafo)
**⬅️ Quem chama este módulo (Entrada):**
* [[Main_Montagem_React]]

**➡️ Quem este módulo chama (Saída/Uso):**
* [[API_Client_Frontend]]
* [[API_FastAPI_Main]]
* [[Servico_Orquestrador_Service]]
* **Bibliotecas Externas:** `react`, `lucide-react`, `tailwindcss`.
