FROM python:3.12-slim
ENV DATABASE_URL=sqlite:///./safeguard.db
WORKDIR /srv
RUN apt-get update && apt-get install -y --no-install-recommends libglib2.0-0 && rm -rf /var/lib/apt/lists/*
COPY . /build-context
RUN set -e; \
    if [ -f /build-context/requirements.txt ]; then \
        cp -a /build-context/. /srv/; \
    elif [ -f /build-context/backend/requirements.txt ]; then \
        cp -a /build-context/backend/. /srv/; \
    else \
        echo "Unable to locate backend/requirements.txt" >&2; exit 1; \
    fi
RUN rm -rf .venv  # remove host virtualenv from image
RUN pip install --no-cache-dir -r /srv/requirements.txt

RUN mkdir -p /srv/evidence /srv/uploads
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD python -c "import os,urllib.request; port=os.getenv('PORT','8000'); urllib.request.urlopen(f'http://127.0.0.1:{port}/api/health')"
CMD ["sh","-c","alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
ENV DATABASE_URL=sqlite:///./safeguard.db
WORKDIR /srv
RUN apt-get update && apt-get install -y --no-install-recommends libglib2.0-0 && rm -rf /var/lib/apt/lists/*
COPY . /build-context
RUN set -e; \
    if [ -f /build-context/requirements.txt ]; then \
        cp -a /build-context/. /srv/; \
    elif [ -f /build-context/backend/requirements.txt ]; then \
        cp -a /build-context/backend/. /srv/; \
    else \
        echo "Unable to locate backend/requirements.txt" >&2; exit 1; \
    fi
RUN pip install --no-cache-dir -r /srv/requirements.txt
RUN mkdir -p /srv/evidence /srv/uploads
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD python -c "import os,urllib.request; port=os.getenv('PORT','8000'); urllib.request.urlopen(f'http://127.0.0.1:{port}/api/health')"
CMD ["python", "-c", "import os, uvicorn; uvicorn.run('app.main:app', host='0.0.0.0', port=int(os.getenv('PORT', '8000')), log_level='info')"]
