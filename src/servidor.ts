import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { assinaturaValida, Deduplicador, extrairMensagens, montarResposta } from "./canal-whatsapp.ts";
import { AGENTES, ferramentasDemo, PEDIDOS_DEMO } from "./cenario.ts";
import { ModeloSimulado } from "./modelo.ts";
import { Orquestrador } from "./orquestrador.ts";
import { Rastros } from "./rastros.ts";

const PUBLICO = join(import.meta.dirname, "..", "public");
const TIPOS: Record<string, string> = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript" };

const rastros = new Rastros(process.env.BANCO ?? "execucoes.db");
const orquestrador = new Orquestrador({ modelo: new ModeloSimulado(), agentes: AGENTES, ferramentas: ferramentasDemo(1), rastros, inicial: "triagem" });
const deduplicador = new Deduplicador();

if (rastros.listar(1).length === 0) {
  for (const pedido of PEDIDOS_DEMO) await orquestrador.iniciar(pedido);
}

const json = (res: ServerResponse, status: number, corpo: unknown) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(corpo));

async function texto(req: IncomingMessage): Promise<string> {
  let corpo = "";
  for await (const parte of req) corpo += parte;
  return corpo;
}
const ler = async (req: IncomingMessage): Promise<Record<string, unknown>> => JSON.parse((await texto(req)) || "{}");

async function webhook(req: IncomingMessage, res: ServerResponse) {
  const segredo = process.env.WHATSAPP_SEGREDO;
  const corpo = await texto(req);
  if (!segredo || !assinaturaValida(corpo, req.headers["x-hub-signature-256"] as string | undefined, segredo)) return json(res, 401, { erro: "Assinatura inválida" });
  const respostas = [];
  for (const m of extrairMensagens(JSON.parse(corpo))) {
    if (!deduplicador.primeiraVez(m.id)) continue;
    const e = await orquestrador.iniciar(m.texto);
    respostas.push(montarResposta(m.de, e.resposta ?? "Recebemos seu pedido e um atendente vai revisar."));
  }
  json(res, 200, { respostas });
}

const servidor = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://local");
  const rota = `${req.method} ${url.pathname}`;
  try {
    if (rota === "POST /webhook/whatsapp") return await webhook(req, res);
    if (rota === "GET /api/metricas") return json(res, 200, rastros.metricas());
    if (rota === "GET /api/execucoes") return json(res, 200, rastros.listar());
    if (rota === "POST /api/execucoes") {
      const { pedido } = await ler(req);
      if (typeof pedido !== "string" || !pedido.trim()) return json(res, 400, { erro: "Informe o pedido" });
      return json(res, 201, await orquestrador.iniciar(pedido));
    }
    const detalhe = url.pathname.match(/^\/api\/execucoes\/([\w-]+)$/);
    if (detalhe && req.method === "GET") {
      const execucao = rastros.carregar(detalhe[1]);
      if (!execucao) return json(res, 404, { erro: "Não encontrada" });
      return json(res, 200, { execucao, eventos: rastros.eventos(execucao.id) });
    }
    const aprovacao = url.pathname.match(/^\/api\/execucoes\/([\w-]+)\/aprovacao$/);
    if (aprovacao && req.method === "POST") {
      const { aprovado } = await ler(req);
      return json(res, 200, await orquestrador.decidirAprovacao(aprovacao[1], aprovado === true, "supervisor"));
    }
    if (req.method !== "GET") return json(res, 404, { erro: "Rota inexistente" });
    const arquivo = normalize(url.pathname === "/" ? "index.html" : url.pathname).replace(/^(\.\.[/\\])+/, "");
    const conteudo = await readFile(join(PUBLICO, arquivo));
    res.writeHead(200, { "content-type": TIPOS[extname(arquivo)] ?? "text/plain" }).end(conteudo);
  } catch (erro) {
    const e = erro as NodeJS.ErrnoException;
    if (e.code === "ENOENT") return json(res, 404, { erro: "Arquivo não encontrado" });
    json(res, 400, { erro: e.message });
  }
});

const porta = Number(process.env.PORTA ?? 3000);
servidor.listen(porta, () => console.log(`Console em http://localhost:${porta}`));
