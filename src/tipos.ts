export type Chamada = { nome: string; argumentos: Record<string, unknown> };

export type Mensagem = {
  papel: "usuario" | "assistente" | "ferramenta";
  conteudo: string;
  ferramenta?: string;
};

export type Decisao =
  | { tipo: "ferramenta"; chamada: Chamada; raciocinio: string }
  | { tipo: "transferir"; agente: string; motivo: string }
  | { tipo: "resposta"; texto: string };

export type Campo = { tipo: "texto" | "numero" | "booleano"; obrigatorio?: boolean; minimo?: number; maximo?: number };
export type Esquema = Record<string, Campo>;

export type DescricaoFerramenta = { nome: string; descricao: string; parametros: Esquema };

export type EntradaModelo = {
  agente: string;
  instrucoes: string;
  mensagens: Mensagem[];
  ferramentas: DescricaoFerramenta[];
  destinos: string[];
};

export interface Modelo {
  decidir(entrada: EntradaModelo): Promise<{ decisao: Decisao; tokens: number }>;
}

export type Ferramenta = DescricaoFerramenta & {
  sensivel?: boolean;
  executar(argumentos: Record<string, unknown>): Promise<unknown>;
};

export type Agente = { nome: string; instrucoes: string; ferramentas: string[]; destinos: string[] };

export type Status = "rodando" | "aguardando_aprovacao" | "concluida" | "falhou" | "limite";

export type Execucao = {
  id: string;
  pedido: string;
  status: Status;
  agente: string;
  mensagens: Mensagem[];
  passos: number;
  tokens: number;
  transferencias: number;
  suspeita: boolean;
  pendente?: Chamada;
  resposta?: string;
};

export type Limites = { maxPassos: number; maxTokens: number; maxTransferencias: number; maxFalhasFerramenta: number };
