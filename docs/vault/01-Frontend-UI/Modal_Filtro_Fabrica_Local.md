---
tipo: componente_frontend
tags:
  - frontend
  - ui
  - modal
  - filtros
---

# Modal Filtro Fábrica e Local (`ModalFiltroFabricaLocal.jsx`)

Componente modal de alta fidelidade visual (padrão editorial Líder Design) para filtragem multinível por centros industriais (Fábricas) e locais de produção Sankhya.

## Visões e Navegação
1. **Visão 1 — Centros de Produção Industriais (Fábricas):**
   - Grade de cards fabris com ícones Material Symbols temáticos (`countertops`, `weekend`, `chair`, `precision_manufacturing`, etc.).
   - Checkbox "Todos" com suporte a estado parcial indeterminado (`indeterminate` / traço `-`).
   - Clique no checkbox marca/desmarca todos os locais daquela fábrica.
   - Clique no corpo do card navega em *drill-down* para a Visão 2.
2. **Visão 2 — Detalhe de Locais da Fábrica:**
   - Barra de navegação com migalha de pão e botão "Voltar para Fábricas".
   - Ações em lote: "Marcar Todos" e "Desmarcar Todos".
   - Grade de cards individuais de cada local de produção com badge de código, status ativo e indicador de seleção.
   - Seção inferior com atalhos para outras fábricas ativas.
3. **Visão 3 — Busca Global Direta:**
   - Ativada automaticamente quando há texto no campo de busca do cabeçalho.
   - Apresenta grade unificada com todos os locais de todas as fábricas que coincidem com a pesquisa, permitindo marcação com 1 clique sem necessidade de navegar entre fábricas.

## Regras de Negócio e Dados
- **Amarração Dinâmica:** Estruturada a partir de `backend/data/DIVISAO_FABRICAS.json` com metadados de ícones e ordem de exibição.
- **Omissão de Não Disponíveis:** Exibe estritamente locais que possuam OPs/registros na carga ativa da tabela principal (`locais_producao`). Fábricas com 0 locais disponíveis são omitidas da grade.
- **Locais Não Mapeados:** Itens presentes na tabela principal que não constem no JSON são alocados automaticamente na fábrica `"OUTROS"`.
- **Modo Rascunho (*Draft*):** A seleção é mantida em memória local enquanto o usuário navega, sendo aplicada à tabela e aos KPIs apenas ao clicar no botão "Aplicar Seleção".

## Conexões do Grafo
- `[[VerEstoque_Componente]]`
- `[[API_FastAPI_Main]]`
- `[[Servico_Orquestrador_Service]]`
- `[[Index_Ver_estoque]]`
