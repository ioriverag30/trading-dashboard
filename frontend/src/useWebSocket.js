import { useEffect, useRef, useCallback } from 'react'

export function useWebSocket(onMessage) {
  const ws = useRef(null)
  const reconnectTimer = useRef(null)

  const connect = useCallback(() => {
    const apiBase = import.meta.env.VITE_API_URL || ''
    const wsBase = apiBase
      ? apiBase.replace(/^http/, 'ws')
      : `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`
    const url = `${wsBase}/ws`
    ws.current = new WebSocket(url)

    ws.current.onmessage = (e) => {
      try { onMessage(JSON.parse(e.data)) } catch {}
    }

    ws.current.onclose = () => {
      reconnectTimer.current = setTimeout(connect, 5000)
    }

    ws.current.onerror = () => {
      ws.current?.close()
    }
  }, [onMessage])

  useEffect(() => {
    connect()
    return () => {
      clearTimeout(reconnectTimer.current)
      ws.current?.close()
    }
  }, [connect])
}
