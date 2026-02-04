from typing import Dict, Optional
from pydantic import BaseModel

class ParagraphContext(BaseModel):
    id: str
    path: str
    content: str  # Original content

class SessionContextStore:
    _instance = None
    # Structure: { session_id: { paragraph_id: ParagraphContext } }
    _store: Dict[str, Dict[str, ParagraphContext]] = {}

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(SessionContextStore, cls).__new__(cls)
        return cls._instance

    @classmethod
    def add(cls, session_id: str, pid: str, context: ParagraphContext):
        if session_id not in cls._store:
            cls._store[session_id] = {}
        cls._store[session_id][pid] = context

    @classmethod
    def get(cls, session_id: str, pid: str) -> Optional[ParagraphContext]:
        if session_id not in cls._store:
            return None
        return cls._store[session_id].get(pid)

    @classmethod
    def clear(cls, session_id: str):
        if session_id in cls._store:
            del cls._store[session_id]
