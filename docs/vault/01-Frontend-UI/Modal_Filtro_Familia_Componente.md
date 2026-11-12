---
tipo: componente_frontend
tags:
  - frontend
  - ui
  - modal
  - filtros
  - insumos
---

# Modal Filtro Família do Componente (`ModalFiltroFamiliaComponente.jsx`)

Componente modal desacoplado no padrão editorial Líder Design para filtragem e recálculo da fila de atendimento MRP exclusivamente pelas famílias selecionadas de componentes iniciados em `3` (insumos e matérias-primas).

## Funcionalidades e Interações
1. **Listagem Dinâmica:**
   - Popula automaticamente a lista de famílias de insumos/matérias-primas a partir dos dados reais da tabela de consumo (`cons` / `df_consumo`), considerando estritamente componentes com código iniciado em `3`.
   - Exibe o código da família (ex: `CST`, `FEC`, `EMB`, `LAM`, `COL`), o grupo Sankhya predominante (ex: `COURO`, `FERRAGENS (INTERNO)`, `EMBALAGENS`) e a contagem de itens únicos cadastrados.
   - Destaque visual especial para tecidos customizados (`CST`).
2. **Busca em Tempo Real:**
   - Campo de pesquisa superior com filtragem instantânea por código da família ou nome do grupo.
3. **Ações em Massa:**
   - Botões "Selecionar Todas" e "Limpar Seleção".
4. **Modo Rascunho (*Draft*):**
   - Mantém as alterações em estado temporário local (`tempSelecao`), sincronizando com os filtros globais e disparando o recálculo da fila apenas ao clicar no botão "Aplicar Filtro".

## Regra de Negócio de Recálculo (Itens iniciados em 3)
- **Escopo Exclusivo de Famílias:** Quando uma ou mais famílias são filtradas (e não a totalidade), o motor de cálculo MRP (`backend/service.py`) recalcula a fila de atendimento avaliando exclusivamente os componentes iniciados em `3` que pertencem às famílias selecionadas.
- **Itens Não-3 e Outras Famílias:** Componentes que não começam com `3` (ex: peças produzidas tipo `P` iniciadas em `2`, `4`, `8`, etc.) e insumos iniciados em `3` de famílias não selecionadas são desconsiderados na avaliação de disponibilidade e faltas do item final.
- **Propagação Multinível de Peças Produzidas:** Caso um componente produzido tipo `P` (iniciado em `2`) tenha falta de saldo, a necessidade é propagada normalmente para seus nós filhos na árvore estrutural (onde podem residir insumos iniciados em `3` da família filtrada, ex: ferragens ou tecidos).
- **Sem Filtro (Totalidade ou Vazio):** Caso nenhuma família esteja marcada ou todas estejam selecionadas, o sistema opera no modo global padrão avaliando todos os componentes normalmente.

## Conexões do Grafo
- `[[VerEstoque_Componente]]`
- `[[Calculo_Fila_Atendimento_Estoque]]`
- `[[API_FastAPI_Main]]`
- `[[Servico_Orquestrador_Service]]`
- `[[Index_Ver_estoque]]`
