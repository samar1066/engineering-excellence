import logging
from collections.abc import Awaitable, Callable

from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse

from app.api.routes.health import router as health_router
from app.api.routes.notes import router as notes_router
from app.core.config import settings
from app.core.exceptions import DomainValidationError, NotFoundError
from app.core.logging import configure_logging, new_correlation_id
from app.core.otel import configure_tracing


def create_app() -> FastAPI:
    configure_logging(getattr(logging, settings.log_level))
    app = FastAPI(title=settings.service_name)
    configure_tracing(app, settings.service_name)

    @app.middleware("http")
    async def correlation(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        cid = new_correlation_id()
        response: Response = await call_next(request)
        response.headers["x-correlation-id"] = cid
        return response

    @app.exception_handler(NotFoundError)
    async def not_found(_: Request, exc: NotFoundError) -> JSONResponse:
        return JSONResponse(status_code=404, content={"detail": str(exc)})

    @app.exception_handler(DomainValidationError)
    async def domain_validation_error(_: Request, exc: DomainValidationError) -> JSONResponse:
        return JSONResponse(status_code=422, content={"detail": str(exc)})

    app.include_router(health_router)
    app.include_router(notes_router)
    return app


app = create_app()
