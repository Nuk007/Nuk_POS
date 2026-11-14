# Agente de impressão em rede — Nuk_POS

Programa pequeno para imprimir talões e recibos em **impressoras térmicas de rede** (Wi-Fi ou cabo, porta 9100), que o navegador não consegue alcançar directamente.

## O que é preciso
- Um computador (Windows, Linux ou Mac) **ligado à mesma rede das impressoras** e sempre ligado durante o serviço.
- [Node.js](https://nodejs.org) 18 ou mais recente.
- O ficheiro `agente.js` desta pasta.

## Instalar
1. No Nuk_POS, como administrador: **Configurações → Impressão em rede → Criar agente**. Copie o token (`nka_…`): só aparece uma vez.
2. No computador da rede, abra uma janela de comandos na pasta do `agente.js` e corra:
   ```
   node agente.js --token nka_O_SEU_TOKEN
   ```
3. Em cada dispositivo que imprime (tablet do caixa, ecrã da cozinha): botão 🖨️ → **Rede (agente local)** → escreva o IP da impressora (ex.: `192.168.1.50:9100`) → **Imprimir teste**.

Para arrancar sozinho com o Windows, crie uma tarefa no Agendador de Tarefas («Ao iniciar sessão») com o mesmo comando, ou use o `pm2` (`npm i -g pm2`, `pm2 start agente.js -- --token nka_…`, `pm2 save`).

## Segurança
- O agente só envia para endereços da rede local (10.x, 172.16–31.x, 192.168.x) e portas 9100–9109.
- O token identifica o estabelecimento. Se o computador for roubado ou trocado, **revogue o agente** em Configurações e crie outro.
