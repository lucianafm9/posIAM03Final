import { SETTINGS } from "../shared/settings.ts";
import { DECISIONS, type Envelope, type RetrievedChunk } from "../shared/types.ts";
import { countWords, matchesAffirmative, matchesAny, numberTokens } from "../shared/text.ts";
import type { ApprovedKey } from "../rules/messages.ts";
import { OFFICIAL_NUMBERS } from "../rules/policy.ts";
import { AUTHORIZATION_CLAIMS, COMPLIANCE_WITH_ATTACK, PROMISE_SIGNALS, redactPii } from "../rules/signals.ts";

export type OutputContext = {
  conhecimento: RetrievedChunk[];
  perfil: { chave: string; valor: string }[];
  canary: string;
};

export type OutputViolation = { ok: false; regra: string; motivo: string; mensagem: ApprovedKey };

export type OutputOk = { ok: true; envelope: Envelope; correcoes: string[] };

export type OutputVerdict = OutputOk | OutputViolation;

const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}]/gu;

function violation(regra: string, motivo: string, mensagem: ApprovedKey): OutputViolation {
  return { ok: false, regra, motivo, mensagem };
}

/** Lê o contrato JSON, tolerando cercas de código (```json ... ```). */
export function parseEnvelope(raw: string): Envelope | undefined {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const data = JSON.parse(text) as Partial<Envelope>;
    if (!DECISIONS.includes(data.decisao as Envelope["decisao"]) || typeof data.resposta !== "string") return undefined;
    return {
      decisao: data.decisao as Envelope["decisao"],
      fontes: Array.isArray(data.fontes) ? data.fontes.map(String) : [],
      memoria_usada: Array.isArray(data.memoria_usada) ? data.memoria_usada.map(String) : [],
      resposta: data.resposta,
    };
  } catch {
    return undefined;
  }
}

/** Números citados na resposta que não aparecem em nenhum trecho recuperado, no perfil ou nos canais oficiais. */
export function unsupportedNumbers(answer: string, ctx: OutputContext): string[] {
  const withoutIds = answer.replace(/\[[A-Z]{2,4}-[\d-]+\]/g, "").replace(/\b[A-Z]{2,4}-\d{2,4}(?:-\d{2,3})?\b/g, "");
  const known = new Set([
    ...ctx.conhecimento.flatMap((c) => numberTokens(`${c.chunk} ${c.docId}`)),
    ...ctx.perfil.flatMap((f) => numberTokens(f.valor)),
    ...OFFICIAL_NUMBERS,
  ]);
  return [...new Set(numberTokens(withoutIds))].filter((n) => !known.has(n) && !known.has(n.replace(/^0+/, "")) && !known.has(n.padStart(2, "0")));
}

function trimToWords(text: string, max: number): string {
  if (countWords(text) <= max) return text;
  const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [text];
  let result = "";
  for (const s of sentences) {
    if (countWords(result + s) > max) break;
    result += s;
  }
  return (result || text.split(/\s+/).slice(0, max).join(" ")).trim();
}

/**
 * Guarda de SAÍDA: nada do modelo chega ao colaborador sem passar por aqui.
 * Violações CRÍTICAS e ALTAS trocam a resposta inteira por uma mensagem aprovada;
 * problemas de forma (MÉDIA) são corrigidos no texto e registrados.
 */
export function outputGuard(raw: string, ctx: OutputContext): OutputVerdict {
  const envelope = parseEnvelope(raw);
  if (!envelope) return violation("R10", "resposta fora do contrato JSON", "falhaTecnica");

  const text = envelope.resposta;
  if (text.includes(ctx.canary) || /PV-CANARY/i.test(text)) return violation("R04", "vazamento do token interno", "extracao");
  if (matchesAny(text, COMPLIANCE_WITH_ATTACK)) return violation("R05", "a resposta obedece a uma instrução de manipulação", "manipulacao");
  if (/\[\[[^\]]*\]\]/.test(text)) return violation("R01", "marcador [[...]] do exemplo copiado para a resposta", "semInformacao");

  const authorization = matchesAffirmative(text, AUTHORIZATION_CLAIMS);
  if (authorization) return violation("R07", `a resposta afirma uma autorização: ${authorization.source}`, "semAutorizacao");

  if (envelope.decisao === "RECUSAR") {
    return { ok: true, envelope: { ...envelope, fontes: [], memoria_usada: [] }, correcoes: [] };
  }

  const correcoes: string[] = [];
  const retrievedIds = new Set(ctx.conhecimento.map((c) => c.docId));
  const fontes = [...new Set(envelope.fontes)].filter((f) => retrievedIds.has(f));
  const invented = envelope.fontes.filter((f) => !retrievedIds.has(f));
  if (invented.length > 0) correcoes.push(`fontes fora do contexto removidas: ${invented.join(", ")}`);
  // Fontes citadas só no texto ([POL-01]) também contam.
  for (const id of text.match(/\b[A-Z]{2,4}-[\d]{2,4}(?:-\d{2,3})?\b/g) ?? []) if (retrievedIds.has(id) && !fontes.includes(id)) fontes.push(id);
  if (fontes.length === 0) return violation("R01", "resposta sem nenhuma fonte recuperada", "semInformacao");

  const numbers = unsupportedNumbers(text, ctx);
  if (numbers.length > 0) return violation("R01", `números sem respaldo nos documentos: ${numbers.join(", ")}`, "semInformacao");

  let resposta = text;
  const promise = matchesAffirmative(resposta, PROMISE_SIGNALS);
  if (promise) {
    resposta = (resposta.match(/[^.!?]+[.!?]+/g) ?? [resposta]).filter((s) => !matchesAny(s, PROMISE_SIGNALS)).join(" ").trim();
    correcoes.push(`promessa removida (${promise.source})`);
  }
  const { text: redacted, redactions } = redactPii(resposta);
  if (redactions.length > 0) correcoes.push(`dados pessoais mascarados: ${redactions.join(", ")}`);
  resposta = redacted;
  if (EMOJI.test(resposta)) {
    resposta = resposta.replace(EMOJI, "").replace(/\s{2,}/g, " ").trim();
    correcoes.push("emojis removidos");
  }
  if (countWords(resposta) > SETTINGS.limits.maxAnswerWords) {
    resposta = trimToWords(resposta, SETTINGS.limits.maxAnswerWords);
    correcoes.push(`resposta encurtada para ${SETTINGS.limits.maxAnswerWords} palavras`);
  }

  const perfilKeys = new Set(ctx.perfil.map((f) => f.chave));
  const memoria_usada = envelope.memoria_usada.filter((k) => perfilKeys.has(k));
  if (memoria_usada.length < envelope.memoria_usada.length) correcoes.push("chaves de memória inexistentes removidas");

  return { ok: true, envelope: { ...envelope, fontes, memoria_usada, resposta }, correcoes };
}
