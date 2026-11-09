# 7. Decisão de customização

[← Voltar ao README](../README.md)

## A pergunta

Como fazer um modelo genérico responder **com o conhecimento do Porto Ventura** e **com o comportamento que a empresa
exige** (citar fonte, recusar o que não sabe, não aprovar nada, proteger dados)? Havia cinco caminhos possíveis, e
cada um resolve uma parte diferente do problema.

## As opções

| # | Opção | Como funciona | O que resolve | O que não resolve |
|---|---|---|---|---|
| 1 | **Só prompt** (engenharia de prompt sem dados) | instruções e exemplos; o modelo responde com o que sabe | tom, formato, limites de comportamento | o modelo **não conhece** a empresa: ou recusa, ou inventa |
| 2 | **Contexto longo** | todos os documentos vão no prompt, em toda pergunta | conhecimento, sem infraestrutura de busca | custo e latência crescem com a base; o trecho certo se perde no meio de muitos |
| 3 | **RAG + engenharia de contexto** (escolhida) | busca os trechos relevantes e monta o contexto em blocos, com regras e guardas em código | conhecimento atualizável, fonte verificável, custo baixo | depende da qualidade da busca; o modelo ainda decide **como** usar o contexto |
| 4 | **Fine-tuning sem contexto** | treina o modelo com perguntas e respostas da empresa | comportamento e estilo | não ensina fatos de forma confiável; tem de ser retreinado a cada mudança |
| 5 | **Fine-tuning + RAG** | modelo ajustado para usar bem o contexto recuperado | comportamento mais estável com o conhecimento vindo da busca | custo de treinar, hospedar e reavaliar cada versão |

## A evidência

As opções 1, 2 e 3 foram medidas **nesta plataforma**, com o gpt-4o-mini, os mesmos 39 casos e 3 execuções por caso
(117 respostas por opção). As opções 4 e 5 foram medidas no **D04**, com a mesma empresa e as mesmas políticas, usando
o Qwen2.5-1.5B com LoRA treinado no Colab.

### Opções 1, 2 e 3 (este projeto, gpt-4o-mini)

| Opção | Acerto | Conhecimento | Memória | Alucinação | Críticos seguros | Consistência | Tokens de entrada | Latência mediana | Custo / mil respostas |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1. Só prompt | 23,1% | 18,8% | 0% | **12,8%** | 18/42 | 100% | 52 | 1,1 s | US$ 0,04 |
| 2. Contexto longo (+ memória, regras e guardas) | 91,5% | 89,6% | 76,2% | 0% | 42/42 | 94,9% | **12.758** | 1,6 s (p95 3,4 s) | **US$ 1,56** |
| **3. RAG + contexto (plataforma)** | **97,4%** | **100%** | **85,7%** | **0%** | **42/42** | **100%** | 2.744 | 1,8 s (p95 2,8 s) | **US$ 0,34** |

Custo calculado com os tokens reais de cada chamada e o preço de tabela do gpt-4o-mini (US$ 0,15 por milhão de tokens
de entrada e US$ 0,60 por milhão de saída), configurável em `PRICE_PER_MILLION`.

Para comparar só a **estratégia de conhecimento**, a opção 2 roda com a mesma memória, as mesmas regras e as mesmas
guardas da 3 (modo `contexto_longo` do pipeline). Ela recebe os 71 trechos da base em toda pergunta, em vez dos 4
melhores.

### Opções 4 e 5 (D04, Qwen2.5-1.5B + LoRA)

| Modo do D04 | Equivale a | Acerto | Alucinação | Recusa correta | Cita a fonte certa |
|---|---|---:|---:|---:|---:|
| A. Base, sem contexto | opção 1 | 20% | 60% | 66,7% | 0% |
| B. Base, com contexto | opção 3 | 80% | 15% | 66,7% | 57,1% |
| C. LoRA, sem contexto | **opção 4** | 10% | **75%** | 33,3% | 0% |
| D. LoRA, com contexto | **opção 5** | **85%** | 15% | **100%** | **92,9%** |

## Leitura

**Só prompt (1) não é opção para conhecimento interno.** O modelo não conhece a empresa. Em 12,8% das respostas ele
inventou com confiança: "A licença-paternidade é de 5 dias corridos... pode ter direito a 20 dias" (benefício que a
empresa não documenta), uma receita com "forno a 180 °C" e "Paris" para perguntas fora do escopo. Quando acertou
("24 horas de antecedência"), foi palpite genérico que coincidiu com a política, sem fonte para conferir. O baixo
custo não compensa: é a opção mais barata e a única que alucina.

**Contexto longo (2) funciona, mas custa 4,6 vezes mais e erra mais.**

- **Custo:** 12.758 tokens de entrada por pergunta, contra 2.744. Com 17 documentos isso já representa 4,6 vezes o
  custo. Cada documento novo aumenta o custo de **todas** as perguntas, enquanto no RAG o custo por pergunta fica
  estável.
- **Qualidade:** o acerto em conhecimento caiu de 100% para 89,6%. O modelo recusou K08 ("o terminal armazena carga
  radioativa?") nas 3 execuções e K03 ("EPIs do cais") em 2 das 3, com a resposta presente no contexto, só que
  diluída entre 71 trechos. É o efeito conhecido de **"perdido no meio"**: quanto mais texto irrelevante ao redor,
  maior a chance de o modelo não usar o trecho certo.
- **Consistência:** 94,9% contra 100%. A mesma pergunta teve resultados diferentes entre execuções (M02 falhou em 2
  das 3).
- **Latência:** a mediana ficou parecida (1,6 s contra 1,8 s; o RAG inclui a chamada de embedding da busca), mas a
  cauda piorou (p95 de 3,4 s contra 2,8 s).
- **O que o contexto longo tem de bom:** dispensa a busca, então não existe "o trecho certo não foi recuperado". Para
  uma base muito pequena e estável (poucas páginas), seria uma escolha razoável.

**Fine-tuning sem contexto (4) foi o pior resultado medido em todo o módulo: 75% de alucinação.** O LoRA ensinou o
modelo a responder curto e com confiança, mas não os fatos. Com 40 exemplos, a confiança aumentou e o conhecimento
continuou ausente.

**Fine-tuning + RAG (5) ensina comportamento**: no D04, a recusa correta foi de 66,7% para 100% e a citação da fonte,
de 57,1% para 92,9%. Esse é exatamente o comportamento que esta plataforma obtém de outra forma:

| Comportamento que o LoRA ensinou no D04 | Como a plataforma obtém aqui | Resultado medido |
|---|---|---|
| Recusar quando a base não responde | não chama o modelo sem trecho acima do corte; `RECUSAR` vira mensagem aprovada | fora da base: 100% |
| Citar a fonte | contrato JSON com `fontes`; a saída remove fonte inventada e bloqueia resposta sem fonte; a execução escreve a linha `Fontes:` | 100% das respostas com fonte recuperada |
| Formato estável | JSON mode + contrato | 0 respostas fora do contrato em 441 chamadas ao modelo (rodada v1 + rodada final) |
| Não inventar números | checagem numérica contra os trechos (o LoRA não tinha essa garantia) | 0% de alucinação |

## Decisão

**RAG + engenharia de contexto + guardas determinísticas (opção 3), sem fine-tuning em produção.**

| Critério | Peso no domínio | Opção 3 atende? |
|---|---|---|
| Fatos corretos e verificáveis (prazo errado = custo real no porto) | crítico | sim: fonte em toda resposta, checagem numérica, 0% de alucinação |
| Conhecimento muda com frequência (runbooks, incidentes, versões de política) | alto | sim: trocar o arquivo e reingerir; nada para retreinar |
| Comportamento controlado (emergência, LGPD, autorizações) | crítico | sim: decidido em código, testável e auditável |
| Personalização por usuário (memória) | alto | sim: contexto dinâmico por pergunta (o treino seria igual para todos) |
| Custo por resposta | médio | US$ 0,34 por mil respostas, 4,6 vezes menos que o contexto longo |
| Infraestrutura | médio | só a API; sem GPU para treinar ou servir |

## Quando reconsiderar

| Gatilho | Mudança | Por quê |
|---|---|---|
| Volume de milhares de perguntas por dia | opção 5: modelo pequeno ajustado + o mesmo RAG e guardas | o custo por token de um modelo próprio pequeno passa a compensar o treino e a hospedagem |
| O prompt não estabiliza um comportamento | ajuste fino só desse comportamento | é o caso do M04: o vínculo "terceirizado" chega ao contexto, mas o modelo não o aplica. Antes, tentar um alerta de execução; se não bastar, treinar com exemplos em que o perfil muda a resposta |
| Base muito pequena e estável | opção 2 (contexto longo) | sem busca para manter, e o custo continua baixo |
| Base de milhares de documentos | RAG com índice vetorial (pgvector) e reranqueamento | a busca por força bruta deixa de ser viável |

Os dados para um eventual ajuste fino já existem: os turnos aprovados (`turns` com desfecho `respondida` e fontes) e
os casos de avaliação viram um dataset JSONL no formato de mensagens (`system` com o contexto montado, `user` e
`assistant` com o envelope JSON), como no `toJsonl` / `validateJsonl` da aula.

**Regra que vale para qualquer caminho, confirmada nos dois projetos:** fine-tuning ajusta o comportamento; o
conhecimento vem do contexto.
