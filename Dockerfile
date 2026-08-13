# Stage 1 — build the React frontend
FROM node:20-slim AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package.json ./
RUN npm install
COPY frontend/ ./
# No VITE_BACKEND_URL → frontend calls same-origin /api (single container)
RUN npm run build

# Stage 2 — Python backend + serve built frontend
FROM python:3.11-slim
WORKDIR /app

# Pango/GDK-Pixbuf/etc. required by WeasyPrint for PDF rendering, plus
# Noto Sans JP so the bilingual report renders Japanese correctly (spec §11).
# libgdk-pixbuf-2.0-0 (dash before "2.0") is the current Debian trixie name —
# the old libgdk-pixbuf2.0-0 is a removed transitional package.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libpango-1.0-0 libpangocairo-1.0-0 libgdk-pixbuf-2.0-0 \
      libffi-dev shared-mime-info fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ .

# Copy built frontend into the static/ folder that server.py serves
COPY --from=frontend-builder /app/frontend/dist ./static

ENV PORT=8080
CMD ["sh", "-c", "uvicorn server:app --host 0.0.0.0 --port ${PORT}"]
