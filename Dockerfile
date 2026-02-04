FROM mirror.gcr.io/library/node:18-slim AS web
WORKDIR /web
# 复制 ai-ide 项目文件
COPY ai-ide/package.json ai-ide/package-lock.json* ./
RUN npm install
COPY ai-ide/ .
RUN npm run build

FROM python:3.12-slim AS backend
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# 安装系统依赖
RUN apt-get update && apt-get install -y curl git && rm -rf /var/lib/apt/lists/*

# 安装 uv
RUN curl -Ls https://astral.sh/uv/install.sh | sh
ENV PATH="/root/.local/bin:$PATH"

WORKDIR /app

# 复制 trae-agent 项目依赖文件
COPY trae-agent/pyproject.toml /app/pyproject.toml
COPY trae-agent/uv.lock /app/uv.lock

# 同步依赖，确保 uvicorn 被安装
# 使用 --system 安装到系统环境，或者确保 venv 路径正确
# 使用 uv venv 创建虚拟环境，并安装依赖
RUN uv venv .venv
ENV VIRTUAL_ENV=/app/.venv
ENV PATH="/app/.venv/bin:$PATH"
RUN uv sync --no-dev --frozen

# 复制 trae-agent 代码
COPY trae-agent/trae_agent /app/trae_agent
COPY trae-agent/openapi /app/openapi

# 从 web 阶段复制前端构建产物
COPY --from=web /web/dist /app/static

EXPOSE 8090

# 激活虚拟环境并运行 uvicorn
# 验证 uvicorn 是否安装成功
RUN uv run uvicorn --version

CMD ["uv", "run", "uvicorn", "trae_agent.server.main:app", "--host", "0.0.0.0", "--port", "8090"]
