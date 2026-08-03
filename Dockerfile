# Bot de Orçamentos — Node 20 (mesmo padrão de deploy do Kairos: GHCR + Swarm)
FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY . .

# fichas de conversa, PDFs gerados e cache de imagens (volumes no stack)
RUN mkdir -p sessions out img-cache clientes orcamentos

EXPOSE 3000
CMD ["node", "server.js"]
