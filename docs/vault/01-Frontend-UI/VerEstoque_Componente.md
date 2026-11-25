---
modulo: "VerEstoque.jsx"
tipo: "frontend"
linguagem: "javascript"
data_atualizacao: 2026-11-25
tags: [codigo, frontend, javascript, react, ui]
---

# Módulo: VerEstoque.jsx

**Responsabilidade:** Orquestrador principal da interface em React/Vite do Ver Estoque, com code-splitting (`React.lazy` + `<Suspense>`) para telas secundárias e modais, cancelamento de requisições concorrentes via `AbortController`, ícones SVG inline (`./frontend/src/components/Icon.jsx`), notificações via `./frontend/src/components/Toast.jsx`, sidebar desktop colapsável e drawer mobile nativo em `<dialog>`, listagem paginada de itens finais (`DisponibilidadeEstoque.jsx`), tela de Itens Faltantes (`ResumoFaltantes.jsx`), detalhamento gerencial de insumos (`DetalhamentoInsumos.jsx`), resumo executivo de pedidos (`ResumoPedido.jsx`) e Matriz Pivot (`MatrizFaltasProduzidos.jsx`).

## Principais Funções / Métodos
* `carregarDados(resetar, paginaAlvo, recarregarCache)`: Dispara busca paginada com `AbortController` + `reqSeqRef` (preservando `loadingMoreRef` na rolagem infinita limitada por `max-h-[65vh] lg:max-h-none` em mobile), filtros ativos (`todas_ops`, `escopo_abatimento`) e sincronização de `dataOc` exibido na `Sidebar`.
* `handleRecarregarGlobal()`: Acionado pelo botão da Sidebar; aguarda `carregarDados(true, 0, true)` e reatualiza automaticamente a tela secundária ativa (`faltantes`, `detalhes` ou `resumo`).
* `carregarFaltantes(forcarRecarga)`: Consulta `obter_resumo_faltantes` com `AbortController`, `JSON.stringify(debouncedColFiltros)` estável e filtros espelhados em [[Tela_Itens_Faltantes]].
* `montarFiltrosEscopoAtual()`: Empacota os filtros restritivos da fila para repasse coerente a `carregarDetalhes` e `carregarResumoPedido` quando `filtroEscopoAbatimento === "filtrado"`.
* `abrirModalSimulador()` / `fecharModalSimulador()`: Controla o diálogo nativo `<dialog>` (`SimuladorModal.jsx`) para inserção de pedidos de teste em fila.
* `handleConfirmarSimulacao()` / `handleRemoverPedidoSimulado(numPedido)` / `handleLimparSimulacao()`: Gerenciam pedidos simulados da sessão com feedback não-bloqueante via `Toast`.
* `handleExportarExcel()`: Solicita a geração e download da planilha Excel com a análise completa de atendimento e insumos.
* `abrirResumoPedido(numPedido, itemFinalOpcional)`: Consulta o endpoint gerencial e exibe `ResumoPedido.jsx` com 3 cards alinhados (`lg:grid-cols-[1.35fr_1fr_1fr]`), badge sem colisão e faltas agrupadas via `SecaoGerencialInsumos.jsx`.
* `abrirMatrizFaltantes()` / `carregarMatrizFaltantes()` / `handleExportarMatrizExcel()`: Controla `MatrizFaltasProduzidos.jsx` com `useDebounce(250)`, `gruposBase`/`gruposFiltrados` memoizados, accordions iniciando com apenas o 1º grupo aberto, `deferred-table-card`, import dinâmico de `exportarImagemMatriz.js` e exportação Excel/PNG.
* `abrirDetalhes(item)`: Abre `DetalhamentoInsumos.jsx` com cabeçalho responsivo, `role="tab"` acessível e inspeção detalhada dos insumos do item final.

## Dependências (Grafo)
**⬅️ Quem chama este módulo (Entrada):**
* [[Main_Montagem_React]]

**➡️ Quem este módulo chama (Saída/Uso):**
* [[API_Client_Frontend]]
* [[API_FastAPI_Main]]
* [[Servico_Orquestrador_Service]]
* [[Modal_Filtro_Fabrica_Local]]
* [[Modal_Filtro_Familia_Componente]]
* [[Tela_Itens_Faltantes]]
* **Bibliotecas Externas:** `react`, `react-dom`, `tailwindcss`.
