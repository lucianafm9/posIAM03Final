import type { Embedder } from "../shared/types.ts";
import { chunkText } from "./chunkText.ts";
import { loadKnowledgeBase, type KnowledgeDocument } from "./documents.ts";
import { inspectChunk } from "./sanitizeChunk.ts";
import type { VectorRepository } from "./vectorRepository.ts";

export type IngestReport = { docId: string; tipo: string; chunks: number; quarantined: number };

/**
 * Pipeline de ingestão (aula: ingest.ts): quebra o documento em chunks, gera o embedding de cada um
 * e salva no banco. Antes de salvar, cada chunk passa pela inspeção de injeção indireta (quarentena).
 */
export async function ingestDocument(doc: KnowledgeDocument, repo: VectorRepository, embedder: Embedder): Promise<IngestReport> {
  // A seção "Objetivo" descreve o documento, não traz regra: fica fora da busca (reduz ruído na recuperação).
  const chunks = chunkText(doc.corpo).filter((c) => !/> Objetivo$/i.test(c.section));
  let quarantined = 0;
  for (const chunk of chunks) {
    const inspection = inspectChunk(chunk.text);
    if (!inspection.safe) {
      repo.quarantine(doc.docId, chunk.text, inspection.reason);
      quarantined++;
      continue;
    }
    repo.insert({
      docId: doc.docId,
      titulo: doc.titulo,
      tipo: doc.tipo,
      secao: chunk.section,
      chunk: chunk.text,
      embeddings: await embedder.embed(chunk.text),
      embedder: embedder.name,
    });
  }
  return { docId: doc.docId, tipo: doc.tipo, chunks: chunks.length, quarantined };
}

export async function ingestKnowledgeBase(dir: string, repo: VectorRepository, embedder: Embedder): Promise<IngestReport[]> {
  repo.clear(embedder.name);
  const reports: IngestReport[] = [];
  for (const doc of loadKnowledgeBase(dir)) reports.push(await ingestDocument(doc, repo, embedder));
  return reports;
}
