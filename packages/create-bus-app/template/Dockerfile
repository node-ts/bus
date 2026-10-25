# Builds the app with npm. Run `npm install` first, so package-lock.json exists.

# Compiles the app. docker compose also runs `bus provision` in this stage,
# since it has the dev dependencies.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Runs the app, with only its production dependencies
FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
CMD ["node", "dist/index.js"]
