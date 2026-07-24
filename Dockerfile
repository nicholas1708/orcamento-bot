# Bot de Orçamentos — Node 20 (mesmo padrão de deploy do Kairos: GHCR + Swarm)
FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY . .

# fichas de conversa e PDFs gerados (montados como volume no stack)
RUN mkdir -p sessions out

EXPOSE 3000
CMD ["node", "server.js"]
