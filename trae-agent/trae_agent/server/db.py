from sqlalchemy import create_engine, Column, Integer, String, Text, DateTime, Boolean, text
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
    except Exception:
        pass
