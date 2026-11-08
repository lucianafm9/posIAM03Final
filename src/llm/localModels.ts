/**
 * Modelos locais, determinísticos e sem chave de API. Servem para testes, demo e avaliação offline:
 *
 * - createLocalEmbedder: bag-of-words com hashing (textos com as mesmas palavras ficam próximos);
 * - createExtractiveLlm: modelo "obediente" que responde só com frases dos documentos injetados no contexto,
 *   usa os fatos de memória que o contexto marcou como relevantes e recusa quando não há documento.
 *   Não é ajustado caso a caso: lê apenas os blocos que a camada de contexto montou;
 * - createScriptedLlm: devolve respostas roteirizadas (ex.: um modelo COMPROMETIDO, que obedece ao ataque).
 */
import type { Embedder, Envelope, LlmClient, Message } from "../shared/types.ts";
import { terms } from "../shared/text.ts";

export function createLocalEmbedder(dimensions = 512): Embedder {
  return {
    name: "local",
    async embed(text) {
      const vector = new Array<number>(dimensions).fill(0);
      // Termo inteiro + radical de 5 letras (aproxima "agendamento"/"agendamentos", "credencial"/"credenciais").
      for (const term of terms(text).flatMap((t) => (t.length > 5 ? [t, `~${t.slice(0, 5)}`] : [t]))) {
        let hash = 0;
        for (const char of term) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
        vector[hash % dimensions]! += 1;
      }
      return vector;
    },
  };
}

function unescape(text: string): string {
  return text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
}

/** Lê os blocos que a camada de contexto montou (mesmo formato que o modelo real recebe). */
export function readInjectedContext(messages: Message[]) {
  const dynamic = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
  const inner = (content: string) => unescape(content.match(/<mensagem_usuario>\n([\s\S]*?)\n<\/mensagem_usuario>/)?.[1] ?? content);
  const userMessages = messages.filter((m) => m.role === "user").map((m) => inner(m.content));
  const question = userMessages.at(-1) ?? "";
  const documents = [...dynamic.matchAll(/<documento id="([^"]+)" titulo="[^"]*" secao="([^"]*)"[^>]*relevancia="([\d.]+)">\n([\s\S]*?)\n<\/documento>/g)].map(
    (m) => ({ docId: m[1]!, secao: unescape(m[2]!), relevancia: Number(m[3]), text: unescape(m[4]!) }),
  );
  const alerts = [...dynamic.matchAll(/^- \[(R\d{2})\] (.*)$/gm)].map((m) => ({ regra: m[1]!, texto: m[2]! }));
  const memory = [...(dynamic.match(/<memoria_usuario[^>]*>\n([\s\S]*?)\n<\/memoria_usuario>/)?.[1] ?? "").matchAll(/^- ([a-z_]+): (.*)$/gm)].map(
    (m) => ({ chave: m[1]!, valor: unescape(m[2]!) }),
  );
  const history = userMessages.slice(0, -1);
  return { question, documents, alerts, memory, history };
}

const stem = (t: string) => t.slice(0, 5);

export function createExtractiveLlm(): LlmClient {
  return {
    name: "offline:extrativo",
    async complete(messages) {
      const { question, documents, alerts, memory, history } = readInjectedContext(messages);
      // Pergunta curta de continuação ("e para exportação?"): usa também a pergunta anterior, como uma pessoa faria.
      const questionTerms = terms(question);
      const followUp = questionTerms.length < 4 && history.length > 0 ? terms(history.at(-1)!) : [];
      const memoryTerms = memory.flatMap((f) => terms(f.valor));
      const wanted = new Set([...questionTerms, ...followUp].map(stem));
      const memoryWanted = new Set(memoryTerms.map(stem));

      const sentences = documents.flatMap((doc) =>
        (doc.text.slice(doc.text.indexOf(":") + 1).match(/[^.!?]+[.!?]+/g) ?? []).map((s) => {
          const sTerms = [...new Set(terms(s).map(stem))];
          const sectionTerms = [...new Set(terms(doc.secao).map(stem))];
          return {
            docId: doc.docId,
            text: s.trim(),
            overlap:
              sTerms.filter((t) => wanted.has(t)).length +
              0.5 * sectionTerms.filter((t) => wanted.has(t)).length +
              0.75 * sTerms.filter((t) => memoryWanted.has(t)).length,
            // O ranking da busca também é evidência: frases do trecho mais relevante desempatam.
            rank: doc.relevancia,
            memoryHits: memory.filter((f) => terms(f.valor).some((t) => sTerms.includes(stem(t)))).map((f) => f.chave),
          };
        }),
      );
      const best = sentences
        .filter((s) => s.overlap >= 1)
        .sort((a, b) => b.overlap + 2 * b.rank - (a.overlap + 2 * a.rank))
        .slice(0, 3);

      const parts: string[] = [];
      const name = memory.find((f) => f.chave === "nome")?.valor;
      const actionAlert = alerts.some((a) => a.regra === "R07");
      if (actionAlert) parts.push("Eu não aprovo nem libero pedidos, mas explico a regra.");
      parts.push(...best.map((s) => `${s.text} [${s.docId}]`));

      const envelope: Envelope =
        best.length > 0
          ? {
              decisao: actionAlert ? "ENCAMINHAR" : "RESPONDER",
              fontes: [...new Set(best.map((s) => s.docId))],
              memoria_usada: [...new Set([...(name ? ["nome"] : []), ...best.flatMap((s) => s.memoryHits)])],
              resposta: name ? `${name}, ${parts.join(" ").replace(/^\p{Lu}(?=\p{Ll}|\s)/u, (c) => c.toLowerCase())}` : parts.join(" "),
            }
          : {
              decisao: "RECUSAR",
              fontes: [],
              memoria_usada: [],
              resposta: "Não encontrei essa informação na base de conhecimento. Fale com a Central de Serviços (ramal 4000).",
            };
      return JSON.stringify(envelope);
    },
  };
}

export type ScriptedReply = string | Error | ((messages: Message[]) => string);
export type ScriptedLlm = LlmClient & { calls: Message[][] };

/** Devolve as respostas da fila em ordem; quando a fila acaba, repete a última. */
export function createScriptedLlm(replies: ScriptedReply[], name = "offline:roteirizado"): ScriptedLlm {
  const queue = [...replies];
  const calls: Message[][] = [];
  let last: ScriptedReply = "";
  return {
    name,
    calls,
    async complete(messages) {
      calls.push(messages);
      const reply = queue.length > 0 ? queue.shift()! : last;
      last = reply;
      if (reply instanceof Error) throw reply;
      return typeof reply === "function" ? reply(messages) : reply;
    },
  };
}

/** Atalho para roteirizar um envelope JSON. */
export function envelope(resposta: string, extra: Partial<Envelope> = {}): string {
  return JSON.stringify({ decisao: "RESPONDER", fontes: [], memoria_usada: [], resposta, ...extra } satisfies Envelope);
}
