# LAN host (page, read-only game data, multiplayer gateway) for compose.yaml. The built page (dist/), the
# certificates and the game data are mounted at run time; the image holds only the server scripts and `ws`.
FROM node:24-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY server/lan-host.mjs server/mp-gateway.mjs server/
USER node
EXPOSE 8443
ENTRYPOINT ["node", "server/lan-host.mjs"]
