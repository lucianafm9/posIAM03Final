/** npm run ingest [-- --offline]: recria a base vetorial a partir de conhecimento/. */
import { SETTINGS } from "../shared/settings.ts";
import { createLocalEmbedder } from "../llm/localModels.ts";
import { createOpenAiEmbedder, readApiKey } from "../llm/openaiClient.ts";
import { describeError } from "../llm/errors.ts";
import { ingestKnowledgeBase } from "./ingest.ts";
import { VectorRepository } from "./vectorRepository.ts";

const apiKey = process.argv.includes("--offline") ? undefined : readApiKey();
const embedder = apiKey ? createOpenAiEmbedder(apiKey) : createLocalEmbedder();
try {
  const repo = new VectorRepository(SETTINGS.databaseFile);
  const reports = await ingestKnowledgeBase(SETTINGS.knowledgeDir, repo, embedder);
  for (const r of reports) console.log(`${r.docId.padEnd(14)} ${r.tipo.padEnd(11)} ${r.chunks} chunk(s)${r.quarantined ? `, ${r.quarantined} em quarentena` : ""}`);
  console.log(`\n${repo.count(embedder.name)} chunks gravados em ${SETTINGS.databaseFile} (embedder: ${embedder.name}).`);
  for (const q of repo.quarantined()) console.log(`QUARENTENA ${q.docId}: ${q.reason}`);
} catch (error) {
  console.error(`[Erro na ingestão] ${describeError(error)}`);
  process.exit(1);
}
