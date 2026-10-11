FROM node:24-bookworm-slim AS frontend
WORKDIR /src/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim-bookworm
LABEL org.opencontainers.image.source="https://github.com/wonderhate/photo-management"
LABEL org.opencontainers.image.description="Local photo library web edition: EXIF, reports and watermark drafts"
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 && rm -rf /var/lib/apt/lists/*
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ ./backend/
COPY --from=frontend /src/frontend/dist ./frontend/dist
RUN useradd --uid 1000 --create-home photos && mkdir /data /models && chown photos:photos /data /models
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PHOTO_DATA_DIR=/data PHOTO_EXPORT_DIR=/data/exports PHOTO_MODELS_DIR=/models PHOTO_AUTOLOAD_AI=0
USER photos
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health',timeout=3)"
CMD ["python", "-m", "uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8000"]
