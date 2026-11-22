FROM python:3.12-slim
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
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health')"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
