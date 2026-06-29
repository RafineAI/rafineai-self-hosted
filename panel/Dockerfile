# ---- deps ----
FROM node:22-alpine AS deps
WORKDIR /app
COPY panel/package.json panel/package-lock.json* ./
RUN npm install

# ---- build ----
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY panel/ ./
RUN npm run build

# ---- runtime (standalone output) ----
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
