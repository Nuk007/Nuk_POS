# Guia de Deploy — Nuk_POS no Render

## Pré-requisitos
- Conta no [render.com](https://render.com)
- Repositório no GitHub com este código

## Passo 1 — Criar o serviço no Render

1. Aceder a **render.com → New → Blueprint**
2. Ligar ao repositório GitHub do Nuk_POS
3. O Render detecta automaticamente o `render.yaml` e cria:
   - Serviço web `nukpos` (Node.js)
   - Base de dados PostgreSQL `nukpos-db` (plano free)

## Passo 2 — Variáveis de ambiente

O `render.yaml` já define automaticamente:
| Variável | Valor |
|----------|-------|
| `NODE_ENV` | `production` |
| `JWT_SECRET` | gerado automaticamente |
| `PORT` | `10000` |
| `DATABASE_URL` | injectado pela BD nukpos-db |
| `ALLOWED_ORIGINS` | `https://nukpos.onrender.com` |
| `BASE_URL` | `https://nukpos.onrender.com` |

> ⚠️ Se o nome do serviço for diferente de `nukpos`, actualizar `ALLOWED_ORIGINS` e `BASE_URL` para o URL real.

## Passo 3 — Primeiro deploy

1. O Render corre `npm install` e `node server/app.js`
2. O `initDB()` cria todas as tabelas automaticamente (CREATE TABLE IF NOT EXISTS)
3. O `seedDB()` insere o utilizador admin e as configurações iniciais

## Passo 4 — Verificar o arranque

Aceder ao URL do serviço + `/api/health`:
```
https://nukpos.onrender.com/api/health
```
Deve responder:
```json
{"status":"ok","timestamp":"...","database":"connected"}
```

## Passo 5 — Primeiro login de admin

```
Email: admin@nukpos.ao
Password: Admin@NukPOS25!
```

**Alterar imediatamente** em Configurações → Conta.

## Passo 6 — Portal do cliente (QR Code)

1. Fazer login como ADMIN ou GERENTE
2. Ir a **Configurações → QR Code**
3. O endpoint `GET /api/qrcode` gera o QR para `https://nukpos.onrender.com/cliente`
4. Partilhar o QR com os clientes via WhatsApp ou imprimir

## Passo 7 — Configurar a URL pública (opcional)

Se usar um domínio próprio (ex: `pos.nukunidade.ao`):
1. No Render: Settings → Custom Domains → Add Domain
2. Actualizar as env vars `ALLOWED_ORIGINS` e `BASE_URL` com o novo domínio
3. Actualizar `portal_url` em Configurações no painel admin

## Notas importantes

- **Plano free do PostgreSQL**: a BD é eliminada após 90 dias de inactividade. Actualizar para plano pago antes do go-live.
- **Sleep em inactividade**: serviços free adormece após 15 min sem pedidos. Actualizar para plano Starter ($7/mês) para produção.
- **Backups**: configurar backups automáticos da BD no painel Render.

## Rotas disponíveis

### Staff (JWT obrigatório)
| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/api/auth/login` | Login staff |
| GET | `/api/produtos` | Listar produtos |
| POST | `/api/pedidos` | Criar pedido |
| GET | `/api/pedidos` | Listar pedidos |
| GET | `/api/qrcode` | QR Code portal |

### Portal Cliente (público)
| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/api/cliente/login` | Identificar por telefone |
| POST | `/api/cliente/cadastrar` | Registar novo cliente |
| GET | `/api/cliente/perfil?tel=9XXXXXXXX` | Perfil + carteira |
| GET | `/api/cliente/cardapio` | Menu disponível |
| POST | `/api/cliente/pedido-restaurante` | Fazer pedido |
| POST | `/api/cliente/pedido-hospedagem` | Solicitar quarto |
| POST | `/api/cliente/nukcoin/carregar` | Carregar Nuk-Coin |
| GET | `/api/cliente/nukcoin/historico` | Histórico carteira |
