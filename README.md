# Orquestrador de agentes

Plataforma de atendimento com vários agentes de IA, ferramentas validadas, aprovação humana e rastro completo de cada decisão.

![Testes](https://github.com/luizrenatodc/orquestrador-agentes/actions/workflows/testes.yml/badge.svg) ![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white) ![Node.js](https://img.shields.io/badge/Node.js_24-339933?logo=nodedotjs&logoColor=white) ![SQLite](https://img.shields.io/badge/SQLite-003B57?logo=sqlite&logoColor=white)

## Veja funcionando

![Cliente pede um reembolso na conversa, o agente pausa, um humano aprova e o protocolo é emitido.](docs/conversa.gif)

*Gravação real da interface: o cliente pede um reembolso, o agente consulta o pedido e a política, pausa para aprovação humana e só então emite o protocolo.*

| Entrega resolvida sozinha | Ataque de injeção bloqueado |
| --- | --- |
| ![Rastro de uma dúvida de entrega resolvida sem intervenção humana.](docs/entrega.png) | ![Instrução maliciosa escondida em um dado externo sendo bloqueada.](docs/injecao.png) |

## O problema

Colocar um agente de IA para atender cliente é fácil. Difícil é confiar nele. Sem controle, um agente pode prometer o que não deve, executar uma ação cara por engano, entrar em laço, gastar sem limite ou obedecer a uma instrução escondida em um texto externo. E quando algo dá errado, ninguém consegue explicar por quê.

Este projeto trata o modelo como uma parte que erra: toda decisão dele passa por regras que ele não controla.

## O que ele faz

- **Vários agentes especialistas:** a triagem encaminha para logística ou financeiro, e cada um só enxerga as próprias ferramentas.
- **Aprovação humana:** ações sensíveis pausam a execução. O estado fica no banco, então a aprovação funciona mesmo depois de reiniciar o processo.
- **Defesa contra injeção:** texto suspeito, vindo do cliente ou de uma ferramenta, marca a execução e bloqueia qualquer ação sensível.
- **Dados pessoais mascarados:** CPF, cartão, e-mail e telefone são removidos antes de chegar ao modelo e aos logs.
- **Limites rígidos:** teto de passos, tokens, transferências e falhas seguidas.
- **Rastro completo:** cada decisão, chamada e bloqueio fica registrado, com duração.
- **Canal de WhatsApp:** webhook no formato da WhatsApp Cloud API, com validação de assinatura e descarte de mensagens reenviadas.

## Como funciona

```mermaid
flowchart LR
    C[Cliente] --> W[Webhook]
    W --> G{Guardas de entrada}
    G --> T[Agente de triagem]
    T --> L[Logística]
    T --> F[Financeiro]
    L --> V{Validação da chamada}
    F --> V
    V -->|ação comum| E[Executa a ferramenta]
    V -->|ação sensível| H[Aprovação humana]
    H --> E
    E --> S{Guardas de saída}
    S --> L
    S --> F
    V -.-> R[(Rastro em SQLite)]
    E -.-> R
```

A cada passo, o modelo só pode devolver uma de três decisões: chamar uma ferramenta, transferir o caso ou responder. O orquestrador confere se o agente tem acesso à ferramenta, valida os argumentos contra o esquema dela e, se algo estiver errado, devolve o erro ao modelo para ele corrigir, sem executar nada.

## Decisões técnicas

| Decisão | Motivo |
| --- | --- |
| Permissões no orquestrador, não no prompt | Um prompt pode ser contornado. Uma lista de acesso no código, não. |
| Estado completo salvo no banco | Permite pausar por horas e retomar em outro processo. |
| Interface `Modelo` com duas implementações | Troca de provedor sem mexer no orquestrador. |
| Modelo simulado determinístico | Testes reproduzíveis, sem custo e sem chave de API. |
| Injeção tratada como sinal, não como certeza | Texto suspeito ainda pode ser respondido, mas nunca dispara ação sensível. |

## Como rodar

Requer Node.js 24. Não há dependências para instalar.

```bash
npm start     # console em http://localhost:3000
npm test      # 26 testes
```

O projeto roda com o modelo simulado. Para usar um modelo real, passe `ModeloHttp` ao orquestrador com a URL e a chave de uma API compatível com `chat/completions`.

Para o webhook, defina `WHATSAPP_SEGREDO` e aponte para `POST /webhook/whatsapp`.

## Testes

![26 testes passando.](docs/testes.png)

Cobrem o que costuma falhar em produção: aprovação dupla, retomada após reinício, injeção vinda de dado externo, laço infinito, orçamento esgotado, ferramenta fora do ar e argumentos inválidos.

## Limites conhecidos

- A tela de conversa é um simulador. O webhook foi testado com payloads no formato da Cloud API, sem conexão a um número real.
- O adaptador `ModeloHttp` foi testado com respostas simuladas.
- A detecção de injeção usa padrões conhecidos. Em produção eu somaria um classificador, mantendo o bloqueio de ações sensíveis como última barreira.

## Estrutura

```text
src/orquestrador.ts     laço de decisão, limites e aprovação
src/ferramentas.ts      registro e validação de argumentos
src/guardas.ts          máscara de dados e detecção de injeção
src/modelo.ts           modelo simulado e adaptador HTTP
src/canal-whatsapp.ts   assinatura, leitura e deduplicação do webhook
src/rastros.ts          persistência e métricas
public/                 console com simulador de conversa
```

## Sobre este projeto

Projeto de demonstração, com dados e empresas fictícios, criado para mostrar a abordagem técnica.

## Autor

**Luiz Renato Carvalho**, Engenheiro de Software e IA · [luizrenato.dev](https://www.luizrenato.dev) · [LinkedIn](https://linkedin.com/in/luizrenatodc)
