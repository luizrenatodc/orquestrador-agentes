const PADROES: [RegExp, string][] = [
  [/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "[cpf]"],
  [/\b(?:\d[ -]?){13,16}\b/g, "[cartao]"],
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]"],
  [/\(?\b\d{2}\)?[ ]?9?\d{4}-?\d{4}\b/g, "[telefone]"],
];

/** Remove dados pessoais antes de gravar ou enviar o texto ao modelo. */
export function mascarar(texto: string): string {
  return PADROES.reduce((t, [padrao, troca]) => t.replace(padrao, troca), texto);
}

const INJECAO = [
  /ignore (todas )?(as |suas )?instru[cç][oõ]es/i,
  /ignore (all |your )?(previous )?instructions/i,
  /voc[eê] agora [eé]/i,
  /revele (o|seu) prompt/i,
  /aprove (o |este )?reembolso/i,
];

/** Sinaliza texto vindo de fora que tenta dar ordens ao agente. */
export function pareceInjecao(texto: string): boolean {
  return INJECAO.some((padrao) => padrao.test(texto));
}

export function estimarTokens(texto: string): number {
  return Math.ceil(texto.length / 4);
}
