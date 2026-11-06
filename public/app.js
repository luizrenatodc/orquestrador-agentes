const $ = (s) => document.querySelector(s);
const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const api = async (url, opcoes) => (await fetch(url, opcoes)).json();
const post = (url, corpo) => api(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) });

const STATUS = {
  concluida: ["ok", "concluída"],
  aguardando_aprovacao: ["alerta", "aguardando aprovação"],
  falhou: ["erro", "interrompida"],
  limite: ["erro", "limite"],
  rodando: ["info", "rodando"],
};
const selo = (s) => `<span class="selo ${STATUS[s][0]}">${STATUS[s][1]}</span>`;

const EVENTOS = {
  inicio: ["info", "▶", (d) => `Mensagem recebida${d.suspeita ? " e marcada como suspeita" : ""}`, (d) => d.pedido],
  decisao: ["lilas", "◆", (d) => (d.tipo === "ferramenta" ? d.raciocinio : d.tipo === "transferir" ? "Decidiu transferir" : "Decidiu responder"), (d) => (d.tipo === "ferramenta" ? `${d.chamada.nome}(${JSON.stringify(d.chamada.argumentos)})` : "")],
  transferencia: ["info", "⇄", (d) => `Transferiu para ${d.para}`, (d) => d.motivo],
  ferramenta_ok: ["ok", "✓", (d) => `${d.nome} executada`, (d) => JSON.stringify(d.resultado)],
  ferramenta_erro: ["erro", "!", (d) => `${d.nome} falhou`, (d) => d.erro],
  bloqueio: ["erro", "■", () => "Guarda bloqueou a ação", (d) => d.motivo],
  aprovacao_pendente: ["alerta", "?", (d) => `${d.nome} precisa de aprovação`, (d) => JSON.stringify(d.argumentos)],
  aprovado: ["ok", "✓", (d) => `Aprovado por ${d.revisor}`, () => ""],
  recusado: ["erro", "✕", (d) => `Recusado por ${d.revisor}`, () => ""],
  fim: ["ok", "●", (d) => `Fim: ${d.status}`, (d) => d.resposta ?? d.motivo ?? ""],
};

const RESPOSTA_PADRAO = {
  aguardando_aprovacao: "Recebi seu pedido. Um atendente vai revisar e já te retorno.",
  falhou: "Não consegui concluir por aqui. Vou passar para um atendente.",
  limite: "Não consegui concluir por aqui. Vou passar para um atendente.",
};

let ativa;

const hora = (i) => `14:${String(2 + i * 3).padStart(2, "0")}`;

function balao(e, i) {
  const resposta = e.resposta ?? RESPOSTA_PADRAO[e.status];
  const classe = e.id === ativa ? "ativo" : "";
  return `<div class="balao eu ${classe}" data-id="${e.id}">${esc(e.pedido)}<time>${hora(i)} <span class="check">✓✓</span></time></div>` +
    (resposta ? `<div class="balao bot ${classe}" data-id="${e.id}">${esc(resposta)}<time>${hora(i)}</time></div>` : "");
}

async function carregar() {
  const [m, lista] = await Promise.all([api("/api/metricas"), api("/api/execucoes")]);
  $("#kpis").innerHTML = [
    ["Conversas", m.execucoes, `${m.porStatus.concluida ?? 0} resolvidas sem humano`],
    ["Aguardando humano", m.porStatus.aguardando_aprovacao ?? 0, "ações sensíveis em revisão"],
    ["Bloqueadas", (m.porStatus.falhou ?? 0) + (m.porStatus.limite ?? 0), "guardas de segurança e limites"],
    ["Tokens usados", m.tokens.toLocaleString("pt-BR"), `${m.passosMedios.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} passos por conversa`],
  ].map(([r, v, n]) => `<div class="cartao kpi"><div class="rotulo">${r}</div><div class="valor">${v}</div><div class="nota">${n}</div></div>`).join("");

  const maior = Math.max(1, ...m.ferramentas.map((f) => f.chamadas));
  $("#ferramentas").innerHTML = m.ferramentas.map((f) => `
    <div style="margin-bottom:12px"><code>${esc(f.nome)}</code><div class="nevoa" style="font-size:12px">${f.chamadas}× · ${f.media_ms} ms${f.erros ? ` · ${f.erros} erro` : ""}</div>
    <div class="barra" style="width:${(f.chamadas / maior) * 100}%"></div></div>`).join("");

  const ordem = [...lista].reverse();
  if (!ativa && ordem.length) ativa = (ordem.find((e) => e.status === "aguardando_aprovacao") ?? ordem.at(-1)).id;
  $("#chat").innerHTML = ordem.map(balao).join("");
  $("#chat").scrollTop = $("#chat").scrollHeight;
  if (ativa) await detalhe();
}

async function detalhe() {
  const { execucao: e, eventos } = await api(`/api/execucoes/${ativa}`);
  const aprovar = e.status === "aguardando_aprovacao" ? `
    <div class="aprovar">
      <strong>Aprovação necessária:</strong> <code>${esc(e.pendente.nome)}(${esc(JSON.stringify(e.pendente.argumentos))})</code>
      <div class="linha" style="margin-top:10px"><button data-aprovar="true">Aprovar</button><button class="fantasma" data-aprovar="false">Recusar</button></div>
    </div>` : "";
  $("#detalhe").innerHTML = `
    <div class="linha" style="justify-content:space-between;margin-bottom:12px"><h2 style="margin:0">Rastro da decisão</h2>${selo(e.status)}</div>
    ${aprovar}
    ${eventos.map((ev) => {
      const [classe, icone, titulo, extra] = EVENTOS[ev.tipo];
      const texto = extra(ev.dados);
      return `<div class="passo"><div class="bola ${classe}">${icone}</div>
        <div><strong>${esc(titulo(ev.dados))}</strong> <span class="selo">${esc(ev.agente)}</span>${texto ? `<div class="dados mono">${esc(texto)}</div>` : ""}</div>
        <span class="nevoa mono">${ev.duracao_ms ? ev.duracao_ms + " ms" : ""}</span></div>`;
    }).join("")}`;
}

$("#chat").addEventListener("click", (ev) => {
  const item = ev.target.closest(".balao");
  if (item) { ativa = item.dataset.id; carregar(); }
});
$("#detalhe").addEventListener("click", async (ev) => {
  const valor = ev.target.dataset.aprovar;
  if (valor) { await post(`/api/execucoes/${ativa}/aprovacao`, { aprovado: valor === "true" }); carregar(); }
});
$("#novo").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const pedido = $("#pedido").value;
  $("#pedido").value = "";
  $("#chat").insertAdjacentHTML("beforeend", `<div class="balao eu">${esc(pedido)}<time>agora <span class="check">✓✓</span></time></div><div class="digitando"><i></i><i></i><i></i></div>`);
  $("#chat").scrollTop = $("#chat").scrollHeight;
  const e = await post("/api/execucoes", { pedido });
  ativa = e.id;
  carregar();
});
carregar();
