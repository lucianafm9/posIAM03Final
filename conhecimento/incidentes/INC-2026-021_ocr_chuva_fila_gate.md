# INC-2026-021 — Falhas de OCR e fila no gate durante chuva forte

Empresa: Porto Ventura Terminais (empresa fictícia, criada para fins acadêmicos)
Área responsável: TI — Automação de Gate e Operações de Gate
Versão: relatório pós-incidente aprovado em 18/07/2026

## Resumo

Em 14/07/2026, entre 15h e 18h, a taxa de falha de leitura do OCR nas pistas 2 e 3 chegou a 38%. A fila na via de acesso alcançou 1,8 km e o tempo médio de entrada passou de 6 para 41 minutos.

## Causa raiz

A chuva forte, combinada com o acúmulo de sujeira nas lentes, reduziu a qualidade das imagens. A limpeza das lentes estava prevista só para o dia seguinte, na rotina semanal.

## Ações tomadas

Os operadores passaram a usar a correção manual (RB-02) e a pista 4 foi aberta como reforço às 16h20. A Manutenção limpou as lentes às 17h30 e a taxa de falha voltou a 3%.

## Lições aprendidas e ações corretivas

- A limpeza das lentes passou a ser feita também antes de toda previsão de chuva forte emitida pela Defesa Civil.
- O limite de escalonamento do RB-02 foi fixado em 10% de falhas por pista em 1 hora.
- Foi aprovada a compra de câmeras com limpeza automática para as pistas 2 e 3, prevista para o 1º trimestre de 2027.
