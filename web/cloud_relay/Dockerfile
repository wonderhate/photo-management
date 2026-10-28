FROM python:3.12-slim
WORKDIR /app
COPY cloud_relay/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt
COPY cloud_relay/__init__.py cloud_relay/app.py cloud_relay/protocol.py cloud_relay/schemas.py /app/cloud_relay/
COPY cloud_relay/studio.py cloud_relay/ai_protocol.py cloud_relay/ai_schemas.py /app/cloud_relay/
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
USER 65534:65534
EXPOSE 9000
# Wire limit includes compression overhead; decoded chunks remain capped at 64 KiB.
CMD ["uvicorn","cloud_relay.app:app","--host","0.0.0.0","--port","9000","--ws-max-size","131072","--no-access-log"]
