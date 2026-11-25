---
projeto: "Ver_estoque"
data_criacao: 2026-11-13
data_atualizacao: 2026-11-25
status: ativo
tags: [frontend, tela, faltantes, filtros]
---

# Tela Itens Faltantes (`ResumoFaltantes.jsx`)

**Resumo:** lista tudo o que falta (insumos com `Falta > 0`) para os itens finais que atendem aos filtros da tela principal, organizado por local de produção e tipo (P produzido / C comprado), com `useDebounce(250)`, inicialização com apenas o 1º grupo aberto, `LIMITE_INICIAL = 50`, `deferred-section` e semântica acessível (`<main>`, `<h1>`, `select-custom`).

## Regras
- **Filtros espelhados** com [[VerEstoque_Componente]]: mesmo estado no orquestrador (`filtroLocal`, `filtroFamilias`, `filtroTodasOps`, `filtroEscopoAbatimento`, datas, pedido, código, baixa, tipo). Os modais [[Modal_Filtro_Fabrica_Local]] e [[Modal_Filtro_Familia_Componente]] são reutilizados.
- O filtro de **status** do item final (e col. `status`/`saldo`) é ignorado: a tela mostra tudo o que falta.
- **Modo de Abatimento (`escopo_abatimento`):** toggle acessível `Fila Global | Apenas no Filtro` para optar entre o abatimento global considerando prioridades 2030/backlog ou simulação restrita apenas aos pedidos/OPs do filtro ativo (ex.: entregas até 31/12/2026).
- **Recarga (`Atualizar`):** dispara `obter_resumo_faltantes` com `recarregar=true` e `forcar_oc=true`, sincronizando snapshot e OCs da Intranet diretamente da tela.
- **Modo de visualização (`visao`):**
  - `por_insumo` (**Consolidado por Insumo**, padrão): **Tipo P** agrupado pelo local de produção do componente (`_resolver_local_prod_componente`); **Tipo C** agrupado pela **fábrica consumidora** (`raiz_Fábrica` do item final).
  - `por_item_pedido` (**Por Local → Item / Pedido**): agrupado pelo **Local de Produção** do item/OP (`raiz_Fábrica`) → cada **Item / Pedido / OP** com falta → lista de insumos faltantes daquela ordem (com atalhos para **Resumo do Pedido** e **Ver Insumos**).
- **Escopo (`todas_ops`):** alterna entre **Itens Finais** e **Todas as OPs** (itens com e sem item pai, avaliados em 1 nível sem dupla contagem).
- Abas de tipo: Todos / Produzidos (P) / Comprados (C); busca client-side (local, item, OP, pedido ou insumo); grupos recolhíveis; paginação local.
- Exportação Excel adaptativa: abas "Produzidos (P)" e "Comprados (C)" em `por_insumo`, ou aba "Por Local e Item-Pedido" em `por_item_pedido`.

## Acesso
Sidebar ("Itens Faltantes") e atalho "Ver resumo de itens faltantes →" no card "Com Componentes Faltando".

## Backend
- RPC `obter_resumo_faltantes` / `exportar_resumo_faltantes_excel` ([[API_FastAPI_Main]]).
- `service.obter_resumo_faltantes` ([[Servico_Orquestrador_Service]]) reutiliza `_obter_fila_calculada` (com `escopo_abatimento`), os helpers extraídos `_filtrar_itens_finais_base` / `_aplicar_col_filtros` (mesma lógica de `analisar_itens_finais`) e `_enriquecer_insumo_gerencial` (OP/OC).
- Testes: `tests/test_resumo_faltantes.py` e `tests/test_oc_e_abatimento.py`.
