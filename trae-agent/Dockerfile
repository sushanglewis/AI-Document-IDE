FROM node:18-slim AS web
WORKDIR /web
COPY ai-ide/ /web/
RUN npm install && npm run build

FROM python:3.12-slim AS backend
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*
RUN curl -Ls https://astral.sh/uv/install.sh | sh
ENV PATH="/root/.local/bin:$PATH"
WORKDIR /app
COPY trae-agent/pyproject.toml /app/pyproject.toml
RUN uv sync --no-dev
ENV VIRTUAL_ENV=/app/.venv
ENV PATH="/app/.venv/bin:$PATH"
COPY trae-agent/trae_agent /app/trae_agent
COPY trae-agent/openapi /app/openapi
COPY --from=web /web/dist /app/static
EXPOSE 8090
CMD ["uvicorn", "trae_agent.server.main:app", "--host", "0.0.0.0", "--port", "8090"]
