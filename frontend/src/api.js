const BASE = (import.meta.env.VITE_API_URL || '') + '/api'

export const fetchPrices = () => fetch(`${BASE}/prices`).then(r => r.json())
export const fetchSignals = () => fetch(`${BASE}/signals`).then(r => r.json())
export const fetchPortfolio = () => fetch(`${BASE}/portfolio`).then(r => r.json())
export const fetchAlerts = () => fetch(`${BASE}/alerts`).then(r => r.json())
export const fetchWatchlist = () => fetch(`${BASE}/watchlist`).then(r => r.json())
export const fetchSignal = (ticker) => fetch(`${BASE}/signal/${ticker}`).then(r => r.json())

export const addPosition = (pos) =>
  fetch(`${BASE}/portfolio`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pos) }).then(r => r.json())

export const deletePosition = (id) =>
  fetch(`${BASE}/portfolio/${id}`, { method: 'DELETE' }).then(r => r.json())

export const createAlert = (alert) =>
  fetch(`${BASE}/alerts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(alert) }).then(r => r.json())

export const deleteAlert = (id) =>
  fetch(`${BASE}/alerts/${id}`, { method: 'DELETE' }).then(r => r.json())
