---
modulo: "Calculo_Dias_Uteis_Feriados"
tipo: "dominio"
data_atualizacao: 2026-11-05
tags: [regras-negocio, calculo, parametros, feriados, calendario, leadtime]
---

# Regra: Calculo_Dias_Uteis_Feriados

**Contexto:** O agendamento da data de abertura de uma Ordem de Produção (OP) depende da retroação de prazos produtivos (lead times) a partir da data de entrega do pedido, devendo desconsiderar finais de semana e feriados/recessos específicos da empresa.

## Lógica e Parâmetros

- **Variáveis de Entrada Obrigatórias:**
  - `data_referencia`: Objeto `date` ou String (`YYYY-MM-DD`).
  - `dias_subtrair`: Inteiro positivo (quantidade de dias de trabalho industrial necessários).
  - `tabela_feriados`: Conjunto (`set`) de datas cadastradas no arquivo `backend/feriados.txt` (extraídas da Intranet via `backend/feriados.py`).
- **Condicionais Críticas:**
  - O cálculo itera dia a dia regressivamente:
    - Se o dia for sábado (`weekday() == 5`) ou domingo (`weekday() == 6`), o dia é ignorado na contagem útil.
    - Se a data estiver presente em `tabela_feriados`, o dia é considerado não útil e é ignorado.
    - Caso contrário, consome 1 dia útil da cota até zerar `dias_subtrair`.
- **Saída Esperada:**
  - `data_abertura_calculada`: String de data no formato ISO (`YYYY-MM-DD`) correspondente ao dia útil de abertura da OP.

## Dependências

**⬅️ Consumido por:** [[Servico_Orquestrador_Service]]
