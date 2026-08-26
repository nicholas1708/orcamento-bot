# Bot de Orçamentos — Node 20 (mesmo padrão de deploy do Kairos: GHCR + Swarm)
FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY . .

# Tudo que é DADO e não código. Cada uma destas é volume no stack — sem isso
# o deploy apaga cadastro de produto, foto e vendedor, porque o container é
# descartado e recriado a partir da imagem.
RUN mkdir -p sessions out img-cache clientes orcamentos dados img

EXPOSE 3000
CMD ["node", "server.js"]
