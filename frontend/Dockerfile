# -------- Stage 1: Build --------
FROM node:20-alpine AS builder

WORKDIR /app

COPY . .

# If this was React/Vue:
# RUN npm install && npm run build


# -------- Stage 2: Nginx --------
FROM nginx:alpine

COPY --from=builder /app /usr/share/nginx/html

EXPOSE 80