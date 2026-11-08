import { normalize, terms } from "../shared/text.ts";

/**
 * Memória de trabalho aplicada à BUSCA: perguntas de continuação ("e para exportação?", "e se for reefer?")
 * não têm termos suficientes para recuperar o documento certo. Nesses casos, a consulta de busca
 * junta a pergunta anterior do usuário. A pergunta enviada ao modelo continua sendo a original.
 */
const CONTINUATION = /^(e|e se|e no|e na|e nos|e nas|e para|e pra|e quanto|e quando|e o|e a|e os|e as|mas e|nesse caso|neste caso|e depois|e se eu|e em)\b/;
const ANAPHORA = /\b(isso|disso|nisso|nesse|nessa|desse|dessa|daquele|daquela|naquele|naquela|aquele|aquela|esse prazo|essa regra|ele|ela|o mesmo|a mesma)\b/;

export type ContextualQuery = { query: string; usouHistorico: boolean; motivo?: string };

export function contextualizeQuery(question: string, previousQuestions: string[]): ContextualQuery {
  const previous = previousQuestions.at(-1);
  if (!previous) return { query: question, usouHistorico: false };
  const norm = normalize(question);
  const reason = CONTINUATION.test(norm)
    ? "pergunta de continuação"
    : ANAPHORA.test(norm)
      ? "referência a algo dito antes"
      : terms(question).length <= 1
        ? "pergunta curta demais para buscar sozinha"
        : undefined;
  return reason ? { query: `${previous} ${question}`, usouHistorico: true, motivo: reason } : { query: question, usouHistorico: false };
}
