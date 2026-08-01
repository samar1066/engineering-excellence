"""Tracing setup. Import and call configure_tracing(app) once at startup."""

import os

from fastapi import FastAPI
from opentelemetry import trace
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor, ConsoleSpanExporter

# Both of pytest's own environment variables, and both are needed. PYTEST_VERSION (pytest 8.0 and
# later) is exported for the whole session, so it is already set while pytest imports the test
# modules, which is when this module is first reached: app.main builds the application at import
# time, and a tracer provider set then cannot be replaced later, because OpenTelemetry refuses to
# override a provider that is already global. PYTEST_CURRENT_TEST is set only while an individual
# test sets up, runs, or tears down, so on its own it would miss that first import entirely. They
# are read at call time rather than at import time, so the answer is the one true when tracing is
# configured.
PYTEST_ENV_VARS = ("PYTEST_VERSION", "PYTEST_CURRENT_TEST")


def _under_pytest() -> bool:
    return any(name in os.environ for name in PYTEST_ENV_VARS)


def configure_tracing(app: FastAPI, service_name: str) -> None:
    provider = TracerProvider(resource=Resource.create({"service.name": service_name}))
    # Under pytest the provider is given no span processor, so spans are recorded and then dropped.
    # The console exporter otherwise flushes at interpreter shutdown, after pytest has closed the
    # capture file it writes into, and that prints a teardown traceback over the top of the run's
    # real result. Tracing is proved by this module and its wiring, never by spans printed mid test.
    if not _under_pytest():
        provider.add_span_processor(BatchSpanProcessor(ConsoleSpanExporter()))
    trace.set_tracer_provider(provider)
    FastAPIInstrumentor.instrument_app(app)
