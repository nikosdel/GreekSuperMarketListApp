export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function asyncRoute(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function sendError(res, error) {
  if (error instanceof HttpError) {
    const body =
      error.code === "invalid_grant" || error.code === "invalid_request" || error.code === "invalid_token"
        ? { error: error.code, error_description: error.message }
        : { error: error.code, message: error.message };
    if (error.status === 401) {
      res.set("WWW-Authenticate", `Bearer error="${error.code}"`);
    }
    res.status(error.status).json(body);
    return;
  }
  console.error(error);
  res.status(500).json({ error: "server_error", message: "Something went wrong." });
}
