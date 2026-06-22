FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=3000 \
    WEB_CONCURRENCY=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import os, urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\", \"3000\")}/api/v1/health', timeout=3).read()"

CMD ["sh", "-c", "gunicorn app:asgi_app --bind 0.0.0.0:${PORT:-3000} --workers ${WEB_CONCURRENCY:-1} --worker-class uvicorn.workers.UvicornWorker --access-logfile - --error-logfile -"]
