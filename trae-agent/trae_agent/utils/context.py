from contextvars import ContextVar

config_file_var: ContextVar[str | None] = ContextVar("config_file", default=None)
trajectory_file_var: ContextVar[str | None] = ContextVar("trajectory_file", default=None)
