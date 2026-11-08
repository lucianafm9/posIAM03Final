# INC-2026-014 — Queda do Portal do Transportador

Empresa: Porto Ventura Terminais (empresa fictícia, criada para fins acadêmicos)
Área responsável: TI — Sistemas Operacionais
Versão: relatório pós-incidente aprovado em 22/05/2026

## Resumo

Em 19/05/2026, o Portal do Transportador ficou indisponível das 07h10 às 10h05 (2 horas e 55 minutos). Prioridade P1, porque havia dois navios atracados. Foram feitos 214 agendamentos na planilha de contingência AG-CONT.

## Causa raiz

O certificado digital (SSL) do portal venceu às 07h00. O alerta de vencimento estava configurado para um e-mail de um empregado que já tinha saído da empresa, por isso ninguém foi avisado.

## Ações tomadas

O certificado foi renovado às 09h40 e o serviço foi restabelecido às 10h05, depois da limpeza de cache do balanceador. Os agendamentos de contingência foram lançados no portal até as 14h.

## Lições aprendidas e ações corretivas

- Os alertas de vencimento de certificados passaram a ir para a lista de e-mail da equipe (ti-plantao@portoventura.example), não para pessoas.
- O Ventura Monitor ganhou um alerta 30 dias antes do vencimento de qualquer certificado.
- O RB-01 passou a prever a planilha AG-CONT já a partir de 30 minutos de indisponibilidade.
