# Lytterom: produksjonsbilde. Databasen og opplastede filer lagres i /data,
# som må være et vedvarende volum hos vertstjenesten.
FROM node:26-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:26-slim
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    LYTTEROM_DATA_DIR=/data \
    PORT=3000
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/next.config.ts ./
# Kjører som root fordi Railway og flere andre monterer volumet med root som eier.
RUN mkdir -p /data
EXPOSE 3000
CMD ["sh", "-c", "exec node node_modules/next/dist/bin/next start -H 0.0.0.0 -p ${PORT:-3000}"]
