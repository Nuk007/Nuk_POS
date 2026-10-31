FROM node:20-alpine

WORKDIR /app

# Instalar dependências
COPY package*.json ./
RUN npm install --production

# Copiar código
COPY . .

# Porto exposto
EXPOSE 10000

# Arranque
CMD ["node", "scripts/start.js"]
