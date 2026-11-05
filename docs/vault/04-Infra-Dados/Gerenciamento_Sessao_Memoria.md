---
modulo: "Gerenciamento_Sessao_Memoria"
tipo: "infra"
linguagem: "python"
data_atualizacao: 2026-11-05
tags: [codigo, infra, dados, session, state, threading, memoria]
---

# Módulo: Gerenciamento_Sessao_Memoria

**Responsabilidade:** Mecanismo de isolamento multiusuário em memória (`SessionState`), garantindo que simulações de pedidos e caches de fila de um usuário não interfiram nas consultas de outros operadores simultâneos do sistema.

## Principais Funções / Métodos
* `SessionState`: Classe que armazena `session_id`, `created_at`, `last_accessed`, dicionário de `pedidos_simulados` e cache do DataFrame de consumo efetivo (`cons_efetivo`).
* `obter_sessao(session_id)`: Recupera a sessão ativa sob trava `threading.Lock` ou inicializa uma nova instância caso não exista.
* `_limpar_sessoes_expiradas_locked()`: Remove instâncias de sessão inativas há mais de `SESSION_TTL_SECONDS` (48 horas), prevenindo vazamentos de memória no processo.
* `is_valid_session_id(sid)`: Valida se o identificador segue o formato de UUID seguro.

## Dependências (Grafo)
**⬅️ Quem chama este módulo (Entrada):**
* [[API_FastAPI_Main]]
* [[Servico_Orquestrador_Service]]

**➡️ Quem este módulo chama (Saída/Uso):**
* [[Configuracao_Settings]]
* **Bibliotecas Externas:** `threading`, `time`, `uuid`.
