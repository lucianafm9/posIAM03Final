/**
 * npm start [-- --offline] [-- --trace] [-- --usuario <id>]
 * Chat no terminal. Comandos: /memoria, /esquecer, /nova (nova sessão), /contexto (manifesto da última resposta), sair.
 */
import { createInterface } from "node:readline";
import { stdin, stdout } from "node:process";
import { answer, type AnswerResult } from "../execution/pipeline.ts";
import { formatTrace } from "../execution/trace.ts";
import { startOrExit } from "./runtime.ts";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const runtime = await startOrExit({ log: console.log });
const showTrace = process.argv.includes("--trace");
const userId = arg("--usuario") ?? "colaborador-demo";
let sessionId = runtime.memory.startSession(userId);
let last: AnswerResult | undefined;

console.log(`Ventura Assist — Porto Ventura Terminais (${runtime.provider === "openai" ? runtime.llm.name : "modo offline: modelo extrativo local"})`);
console.log(`Usuário: ${userId}. Pergunte sobre políticas, sistemas, runbooks, incidentes ou onboarding.`);
console.log('Comandos: /memoria, /esquecer, /nova, /contexto, "sair".\n');

const rl = createInterface({ input: stdin, output: stdout, prompt: "Você: " });
rl.prompt();
for await (const line of rl) {
  const text = line.trim();
  if (["sair", "exit", "quit"].includes(text.toLowerCase())) break;
  if (text === "/nova") {
    sessionId = runtime.memory.startSession(userId);
    console.log("[Nova sessão iniciada. O perfil continua guardado; o histórico da conversa recomeça.]\n");
  } else if (text === "/contexto") {
    console.log(last?.contexto ? last.contexto.manifest.map((m) => `  ${m.bloco.padEnd(32)} ${String(m.tokens).padStart(5)} tokens  itens=${m.itens}${m.cortados ? ` cortados=${m.cortados}` : ""}`).join("\n") + "\n" : "[Nenhum contexto montado ainda.]\n");
  } else if (text) {
    last = await answer(userId, sessionId, text, { ...runtime, onNotice: (n) => console.log(n) });
    console.log(`\nVentura: ${last.resposta}\n`);
    if (showTrace) console.log(`[${last.desfecho} | decisão ${last.decisao} | modelo chamado: ${last.llmChamado ? "sim" : "não"} | memória usada: ${last.memoria.usada.join(", ") || "-"}]\n${formatTrace(last.trace)}\n`);
  }
  rl.prompt();
}
rl.close();
