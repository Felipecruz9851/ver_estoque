---
modulo: "scraper.py"
tipo: "backend"
linguagem: "python"
data_atualizacao: 2026-11-24
tags: [codigo, backend, python, scraper, intranet, httpx, parser]
---

# Módulo: scraper.py

**Responsabilidade:** Cliente HTTP autenticado com a Intranet corporativa do PCP e de Suprimentos. Realiza consultas e raspagem de dados de saldos de pedidos, árvores de estrutura em JSON e ordens de compra em atraso ou programadas com cache local.

## Principais Funções / Métodos
* `_autenticar_intranet(client, usuario, senha)`: Gerencia login multipart com persistência de cookie de sessão PHP (`PHPSESSID`).
* `_parse_saldo_intranet(valor, default)`: Parser numérico seguro para saldos SQL em ponto decimal da Intranet (`'1.000' -> 1.0`, evitando inflar 1000x como no parser de milhar brasileiro).
* `consultar_saldos_pedidos(pedidos, usuario, senha)`: Consulta `/pcp/situacao_pedidos2.php` e extrai saldos, clientes, datas de entrega e itens em aberto.
* `consultar_estrutura_pedidos(pedidos, usuario, senha)`: Baixa a árvore hierárquica em JSON de `/JSN001/json-pedido-estrutura.php` de cada pedido.
* `consultar_pedidos_simulados(pedidos_input, usuario, senha)`: Unifica a busca de saldos e estruturas de novos pedidos informados pelo usuário.
* `parse_oc_texto_vinculo(texto)`: Parser via regex que extrai `(pedido_vinculado, item_final_vinculado)` a partir das anotações livres no campo de texto da OC.
* `parse_vidrosoc_html(html, cod_item_esperado)` / `consultar_oc_vidrosoc_itens(itens)`: Fallback concorrente em `/sup/vidrosoc.php` para itens com OC em `apoio_compras.parquet` omitidos pelo INNER JOIN de Comprador em `/sup/oc_atrasadas-lgx.php`.
* `consultar_oc_abertas_intranet(..., itens_fallback_vidrosoc)`: Raspagem de `/sup/oc_atrasadas-lgx.php` combinando `sit_oc=S` e `data=2999-12-31`, com aborto em falha da consulta principal e complemento em `vidrosoc.php`.
* `cache_oc_expirado(ttl_segundos, referencia_mtime)` / `obter_data_cache_oc()` / `_cache_oc_eh_legado()`: Detecta cache ausente, legado (`oc_atrasadas.php` sem coluna `Unidade`), expirado pelo TTL (`settings.OC_CACHE_TTL_SECONDS`, padrão 30 min) ou defasado frente ao snapshot, com cooldown de 120s após falha da Intranet.
* `carregar_ou_atualizar_oc_abertas(forcar_intranet, ..., itens_fallback_vidrosoc)`: Gerencia o cache serializado em `backend/data/oc_abertas_cache.pkl` com gravação atômica via `.pkl.tmp`, preservando o cache anterior em caso de falha.
* `consultar_tecidos_customizados_intranet(usuario, senha, timeout_sec)`: Consulta `/pcp/tecidos_customizados3.php` com cod_empresa=11 e período 2000 a 2050 para checar situação dos tecidos importados/customizados (CST).
* `carregar_ou_atualizar_tecidos_customizados(forcar_intranet)`: Gerencia o cache serializado em `backend/data/tecidos_customizados_cache.pkl` para suportar regras exclusivas de disponibilidade da família CST.

## Dependências (Grafo)
**⬅️ Quem chama este módulo (Entrada):**
* [[Servico_Orquestrador_Service]]

**➡️ Quem este módulo chama (Saída/Uso):**
* [[Cache_Ordens_Compra_OCs]]
* [[Configuracao_Settings]]
* **Bibliotecas Externas:** `httpx`, `beautifulsoup4` (`bs4`), `pickle`, `re`.
