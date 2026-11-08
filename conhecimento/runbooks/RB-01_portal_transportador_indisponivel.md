# RB-01 — Portal do Transportador indisponível

Empresa: Porto Ventura Terminais (empresa fictícia, criada para fins acadêmicos)
Área responsável: Tecnologia da Informação (TI) — Sistemas Operacionais
Versão: 1.3 — vigência a partir de 05/06/2026

## Objetivo

Orientar o atendimento quando o Portal do Transportador, usado para criar e cancelar agendamentos de caminhões no gate, fica fora do ar ou lento.

## Sintomas

O transportador relata tela de erro "503 — Serviço indisponível", login que não conclui ou tempo de resposta acima de 30 segundos ao salvar um agendamento. A Central de Atendimento ao Transportador recebe mais de 5 chamados sobre o mesmo erro em 15 minutos.

## Diagnóstico inicial

1. Confirme a indisponibilidade acessando o portal pela rede interna e pela rede externa (4G).
2. Verifique o painel de monitoramento Ventura Monitor, aba "Portais". Status vermelho indica queda do serviço; status amarelo indica lentidão.
3. Se só a rede externa falha, o problema é no link de internet ou no firewall: acione a equipe de Infraestrutura.

## Contorno operacional

Enquanto o portal estiver indisponível por mais de 30 minutos, a Central de Atendimento ao Transportador pode registrar agendamentos manualmente na planilha de contingência AG-CONT, limitada a 20 veículos por janela. Os agendamentos de contingência devem ser lançados no portal em até 4 horas após o restabelecimento.

## Escalonamento

Indisponibilidade acima de 30 minutos é incidente de prioridade P2: abra chamado na Central de Serviços (ramal 4000) e acione o plantão de Sistemas Operacionais. Indisponibilidade acima de 2 horas ou em dia de navio atracado é P1 e exige comunicação ao gerente de Operações de Gate.

## Encerramento

Após a normalização, a TI registra o incidente no Registro de Incidentes com causa, horário de início e fim e ações tomadas, em até 2 dias úteis.
