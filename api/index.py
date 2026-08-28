"""Vercel Serverless Function entrypoint for CAPACITY CONNECT FastAPI backend.

This exposes the ASGI `app` instance for the @vercel/python runtime.
"""

from __future__ import annotations

import os
import sys

# Ensure root directory is in sys.path
root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if root_dir not in sys.path:
    sys.path.insert(0, root_dir)

from app.main import app  # noqa: E402

__all__ = ["app"]
