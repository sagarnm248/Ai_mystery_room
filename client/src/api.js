const BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api/v1';
export async function api(path, options = {}) {
  const response = await fetch(`${BASE}${path}`, { credentials: 'include', ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || 'Something went wrong. Please try again.');
  return data;
}
export const getCases = () => api('/cases');
export const getCase = id => api(`/cases/${id}`);
export const createCase = body => api('/cases', { method: 'POST', body: JSON.stringify(body) });
export const submitAccusation = (id, suspectId) => api(`/cases/${id}/accusations`, { method: 'POST', body: JSON.stringify({ suspectId }) });
export const getReveal = id => api(`/cases/${id}/reveal`);
export const retryCase = id => api(`/cases/${id}/retry`, { method: 'POST' });
export const discoverClue = (id, clueId) => api(`/cases/${id}/clues/${clueId}/discover`, { method: 'POST' });
export const requestHint = id => api(`/cases/${id}/hints`, { method: 'POST' });
