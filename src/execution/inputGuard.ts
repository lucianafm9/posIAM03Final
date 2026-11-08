import { SETTINGS } from "../shared/settings.ts";
import { matchesAny } from "../shared/text.ts";
import { APPROVED, type ApprovedKey } from "../rules/messages.ts";
import {
  ACTION_REQUEST_SIGNALS,
  EMERGENCY_SIGNALS,
  ENCODED_PAYLOAD_SIGNALS,
  EXTRACTION_SIGNALS,
  INJECTION_SIGNALS,
  redactPii,
  SECRET_SIGNALS,
  THIRD_PARTY_SIGNALS,
} from "../rules/signals.ts";
import type { Alert } from "../context/contextBuilder.ts";
import type { Decision } from "../shared/types.ts";

export type InputBlock = {
  action: "block";
  motivo: string;
  regra: string;
  mensagem: ApprovedKey;
  decisao: Decision;
  desfecho: "emergencia" | "bloqueada" | "entrada_invalida";
  detalhe: string;
};

export type InputProceed = { action: "proceed"; sanitized: string; alertas: Alert[]; redactions: string[] };

export type InputVerdict = InputBlock | InputProceed;

function block(motivo: string, regra: string, mensagem: ApprovedKey, decisao: Decision, desfecho: InputBlock["desfecho"], detalhe: string): InputBlock {
  return { action: "block", motivo, regra, mensagem, decisao, desfecho, detalhe };
}

/**
 * Guarda de ENTRADA: roda antes de qualquer chamada ao modelo e antes de gravar memória.
 * A ordem importa: a segurança das pessoas (R03) vem antes de tudo; uma emergência escrita dentro de
 * uma tentativa de manipulação ainda recebe a orientação de emergência.
 */
export function inputGuard(message: string, maxChars: number = SETTINGS.limits.maxInputChars): InputVerdict {
  if (!message || message.trim() === "") return block("entrada_invalida", "R10", "entradaInvalida", "RECUSAR", "entrada_invalida", "a mensagem está vazia.");
  if (message.length > maxChars) {
    return block("entrada_invalida", "R10", "entradaInvalida", "RECUSAR", "entrada_invalida", `a mensagem tem ${message.length} caracteres e o limite é ${maxChars}.`);
  }

  const emergency = matchesAny(message, EMERGENCY_SIGNALS);
  if (emergency) return block("emergencia", "R03", "emergencia", "ENCAMINHAR", "emergencia", `sinal de emergência: ${emergency.source}`);

  if (matchesAny(message, SECRET_SIGNALS)) return block("segredo", "R06", "segredo", "RECUSAR", "bloqueada", "a mensagem contém uma senha");

  const encoded = ENCODED_PAYLOAD_SIGNALS.some((re) => {
    const m = message.match(re)?.[0];
    return !!m && /[a-z]/i.test(m) && /[\d+/=]/.test(m);
  });
  if (encoded) return block("manipulacao", "R05", "manipulacao", "RECUSAR", "bloqueada", "conteúdo codificado (possível instrução escondida)");

  const extraction = matchesAny(message, EXTRACTION_SIGNALS);
  if (extraction) return block("extracao", "R04", "extracao", "RECUSAR", "bloqueada", `pedido de extração: ${extraction.source}`);

  const injection = matchesAny(message, INJECTION_SIGNALS);
  if (injection) return block("manipulacao", "R05", "manipulacao", "RECUSAR", "bloqueada", `tentativa de manipulação: ${injection.source}`);

  const thirdParty = matchesAny(message, THIRD_PARTY_SIGNALS);
  if (thirdParty) return block("dados_terceiros", "R06", "dadosTerceiros", "RECUSAR", "bloqueada", `dados de outro colaborador: ${thirdParty.source}`);

  const alertas: Alert[] = [];
  const { text: sanitized, redactions } = redactPii(message);
  if (redactions.length > 0) alertas.push({ regra: "R06", texto: `Dados pessoais foram mascarados (${redactions.join(", ")}). Não peça nem repita dados pessoais.` });
  const action = matchesAny(message, ACTION_REQUEST_SIGNALS);
  if (action) {
    alertas.push({
      regra: "R07",
      texto: `O colaborador pede uma ação (${action.source}). Você não aprova, libera nem abre exceção: use decisao ENCAMINHAR, explique a regra e quem decide.`,
    });
  }
  return { action: "proceed", sanitized, alertas, redactions };
}

export function approvedText(key: ApprovedKey, detalhe = ""): string {
  return key === "entradaInvalida" ? `${APPROVED.entradaInvalida}${detalhe}` : APPROVED[key];
}
