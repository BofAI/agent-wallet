"""Cross-platform utilities."""

from __future__ import annotations

import os
import warnings
from pathlib import Path


def safe_chmod(path: str | Path, mode: int) -> None:
    """Attempt ``os.chmod`` and warn instead of crashing on unsupported platforms."""
    try:
        os.chmod(path, mode)
    except (OSError, NotImplementedError):
        warnings.warn(
            f"Could not set file permissions on {path}. "
            "On Windows this is expected — secrets are still protected by encryption.",
            stacklevel=2,
        )
