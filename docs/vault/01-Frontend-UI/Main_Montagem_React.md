---
modulo: "main.jsx"
tipo: "frontend"
linguagem: "javascript"
data_atualizacao: 2026-11-05
tags: [codigo, frontend, javascript, react, vite]
---

# Módulo: main.jsx

**Responsabilidade:** Ponto de entrada do bundle React compilado pelo Vite, responsável por montar a árvore de componentes no elemento DOM raiz (`#root`) com suporte a StrictMode e carregar o tema visual Tailwind.

## Principais Funções / Métodos
* `createRoot(document.getElementById('root')).render(...)`: Inicializa a raiz de renderização do React 18 e injeta o componente [[VerEstoque_Componente]].

## Dependências (Grafo)
**⬅️ Quem chama este módulo (Entrada):**
* `index.html` (Servido por [[API_FastAPI_Main]])

**➡️ Quem este módulo chama (Saída/Uso):**
* [[VerEstoque_Componente]]
* `index.css` (Tailwind CSS)
* **Bibliotecas Externas:** `react`, `react-dom/client`.
