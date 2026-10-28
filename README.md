# Nuk_POS

Sistema de Gestão Integrado para o **Clube 3D Afro Grill** — Talatona, Luanda, Angola.

Stack: **Node.js + Express + PostgreSQL + Render** (mesma arquitectura do ATC46/AviationMoney)

---

## Deploy em 4 Passos

### 1. Criar repositório GitHub
```bash
git init
git add .
git commit -m "initial: Nuk_POS"
git remote add origin https://github.com/SEU_USER/nukpos.git
git push -u origin main
```

### 2. Criar serviço no Render
1. Ir a [render.com](https://render.com) → **New → Blueprint**
2. Ligar ao repositório `nukpos`
3. O `render.yaml` cria automaticamente:
   - Serviço web Node.js (sem Docker)
   - Base de dados PostgreSQL gratuita
   - Disco persistente 1 GB

### 3. Configurar variável de ambiente
No painel do Render → serviço `nukpos` → **Environment**:
```
JWT_SECRET = <gerar em: openssl rand -hex 32>
```
> `DATABASE_URL` é injectada automaticamente pelo Render.

### 4. Deploy automático
Cada `git push` para `main` faz deploy automático.

---

## Credenciais Padrão

| Campo | Valor |
|-------|-------|
| Email | `admin@nukpos.ao` |
| Senha | `Admin@NukPOS25!` |

> **Alterar imediatamente após o primeiro login!**

---

## Módulos

| Módulo | Descrição |
|--------|-----------|
| Dashboard | KPIs em tempo real, pedidos activos, top produtos |
| Pedidos | Gestão completa de pedidos por mesa |
| Mesas | Estado visual de todas as mesas (12 mesas, 3 zonas) |
| Quartos | Reservas com controlo de concorrência |
| Produtos | Menu com preços em Kz, por categoria |
| Stock | Inventário com alertas de stock mínimo |
| Financeiro | Receitas, facturas com IVA 14% (AGT Angola) |
| Clientes | CRM com programa de fidelização |
| Funcionários | Gestão de staff com níveis de acesso |
| Configurações | Parâmetros do sistema (Admin only) |

---

## Arquitectura

```
nukpos/
├── server/
│   ├── app.js      # Express + Socket.io + todas as rotas
│   └── db.js       # PostgreSQL pool + schema + seed
├── public/
│   ├── index.html  # SPA shell
│   ├── css/
│   │   └── nukpos.css
│   └── js/
│       ├── nukpos.js    # Core: auth, API, WebSocket, nav
│       └── modulos.js   # UI: todos os 10 módulos
├── render.yaml     # Deploy config (sem Dockerfile!)
├── package.json
└── .env.example
```

**Importante:** Não há `Dockerfile` — o Render usa runtime Node.js nativo, que suporta disco persistente sem problemas de redeploy.

---

## Tecnologias

- **Backend:** Node.js 18+, Express 4, PostgreSQL (via `pg`)
- **Real-time:** Socket.io 4
- **Segurança:** JWT (8h), bcrypt (rounds=12), helmet, rate-limit
- **Frontend:** HTML/CSS/JS vanilla (sem framework)
- **Deploy:** Render (free tier)
- **Timezone:** Africa/Luanda | Moeda: Kz | IVA: 14%
