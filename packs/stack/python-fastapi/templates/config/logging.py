"""Structured logging setup. Import and call configure_logging() once at startup."""
import logging
import uuid
from contextvars import ContextVar

import structlog

correlation_id: ContextVar[str] = ContextVar("correlation_id", default="")


def new_correlation_id() -> str:
    cid = uuid.uuid4().hex
    correlation_id.set(cid)
    return cid


def _add_correlation(_, __, event_dict: dict) -> dict:
    cid = correlation_id.get()
    if cid:
        event_dict["correlation_id"] = cid
    return event_dict


def configure_logging(level: int = logging.INFO) -> None:
    structlog.configure(
        processors=[
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.add_log_level,
            _add_correlation,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(level),
    )
