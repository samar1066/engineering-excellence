/** Base for every error this application raises on purpose. */
export class ApplicationError extends Error {}

/** A resource the caller named does not exist. The app error handler maps this to 404. */
export class NotFoundError extends ApplicationError {
  readonly resource: string;
  readonly key: string;

  constructor(resource: string, key: string) {
    super(`${resource} ${key} not found`);
    this.name = "NotFoundError";
    this.resource = resource;
    this.key = key;
  }
}

/** A domain invariant rejected the input. The app error handler maps this to 422. */
export class DomainValidationError extends ApplicationError {
  constructor(message: string) {
    super(message);
    this.name = "DomainValidationError";
  }
}
