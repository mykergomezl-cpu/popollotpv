# Imagen para Hostinger VPS (plantilla Docker) o cualquier servidor con Docker
FROM node:22-alpine
RUN apk add --no-cache tzdata && mkdir -p /data && chown node:node /data
ENV NODE_ENV=production TZ=Europe/Madrid POPOLLO_DATA=/data PORT=8080 HOST=0.0.0.0
WORKDIR /app
COPY --chown=node:node package.json server.js db.js verifactu.js ./
COPY --chown=node:node public ./public
COPY --chown=node:node scripts ./scripts
USER node
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=60s --timeout=5s CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1
CMD ["node", "--no-warnings", "server.js"]
