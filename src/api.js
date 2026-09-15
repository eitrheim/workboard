// Hosted builds always call their same-origin Worker. The local backend is used
// only when the page itself is running on this computer.
const runningLocally = typeof window !== "undefined" && ["localhost", "127.0.0.1"].includes(window.location.hostname);
const API_BASE = runningLocally ? (import.meta.env.VITE_API_BASE_URL || "http://localhost:8787") : "";

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, { credentials: "include", ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `Request failed: ${response.status}`);
  return response.status === 204 ? null : response.json();
}

export const backendApi = {
  health: () => request("/api/health"),
  state: () => request("/api/state"),
  createProject: (name) => request("/api/projects", { method: "POST", body: JSON.stringify({ name }) }),
  updateProjectStatus: (name, status) => request(`/api/projects/${encodeURIComponent(name)}`, { method: "PATCH", body: JSON.stringify({ status }) }),
  importConnectorData: (source, content) => request("/api/manual-import", { method: "POST", body: JSON.stringify({ source, content }) }),
  extractFile: (fileName, mimeType, text, dataUrl, projectOptions = []) => request("/api/file-extract", { method: "POST", body: JSON.stringify({ fileName, mimeType, text, dataUrl, projectOptions }) }),
  createMilestone: (values) => request("/api/milestones", { method: "POST", body: JSON.stringify(values) }),
  updateMilestone: (id, values) => request(`/api/milestones/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(values) }),
  deleteMilestone: (id) => request(`/api/milestones/${encodeURIComponent(id)}`, { method: "DELETE" }),
  sync: () => request("/api/sync", { method: "POST" }),
  mail: () => request("/api/graph/mail"),
  calendar: (start, end) => request(`/api/graph/calendar?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`),
  teams: () => request("/api/graph/teams"),
  files: () => request("/api/graph/files"),
  createTask: (task) => request("/api/tasks", { method: "POST", body: JSON.stringify(task) }),
  createRecurringTask: (task) => request("/api/recurring-tasks", { method: "POST", body: JSON.stringify(task) }),
  updateTask: (id, task) => request(`/api/tasks/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(task) }),
  completeTask: (id) => request(`/api/tasks/${encodeURIComponent(id)}/complete`, { method: "POST" }),
  undoCompleted: (id) => request(`/api/completed/${encodeURIComponent(id)}/undo`, { method: "POST" }),
  approveSourceItem: (sourceItemId, extractedIndex, values) => request(`/api/source-items/${encodeURIComponent(sourceItemId)}/approve`, { method: "POST", body: JSON.stringify({ extractedIndex, values }) }),
  dismissSourceItem: (sourceItemId, extractedIndex) => request(`/api/source-items/${encodeURIComponent(sourceItemId)}/dismiss`, { method: "POST", body: JSON.stringify({ extractedIndex }) }),
  dismissException: (id) => request(`/api/source-exceptions/${encodeURIComponent(id)}/dismiss`, { method: "POST" }),
  signIn: () => { window.location.assign(`${API_BASE}/auth/signin`); },
  signOut: () => request("/auth/signout", { method: "POST" }),
};
