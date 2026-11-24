---
modulo: "Cache_Ordens_Compra_OCs"
tipo: "infra"
linguagem: "python"
data_atualizacao: 2026-11-24
tags: [codigo, infra, dados, cache, pickle, suprimentos]
---

# Módulo: Cache_Ordens_Compra_OCs

**Responsabilidade:** Camada de persistência local para as Ordens de Compra capturadas da Intranet (`/sup/oc_atrasadas-lgx.php` + complemento `/sup/vidrosoc.php`). Garante respostas em milissegundos para consultas interativas e realiza recarga automática por TTL (padrão 30 min via `OC_CACHE_TTL_SECONDS`) ou na chegada de snapshot mais novo, com gravação atômica via `.pkl.tmp`.

## Principais Funções / Métodos
* `carregar_ou_atualizar_oc_abertas(forcar_intranet, ..., itens_fallback_vidrosoc)`: Se `./backend/data/oc_abertas_cache.pkl` existir, não for legado e estiver dentro do TTL (com `forcar_intranet=False`), desserializa o cache diretamente; caso contrário, dispara nova consulta completa na Intranet com backup atômico via `.pkl.tmp`, preservando o arquivo anterior se a consulta principal falhar (cooldown de 120s para não martelar Intranet offline).
* `cache_oc_expirado(ttl_segundos, referencia_mtime)`: Verifica inexistência, formato legado (`oc_atrasadas.php`), idade superior a `settings.OC_CACHE_TTL_SECONDS` (`VER_ESTOQUE_OC_CACHE_TTL`) ou defasagem em relação ao `mtime` do snapshot ativo.
* `obter_data_cache_oc()`: Expõe o timestamp (`DD/MM/YYYY HH:MM:SS`) exibido no rodapé da Sidebar (`data_oc`).
* Indexação multinível de consulta rápida (aplicável a `Tipo` `C` e `F`):
  1. `(insumo, pedido, item_final)`
  2. `(insumo, pedido)`
  3. `(insumo, item_final)`
  4. `insumo` (previsão mais antiga global)

## Dependências (Grafo)
**⬅️ Quem chama este módulo (Entrada):**
* [[Scraper_Intranet_PCP]]
* [[Servico_Orquestrador_Service]]

**➡️ Quem este módulo chama (Saída/Uso):**
* Arquivo em disco `./backend/data/oc_abertas_cache.pkl`
* **Bibliotecas Externas:** `pickle`, `pathlib`.
