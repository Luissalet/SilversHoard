// Thin fetch wrapper: JSON in/out. `{ error, code, hint }` bodies become exceptions that keep those fields.
async function request(method, path, { params, body, form } = {}) {
  const url = new URL(path, window.location.origin);
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
  }
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: form || (body !== undefined ? JSON.stringify(body) : undefined),
    });
  } catch (cause) {
    const error = new Error(cause && cause.message ? cause.message : "Network error");
    error.code = "network";
    throw error;
  }
  return parse(response.status, response.ok, await response.text());
}

function parse(status, ok, text) {
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text.slice(0, 300) };
  }
  if (!ok) {
    const detail = data && (data.error || data.detail);
    const error = new Error((typeof detail === "string" && detail) || `Error ${status}`);
    error.code = (data && data.code) || (status === 0 ? "network" : "");
    error.hint = (data && data.hint) || "";
    error.data = data;
    error.status = status;
    throw error;
  }
  return data;
}

// Every write and most reads go through the same tool handlers the assistant uses.
const call = (name, args) => request("POST", "/api/ui/call", { body: { name, arguments: args || {} } });

function upload(path, fields) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== null) form.append(k, v);
  return request("POST", path, { form });
}

export const api = {
  health: () => request("GET", "/api/health"),
  overview: () => request("GET", "/api/overview"),
  call,
  uploadAvatar: (file, { trainerId = "", mode = "pixel", removeBackground = true } = {}) =>
    upload("/api/avatars/upload", { file, trainer_id: trainerId, mode, remove_background: removeBackground ? "true" : "false" }),
  uploadImport: (file, { name = "", format = "" } = {}) => upload("/api/import/upload", { file, name, format }),
  exportUrl: (file) => `/api/exports/${encodeURIComponent(file)}`,
};
