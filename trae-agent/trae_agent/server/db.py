from sqlalchemy import create_engine, Column, Integer, String, Text, DateTime, Boolean, text, JSON
from sqlalchemy.orm import declarative_base, sessionmaker
from datetime import datetime
import os

pg_url = os.environ.get("POSTGRES_URL") or os.environ.get("DATABASE_URL")
if not pg_url:
    host = os.environ.get("POSTGRES_HOST")
    port = os.environ.get("POSTGRES_PORT")
    db = os.environ.get("POSTGRES_DB")
    user = os.environ.get("POSTGRES_USER")
    pwd = os.environ.get("POSTGRES_PASSWORD")
    if host and port and db and user and pwd:
        pg_url = f"postgresql+psycopg://{user}:{pwd}@{host}:{port}/{db}"
if not pg_url:
    raise RuntimeError(
        "PostgreSQL configuration missing. Set POSTGRES_URL/DATABASE_URL or POSTGRES_* variables."
    )
DATABASE_URL = pg_url

engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

class Prompt(Base):
    __tablename__ = "prompts"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(128), unique=True, index=True, nullable=False)
    content = Column(Text, nullable=False)
    enable_review = Column(Boolean, default=False)
    review_rules = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class Settings(Base):
    __tablename__ = "settings"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(128), unique=True, index=True, nullable=False)
    value = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class ModelConfigStore(Base):
    __tablename__ = "model_configs"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(128), unique=True, index=True, nullable=False)
    provider = Column(String(64), nullable=False)
    model = Column(String(128), nullable=False)
    base_url = Column(String(256), nullable=False)
    api_key = Column(String(256), nullable=False)
    temperature = Column(String(32), nullable=True)
    top_p = Column(String(32), nullable=True)
    top_k = Column(String(32), nullable=True)
    max_tokens = Column(String(32), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class Tool(Base):
    __tablename__ = "tools"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(128), unique=True, index=True, nullable=False)
    custom_name = Column(String(128), nullable=True)
    description = Column(Text, nullable=True)
    initial_name_zh = Column(String(128), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class CustomTool(Base):
    __tablename__ = "custom_tools"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(128), unique=True, index=True, nullable=False)
    description = Column(Text, nullable=False)
    api_url = Column(String(512), nullable=False)
    api_key = Column(String(256), nullable=False)
    request_method = Column(String(10), default="POST")
    request_body_template = Column(Text, nullable=False)
    parameter_schema = Column(Text, nullable=True)
    curl_example = Column(Text, nullable=True)
    app_id = Column(String(128), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class KnowledgeBase(Base):
    __tablename__ = "knowledge_bases"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(128), unique=True, index=True, nullable=False)
    description = Column(Text, nullable=True)
    dataset_id = Column(String(128), nullable=False)
    api_key = Column(String(256), nullable=False)
    api_url = Column(String(512), nullable=False)
    retrieval_model = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class ChatSession(Base):
    __tablename__ = "chat_sessions"
    id = Column(String(36), primary_key=True, index=True)
    title = Column(String(256), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class ChatMessage(Base):
    __tablename__ = "chat_messages"
    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(String(36), index=True, nullable=False)
    role = Column(String(32), nullable=False)
    content = Column(Text, nullable=True)
    meta = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

def init_db():
    try:
        Base.metadata.create_all(bind=engine)
    except Exception:
        return
    try:
        if engine.dialect.name == "postgresql":
            with engine.begin() as conn:
                cols = set()
                res = conn.execute(
                    text(
                        "SELECT column_name FROM information_schema.columns WHERE table_name='prompts' AND table_schema='public'"
                    )
                )
                for row in res:
                    cols.add(str(row[0]))
                if "enable_review" not in cols:
                    conn.execute(
                        text(
                            "ALTER TABLE public.prompts ADD COLUMN IF NOT EXISTS enable_review boolean NOT NULL DEFAULT false"
                        )
                    )
                if "review_rules" not in cols:
                    conn.execute(
                        text(
                            "ALTER TABLE public.prompts ADD COLUMN IF NOT EXISTS review_rules text"
                        )
                    )
                conn.execute(
                    text(
                        "CREATE TABLE IF NOT EXISTS public.settings (\n"
                        "  id SERIAL PRIMARY KEY,\n"
                        "  name VARCHAR(128) UNIQUE NOT NULL,\n"
                        "  value TEXT NOT NULL,\n"
                        "  created_at TIMESTAMP DEFAULT NOW(),\n"
                        "  updated_at TIMESTAMP DEFAULT NOW()\n"
                        ")"
                    )
                )
                conn.execute(
                    text(
                        "CREATE TABLE IF NOT EXISTS public.custom_tools (\n"
                        "  id SERIAL PRIMARY KEY,\n"
                        "  name VARCHAR(128) UNIQUE NOT NULL,\n"
                        "  description TEXT NOT NULL,\n"
                        "  api_url VARCHAR(512) NOT NULL,\n"
                        "  api_key VARCHAR(256) NOT NULL,\n"
                        "  request_method VARCHAR(10) DEFAULT 'POST',\n"
                        "  request_body_template TEXT NOT NULL,\n"
                        "  parameter_schema TEXT,\n"
                        "  curl_example TEXT,\n"
                        "  created_at TIMESTAMP DEFAULT NOW(),\n"
                        "  updated_at TIMESTAMP DEFAULT NOW()\n"
                        ")"
                    )
                )
                conn.execute(
                    text(
                        "CREATE TABLE IF NOT EXISTS public.knowledge_bases (\n"
                        "  id SERIAL PRIMARY KEY,\n"
                        "  name VARCHAR(128) UNIQUE NOT NULL,\n"
                        "  description TEXT,\n"
                        "  dataset_id VARCHAR(128) NOT NULL,\n"
                        "  api_key VARCHAR(256) NOT NULL,\n"
                        "  api_url VARCHAR(512) NOT NULL,\n"
                        "  created_at TIMESTAMP DEFAULT NOW(),\n"
                        "  updated_at TIMESTAMP DEFAULT NOW()\n"
                        ")"
                    )
                )
                conn.execute(
                    text(
                        "CREATE TABLE IF NOT EXISTS public.chat_sessions (\n"
                        "  id VARCHAR(36) PRIMARY KEY,\n"
                        "  title VARCHAR(256),\n"
                        "  created_at TIMESTAMP DEFAULT NOW(),\n"
                        "  updated_at TIMESTAMP DEFAULT NOW()\n"
                        ")"
                    )
                )
                conn.execute(
                    text(
                        "CREATE TABLE IF NOT EXISTS public.chat_messages (\n"
                        "  id SERIAL PRIMARY KEY,\n"
                        "  session_id VARCHAR(36) NOT NULL,\n"
                        "  role VARCHAR(32) NOT NULL,\n"
                        "  content TEXT,\n"
                        "  meta JSON,\n"
                        "  created_at TIMESTAMP DEFAULT NOW()\n"
                        ")"
                    )
                )
                
                # Check and add curl_example column to custom_tools if missing
                res_ct = conn.execute(
                    text(
                        "SELECT column_name FROM information_schema.columns WHERE table_name='custom_tools' AND table_schema='public'"
                    )
                )
                ct_cols = set()
                for row in res_ct:
                    ct_cols.add(str(row[0]))
                
                if "curl_example" not in ct_cols:
                     conn.execute(
                        text(
                            "ALTER TABLE public.custom_tools ADD COLUMN IF NOT EXISTS curl_example text"
                        )
                    )
                
                if "app_id" not in ct_cols:
                     conn.execute(
                        text(
                            "ALTER TABLE public.custom_tools ADD COLUMN IF NOT EXISTS app_id varchar(128)"
                        )
                    )
    except Exception:
        pass
