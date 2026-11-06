import { randomUUID } from "node:crypto";
import { validar, type Registro } from "./ferramentas.ts";
import { mascarar, pareceInjecao } from "./guardas.ts";
import type { Rastros } from "./rastros.ts";
import type { Agente, Chamada, Execucao, Limites, Modelo, Status } from "./tipos.ts";

export const LIMITES_PADRAO: Limites = { maxPassos: 12, maxTokens: 6000, maxTransferencias: 3, maxFalhasFerramenta: 2 };

type Opcoes = { modelo: Modelo; agentes: Agente[]; ferramentas: Registro; rastros: Rastros; limites?: Partial<Limites>; inicial: string };

export class Orquestrador {
  #modelo: Modelo;
  #agentes: Map<string, Agente>;
  #ferramentas: Registro;
  #rastros: Rastros;
  #limites: Limites;
  #inicial: string;

  constructor(o: Opcoes) {
    this.#modelo = o.modelo;
    this.#agentes = new Map(o.agentes.map((a) => [a.nome, a]));
    this.#ferramentas = o.ferramentas;
    this.#rastros = o.rastros;
    this.#limites = { ...LIMITES_PADRAO, ...o.limites };
    this.#inicial = o.inicial;
  }

  async iniciar(pedido: string): Promise<Execucao> {
    const limpo = mascarar(pedido);
    const e: Execucao = {
      id: randomUUID(),
      pedido: limpo,
      status: "rodando",
      agente: this.#inicial,
      mensagens: [{ papel: "usuario", conteudo: limpo }],
      passos: 0,
      tokens: 0,
      transferencias: 0,
      suspeita: pareceInjecao(limpo),
    };
    this.#rastros.salvar(e);
    this.#rastros.registrar(e.id, "inicio", e.agente, { pedido: limpo, suspeita: e.suspeita });
    return this.#laco(e);
  }

  /** Retoma uma execução pausada. O estado vem do banco, então sobrevive a um reinício do processo. */
  async decidirAprovacao(id: string, aprovado: boolean, revisor: string): Promise<Execucao> {
    const e = this.#rastros.carregar(id);
    if (!e) throw new Error("Execução não encontrada");
    if (e.status !== "aguardando_aprovacao" || !e.pendente) throw new Error("Execução não está aguardando aprovação");
    const chamada = e.pendente;
    delete e.pendente;
    e.status = "rodando";
    this.#rastros.registrar(e.id, aprovado ? "aprovado" : "recusado", e.agente, { nome: chamada.nome, revisor });
    if (aprovado) {
      await this.#executarFerramenta(e, chamada);
    } else {
      e.mensagens.push({ papel: "ferramenta", ferramenta: chamada.nome, conteudo: JSON.stringify({ recusado: true, revisor }) });
    }
    return this.#laco(e);
  }

  async #laco(e: Execucao): Promise<Execucao> {
    let falhas = 0;
    while (true) {
      if (e.passos >= this.#limites.maxPassos) return this.#encerrar(e, "limite", "Limite de passos atingido");
      if (e.tokens >= this.#limites.maxTokens) return this.#encerrar(e, "limite", "Orçamento de tokens esgotado");

      const agente = this.#agentes.get(e.agente);
      if (!agente) return this.#encerrar(e, "falhou", `Agente desconhecido: ${e.agente}`);

      e.passos++;
      const inicio = performance.now();
      let saida;
      try {
        saida = await this.#modelo.decidir({
          agente: agente.nome,
          instrucoes: agente.instrucoes,
          mensagens: e.mensagens,
          ferramentas: this.#ferramentas.descrever(agente.ferramentas),
          destinos: agente.destinos,
        });
      } catch (erro) {
        return this.#encerrar(e, "falhou", `Modelo indisponível: ${(erro as Error).message}`);
      }
      e.tokens += saida.tokens;
      const { decisao } = saida;
      this.#rastros.registrar(e.id, "decisao", agente.nome, { ...decisao, tokens: saida.tokens }, performance.now() - inicio);

      if (decisao.tipo === "resposta") {
        e.resposta = mascarar(decisao.texto);
        e.mensagens.push({ papel: "assistente", conteudo: e.resposta });
        return this.#encerrar(e, "concluida");
      }

      if (decisao.tipo === "transferir") {
        if (!agente.destinos.includes(decisao.agente)) {
          e.mensagens.push({ papel: "ferramenta", conteudo: `Transferência negada para ${decisao.agente}` });
          this.#rastros.registrar(e.id, "bloqueio", agente.nome, { motivo: "destino não permitido", destino: decisao.agente });
          continue;
        }
        if (++e.transferencias > this.#limites.maxTransferencias) return this.#encerrar(e, "limite", "Limite de transferências atingido");
        this.#rastros.registrar(e.id, "transferencia", agente.nome, { para: decisao.agente, motivo: decisao.motivo });
        e.agente = decisao.agente;
        continue;
      }

      const { chamada } = decisao;
      const problema = this.#barrar(agente, chamada);
      if (problema) {
        this.#rastros.registrar(e.id, "bloqueio", agente.nome, { nome: chamada.nome, motivo: problema });
        e.mensagens.push({ papel: "ferramenta", ferramenta: chamada.nome, conteudo: JSON.stringify({ erro: problema }) });
        if (++falhas > this.#limites.maxFalhasFerramenta) return this.#encerrar(e, "falhou", "Muitas chamadas inválidas seguidas");
        continue;
      }

      if (this.#ferramentas.obter(chamada.nome)?.sensivel) {
        if (e.suspeita) {
          this.#rastros.registrar(e.id, "bloqueio", agente.nome, { nome: chamada.nome, motivo: "execução marcada como suspeita" });
          return this.#encerrar(e, "falhou", "Ação sensível bloqueada: possível injeção de instruções");
        }
        e.status = "aguardando_aprovacao";
        e.pendente = chamada;
        this.#rastros.registrar(e.id, "aprovacao_pendente", agente.nome, { ...chamada });
        this.#rastros.salvar(e);
        return e;
      }

      const ok = await this.#executarFerramenta(e, chamada);
      falhas = ok ? 0 : falhas + 1;
      if (falhas > this.#limites.maxFalhasFerramenta) return this.#encerrar(e, "falhou", "Ferramenta falhou repetidamente");
      this.#rastros.salvar(e);
    }
  }

  #barrar(agente: Agente, chamada: Chamada): string | undefined {
    if (!agente.ferramentas.includes(chamada.nome)) return `${agente.nome} não tem acesso a ${chamada.nome}`;
    const ferramenta = this.#ferramentas.obter(chamada.nome);
    if (!ferramenta) return `Ferramenta inexistente: ${chamada.nome}`;
    const erros = validar(ferramenta.parametros, chamada.argumentos);
    return erros.length ? erros.join("; ") : undefined;
  }

  async #executarFerramenta(e: Execucao, chamada: Chamada): Promise<boolean> {
    const inicio = performance.now();
    try {
      const resultado = await this.#ferramentas.obter(chamada.nome)!.executar(chamada.argumentos);
      const texto = mascarar(JSON.stringify(resultado));
      if (pareceInjecao(texto)) {
        e.suspeita = true;
        this.#rastros.registrar(e.id, "bloqueio", e.agente, { nome: chamada.nome, motivo: "conteúdo externo com tentativa de injeção" });
      }
      e.mensagens.push({ papel: "ferramenta", ferramenta: chamada.nome, conteudo: texto });
      this.#rastros.registrar(e.id, "ferramenta_ok", e.agente, { nome: chamada.nome, argumentos: chamada.argumentos, resultado: JSON.parse(texto) }, performance.now() - inicio);
      return true;
    } catch (erro) {
      const mensagem = (erro as Error).message;
      e.mensagens.push({ papel: "ferramenta", ferramenta: chamada.nome, conteudo: JSON.stringify({ erro: mensagem }) });
      this.#rastros.registrar(e.id, "ferramenta_erro", e.agente, { nome: chamada.nome, erro: mensagem }, performance.now() - inicio);
      return false;
    }
  }

  #encerrar(e: Execucao, status: Status, motivo?: string): Execucao {
    e.status = status;
    this.#rastros.registrar(e.id, "fim", e.agente, { status, motivo, resposta: e.resposta, tokens: e.tokens, passos: e.passos });
    this.#rastros.salvar(e);
    return e;
  }
}
