export function statusForError(error, fallback = 500) {
  if (Number.isInteger(error?.status) && error.status >= 400 && error.status < 600) return error.status;
  if (error?.code === "23505" || /(?:unique constraint|UNIQUE constraint|duplicate key)/i.test(error?.message || ""))
    return 409;
  if (
    /SMARTSHEET_ACCESS_TOKEN|Smartsheet is not configured|OPENAI_API_KEY is not configured/i.test(error?.message || "")
  )
    return 503;
  return fallback;
}

export function externalServiceError(message, status = 502, cause) {
  const error = new Error(message, { cause });
  error.status = status;
  return error;
}

export function errorMessage(error, fallback = "Request failed") {
  return error?.message || fallback;
}
