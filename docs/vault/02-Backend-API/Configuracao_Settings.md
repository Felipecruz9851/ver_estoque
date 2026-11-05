---
modulo: "settings.py"
tipo: "backend"
linguagem: "python"
data_atualizacao: 2026-11-05
tags: [codigo, backend, python, configuracao, settings, env]
---

# Módulo: settings.py

**Responsabilidade:** Módulo centralizador de parâmetros de ambiente, caminhos de diretórios de dados e exportações, portas e hosts HTTP, credenciais da Intranet e configurações de isolamento de sessão por cookies.

## Principais Funções / Métodos
* Constantes de Caminhos: `BACKEND_DIR`, `PROJECT_ROOT`, `DATA_DIR`, `SNAPSHOTS_DIR`, `EXPORTS_DIR`, `FRONTEND_DIST`.
* Parâmetros de Snapshots: `SNAPSHOTS_REMOTE_URL` (`http://366n:8001/api/snapshots`), `SNAPSHOTS_AUTO_SYNC` (`True`).
* Parâmetros de Servidor: `HOST` (`0.0.0.0`), `PORT` (`8687`).
* Parâmetros de Sessão: `SESSION_COOKIE_NAME` (`ver_estoque_session`), `SESSION_COOKIE_MAX_AGE` (30 dias), `SESSION_TTL_SECONDS` (48 horas).
* Credenciais Padrão: `INTRANET_DEFAULT_USER`, `INTRANET_DEFAULT_PASS`.

## Dependências (Grafo)
**⬅️ Quem chama este módulo (Entrada):**
* [[API_FastAPI_Main]]
* [[Servico_Orquestrador_Service]]
* [[Gerenciador_Snapshots]]
* [[Scraper_Intranet_PCP]]

**➡️ Quem este módulo chama (Saída/Uso):**
* Diretórios do sistema operacional (`./backend/data`, `./backend/data/snapshots`, `./backend/data/exports`).
* **Bibliotecas Externas:** `os`, `pathlib`.
