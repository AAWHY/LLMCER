import threading
import os

_callback = None
_log_dir = None
_local = threading.local()

# Fields that contain long text, print with special formatting
_LONG_FIELDS = {"prompt", "raw_response"}
# Max characters to show for long fields (0 = unlimited)
_TRUNCATE = 0


def set_callback(fn):
    """Set callback function: fn(type, stage, message, data)"""
    global _callback
    _callback = fn


def reset_callback():
    global _callback
    _callback = None


def init_log_dir(path):
    """Create a per-run log directory. Each context writes to its own file inside."""
    global _log_dir
    _log_dir = path
    os.makedirs(path, exist_ok=True)


def set_context(name):
    """Set current thread's log context (e.g. 'block_000', 'cmr_merge', 'blocking').
    Determines which file emit() writes to."""
    _local.context = name


def get_context():
    """Get current thread's log context."""
    return getattr(_local, "context", None)


def _format_data(data, indent=2):
    """Format the data dict into lines for file output."""
    if not data:
        return []
    lines = []
    prefix = " " * indent
    for key, value in data.items():
        if key in _LONG_FIELDS:
            text = str(value)
            if _TRUNCATE and len(text) > _TRUNCATE:
                text = text[:_TRUNCATE] + f"... ({len(text)} chars total)"
            lines.append(f"{prefix}{key}:")
            for line in text.splitlines():
                lines.append(f"{prefix}  {line}")
        elif isinstance(value, list) and len(str(value)) > 120:
            lines.append(f"{prefix}{key}: ({len(value)} items)")
            for i, item in enumerate(value):
                lines.append(f"{prefix}  [{i}] {item}")
        else:
            lines.append(f"{prefix}{key}: {value}")
    return lines


def emit(event_type, stage, message, data=None):
    """Emit an event.
    - Callback mode (backend): forward to callback, no file/print.
    - Standalone mode: write full detail to per-context log file, print brief line to console.
    """
    if _callback:
        _callback(type=event_type, stage=stage, message=message, data=data)
        return

    # Console: brief one-liner (may interleave in parallel, that's OK)
    print(f"[{stage}] [{event_type}] {message}")

    # File: full detail, each context (block/stage) has its own file
    if _log_dir:
        ctx = getattr(_local, "context", "main")
        lines = [f"[{stage}] [{event_type}] {message}"]
        lines.extend(_format_data(data))
        block = "\n".join(lines) + "\n\n"
        filepath = os.path.join(_log_dir, f"{ctx}.log")
        with open(filepath, "a", encoding="utf-8") as f:
            f.write(block)
