# 7. Decisão de customização: RAG + engenharia de contexto, sem fine-tuning em produção

[← Voltar ao README](../README.md)

## Decisão

O comportamento do Ventura Assist é customizado por **RAG + engenharia de contexto + guardas determinísticas**. O
fine-tuning **não** foi usado nesta plataforma. A decisão se apoia no experimento do D04, feito com a mesma empresa e
as mesmas políticas, e nas características do domínio.

## O que já foi medido (D04)

No D04, o Qwen2.5-1.5B-Instruct foi treinado com LoRA (r=16, alpha=32, `q_proj`/`v_proj`, 3 épocas, 40 exemplos em
JSONL de mensagens) e comparado em 4 modos, nas mesmas 20 perguntas de teste:

| Modo | Acerto geral | Alucinação | Recusa correta | Cita a fonte certa |
|---|---:|---:|---:|---:|
| A. Base, sem contexto | 20% | 60% | 66,7% | 0% |
| B. Base, com contexto (RAG) | 80% | 15% | 66,7% | 57,1% |
| C. LoRA, sem contexto | 10% | **75%** | 33,3% | 0% |
| D. LoRA, com contexto | **85%** | 15% | **100%** | **92,9%** |

Leitura:

1. **O conhecimento vem do contexto, não do treino.** A → B levou o acerto nas perguntas da base de 0% para 85,7% sem
   treino nenhum. C (LoRA sem contexto) foi o pior modo: o adapter aprendeu a responder com confiança, mas não os fatos.
2. **O fine-tuning ensinou comportamento** (recusar fora da base, citar a fonte, formato curto): B → D.
3. **Esse comportamento é exatamente o que esta plataforma garante em código**, com mais controle:

| Comportamento que o LoRA ensinou no D04 | Como a plataforma obtém aqui |
|---|---|
| Recusar quando a base não responde | não chama o modelo sem trecho acima do corte; `decisao: RECUSAR` vira mensagem aprovada |
| Citar a fonte | contrato JSON com `fontes`; a saída remove fonte inventada e bloqueia resposta sem fonte; a execução escreve a linha `Fontes:` |
| Formato curto e estável | JSON mode do gpt-4o-mini + contrato + limite de palavras na saída |
| Não inventar números | checagem numérica contra os trechos (o LoRA não tinha essa garantia) |

## Critérios da decisão

| Critério | RAG + contexto | Fine-tuning |
|---|---|---|
| Conhecimento muda com frequência (runbooks, incidentes novos, versões de políticas) | trocar o arquivo e reingerir | retreinar a cada mudança, com risco de o modelo "lembrar" a versão antiga |
| Rastreabilidade (de onde veio a resposta?) | fonte e seção em toda resposta | o fato fica nos pesos, sem fonte verificável |
| Controle de comportamento crítico (emergência, LGPD, autorizações) | determinístico, testável, auditável | probabilístico |
| Memória por usuário | contexto dinâmico por pergunta | não se aplica (o treino é igual para todos) |
| Custo e operação | só API; sem GPU | GPU para treinar e servir (ou fine-tuning gerenciado), pipeline de dados e reavaliação a cada versão |
| Volume de dados | 17 documentos bastam | 40 exemplos foram suficientes para comportamento, não para fatos (C = 75% de alucinação) |

## Quando o fine-tuning passaria a valer a pena

O fine-tuning não foi descartado; ele tem lugar como **otimização**, sempre combinado com RAG (modo D do D04, nunca o C):

1. **Custo em escala:** com milhares de perguntas por dia, um modelo pequeno ajustado (ex.: Qwen 1.5B com LoRA, ou
   fine-tuning gerenciado de um modelo menor) pode substituir o gpt-4o-mini, mantendo o RAG e as guardas.
2. **Comportamento que o prompt não estabiliza.** A rodada com o gpt-4o-mini confirmou a escolha e mostrou onde ela
   tem limite:
   - o **contrato JSON foi estável**: nenhuma resposta fora do contrato nas 348 chamadas ao modelo (174 na v1 e 174 na
     v2, nas configurações que usam o contrato);
   - o **excesso de recusa** da v1 (o modelo copiava o exemplo de "não encontrei") foi resolvido **por contexto**, com
     a v2 das instruções e dos exemplos: conhecimento de 75% para 100%, sem treino;
   - o que o contexto ainda não resolveu é o **uso de um fato de perfil quando a pergunta não depende dele de forma
     explícita** (M04: o vínculo terceirizado chega ao contexto, mas não é aplicado). Se um alerta de execução também
     não resolver, esse é o candidato a ajuste fino: exemplos em que o perfil muda a resposta, com `memoria_usada`
     preenchida.
3. **Dados para isso já existem:** os turnos aprovados (`turns` com desfecho `respondida` e fontes) e os casos de
   avaliação viram um dataset JSONL no formato de mensagens (`system` com o contexto montado, `user`, `assistant` com
   o envelope JSON), como o `toJsonl` / `validateJsonl` da aula.

Mesmo nesse cenário, a regra de ouro do D04 continua: **fine-tuning ajusta o comportamento; o conhecimento vem do
contexto**.
