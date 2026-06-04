# =============================================================
# track-frontend · build multi-stage (Angular → Nginx)
# =============================================================

# ---- Stage 1: compilar el Angular ----
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build
# El application builder de Angular 17 deja el bundle del navegador en dist/browser

# ---- Stage 2: servir estático con Nginx ----
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/browser /usr/share/nginx/html
EXPOSE 80
