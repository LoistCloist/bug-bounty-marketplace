/** Thrown by mock DB operations; handlers catch this and map it to an HTTP
 * JSON error response with the given status. */
export class MockApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "MockApiError";
  }
}
