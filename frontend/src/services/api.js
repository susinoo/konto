// Empty base: the app is served from the same origin as the API.
const API_BASE = "";

/**
 * Central wrapper for every backend call. Authentication is a session cookie,
 * so requests always use `credentials: "include"` and never an Authorization
 * header.
 *
 * Throws Error("NOT_AUTHORIZED") on 401: the caller (ultimately App) handles
 * the logout. In-session validation errors are 400, never 401.
 */
export const apiFetch = async (endpoint, options = {}) => {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    credentials: "include",
  });

  if (response.status === 401) {
    throw new Error("NOT_AUTHORIZED");
  }

  return response;
};

// Reads a JSON body, or {} when there is none (e.g. 204 No Content).
export const readJson = async (response) => {
  if (response.status === 204) return {};
  return response.json().catch(() => ({}));
};
