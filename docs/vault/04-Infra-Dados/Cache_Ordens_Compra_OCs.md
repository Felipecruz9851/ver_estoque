---
modulo: "Cache_Ordens_Compra_OCs"
tipo: "infra"
linguagem: "python"
data_atualizacao: 2026-11-05
tags: [codigo, infra, dados, cache, pickle, suprimentos]
---

# Módulo: Cache_Ordens_Compra_OCs

**Responsabilidade:** Camada de persistência local para as Ordens de Compra de matérias-primas capturadas da Intranet (`/sup/oc_atrasadas.php`). Garante respostas em milissegundos para consultas interativas e permite recarga forçada sob demanda.

## Principais Funções / Métodos
* `carregar_ou_atualizar_oc_abertas(forcar_intranet)`: Se o arquivo serializado `./backend/data/oc_abertas_cache.pkl` existir e `forcar_intranet=False`, desserializa o cache diretamente; caso contrário, dispara nova raspagem completa da Intranet e regrava o arquivo.
* Indexação multinível de consulta rápida:
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
