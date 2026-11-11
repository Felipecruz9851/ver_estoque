---
modulo: "scraper.py"
tipo: "backend"
linguagem: "python"
data_atualizacao: 2026-11-05
tags: [codigo, backend, python, scraper, intranet, httpx, parser]
---

# Módulo: scraper.py

**Responsabilidade:** Cliente HTTP autenticado com a Intranet corporativa do PCP e de Suprimentos. Realiza consultas e raspagem de dados de saldos de pedidos, árvores de estrutura em JSON e ordens de compra em atraso ou programadas com cache local.

## Principais Funções / Métodos
* `_autenticar_intranet(client, usuario, senha)`: Gerencia login multipart com persistência de cookie de sessão PHP (`PHPSESSID`).
* `consultar_saldos_pedidos(pedidos, usuario, senha)`: Consulta `/pcp/situacao_pedidos2.php` e extrai saldos, clientes, datas de entrega e itens em aberto.
* `consultar_estrutura_pedidos(pedidos, usuario, senha)`: Baixa a árvore hierárquica em JSON de `/JSN001/json-pedido-estrutura.php` de cada pedido.
* `consultar_pedidos_simulados(pedidos_input, usuario, senha)`: Unifica a busca de saldos e estruturas de novos pedidos informados pelo usuário.
* `parse_oc_texto_vinculo(texto)`: Parser via regex que extrai `(pedido_vinculado, item_final_vinculado)` a partir das anotações livres no campo de texto da OC.
* `consultar_oc_abertas_intranet(...)`: Raspagem de `/sup/oc_atrasadas.php` combinando situações de compra aberta (`sit_oc=S` e padrão horizonte 2050).
* `carregar_ou_atualizar_oc_abertas(forcar_intranet)`: Gerencia o cache serializado em `backend/data/oc_abertas_cache.pkl`, atualizando sob demanda.
* `consultar_tecidos_customizados_intranet(usuario, senha, timeout_sec)`: Consulta `/pcp/tecidos_customizados3.php` com cod_empresa=11 e período 2000 a 2050 para checar situação dos tecidos importados/customizados (CST).
* `carregar_ou_atualizar_tecidos_customizados(forcar_intranet)`: Gerencia o cache serializado em `backend/data/tecidos_customizados_cache.pkl` para suportar regras exclusivas de disponibilidade da família CST.

## Dependências (Grafo)
**⬅️ Quem chama este módulo (Entrada):**
* [[Servico_Orquestrador_Service]]

**➡️ Quem este módulo chama (Saída/Uso):**
* [[Cache_Ordens_Compra_OCs]]
* [[Configuracao_Settings]]
* **Bibliotecas Externas:** `httpx`, `beautifulsoup4` (`bs4`), `pickle`, `re`.
