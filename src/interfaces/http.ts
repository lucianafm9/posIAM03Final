/**
 * npm run serve [-- --offline] [-- --porta 3000]
 * API HTTP + página de demonstração (src/interfaces/web/index.html).
 *
 *   POST   /api/chat               {usuario, sessao?, mensagem} -> resposta, fontes, memória, trace e manifesto do contexto
 *   GET    /api/memoria/:usuario   perfil guardado + auditoria (o que foi gravado, rejeitado, apagado)
 *   DELETE /api/memoria/:usuario   direito de eliminação (LGPD)
 *   GET    /api/saude              provedor, modelo e tamanho da base
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SETTINGS } from "../shared/settings.ts";
import { answer } from "../execution/pipeline.ts";
import { startOrExit, type Runtime } from "./runtime.ts";

const MAX_BODY = 16_000;

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let data = "";
  for await (const chunk of req) {
    data += chunk;
    if (data.length > MAX_BODY) throw new Error("corpo da requisição grande demais");
  }
  return data ? (JSON.parse(data) as Record<string, unknown>) : {};
}

const validId = (v: unknown): v is string => typeof v === "string" && /^[\w.-]{1,64}$/.test(v);

export function createApp(runtime: Runtime) {
  const page = readFileSync(fileURLToPath(new URL("./web/index.html", import.meta.url)), "utf8");

  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        return res.end(page);
      }
      if (req.method === "GET" && url.pathname === "/api/saude") {
        return send(res, 200, { status: "ok", provedor: runtime.provider, modelo: runtime.llm.name, embedder: runtime.embedder.name, chunks: runtime.knowledge.count(runtime.embedder.name) });
      }
      if (req.method === "POST" && url.pathname === "/api/chat") {
        const body = await readJson(req);
        if (!validId(body.usuario)) return send(res, 400, { erro: "informe 'usuario' (letras, números, ponto, hífen; até 64)" });
        if (typeof body.mensagem !== "string") return send(res, 400, { erro: "informe 'mensagem' (texto)" });
        if (body.sessao !== undefined && !validId(body.sessao)) return send(res, 400, { erro: "'sessao' inválida" });
        const sessao = runtime.memory.startSession(body.usuario, body.sessao as string | undefined);
        const result = await answer(body.usuario, sessao, body.mensagem, runtime);
        const contexto = result.contexto ? { manifest: result.contexto.manifest, tokens: result.contexto.tokens } : undefined;
        return send(res, 200, { sessao, ...result, contexto });
      }
      const memoria = url.pathname.match(/^\/api\/memoria\/([\w.-]{1,64})$/);
      if (memoria && req.method === "GET") return send(res, 200, { perfil: runtime.memory.profile(memoria[1]!), auditoria: runtime.memory.audit(memoria[1]!) });
      if (memoria && req.method === "DELETE") return send(res, 200, { removidos: runtime.memory.forget(memoria[1]!) });
      return send(res, 404, { erro: "rota não encontrada" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // A sessão de outro usuário e JSON inválido são erros do cliente; o resto é falha interna sem detalhes.
      if (/sessão pertence|JSON|grande demais/.test(message)) return send(res, 400, { erro: message });
      console.error("[http]", message);
      return send(res, 500, { erro: "falha interna" });
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const i = process.argv.indexOf("--porta");
  const port = Number(i >= 0 ? process.argv[i + 1] : process.env.PORT ?? 3000);
  const runtime = await startOrExit({ log: console.log });
  createApp(runtime).listen(port, () => console.log(`${SETTINGS.assistantName} em http://localhost:${port} (${runtime.provider}: ${runtime.llm.name})`));
}
