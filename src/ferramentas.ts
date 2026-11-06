import type { DescricaoFerramenta, Esquema, Ferramenta } from "./tipos.ts";

/** Devolve os problemas encontrados nos argumentos. Lista vazia significa válido. */
export function validar(esquema: Esquema, argumentos: Record<string, unknown>): string[] {
  const erros: string[] = [];
  for (const [nome, campo] of Object.entries(esquema)) {
    const valor = argumentos[nome];
    if (valor === undefined || valor === null) {
      if (campo.obrigatorio) erros.push(`${nome} é obrigatório`);
      continue;
    }
    const esperado = { texto: "string", numero: "number", booleano: "boolean" }[campo.tipo];
    if (typeof valor !== esperado) {
      erros.push(`${nome} deve ser ${campo.tipo}`);
      continue;
    }
    if (typeof valor === "number") {
      if (campo.minimo !== undefined && valor < campo.minimo) erros.push(`${nome} abaixo de ${campo.minimo}`);
      if (campo.maximo !== undefined && valor > campo.maximo) erros.push(`${nome} acima de ${campo.maximo}`);
    }
  }
  for (const nome of Object.keys(argumentos)) {
    if (!(nome in esquema)) erros.push(`${nome} não é um parâmetro aceito`);
  }
  return erros;
}

export class Registro {
  #itens = new Map<string, Ferramenta>();

  adicionar(ferramenta: Ferramenta): this {
    if (this.#itens.has(ferramenta.nome)) throw new Error(`Ferramenta duplicada: ${ferramenta.nome}`);
    this.#itens.set(ferramenta.nome, ferramenta);
    return this;
  }

  obter(nome: string): Ferramenta | undefined {
    return this.#itens.get(nome);
  }

  descrever(nomes: string[]): DescricaoFerramenta[] {
    return nomes.flatMap((nome) => {
      const f = this.#itens.get(nome);
      return f ? [{ nome: f.nome, descricao: f.descricao, parametros: f.parametros }] : [];
    });
  }
}
