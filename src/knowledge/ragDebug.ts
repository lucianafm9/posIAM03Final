/** npm run debug -- "pergunta" [--offline]: ranking de chunks com score, corte e o que entraria no contexto (aula: ragDebug.ts). */
import { minScoreFor } from "../shared/settings.ts";
import { startOrExit } from "../interfaces/runtime.ts";
import { expandQuery } from "./glossary.ts";
import { retrieve } from "./retriever.ts";

const question = process.argv.slice(2).filter((a) => !a.startsWith("--")).join(" ") || "Qual a tolerância de atraso no gate?";
const runtime = await startOrExit({ log: console.log });
const expanded = expandQuery(question, runtime.glossary ?? []);
const ranking = runtime.knowledge.rank(expanded.query, await runtime.embedder.embed(expanded.query), runtime.embedder.name);
const min = minScoreFor(runtime.embedder.name);
console.log(`Pergunta: ${question}`);
if (expanded.expansoes.length) console.log(`Glossário: + ${expanded.expansoes.join("; ")}`);
console.log(`Embedder: ${runtime.embedder.name} | score mínimo: ${min}\n`);
for (const c of ranking.slice(0, 8)) {
  console.log(`${c.score >= min ? "ENTRA " : "corte "} ${c.score.toFixed(3)}  ${c.docId.padEnd(14)} ${c.secao}`);
}
const r = await retrieve(question, runtime.knowledge, runtime.embedder, runtime.glossary);
console.log(`\nSelecionados: ${r.chunks.map((c) => c.docId).join(", ") || "nenhum"}${r.descartados.length ? ` | descartados: ${r.descartados.map((d) => d.docId).join(", ")}` : ""}`);
