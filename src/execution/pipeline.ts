import { SETTINGS } from "../shared/settings.ts";
import type { Decision, Embedder, LlmClient, Message, ProfileFact, RetrievedChunk } from "../shared/types.ts";
import { normalize } from "../shared/text.ts";
import { APPROVED } from "../rules/messages.ts";
import { buildContext, CANARY, type ManifestEntry } from "../context/contextBuilder.ts";
import type { StaticModule } from "../context/moduleLoader.ts";
import type { Glossary } from "../knowledge/glossary.ts";
import { retrieve } from "../knowledge/retriever.ts";
import type { VectorRepository } from "../knowledge/vectorRepository.ts";
import type { MemoryService } from "../memory/memoryService.ts";
import { detectMemoryIntent } from "../memory/intents.ts";
import { ALLOWED_KEYS } from "../memory/profileMemory.ts";
import type { ContextualQuery } from "../memory/queryRewriter.ts";
import { describeError } from "../llm/errors.ts";
import { withRetry } from "../llm/withRetry.ts";
import { approvedText, inputGuard } from "./inputGuard.ts";
import { outputGuard } from "./outputGuard.ts";
import { Trace, type TraceStep } from "./trace.ts";

/** Configuração do pipeline. As variações existem para a avaliação comparar o sistema com e sem cada camada. */
export type PipelineMode = "completo" | "sem_memoria" | "llm_puro";

export type Deps = {
  llm: LlmClient;
  embedder: Embedder;
  knowledge: VectorRepository;
  memory: MemoryService;
  modules: StaticModule[];
  glossary?: Glossary;
  mode?: PipelineMode;
  onNotice?: (text: string) => void;
};

export type Desfecho =
  | "respondida"
  | "encaminhada"
  | "sem_informacao"
  | "emergencia"
  | "bloqueada"
  | "entrada_invalida"
  | "memoria"
  | "falha";

export type AnswerResult = {
  resposta: string;
  decisao: Decision;
  desfecho: Desfecho;
  fontes: { docId: string; titulo: string; secao: string }[];
  memoria: {
    usada: string[];
    gravada: ProfileFact[];
    rejeitada: { trecho: string; motivo: string }[];
    consulta?: ContextualQuery;
    resumiu: number;
  };
  llmChamado: boolean;
  trace: TraceStep[];
  contexto?: { manifest: ManifestEntry[]; tokens: number; messages: Message[] };
};

const QUESTION_HINT = /\?|\b(qual|quais|quando|quanto|quantos|quantas|como|onde|posso|pode|preciso|devo|tenho|existe|vale|o que|por que|qual e)\b/;

function sourcesOf(ids: string[], chunks: RetrievedChunk[]): AnswerResult["fontes"] {
  return ids.map((id) => {
    const c = chunks.find((x) => x.docId === id)!;
    return { docId: id, titulo: c.titulo, secao: c.secao.split(" > ").slice(1).join(" > ") };
  });
}

function withFooter(text: string, fontes: AnswerResult["fontes"]): string {
  if (fontes.length === 0) return text;
  return `${text}\n\nFontes: ${fontes.map((f) => `${f.docId} — ${f.titulo}${f.secao ? ` (${f.secao})` : ""}`).join("; ")}`;
}

function describeProfile(facts: ProfileFact[]): string {
  if (facts.length === 0) return APPROVED.memoriaVazia;
  return [
    "Estes são os dados de perfil que guardei, informados por você:",
    ...facts.map((f) => `- ${f.chave}: ${f.valor}`),
    'Uso esses dados só para personalizar as respostas. Para apagar, escreva "/esquecer" ou "esqueça meus dados".',
  ].join("\n");
}

/**
 * Pipeline de uma pergunta (evolução do safeRagAnswer da aula). Ordem:
 *  0. intenção sobre a memória (ver / apagar)       5. busca na base (consulta contextualizada pela memória)
 *  1. guarda de entrada                              6. montagem do contexto modular com orçamento
 *  2. aprendizado de perfil (memória longa)          7. geração com retentativa
 *  3. confirmação quando a mensagem só informa perfil  8. guarda de saída + fontes
 *  4. leitura da memória (perfil relevante, resumo, janela)  9. gravação do turno e resumo da sessão
 * Princípio: o prompt orienta, a execução garante.
 */
export async function answer(userId: string, sessionId: string, message: string, deps: Deps): Promise<AnswerResult> {
  const mode = deps.mode ?? "completo";
  const useMemory = mode === "completo";
  const trace = new Trace();
  const memoria: AnswerResult["memoria"] = { usada: [], gravada: [], rejeitada: [], resumiu: 0 };

  const finish = async (
    resposta: string,
    decisao: Decision,
    desfecho: Desfecho,
    extra: Partial<AnswerResult> & { perguntaGravada: string; respostaGravada?: string; noContexto: boolean },
  ): Promise<AnswerResult> => {
    if (mode !== "llm_puro") {
      const recorded = await deps.memory.record(
        sessionId,
        { pergunta: extra.perguntaGravada, resposta: extra.respostaGravada ?? resposta, desfecho, fontes: (extra.fontes ?? []).map((f) => f.docId) },
        useMemory && extra.noContexto,
      );
      memoria.resumiu = recorded.resumiu;
      if (recorded.resumiu > 0) trace.add("memoria", "info", `${recorded.resumiu} turno(s) antigo(s) comprimido(s) no resumo da sessão`, "R09");
    }
    return {
      resposta,
      decisao,
      desfecho,
      fontes: extra.fontes ?? [],
      memoria,
      llmChamado: extra.llmChamado ?? false,
      trace: trace.steps,
      ...(extra.contexto ? { contexto: extra.contexto } : {}),
    };
  };

  // Linha de base da avaliação: o "chatbot genérico", sem RAG, sem memória e sem guardas.
  if (mode === "llm_puro") return answerWithoutContext(message, deps, trace, memoria);

  // 0. Pedidos sobre a própria memória: resolvidos sem modelo (transparência e eliminação, LGPD).
  const intent = useMemory ? detectMemoryIntent(message) : undefined;
  if (intent === "ver_memoria") {
    trace.add("memoria", "info", "o colaborador pediu para ver os dados guardados", "R09");
    return finish(describeProfile(deps.memory.profile(userId)), "RESPONDER", "memoria", { perguntaGravada: message, noContexto: false });
  }
  if (intent === "apagar_memoria") {
    const removed = deps.memory.forget(userId);
    deps.memory.startSession(userId, sessionId); // a conversa continua numa sessão vazia, sem histórico
    trace.add("memoria", "info", `perfil apagado (${removed} fato(s)) e sessões encerradas`, "R09");
    return { resposta: APPROVED.memoriaApagada, decisao: "RESPONDER", desfecho: "memoria", fontes: [], memoria, llmChamado: false, trace: trace.steps };
  }

  // 1. Entrada.
  const verdict = inputGuard(message);
  if (verdict.action === "block") {
    trace.add("entrada", "bloqueado", `${verdict.motivo}: ${verdict.detalhe}`, verdict.regra);
    const masked = verdict.motivo === "segredo" ? "[mensagem com senha não registrada]" : message.slice(0, 200);
    return finish(approvedText(verdict.mensagem, verdict.detalhe), verdict.decisao, verdict.desfecho, { perguntaGravada: masked, noContexto: false });
  }
  trace.add("entrada", verdict.alertas.length ? "alerta" : "ok", verdict.alertas.map((a) => `${a.regra}: ${a.texto}`).join(" | ") || "nenhum sinal de risco");
  const pergunta = verdict.sanitized;

  // 2. Memória de longo prazo: aprende o perfil a partir da mensagem já mascarada.
  if (useMemory) {
    const learned = deps.memory.learn(userId, pergunta);
    memoria.gravada = learned.gravar;
    memoria.rejeitada = learned.rejeitados;
    if (learned.gravar.length) trace.add("memoria", "info", `gravou: ${learned.gravar.map((f) => `${f.chave}=${f.valor}`).join(", ")}`, "R09");
    for (const r of learned.rejeitados) trace.add("memoria", "alerta", `não gravou "${r.trecho}" (${r.motivo})`, r.motivo.slice(0, 3));
  }

  // 3. Mensagem que só informa perfil ou só pede para memorizar algo: confirma sem chamar o modelo.
  const isQuestion = QUESTION_HINT.test(normalize(pergunta));
  if (useMemory && !isQuestion && (memoria.gravada.length > 0 || memoria.rejeitada.length > 0)) {
    const parts: string[] = [];
    if (memoria.gravada.length) {
      parts.push(`Anotado: ${memoria.gravada.map((f) => `${f.chave.replace("_", " ")} = ${f.valor}`).join("; ")}. Vou usar isso para personalizar as respostas.`);
    }
    if (memoria.rejeitada.length) {
      parts.push("Não guardei a outra parte: a memória só registra dados do seu perfil. Regras, prazos e valores da empresa sempre vêm dos documentos oficiais.");
    }
    parts.push('Para ver o que guardei, pergunte "o que você sabe sobre mim?".');
    return finish(parts.join(" "), "RESPONDER", "memoria", { perguntaGravada: pergunta, noContexto: true });
  }

  // 4. Leitura da memória.
  const snapshot = useMemory
    ? deps.memory.read(userId, sessionId, pergunta)
    : { perfilRelevante: [], perfilCompleto: [], resumo: "", janela: [], consulta: { query: pergunta, usouHistorico: false } };
  memoria.consulta = snapshot.consulta;
  if (useMemory) {
    trace.add(
      "memoria",
      "info",
      `perfil relevante: ${snapshot.perfilRelevante.map((f) => `${f.chave} (${f.motivo})`).join(", ") || "nenhum"}; ` +
        `janela: ${snapshot.janela.length / 2} turno(s); resumo: ${snapshot.resumo ? "sim" : "não"}` +
        (snapshot.consulta.usouHistorico ? `; busca contextualizada (${snapshot.consulta.motivo})` : ""),
    );
  }

  // 5. Busca.
  let retrieval;
  try {
    retrieval = await withRetry(() => retrieve(snapshot.consulta.query, deps.knowledge, deps.embedder, deps.glossary), {
      ...SETTINGS.retry,
      onRetry: ({ attempt, maxAttempts, delayMs, error }) => deps.onNotice?.(`[Busca: ${describeError(error)} Nova tentativa ${attempt + 1}/${maxAttempts} em ${(delayMs / 1000).toFixed(1)}s...]`),
    });
  } catch (error) {
    trace.add("recuperacao", "bloqueado", `busca indisponível: ${describeError(error)}`, "R01");
    return finish(APPROVED.falhaTecnica, "RECUSAR", "falha", { perguntaGravada: pergunta, noContexto: false });
  }
  for (const d of retrieval.descartados) trace.add("recuperacao", "alerta", `descartado ${d.docId}: ${d.motivo}`, "R05");
  if (retrieval.chunks.length === 0) {
    trace.add("recuperacao", "bloqueado", `nenhum trecho acima do score mínimo ${retrieval.minScore} (melhor: ${retrieval.melhorScore.toFixed(2)})`, "R02");
    return finish(APPROVED.semInformacao, "RECUSAR", "sem_informacao", { perguntaGravada: pergunta, noContexto: true });
  }
  if (retrieval.expansoes.length) trace.add("recuperacao", "info", `glossário expandiu a busca: ${retrieval.expansoes.join("; ")}`);
  trace.add("recuperacao", "ok", retrieval.chunks.map((c) => `${c.docId} (${c.score.toFixed(2)})`).join("; "));

  // 6. Contexto.
  const built = buildContext({
    modules: deps.modules,
    pergunta,
    alertas: verdict.alertas,
    perfil: snapshot.perfilRelevante,
    resumo: snapshot.resumo,
    janela: snapshot.janela,
    conhecimento: retrieval.chunks,
  });
  trace.add("contexto", "info", `~${built.tokens} tokens; ${built.manifest.map((m) => `${m.bloco}=${m.tokens}${m.cortados ? ` (-${m.cortados})` : ""}`).join(", ")}`);
  const contexto = { manifest: built.manifest, tokens: built.tokens, messages: built.messages };

  // 7. Geração.
  let raw: string;
  try {
    raw = await withRetry(() => deps.llm.complete(built.messages, { json: true }), {
      ...SETTINGS.retry,
      onRetry: ({ attempt, maxAttempts, delayMs, error }) => deps.onNotice?.(`[Geração: ${describeError(error)} Nova tentativa ${attempt + 1}/${maxAttempts} em ${(delayMs / 1000).toFixed(1)}s...]`),
    });
  } catch (error) {
    trace.add("modelo", "bloqueado", describeError(error));
    return finish(APPROVED.falhaTecnica, "RECUSAR", "falha", { perguntaGravada: pergunta, noContexto: false, llmChamado: true, contexto });
  }
  trace.add("modelo", "ok", deps.llm.name);

  // 8. Saída.
  const checked = outputGuard(raw, { conhecimento: built.conhecimentoUsado, perfil: snapshot.perfilRelevante, canary: CANARY, pergunta });
  if (!checked.ok) {
    trace.add("saida", "bloqueado", checked.motivo, checked.regra);
    const desfecho: Desfecho = checked.mensagem === "semInformacao" ? "sem_informacao" : checked.mensagem === "falhaTecnica" ? "falha" : "bloqueada";
    return finish(APPROVED[checked.mensagem], "RECUSAR", desfecho, { perguntaGravada: pergunta, noContexto: false, llmChamado: true, contexto });
  }
  trace.add("saida", checked.correcoes.length ? "alerta" : "ok", checked.correcoes.join("; ") || "nenhuma violação");

  const env = checked.envelope;
  memoria.usada = env.memoria_usada.filter((k) => ALLOWED_KEYS.includes(k));
  if (env.decisao === "RECUSAR") {
    trace.add("saida", "info", "o modelo declarou que a base não responde", "R02");
    return finish(APPROVED.semInformacao, "RECUSAR", "sem_informacao", { perguntaGravada: pergunta, noContexto: true, llmChamado: true, contexto });
  }
  const fontes = sourcesOf(env.fontes, built.conhecimentoUsado);
  return finish(withFooter(env.resposta, fontes), env.decisao, env.decisao === "ENCAMINHAR" ? "encaminhada" : "respondida", {
    perguntaGravada: pergunta,
    respostaGravada: env.resposta,
    noContexto: true,
    fontes,
    llmChamado: true,
    contexto,
  });
}

const BASELINE_PROMPT = `Você é o assistente interno do ${SETTINGS.company}. Responda em português, de forma objetiva, à pergunta do colaborador.`;

/** Modo "llm_puro": o que a empresa teria sem a plataforma de contexto (linha de base da avaliação). */
async function answerWithoutContext(message: string, deps: Deps, trace: Trace, memoria: AnswerResult["memoria"]): Promise<AnswerResult> {
  try {
    const raw = await withRetry(
      () =>
        deps.llm.complete([
          { role: "system", content: BASELINE_PROMPT },
          { role: "user", content: message },
        ]),
      SETTINGS.retry,
    );
    trace.add("modelo", "ok", `${deps.llm.name} sem contexto, sem memória e sem guardas`);
    return { resposta: raw.trim(), decisao: "RESPONDER", desfecho: "respondida", fontes: [], memoria, llmChamado: true, trace: trace.steps };
  } catch (error) {
    trace.add("modelo", "bloqueado", describeError(error));
    return { resposta: APPROVED.falhaTecnica, decisao: "RECUSAR", desfecho: "falha", fontes: [], memoria, llmChamado: true, trace: trace.steps };
  }
}
