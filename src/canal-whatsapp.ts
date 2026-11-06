import { createHmac, timingSafeEqual } from "node:crypto";

export type MensagemRecebida = { id: string; de: string; texto: string };

type Webhook = {
  entry?: { changes?: { value?: { messages?: { id: string; from: string; type: string; text?: { body: string } }[] } }[] }[];
};

/** Confere o cabeçalho X-Hub-Signature-256 antes de aceitar o webhook. */
export function assinaturaValida(corpo: string, cabecalho: string | undefined, segredo: string): boolean {
  if (!cabecalho?.startsWith("sha256=")) return false;
  const esperado = Buffer.from(createHmac("sha256", segredo).update(corpo).digest("hex"));
  const recebido = Buffer.from(cabecalho.slice("sha256=".length));
  return esperado.length === recebido.length && timingSafeEqual(esperado, recebido);
}

/** Extrai as mensagens de texto do formato de webhook da WhatsApp Cloud API. */
export function extrairMensagens(webhook: Webhook): MensagemRecebida[] {
  return (webhook.entry ?? []).flatMap((entrada) =>
    (entrada.changes ?? []).flatMap((mudanca) =>
      (mudanca.value?.messages ?? [])
        .filter((m) => m.type === "text" && m.text)
        .map((m) => ({ id: m.id, de: m.from, texto: m.text!.body })),
    ),
  );
}

export function montarResposta(para: string, texto: string) {
  return { messaging_product: "whatsapp", to: para, type: "text", text: { body: texto } };
}

/** O provedor reenvia webhooks, então cada mensagem só pode ser processada uma vez. */
export class Deduplicador {
  #vistos = new Set<string>();
  #limite: number;

  constructor(limite = 10_000) {
    this.#limite = limite;
  }

  primeiraVez(id: string): boolean {
    if (this.#vistos.has(id)) return false;
    this.#vistos.add(id);
    if (this.#vistos.size > this.#limite) this.#vistos.delete(this.#vistos.values().next().value!);
    return true;
  }
}
