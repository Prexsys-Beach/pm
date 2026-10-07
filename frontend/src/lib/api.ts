// Returns the backend's error detail, or the fallback when the body is not
// JSON (proxy/HTML error pages) or the detail is not a plain message.
export const readErrorMessage = async (response: Response, fallback: string): Promise<string> => {
  try {
    const payload = (await response.json()) as { detail?: unknown };
    return typeof payload.detail === "string" && payload.detail ? payload.detail : fallback;
  } catch {
    return fallback;
  }
};
