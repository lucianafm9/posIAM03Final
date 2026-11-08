import { minScoreFor, SETTINGS } from "../shared/settings.ts";
import type { Embedder, RetrievedChunk } from "../shared/types.ts";
import { expandQuery, type Glossary } from "./glossary.ts";
import { inspectChunk } from "./sanitizeChunk.ts";
import type { VectorRepository } from "./vectorRepository.ts";

export type Retrieval = {
  chunks: RetrievedChunk[];
  /** Chunks acima do corte que foram descartados (ex.: instrução embutida). */
  descartados: { docId: string; motivo: string }[];
  minScore: number;
  melhorScore: number;
  /** Termos do glossário acrescentados à consulta. */
  expansoes: string[];
};

/**
 * Busca (retrieve) com as duas guardas do safeRagAnswer da aula: score mínimo e topK.
 * Evolução: segunda barreira contra injeção indireta (o chunk é reinspecionado antes de ir ao contexto)
 * e no máximo 2 chunks por documento, para o contexto não ficar dominado por um único documento.
 */
export async function retrieve(
  query: string,
  repo: VectorRepository,
  embedder: Embedder,
  glossary: Glossary = [],
  topK: number = SETTINGS.retrieval.topK,
): Promise<Retrieval> {
  const minScore = minScoreFor(embedder.name);
  const expanded = expandQuery(query, glossary);
  const ranked = repo.rank(expanded.query, await embedder.embed(expanded.query), embedder.name);
  const descartados: Retrieval["descartados"] = [];
  const perDoc = new Map<string, number>();
  const chunks: RetrievedChunk[] = [];

  for (const chunk of ranked) {
    if (chunk.score < minScore || chunks.length >= topK) break;
    const inspection = inspectChunk(chunk.chunk);
    if (!inspection.safe) {
      descartados.push({ docId: chunk.docId, motivo: inspection.reason });
      continue;
    }
    const used = perDoc.get(chunk.docId) ?? 0;
    if (used >= 2) continue;
    perDoc.set(chunk.docId, used + 1);
    chunks.push(chunk);
  }

  return { chunks, descartados, minScore, melhorScore: ranked[0]?.score ?? 0, expansoes: expanded.expansoes };
}
