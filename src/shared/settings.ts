/** Parâmetros fixos da aplicação. Trocar de domínio = trocar a pasta de conhecimento, a pasta de contexto e as regras. */
export const SETTINGS = {
  assistantName: "Ventura Assist",
  company: "Porto Ventura Terminais",
  defaultModel: "gpt-4o-mini",
  embeddingModel: "text-embedding-3-small",
  databaseFile: "data/ventura.db",
  knowledgeDir: "conhecimento",
  contextDir: "contexto",
  requestTimeoutMs: 60_000,
  /** Temperatura baixa: o assistente deve ser previsível, não criativo. */
  temperature: 0.1,
  retry: { maxAttempts: 3, baseDelayMs: 1_000, maxDelayMs: 8_000 },
  chunk: {
    /** Tamanho máximo (caracteres) de um chunk; o corte respeita seções e frases. */
    maxChars: 700,
    /** Frases repetidas do chunk anterior (overlap) para não perder contexto na fronteira. */
    overlapSentences: 1,
  },
  retrieval: {
    topK: 4,
    /** Peso da similaridade semântica no score híbrido (o restante é palavra-chave). */
    semanticWeight: 0.7,
    /** Score mínimo para um chunk entrar no contexto; depende da escala de cada embedder. */
    minScore: { openai: 0.4, local: 0.26 } as Record<string, number>,
  },
  memory: {
    /** Turnos (pergunta + resposta) mantidos literalmente na janela da sessão. */
    windowTurns: 4,
    /** Quando a sessão passa deste número de turnos fora do resumo, os mais antigos são resumidos. */
    summarizeAfterTurns: 6,
    /** Máximo de fatos de perfil injetados por pergunta. */
    maxProfileFacts: 5,
  },
  /** Orçamento de tokens por bloco do contexto (estimativa: 1 token ~ 4 caracteres). */
  contextBudget: {
    total: 6_000,
    conhecimento: 2_400,
    historico: 1_200,
    resumo: 300,
    perfil: 200,
  },
  limits: { maxInputChars: 1_500, maxAnswerWords: 160 },
} as const;

export function minScoreFor(embedderName: string): number {
  return SETTINGS.retrieval.minScore[embedderName] ?? 0.4;
}
