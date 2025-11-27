# Copyright (c) 2025 ByteDance Ltd. and/or its affiliates
# SPDX-License-Identifier: MIT

import os
import random
import time
import traceback
from functools import wraps
from typing import Any, Callable, TypeVar

T = TypeVar("T")


def retry_with(
    func: Callable[..., T],
    provider_name: str = "OpenAI",
    max_retries: int = 3,
) -> Callable[..., T]:
    """
    Decorator that adds retry logic with randomized backoff.

    Args:
        func: The function to decorate
        provider_name: The name of the model provider being called
        max_retries: Maximum number of retry attempts

    Returns:
        Decorated function with retry logic
    """

    @wraps(func)
    def wrapper(*args: Any, **kwargs: Any) -> T:
        last_exception = None

        env_max = os.environ.get("LLM_RETRY_MAX")
        try:
            max_retry_eff = int(env_max) if env_max is not None else max_retries
        except Exception:
            max_retry_eff = max_retries

        for attempt in range(max_retry_eff + 1):
            try:
                return func(*args, **kwargs)
            except Exception as e:
                last_exception = e

                if attempt == max_retry_eff:
                    # Last attempt, re-raise the exception
                    raise

                msg = str(e)
                is_connect_refused = (
                    "ConnectError" in type(e).__name__
                    or "Connection refused" in msg
                    or "connect" in msg.lower()
                )
                base_min = int(os.environ.get("LLM_RETRY_SLEEP_MIN", "1"))
                base_max = int(os.environ.get("LLM_RETRY_SLEEP_MAX", "3"))
                conn_max = int(os.environ.get("LLM_RETRY_CONNECT_SLEEP_MAX", str(base_max)))
                low = max(0, base_min)
                high = max(low, (conn_max if is_connect_refused else base_max))
                sleep_time = random.randint(low, high)
                this_error_message = str(e)
                print(
                    f"{provider_name} API call failed: {this_error_message}. Will sleep for {sleep_time} seconds and will retry.\n{traceback.format_exc()}"
                )
                time.sleep(sleep_time)

        # This should never be reached, but just in case
        raise last_exception or Exception("Retry failed for unknown reason")

    return wrapper
