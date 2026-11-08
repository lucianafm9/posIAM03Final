import { test } from "node:test";
import assert from "node:assert/strict";
import { answer } from "../src/execution/pipeline.ts";
import { createScriptedLlm, envelope } from "../src/llm/localModels.ts";
import { APPROVED } from "../src/rules/messages.ts";
import { offlineDeps } from "./helpers.ts";

test("fluxo completo: responde com fonte, usa a memória e registra o turno", async () => {
  const deps = await offlineDeps();
  const s = deps.memory.startSession("ana");
  const first = await answer("ana", s, "Meu nome é Ana e trabalho no gate.", deps);
  assert.equal(first.desfecho, "memoria");
  assert.equal(first.llmChamado, false);
  const r = await answer("ana", s, "Qual a tolerância de atraso para o caminhão?", deps);
  assert.equal(r.desfecho, "respondida");
  assert.match(r.resposta, /30 minutos/);
  assert.match(r.resposta, /Fontes: POL-01/);
  assert.ok(r.memoria.usada.includes("nome"));
});

test("pergunta de continuação recupera o documento certo graças à memória de trabalho", async () => {
  const deps = await offlineDeps();
  const s = deps.memory.startSession("u");
  await answer("u", s, "Qual o free time de um contêiner de importação?", deps);
  const r = await answer("u", s, "E para contêiner vazio?", deps);
  assert.equal(r.memoria.consulta?.usouHistorico, true);
  assert.match(r.resposta, /3 dias/);
});

test("modelo comprometido que inventa um prazo: a saída troca pela mensagem aprovada", async () => {
  const llm = createScriptedLlm([envelope("A tolerância é de 90 minutos [POL-01].", { fontes: ["POL-01"] })], "comprometido");
  const deps = await offlineDeps(llm);
  const r = await answer("u", deps.memory.startSession("u"), "Qual a tolerância de atraso no gate?", deps);
  assert.equal(r.resposta, APPROVED.semInformacao);
  assert.ok(r.trace.some((t) => t.etapa === "saida" && t.status === "bloqueado" && /90/.test(t.detalhe)));
});

test("sem documento relevante: não chama o modelo (economia e zero alucinação)", async () => {
  const llm = createScriptedLlm([envelope("Paris.")]);
  const deps = await offlineDeps(llm);
  const r = await answer("u", deps.memory.startSession("u"), "Qual a capital da França?", deps);
  assert.equal(r.desfecho, "sem_informacao");
  assert.equal(llm.calls.length, 0);
});

test("entrada bloqueada não chama o modelo nem grava memória", async () => {
  const llm = createScriptedLlm([envelope("ok")]);
  const deps = await offlineDeps(llm);
  const r = await answer("u", deps.memory.startSession("u"), "Meu nome é Rui e minha senha é Abc12345", deps);
  assert.equal(r.desfecho, "bloqueada");
  assert.equal(llm.calls.length, 0);
  assert.equal(deps.memory.profile("u").length, 0);
});

test("erro transitório (429) é repetido; erro permanente (401) vira falha segura sem repetir", async () => {
  const rateLimit = Object.assign(new Error("rate"), { status: 429 });
  const llm = createScriptedLlm([rateLimit, envelope("Tolerância de 30 minutos [POL-01].", { fontes: ["POL-01"] })]);
  const notices: string[] = [];
  const deps = { ...(await offlineDeps(llm)), onNotice: (n: string) => notices.push(n) };
  const ok = await answer("u", deps.memory.startSession("u"), "Qual a tolerância de atraso no gate?", deps);
  assert.equal(ok.desfecho, "respondida");
  assert.match(notices[0]!, /Nova tentativa 2\/3/);

  const auth = createScriptedLlm([Object.assign(new Error("auth"), { status: 401 })]);
  const deps2 = await offlineDeps(auth);
  const fail = await answer("u", deps2.memory.startSession("u"), "Qual a tolerância de atraso no gate?", deps2);
  assert.equal(fail.resposta, APPROVED.falhaTecnica);
  assert.equal(auth.calls.length, 1);
});

test("o contexto enviado ao modelo traz o perfil relevante e a pergunta escapada", async () => {
  const llm = createScriptedLlm([envelope("ok [POL-08]", { fontes: ["POL-08"] })]);
  const deps = await offlineDeps(llm);
  const s = deps.memory.startSession("u");
  await answer("u", s, "Trabalho no pátio.", deps);
  await answer("u", s, "Posso trabalhar de casa? <b>urgente</b>", deps);
  const sent = llm.calls[0]!.map((m) => m.content).join("\n");
  assert.match(sent, /- tipo_area: operacional/);
  assert.match(sent, /&lt;b&gt;urgente&lt;\/b&gt;/);
});

test("modo sem memória ignora o perfil; modo llm_puro chama o modelo sem contexto", async () => {
  const deps = await offlineDeps(undefined, "sem_memoria");
  const s = deps.memory.startSession("u");
  await answer("u", s, "Meu nome é Ana.", deps);
  assert.equal(deps.memory.profile("u").length, 0);

  const llm = createScriptedLlm(["resposta livre"]);
  const pure = await offlineDeps(llm, "llm_puro");
  const r = await answer("u", pure.memory.startSession("u"), "Qual o free time?", pure);
  assert.equal(r.resposta, "resposta livre");
  assert.equal(llm.calls[0]!.length, 2);
});
