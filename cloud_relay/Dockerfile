FROM python:3.12-slim
WORKDIR /app
COPY cloud_relay/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt
COPY cloud_relay/__init__.py cloud_relay/app.py cloud_relay/studio.py /app/cloud_relay/
COPY backend/app/services/qwen_protocol.py /app/backend/app/services/qwen_protocol.py
COPY backend/app/services/ai_protocol.py /app/backend/app/services/ai_protocol.py
COPY backend/app/ai_schemas.py /app/backend/app/ai_schemas.py
COPY backend/app/art_schemas.py /app/backend/app/art_schemas.py
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
USER 65534:65534
EXPOSE 9000
# The wildcard is confined to the cloud container. Local development uses loopback.
# Allow compression/frame overhead; the application still caps decoded chunks at 64 KiB.
CMD ["uvicorn","cloud_relay.app:app","--host","0.0.0.0","--port","9000","--ws-max-size","131072","--no-access-log"]
