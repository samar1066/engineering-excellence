class ApplicationError(Exception):
    """Base for all application errors."""


class NotFoundError(ApplicationError):
    def __init__(self, resource: str, key: str) -> None:
        super().__init__(f"{resource} {key} not found")
        self.resource = resource
        self.key = key
