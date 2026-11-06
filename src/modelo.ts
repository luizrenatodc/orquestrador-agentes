import { estimarTokens } from "./guardas.ts";
import type { Decisao, EntradaModelo, Mensagem, Modelo } from "./tipos.ts";

const resultado = (msgs: Mensagem[], nome: string) => {
  const m = msgs.findLast((x) => x.papel === "ferramenta" && x.ferramenta === nome);
  return m ? JSON.parse(m.conteudo) : undefined;
};

/**
 * Política determinística que substitui um LLM na demonstração.
 * Permite rodar o projeto e os testes sem chave de API, com resultado reproduzível.
 */
export class ModeloSimulado implements Modelo {
  async decidir(entrada: EntradaModelo): Promise<{ decisao: Decisao; tokens: number }> {
    const decisao = this.#politica(entrada);
    const tokens = estimarTokens(entrada.instrucoes + entrada.mensagens.map((m) => m.conteudo).join(" ") + JSON.stringify(decisao));
    return { decisao, tokens };
  }

  #politica({ agente, mensagens }: EntradaModelo): Decisao {
    const pedido = mensagens[0].conteudo;
    const numero = pedido.match(/\d{4,}/)?.[0];
    const chamar = (nome: string, argumentos: Record<string, unknown>, raciocinio: string): Decisao => ({ tipo: "ferramenta", chamada: { nome, argumentos }, raciocinio });

    if (agente === "triagem") {
      if (/reembols|estorn|devol|cobran/i.test(pedido)) return { tipo: "transferir", agente: "financeiro", motivo: "Pedido envolve dinheiro" };
      if (/entrega|atras|rastre|chegou/i.test(pedido)) return { tipo: "transferir", agente: "logistica", motivo: "Pedido envolve entrega" };
      return { tipo: "resposta", texto: "Posso ajudar com entregas e reembolsos. Pode me passar o número do pedido?" };
    }
    if (!numero) return { tipo: "resposta", texto: "Preciso do número do pedido para continuar." };

    const compra = resultado(mensagens, "buscar_pedido");
    if (!compra) return chamar("buscar_pedido", { numero }, "Preciso dos dados do pedido antes de agir");
    if (compra.erro) return { tipo: "resposta", texto: `Não encontrei o pedido ${numero}. Pode conferir o número?` };

    if (agente === "logistica") {
      const rastreio = resultado(mensagens, "consultar_rastreio");
      if (!rastreio) return chamar("consultar_rastreio", { codigo: compra.rastreio }, "Vou consultar a transportadora");
      if (rastreio.erro) return { tipo: "resposta", texto: "A transportadora está fora do ar agora. Vou acompanhar e aviso assim que voltar." };
      return { tipo: "resposta", texto: `Seu pedido ${numero} está em: ${rastreio.situacao}. Previsão: ${rastreio.previsao}.` };
    }

    const politica = resultado(mensagens, "consultar_politica");
    if (!politica) return chamar("consultar_politica", { dias: compra.diasDesdeEntrega }, "Preciso verificar o prazo de reembolso");
    if (!politica.elegivel) return { tipo: "resposta", texto: `O pedido ${numero} passou do prazo de ${politica.prazo} dias e não pode ser reembolsado.` };

    const reembolso = resultado(mensagens, "emitir_reembolso");
    if (!reembolso) return chamar("emitir_reembolso", { numero, valor: compra.valor }, "Dentro do prazo, posso propor o reembolso");
    if (reembolso.recusado) return { tipo: "resposta", texto: "Um atendente analisou e não aprovou o reembolso. Vamos entrar em contato." };
    return { tipo: "resposta", texto: `Reembolso de R$ ${compra.valor.toFixed(2).replace(".", ",")} emitido. Protocolo ${reembolso.protocolo}.` };
  }
}

type Corpo = { choices: { message: { content?: string | null; tool_calls?: { function: { name: string; arguments: string } }[] } }[]; usage?: { total_tokens: number } };

/** Adaptador para qualquer API compatível com o formato chat/completions. */
export class ModeloHttp implements Modelo {
  #url: string;
  #chave: string;
  #nome: string;
  #buscar: typeof fetch;

  constructor(url: string, chave: string, nome: string, buscar: typeof fetch = fetch) {
    this.#url = url;
    this.#chave = chave;
    this.#nome = nome;
    this.#buscar = buscar;
  }

  async decidir(e: EntradaModelo): Promise<{ decisao: Decisao; tokens: number }> {
    const tipos = { texto: "string", numero: "number", booleano: "boolean" };
    const tools = e.ferramentas.map((f) => ({
      type: "function",
      function: {
        name: f.nome,
        description: f.descricao,
        parameters: {
          type: "object",
          properties: Object.fromEntries(Object.entries(f.parametros).map(([k, c]) => [k, { type: tipos[c.tipo] }])),
          required: Object.entries(f.parametros).filter(([, c]) => c.obrigatorio).map(([k]) => k),
        },
      },
    }));
    for (const destino of e.destinos) {
      tools.push({ type: "function", function: { name: `transferir_${destino}`, description: `Passa o caso para ${destino}`, parameters: { type: "object", properties: { motivo: { type: "string" } as never }, required: ["motivo"] } } });
    }
    const papeis = { usuario: "user", assistente: "assistant", ferramenta: "user" };
    const resposta = await this.#buscar(this.#url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.#chave}` },
      body: JSON.stringify({
        model: this.#nome,
        tools,
        messages: [{ role: "system", content: e.instrucoes }, ...e.mensagens.map((m) => ({ role: papeis[m.papel], content: m.papel === "ferramenta" ? `Resultado de ${m.ferramenta}: ${m.conteudo}` : m.conteudo }))],
      }),
    });
    if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
    const corpo = (await resposta.json()) as Corpo;
    const { message } = corpo.choices[0];
    const tokens = corpo.usage?.total_tokens ?? 0;
    const chamada = message.tool_calls?.[0]?.function;
    if (!chamada) return { decisao: { tipo: "resposta", texto: message.content ?? "" }, tokens };
    const argumentos = JSON.parse(chamada.arguments || "{}");
    if (chamada.name.startsWith("transferir_")) {
      return { decisao: { tipo: "transferir", agente: chamada.name.slice("transferir_".length), motivo: String(argumentos.motivo ?? "") }, tokens };
    }
    return { decisao: { tipo: "ferramenta", chamada: { nome: chamada.name, argumentos }, raciocinio: message.content ?? "" }, tokens };
  }
}
