---
projeto: "Ver_estoque"
data_criacao: 2026-11-13
status: ativo
tags: [frontend, tela, faltantes, filtros]
---

# Tela Itens Faltantes (`ResumoFaltantes.jsx`)

**Resumo:** lista tudo o que falta (insumos com `Falta > 0`) para os itens finais que atendem aos filtros da tela principal, organizado por local de produção e tipo (P produzido / C comprado).

## Regras
- **Filtros espelhados** com [[VerEstoque_Componente]]: mesmo estado no orquestrador (`filtroLocal`, `filtroFamilias`, datas, pedido, código, baixa, tipo). Os modais [[Modal_Filtro_Fabrica_Local]] e [[Modal_Filtro_Familia_Componente]] são reutilizados.
- O filtro de **status** do item final (e col. `status`/`saldo`) é ignorado: a tela mostra tudo o que falta.
- **Tipo P:** agrupado pelo local de produção do componente (`_resolver_local_prod_componente`).
- **Tipo C:** agrupado pela **fábrica consumidora** (`raiz_Fábrica` do item final).
- Abas: Todos / Produzidos (P) / Comprados (C); busca client-side; grupos recolhíveis; paginação local (100 + "mostrar mais").
- Exportação Excel com abas "Produzidos (P)" e "Comprados (C)".

## Acesso
Sidebar ("Itens Faltantes") e atalho "Ver resumo de itens faltantes →" no card "Com Componentes Faltando".

## Backend
- RPC `obter_resumo_faltantes` / `exportar_resumo_faltantes_excel` ([[API_FastAPI_Main]]).
- `service.obter_resumo_faltantes` ([[Servico_Orquestrador_Service]]) reutiliza `_obter_fila_calculada`, os helpers extraídos `_filtrar_itens_finais_base` / `_aplicar_col_filtros` (mesma lógica de `analisar_itens_finais`) e `_enriquecer_insumo_gerencial` (OP/OC).
- Testes: `tests/test_resumo_faltantes.py`.
