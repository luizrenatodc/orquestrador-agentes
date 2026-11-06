import { DatabaseSync } from "node:sqlite";
import type { Execucao } from "./tipos.ts";

export type Evento = { seq: number; tipo: string; agente: string; dados: Record<string, unknown>; duracao_ms: number; em: string };

export class Rastros {
  #db: DatabaseSync;

  constructor(caminho = ":memory:") {
    this.#db = new DatabaseSync(caminho);
    this.#db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS execucoes (
        id TEXT PRIMARY KEY, status TEXT NOT NULL, estado TEXT NOT NULL,
        criada_em TEXT NOT NULL, atualizada_em TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS eventos (
        execucao_id TEXT NOT NULL REFERENCES execucoes(id), seq INTEGER NOT NULL,
        tipo TEXT NOT NULL, agente TEXT NOT NULL, dados TEXT NOT NULL,
        duracao_ms INTEGER NOT NULL, em TEXT NOT NULL,
        PRIMARY KEY (execucao_id, seq)
      );
    `);
  }

  salvar(e: Execucao): void {
    const agora = new Date().toISOString();
    this.#db
      .prepare(
        `INSERT INTO execucoes (id, status, estado, criada_em, atualizada_em) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET status = excluded.status, estado = excluded.estado, atualizada_em = excluded.atualizada_em`,
      )
      .run(e.id, e.status, JSON.stringify(e), agora, agora);
  }

  carregar(id: string): Execucao | undefined {
    const linha = this.#db.prepare("SELECT estado FROM execucoes WHERE id = ?").get(id) as { estado: string } | undefined;
    return linha ? JSON.parse(linha.estado) : undefined;
  }

  listar(limite = 50): Execucao[] {
    const linhas = this.#db.prepare("SELECT estado FROM execucoes ORDER BY rowid DESC LIMIT ?").all(limite) as { estado: string }[];
    return linhas.map((l) => JSON.parse(l.estado));
  }

  registrar(execucaoId: string, tipo: string, agente: string, dados: Record<string, unknown>, duracaoMs = 0): void {
    const { proximo } = this.#db.prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS proximo FROM eventos WHERE execucao_id = ?").get(execucaoId) as { proximo: number };
    this.#db
      .prepare("INSERT INTO eventos (execucao_id, seq, tipo, agente, dados, duracao_ms, em) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(execucaoId, proximo, tipo, agente, JSON.stringify(dados), Math.round(duracaoMs), new Date().toISOString());
  }

  eventos(execucaoId: string): Evento[] {
    const linhas = this.#db.prepare("SELECT seq, tipo, agente, dados, duracao_ms, em FROM eventos WHERE execucao_id = ? ORDER BY seq").all(execucaoId) as (Omit<Evento, "dados"> & { dados: string })[];
    return linhas.map((l) => ({ ...l, dados: JSON.parse(l.dados) }));
  }

  metricas() {
    const execucoes = this.listar(10_000);
    const porStatus: Record<string, number> = {};
    for (const e of execucoes) porStatus[e.status] = (porStatus[e.status] ?? 0) + 1;
    const ferramentas = this.#db
      .prepare(
        `SELECT json_extract(dados, '$.nome') AS nome, COUNT(*) AS chamadas, ROUND(AVG(duracao_ms)) AS media_ms,
                SUM(CASE WHEN tipo = 'ferramenta_erro' THEN 1 ELSE 0 END) AS erros
         FROM eventos WHERE tipo IN ('ferramenta_ok', 'ferramenta_erro')
         GROUP BY nome ORDER BY chamadas DESC`,
      )
      .all();
    const total = execucoes.length || 1;
    return {
      execucoes: execucoes.length,
      porStatus,
      tokens: execucoes.reduce((s, e) => s + e.tokens, 0),
      passosMedios: execucoes.reduce((s, e) => s + e.passos, 0) / total,
      ferramentas,
    };
  }
}
