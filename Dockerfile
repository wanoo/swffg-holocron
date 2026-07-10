FROM node:22-alpine
WORKDIR /app
COPY package.json ./
# le connecteur embarqué est une dépendance git optionnelle
RUN npm install --omit=dev || npm install --omit=dev --no-optional
COPY server ./server
COPY public ./public
ENV HOLOCRON_DATA_DIR=/data PORT=8080
VOLUME /data
EXPOSE 8080
CMD ["node", "server/index.mjs"]
