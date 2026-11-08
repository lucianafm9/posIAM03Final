import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { ProfileFact } from "../shared/types.ts";

export type StoredTurn = {
  id: number;
  pergunta: string;
  resposta: string;
  desfecho: string;
  fontes: string[];
};

export type MemoryEvent = { acao: "gravou" | "rejeitou" | "apagou"; chave: string; detalhe: string; quando: string };

/**
 * Persistência da memória em SQLite (aula: messageRepository.ts, tabela messages por context_window).
 * Separada da base de conhecimento (arquivo próprio): memória é dado do usuário, conhecimento é dado da empresa.
 *
 * - sessions: uma conversa; guarda o resumo dos turnos antigos (memória de sessão comprimida);
 * - turns: cada pergunta (já mascarada) e resposta; `no_contexto` = pode voltar ao modelo; `resumido` = já está no resumo;
 * - profile_facts: memória de longo prazo, um valor por chave permitida (sobrescreve);
 * - memory_events: auditoria do que foi gravado, rejeitado ou apagado (LGPD: transparência).
 */
export class MemoryRepository {
  private db: DatabaseSync;

  constructor(file = ":memory:") {
    if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        started_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS turns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        pergunta TEXT NOT NULL,
        resposta TEXT NOT NULL,
        desfecho TEXT NOT NULL,
        fontes TEXT NOT NULL DEFAULT '[]',
        no_contexto INTEGER NOT NULL DEFAULT 1,
        resumido INTEGER NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS profile_facts (
        user_id TEXT NOT NULL,
        chave TEXT NOT NULL,
        valor TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, chave)
      );
      CREATE TABLE IF NOT EXISTS memory_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        acao TEXT NOT NULL,
        chave TEXT NOT NULL,
        detalhe TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  // ---------------------------------------------------------------- sessão

  createSession(userId: string, id: string = randomUUID()): string {
    this.db.prepare("INSERT OR IGNORE INTO sessions (id, user_id) VALUES (?, ?)").run(id, userId);
    return id;
  }

  sessionOwner(sessionId: string): string | undefined {
    return (this.db.prepare("SELECT user_id FROM sessions WHERE id = ?").get(sessionId) as { user_id: string } | undefined)?.user_id;
  }

  summary(sessionId: string): string {
    return (this.db.prepare("SELECT summary FROM sessions WHERE id = ?").get(sessionId) as { summary: string } | undefined)?.summary ?? "";
  }

  setSummary(sessionId: string, summary: string, summarizedIds: number[]): void {
    this.db.prepare("UPDATE sessions SET summary = ? WHERE id = ?").run(summary, sessionId);
    for (const id of summarizedIds) this.db.prepare("UPDATE turns SET resumido = 1 WHERE id = ?").run(id);
  }

  addTurn(sessionId: string, turn: Omit<StoredTurn, "id">, noContexto: boolean): void {
    this.db
      .prepare("INSERT INTO turns (session_id, pergunta, resposta, desfecho, fontes, no_contexto) VALUES (?, ?, ?, ?, ?, ?)")
      .run(sessionId, turn.pergunta, turn.resposta, turn.desfecho, JSON.stringify(turn.fontes), noContexto ? 1 : 0);
  }

  /** Turnos que podem voltar ao modelo e ainda não estão no resumo, do mais antigo ao mais recente. */
  openTurns(sessionId: string): StoredTurn[] {
    const rows = this.db
      .prepare("SELECT id, pergunta, resposta, desfecho, fontes FROM turns WHERE session_id = ? AND no_contexto = 1 AND resumido = 0 ORDER BY id")
      .all(sessionId) as { id: number; pergunta: string; resposta: string; desfecho: string; fontes: string }[];
    return rows.map((r) => ({ ...r, fontes: JSON.parse(r.fontes) as string[] }));
  }

  countTurns(sessionId: string): number {
    return Number((this.db.prepare("SELECT COUNT(*) AS n FROM turns WHERE session_id = ?").get(sessionId) as { n: number }).n);
  }

  // ---------------------------------------------------------------- perfil (longo prazo)

  upsertFact(userId: string, fact: ProfileFact): void {
    this.db
      .prepare(
        `INSERT INTO profile_facts (user_id, chave, valor) VALUES (?, ?, ?)
         ON CONFLICT (user_id, chave) DO UPDATE SET valor = excluded.valor, updated_at = CURRENT_TIMESTAMP`,
      )
      .run(userId, fact.chave, fact.valor);
  }

  facts(userId: string): ProfileFact[] {
    return (
      this.db.prepare("SELECT chave, valor, updated_at FROM profile_facts WHERE user_id = ? ORDER BY chave").all(userId) as {
        chave: string;
        valor: string;
        updated_at: string;
      }[]
    ).map((r) => ({ chave: r.chave, valor: r.valor, atualizadoEm: r.updated_at }));
  }

  /** Direito de eliminação (LGPD): apaga o perfil e as sessões do usuário; mantém só o evento de auditoria. */
  forgetUser(userId: string): number {
    const removed = this.facts(userId).length;
    this.db.prepare("DELETE FROM profile_facts WHERE user_id = ?").run(userId);
    this.db.prepare("DELETE FROM turns WHERE session_id IN (SELECT id FROM sessions WHERE user_id = ?)").run(userId);
    this.db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
    return removed;
  }

  // ---------------------------------------------------------------- auditoria

  logEvent(userId: string, acao: MemoryEvent["acao"], chave: string, detalhe: string): void {
    this.db.prepare("INSERT INTO memory_events (user_id, acao, chave, detalhe) VALUES (?, ?, ?, ?)").run(userId, acao, chave, detalhe);
  }

  events(userId: string): MemoryEvent[] {
    return (
      this.db.prepare("SELECT acao, chave, detalhe, created_at FROM memory_events WHERE user_id = ? ORDER BY id").all(userId) as {
        acao: MemoryEvent["acao"];
        chave: string;
        detalhe: string;
        created_at: string;
      }[]
    ).map((r) => ({ acao: r.acao, chave: r.chave, detalhe: r.detalhe, quando: r.created_at }));
  }
}
