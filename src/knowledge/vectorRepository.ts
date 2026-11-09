import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { DocType, RetrievedChunk } from "../shared/types.ts";
import { cosineSimilarity, hybridScore, keywordScore } from "./scoring.ts";

export type ChunkRecord = {
  docId: string;
  titulo: string;
  tipo: DocType;
  secao: string;
  chunk: string;
  embeddings: number[];
  embedder: string;
};

/**
 * Base vetorial em SQLite (aula: vectorRepository.ts). Evoluções:
 * - metadados do documento (ID, título, tipo, seção) para citar a fonte e filtrar por tipo;
 * - o embedder que gerou cada vetor (vetores de modelos diferentes não são comparáveis);
 * - tabela de quarentena para chunks barrados na ingestão.
 */
export class VectorRepository {
  private db: DatabaseSync;

  constructor(file = ":memory:") {
    if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        doc_id TEXT NOT NULL,
        titulo TEXT NOT NULL,
        tipo TEXT NOT NULL,
        secao TEXT NOT NULL,
        chunk TEXT NOT NULL,
        embeddings TEXT NOT NULL,
        embedder TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_documents_embedder ON documents (embedder);
      CREATE TABLE IF NOT EXISTS quarantine (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        doc_id TEXT NOT NULL,
        chunk TEXT NOT NULL,
        reason TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  insert(record: ChunkRecord): void {
    this.db
      .prepare("INSERT INTO documents (doc_id, titulo, tipo, secao, chunk, embeddings, embedder) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(record.docId, record.titulo, record.tipo, record.secao, record.chunk, JSON.stringify(record.embeddings), record.embedder);
  }

  quarantine(docId: string, chunk: string, reason: string): void {
    this.db.prepare("INSERT INTO quarantine (doc_id, chunk, reason) VALUES (?, ?, ?)").run(docId, chunk, reason);
  }

  clear(embedder?: string): void {
    if (embedder) this.db.prepare("DELETE FROM documents WHERE embedder = ?").run(embedder);
    else this.db.exec("DELETE FROM documents;");
    this.db.exec("DELETE FROM quarantine;");
  }

  deleteDoc(docId: string): void {
    this.db.prepare("DELETE FROM documents WHERE doc_id = ?").run(docId);
  }

  count(embedder?: string): number {
    const row = embedder
      ? this.db.prepare("SELECT COUNT(*) AS n FROM documents WHERE embedder = ?").get(embedder)
      : this.db.prepare("SELECT COUNT(*) AS n FROM documents").get();
    return Number((row as { n: number }).n);
  }

  quarantined(): { docId: string; chunk: string; reason: string }[] {
    return (this.db.prepare("SELECT doc_id, chunk, reason FROM quarantine").all() as { doc_id: string; chunk: string; reason: string }[]).map(
      (r) => ({ docId: r.doc_id, chunk: r.chunk, reason: r.reason }),
    );
  }

  /** Toda a base, na ordem dos documentos (modo "contexto longo", sem busca). */
  all(embedder: string): RetrievedChunk[] {
    const rows = this.db.prepare("SELECT id, doc_id, titulo, tipo, secao, chunk FROM documents WHERE embedder = ? ORDER BY id").all(embedder) as {
      id: number;
      doc_id: string;
      titulo: string;
      tipo: DocType;
      secao: string;
      chunk: string;
    }[];
    return rows.map((r) => ({ id: r.id, docId: r.doc_id, titulo: r.titulo, tipo: r.tipo, secao: r.secao, chunk: r.chunk, score: 1 }));
  }

  /** Todos os chunks com score híbrido, do mais ao menos relevante (sem corte: usado pelo debug). */
  rank(query: string, queryEmbeddings: number[], embedder: string): RetrievedChunk[] {
    const rows = this.db
      .prepare("SELECT id, doc_id, titulo, tipo, secao, chunk, embeddings FROM documents WHERE embedder = ?")
      .all(embedder) as { id: number; doc_id: string; titulo: string; tipo: DocType; secao: string; chunk: string; embeddings: string }[];

    return rows
      .map((row) => ({
        id: row.id,
        docId: row.doc_id,
        titulo: row.titulo,
        tipo: row.tipo,
        secao: row.secao,
        chunk: row.chunk,
        score: hybridScore(cosineSimilarity(queryEmbeddings, JSON.parse(row.embeddings) as number[]), keywordScore(query, row.chunk)),
      }))
      .sort((a, b) => b.score - a.score);
  }
}
