import { SETTINGS } from "../shared/settings.ts";
import type { Message, ProfileFact } from "../shared/types.ts";
import type { MemoryRepository, StoredTurn } from "./memoryRepository.ts";
import { extractFacts, selectRelevantFacts, type Extraction, type RelevantFact } from "./profileMemory.ts";
import { contextualizeQuery, type ContextualQuery } from "./queryRewriter.ts";
import type { Summarizer } from "./summarizer.ts";

/** Tudo o que a memória entrega ao pipeline para UMA pergunta. */
export type MemorySnapshot = {
  perfilRelevante: RelevantFact[];
  perfilCompleto: ProfileFact[];
  resumo: string;
  janela: Message[];
  consulta: ContextualQuery;
};

/**
 * Fachada da memória, com três níveis:
 * 1. trabalho: a janela dos últimos turnos (sliding window da aula: ContextWindow) e a reescrita da busca;
 * 2. sessão: turnos antigos comprimidos num resumo (aula: summarizeHistory / maybeCompress);
 * 3. longo prazo: perfil do colaborador, entre sessões, com chaves permitidas e auditoria.
 */
export class MemoryService {
  private readonly repo: MemoryRepository;
  private readonly summarizer: Summarizer;
  private readonly options: { windowTurns: number; summarizeAfterTurns: number; maxProfileFacts: number };

  constructor(repo: MemoryRepository, summarizer: Summarizer, options: { windowTurns: number; summarizeAfterTurns: number; maxProfileFacts: number } = SETTINGS.memory) {
    this.repo = repo;
    this.summarizer = summarizer;
    this.options = options;
  }

  startSession(userId: string, sessionId?: string): string {
    const owner = sessionId ? this.repo.sessionOwner(sessionId) : undefined;
    if (sessionId && owner && owner !== userId) throw new Error("A sessão pertence a outro usuário.");
    return this.repo.createSession(userId, sessionId);
  }

  /** Grava os fatos de perfil de uma mensagem já mascarada; rejeições ficam na auditoria. */
  learn(userId: string, maskedText: string): Extraction {
    const extraction = extractFacts(maskedText);
    for (const fact of extraction.gravar) {
      this.repo.upsertFact(userId, fact);
      this.repo.logEvent(userId, "gravou", fact.chave, fact.valor);
    }
    for (const r of extraction.rejeitados) this.repo.logEvent(userId, "rejeitou", "-", `${r.motivo}: ${r.trecho}`);
    return extraction;
  }

  read(userId: string, sessionId: string, question: string): MemorySnapshot {
    const perfilCompleto = this.repo.facts(userId);
    const open = this.repo.openTurns(sessionId);
    const window = open.slice(-this.options.windowTurns);
    return {
      perfilCompleto,
      perfilRelevante: selectRelevantFacts(perfilCompleto, question, this.options.maxProfileFacts),
      resumo: this.repo.summary(sessionId),
      janela: window.flatMap((t) => [
        { role: "user" as const, content: t.pergunta },
        { role: "assistant" as const, content: t.resposta },
      ]),
      consulta: contextualizeQuery(question, window.map((t) => t.pergunta)),
    };
  }

  /**
   * Registra o turno. Só turnos atendidos (`noContexto`) voltam ao modelo; bloqueios ficam no log, mas não
   * contaminam o contexto das próximas perguntas. Ao passar do limite, os turnos antigos viram resumo.
   */
  async record(sessionId: string, turn: Omit<StoredTurn, "id">, noContexto: boolean): Promise<{ resumiu: number }> {
    this.repo.addTurn(sessionId, turn, noContexto);
    const open = this.repo.openTurns(sessionId);
    if (open.length <= this.options.summarizeAfterTurns) return { resumiu: 0 };
    const toSummarize = open.slice(0, open.length - this.options.windowTurns);
    const summary = await this.summarizer.summarize(this.repo.summary(sessionId), toSummarize);
    this.repo.setSummary(
      sessionId,
      summary,
      toSummarize.map((t) => t.id),
    );
    return { resumiu: toSummarize.length };
  }

  profile(userId: string): ProfileFact[] {
    return this.repo.facts(userId);
  }

  forget(userId: string): number {
    const removed = this.repo.forgetUser(userId);
    this.repo.logEvent(userId, "apagou", "*", `${removed} fato(s) de perfil e todas as sessões`);
    return removed;
  }

  audit(userId: string) {
    return this.repo.events(userId);
  }
}
