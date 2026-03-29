from __future__ import annotations

import asyncio
import json
import queue
from typing import Any, AsyncGenerator, Optional


class EventBus:
    """Thread-safe event bus that bridges sync pipeline threads to async SSE."""

    def __init__(self) -> None:
        self._queue: queue.Queue[Optional[dict[str, Any]]] = queue.Queue()
        self._closed = False
        self._listeners: list = []

    def add_listener(self, callback) -> None:
        """Add a sync callback that receives every event dict."""
        self._listeners.append(callback)

    def put(
        self,
        *,
        type: str = "log",
        stage: Optional[str] = None,
        message: str = "",
        data: Optional[dict[str, Any]] = None,
    ) -> None:
        """Push an event from a sync context (pipeline thread)."""
        if self._closed:
            return
        event = {"type": type, "stage": stage, "message": message}
        if data:
            event["data"] = data
        self._queue.put(event)
        for listener in self._listeners:
            try:
                listener(event)
            except Exception:
                pass

    def close(self) -> None:
        """Signal end of stream."""
        self._closed = True
        self._queue.put(None)  # sentinel

    async def subscribe(self) -> AsyncGenerator[str, None]:
        """Async generator that yields SSE-formatted strings."""
        loop = asyncio.get_event_loop()
        while True:
            # Poll the sync queue from async context
            try:
                event = await loop.run_in_executor(None, self._queue.get, True, 1.0)
            except queue.Empty:
                # Send keepalive comment to prevent timeout
                yield ": keepalive\n\n"
                continue

            if event is None:
                # End of stream
                return

            yield f"data: {json.dumps(event)}\n\n"
