export async function apiCall(method, payload = {}) {
  const res = await fetch(`/ver_estoque/api/call/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, payload }),
  });
  if (!res.ok) {
    throw new Error(`API error: ${res.statusText}`);
  }
  const data = await res.json();
  if (data && data.erro) {
    throw new Error(data.erro);
  }
  return data;
}
