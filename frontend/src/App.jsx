import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine
} from 'recharts'
import {
  TrendingUp, TrendingDown, Bell, BellOff, Plus, Trash2,
  RefreshCw, AlertTriangle, BarChart2, Briefcase, List,
  X, Shield, Target, Activity, Clock, Zap, Grid
} from 'lucide-react'
import {
  fetchSignals, fetchPortfolio, fetchAlerts,
  addPosition, deletePosition, createAlert, deleteAlert
} from './api.js'

const API_BASE = (import.meta.env.VITE_API_URL || '') + '/api'
import { useWebSocket } from './useWebSocket.js'

// ─── Constants ───────────────────────────────────────────────────────────────
const WATCHLIST = {
  'Índices':         ['SPX', 'NDQ', 'DJI', 'VIX', 'DXY'],
  'Top 20 Acciones': ['NVDA','AAPL','MSFT','GOOGL','AMZN','META','TSLA','AMD',
                      'JPM','V','MA','LLY','COST','UNH','XOM','NFLX','PLTR','COIN','ASML','BRKB'],
  'Cripto':          ['BTCUSD', 'ETHUSD'],
  'Materias Primas': ['USOIL', 'XAUUSD'],
  'ETFs':            ['SPY', 'QQQ', 'IWM'],
}
const TICKER_NAMES = {
  NVDA:'NVIDIA',   AAPL:'Apple',     MSFT:'Microsoft', GOOGL:'Alphabet',
  AMZN:'Amazon',   META:'Meta',      TSLA:'Tesla',      AMD:'AMD',
  JPM:'JPMorgan',  V:'Visa',         MA:'Mastercard',   LLY:'Eli Lilly',
  COST:'Costco',   UNH:'UnitedHlth', XOM:'ExxonMobil',  NFLX:'Netflix',
  PLTR:'Palantir', COIN:'Coinbase',  ASML:'ASML',       BRKB:'Berkshire',
  SPX:'S&P 500',   NDQ:'Nasdaq 100', DJI:'Dow Jones',   VIX:'Volatilidad',
  DXY:'Dólar USD', BTCUSD:'Bitcoin', ETHUSD:'Ethereum', USOIL:'Petróleo',
  XAUUSD:'Oro',    SPY:'SPY ETF',    QQQ:'QQQ ETF',     IWM:'IWM ETF',
}
const ALL_TICKERS = Object.values(WATCHLIST).flat()

const SIGNAL_CFG = {
  BUY:  { label:'🟢 COMPRAR',  bg:'#052e16', border:'#16a34a', text:'#4ade80', glow:'#16a34a33' },
  SELL: { label:'🔴 VENDER',   bg:'#450a0a', border:'#dc2626', text:'#f87171', glow:'#dc262633' },
  HOLD: { label:'🟡 MANTENER', bg:'#1c1a03', border:'#ca8a04', text:'#facc15', glow:'#ca8a0433' },
}

const fmt  = (n, d=2) => n==null||n!==n ? '–' : n>=1000
  ? n.toLocaleString('es-MX',{minimumFractionDigits:2,maximumFractionDigits:2})
  : Number(n).toFixed(d)
const fmtU = n => n ? `$${fmt(n)}` : '–'
const pctC = v => v >= 0 ? '#4ade80' : '#f87171'

// ─── Reusable UI pieces ───────────────────────────────────────────────────────

function SignalBadge({ signal, size='sm' }) {
  const c = SIGNAL_CFG[signal] || SIGNAL_CFG.HOLD
  return (
    <span style={{
      background:c.bg, border:`1px solid ${c.border}`, color:c.text,
      padding: size==='lg' ? '5px 12px' : '2px 7px',
      borderRadius:5, fontSize: size==='lg' ? 13 : 11,
      fontWeight:700, whiteSpace:'nowrap', boxShadow:`0 0 8px ${c.glow}`
    }}>{c.label}</span>
  )
}

// Barra de confianza 0–100%
function ConfidenceBar({ buyCount, sellCount, signal }) {
  const pct   = Math.round((buyCount / 5) * 100)
  const color = signal==='BUY' ? '#16a34a' : signal==='SELL' ? '#dc2626' : '#ca8a04'
  const label = signal==='BUY' ? `${pct}% confianza compra` : signal==='SELL'
    ? `${Math.round((sellCount/5)*100)}% señal venta` : `${pct}% hacia compra`
  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
        <span style={{ fontSize:10, color:'#64748b', fontWeight:700, textTransform:'uppercase', letterSpacing:.5 }}>
          Confianza
        </span>
        <span style={{ fontSize:11, color, fontWeight:700 }}>{label}</span>
      </div>
      <div style={{ background:'#1e293b', borderRadius:20, height:8, overflow:'hidden' }}>
        <div style={{
          width:`${pct}%`, height:'100%', borderRadius:20,
          background:`linear-gradient(90deg, ${color}88, ${color})`,
          transition:'width .6s ease', boxShadow:`0 0 6px ${color}88`
        }}/>
      </div>
      <div style={{ display:'flex', justifyContent:'space-between', marginTop:3 }}>
        {[1,2,3,4,5].map(n => (
          <div key={n} style={{
            width:14, height:14, borderRadius:'50%', fontSize:8, fontWeight:700,
            display:'flex', alignItems:'center', justifyContent:'center',
            background: buyCount>=n ? color : '#1e293b',
            border:`1px solid ${buyCount>=n ? color : '#334155'}`,
            color: buyCount>=n ? '#fff' : '#475569'
          }}>{n}</div>
        ))}
      </div>
    </div>
  )
}

function MiniSparkline({ data }) {
  const valid = (data || []).filter(d => d.v > 0)
  if (valid.length < 2) return <div style={{ height:32 }}/>
  const color = valid.at(-1)?.v >= valid[0]?.v ? '#4ade80' : '#f87171'
  return (
    <ResponsiveContainer width="100%" height={32}>
      <AreaChart data={valid} margin={{ top:2, right:0, left:0, bottom:2 }}>
        <defs>
          <linearGradient id={`sg${color.replace('#','')}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor={color} stopOpacity={.35}/>
            <stop offset="95%" stopColor={color} stopOpacity={0}/>
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.5}
          fill={`url(#sg${color.replace('#','')})`} dot={false}/>
      </AreaChart>
    </ResponsiveContainer>
  )
}

function Card({ children, style }) {
  return (
    <div style={{ background:'#0f172a', border:'1px solid #1e293b', borderRadius:8, padding:12, ...style }}>
      {children}
    </div>
  )
}
function StatBox({ label, value, color='#f1f5f9', sub }) {
  return (
    <div style={{ background:'#1e293b', borderRadius:6, padding:'8px 12px', flex:1 }}>
      <div style={{ fontSize:10, color:'#64748b', marginBottom:2 }}>{label}</div>
      <div style={{ fontSize:14, fontWeight:700, color }}>{value}</div>
      {sub && <div style={{ fontSize:10, color:'#475569', marginTop:1 }}>{sub}</div>}
    </div>
  )
}
function SectionTitle({ children }) {
  return (
    <div style={{ fontSize:10, color:'#475569', fontWeight:700, letterSpacing:1,
      textTransform:'uppercase', marginBottom:6 }}>{children}</div>
  )
}
function Modal({ title, onClose, children }) {
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.75)', zIndex:200,
      display:'flex', alignItems:'center', justifyContent:'center' }} onClick={onClose}>
      <div style={{ background:'#0f172a', border:'1px solid #334155', borderRadius:10,
        padding:24, minWidth:340, maxWidth:480, width:'90%' }} onClick={e=>e.stopPropagation()}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
          <h3 style={{ color:'#f1f5f9', fontWeight:700, margin:0 }}>{title}</h3>
          <button onClick={onClose} style={{ background:'none', border:'none', color:'#94a3b8', cursor:'pointer' }}>
            <X size={18}/>
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
function FInput({ label, ...p }) {
  return (
    <div style={{ marginBottom:12 }}>
      <label style={{ display:'block', fontSize:12, color:'#94a3b8', marginBottom:4 }}>{label}</label>
      <input {...p} style={{ width:'100%', background:'#1e293b', border:'1px solid #334155',
        borderRadius:6, padding:'8px 10px', color:'#f1f5f9', fontSize:14, outline:'none',
        boxSizing:'border-box' }}/>
    </div>
  )
}
function FSelect({ label, children, ...p }) {
  return (
    <div style={{ marginBottom:12 }}>
      <label style={{ display:'block', fontSize:12, color:'#94a3b8', marginBottom:4 }}>{label}</label>
      <select {...p} style={{ width:'100%', background:'#1e293b', border:'1px solid #334155',
        borderRadius:6, padding:'8px 10px', color:'#f1f5f9', fontSize:14, outline:'none' }}>
        {children}
      </select>
    </div>
  )
}
function PBtn({ children, color='#1d4ed8', ...p }) {
  return (
    <button {...p} style={{ width:'100%', background:color, border:'none', borderRadius:6,
      padding:'10px 0', color:'#fff', fontWeight:700, fontSize:14, cursor:'pointer' }}>
      {children}
    </button>
  )
}

// Toasts
function Toasts({ toasts, onDismiss }) {
  return (
    <div style={{ position:'fixed', bottom:24, right:24, zIndex:300,
      display:'flex', flexDirection:'column-reverse', gap:10, maxWidth:360 }}>
      {toasts.map(t => {
        const cfg = SIGNAL_CFG[t.signal] || SIGNAL_CFG.HOLD
        return (
          <div key={t.id} style={{
            background:'#0f172a', border:`2px solid ${cfg.border}`,
            borderRadius:10, padding:'12px 14px', boxShadow:`0 4px 20px ${cfg.glow}`,
            animation:'slideIn .3s ease'
          }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
              <span style={{ fontWeight:800, fontSize:14, color:cfg.text }}>
                🔔 {t.ticker} — {cfg.label}
              </span>
              <button onClick={()=>onDismiss(t.id)}
                style={{ background:'none', border:'none', color:'#64748b', cursor:'pointer' }}>
                <X size={14}/>
              </button>
            </div>
            {t.reasons?.length > 0 && (
              <ul style={{ margin:0, padding:'0 0 0 14px', fontSize:11, color:'#94a3b8' }}>
                {t.reasons.map((r,i)=><li key={i}>{r}</li>)}
              </ul>
            )}
            <div style={{ display:'flex', gap:8, marginTop:8 }}>
              {t.stop_loss > 0 && (
                <span style={{ fontSize:11, background:'#450a0a', color:'#f87171', padding:'2px 6px', borderRadius:4 }}>
                  Stop: {fmtU(t.stop_loss)}
                </span>
              )}
              {t.take_profit > 0 && (
                <span style={{ fontSize:11, background:'#052e16', color:'#4ade80', padding:'2px 6px', borderRadius:4 }}>
                  Objetivo: {fmtU(t.take_profit)}
                </span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// Alerta de mercado (SPX / VIX)
function MarketAlert({ signals, prices }) {
  const spxChg = prices['SPX']?.change_pct ?? 0
  const vix    = prices['VIX']?.price ?? 0
  const alerts = []
  if (spxChg <= -2)  alerts.push({ color:'#f87171', icon:'⚠️', msg:`S&P 500 cae ${fmt(spxChg)}% hoy — Precaución al comprar` })
  if (vix >= 25)     alerts.push({ color:'#fbbf24', icon:'🔥', msg:`VIX en ${fmt(vix,1)} — Alta volatilidad del mercado` })
  if (spxChg >= 1.5) alerts.push({ color:'#4ade80', icon:'🚀', msg:`S&P 500 sube ${fmt(spxChg)}% hoy — Mercado alcista` })
  if (!alerts.length) return null
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:4, marginBottom:6 }}>
      {alerts.map((a,i) => (
        <div key={i} style={{ background:'#0f172a', border:`1px solid ${a.color}55`,
          borderRadius:6, padding:'6px 12px', display:'flex', alignItems:'center', gap:8 }}>
          <span>{a.icon}</span>
          <span style={{ fontSize:12, color:a.color, fontWeight:600 }}>{a.msg}</span>
        </div>
      ))}
    </div>
  )
}

// Heatmap de señales
function SignalHeatmap({ signals, prices, onSelect }) {
  const stocks = WATCHLIST['Top 20 Acciones']
  return (
    <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:4 }}>
      {stocks.map(ticker => {
        const sig = signals[ticker]
        const cfg = SIGNAL_CFG[sig?.signal] || SIGNAL_CFG.HOLD
        const pct = prices[ticker]?.change_pct ?? 0
        return (
          <div key={ticker} onClick={() => onSelect(ticker)}
            style={{ background:cfg.bg, border:`1px solid ${cfg.border}44`,
              borderRadius:6, padding:'6px 4px', textAlign:'center',
              cursor:'pointer', transition:'transform .1s',
            }}
            onMouseEnter={e=>e.currentTarget.style.transform='scale(1.05)'}
            onMouseLeave={e=>e.currentTarget.style.transform='scale(1)'}
          >
            <div style={{ fontSize:10, fontWeight:800, color:cfg.text }}>{ticker}</div>
            <div style={{ fontSize:9, color:pctC(pct), marginTop:1 }}>
              {pct>=0?'+':''}{fmt(pct)}%
            </div>
            <div style={{ fontSize:8, color:cfg.text, marginTop:1 }}>
              {sig?.buy_count ?? 0}/5
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [prices,       setPrices]      = useState({})
  const [signals,      setSignals]     = useState({})
  const [portfolio,    setPortfolio]   = useState(null)
  const [alerts,       setAlerts]      = useState([])
  const [history,      setHistory]     = useState([])
  const [perfStats,    setPerfStats]   = useState(null)
  const [selected,     setSelected]    = useState('AAPL')
  const [leftTab,      setLeftTab]     = useState('watchlist')
  const [rightTab,     setRightTab]    = useState('signal')
  const [priceHist,    setPriceHist]   = useState({})
  const [chartData,    setChartData]   = useState([])
  const [chartLoading, setChartLoading]= useState(false)
  const [loading,      setLoading]     = useState(true)
  const [lastUpdate,   setLastUpdate]  = useState(null)
  const [toasts,       setToasts]      = useState([])
  const [showAddPos,   setShowAddPos]  = useState(false)
  const [showAddAlert, setShowAddAlert]= useState(false)
  const [showHeatmap,  setShowHeatmap] = useState(false)
  const [posForm,      setPosForm]     = useState({ ticker:'AAPL', entry_price:'', quantity:'', entry_date: new Date().toISOString().split('T')[0] })
  const [alertForm,    setAlertForm]   = useState({ ticker:'AAPL', alert_type:'price', target_price:'', direction:'above' })
  const notified    = useRef(new Set())
  const toastCounter= useRef(0)

  // ── Data loaders ─────────────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    try {
      const [{ signals: s }, port, { alerts: al }] = await Promise.all([
        fetchSignals(), fetchPortfolio(), fetchAlerts()
      ])
      const sigMap = {}, priceMap = {}
      s.forEach(x => {
        sigMap[x.ticker]   = x
        priceMap[x.ticker] = { price: x.price, change_pct: x.change_pct }
      })
      setSignals(sigMap)
      setPrices(prev => ({ ...prev, ...priceMap }))
      setPortfolio(port)
      setAlerts(al)
      setLoading(false)
    } catch {}
  }, [])

  const loadHistory = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/signal_performance`).then(r => r.json())
      setHistory(r.entries || [])
      setPerfStats(r.stats || null)
    } catch {}
  }, [])

  useEffect(() => {
    loadAll()
    loadHistory()
    const t = setInterval(loadAll, 60_000)
    return () => clearInterval(t)
  }, [loadAll, loadHistory])

  // Load chart data + fresh signal on ticker change
  useEffect(() => {
    if (!selected) return
    setChartLoading(true)
    Promise.all([
      fetch(`${API_BASE}/history/${selected}?days=60`).then(r => r.json()),
      fetch(`${API_BASE}/signal/${selected}`).then(r => r.json()),
    ]).then(([hist, sig]) => {
      setChartData(hist.history || [])
      setChartLoading(false)
      if (sig?.ticker) setSignals(prev => ({ ...prev, [selected]: sig }))
    }).catch(() => setChartLoading(false))
  }, [selected])

  // ── WebSocket ─────────────────────────────────────────────────────────────────
  const pushToast = useCallback(toast => {
    const id = ++toastCounter.current
    setToasts(prev => [...prev.slice(-4), { ...toast, id }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 12000)
    if (Notification.permission === 'granted') {
      const cfg = SIGNAL_CFG[toast.signal] || SIGNAL_CFG.HOLD
      new Notification(`${cfg.label} — ${toast.ticker}`, {
        body: [
          `Precio: ${fmtU(toast.price)}`,
          ...(toast.stop_loss   > 0 ? [`Stop Loss: ${fmtU(toast.stop_loss)}`]   : []),
          ...(toast.take_profit > 0 ? [`Objetivo:  ${fmtU(toast.take_profit)}`] : []),
          ...(toast.reasons?.slice(0,2) || []),
        ].join('\n'),
      })
    }
  }, [])

  const handleWsMsg = useCallback(msg => {
    if (msg.type === 'snapshot') {
      const priceMap = {}, sigMap = {}
      msg.prices?.forEach(p  => { priceMap[p.ticker] = { price: p.price, change_pct: p.change_pct } })
      msg.signals?.forEach(s => {
        sigMap[s.ticker] = s
        if (!priceMap[s.ticker] && s.price) priceMap[s.ticker] = { price: s.price, change_pct: s.change_pct }
      })
      setPrices(priceMap); setSignals(sigMap); setLoading(false)
    }
    if (msg.type === 'prices') {
      setPrices(prev => {
        const next = { ...prev }
        msg.data?.forEach(({ ticker, price, change_pct }) => {
          next[ticker] = { price, change_pct }
          if (price > 0) {
            setPriceHist(ph => ({
              ...ph, [ticker]: [...(ph[ticker]||[]), { v: price }].slice(-40)
            }))
          }
        })
        return next
      })
      setLastUpdate(new Date())
      msg.triggered_alerts?.forEach(a => {
        if (!notified.current.has(`p${a.id}`)) {
          notified.current.add(`p${a.id}`)
          pushToast({ signal:'HOLD', ticker:a.ticker, price:a.price,
            reasons:[`Precio ${a.direction==='above'?'superó':'bajó de'} ${fmtU(a.target)}`] })
          fetchAlerts().then(({ alerts: al }) => setAlerts(al)).catch(()=>{})
        }
      })
    }
    if (msg.type === 'signal_alert') {
      const key = `s${msg.ticker}${msg.signal}${msg.timestamp}`
      if (!notified.current.has(key)) {
        notified.current.add(key)
        pushToast(msg)
        loadHistory()
        setSignals(prev => ({ ...prev, [msg.ticker]: { ...(prev[msg.ticker]||{}), signal: msg.signal } }))
      }
    }
  }, [pushToast, loadHistory])

  useWebSocket(handleWsMsg)

  useEffect(() => {
    if (Notification.permission === 'default') Notification.requestPermission()
  }, [])

  // ── Portfolio & alert actions ──────────────────────────────────────────────────
  const handleAddPos = async e => {
    e.preventDefault()
    await addPosition({ ...posForm, entry_price:+posForm.entry_price, quantity:+posForm.quantity })
    setShowAddPos(false); loadAll()
  }
  const handleAddAlert = async e => {
    e.preventDefault()
    await createAlert({ ...alertForm, target_price: alertForm.target_price ? +alertForm.target_price : null })
    setShowAddAlert(false)
    fetchAlerts().then(({ alerts: al }) => setAlerts(al)).catch(()=>{})
  }

  // ── Derived values ────────────────────────────────────────────────────────────
  const selSig      = signals[selected]
  const selPrice    = prices[selected]
  const ind         = selSig?.indicators || {}
  const activeAlerts= alerts.filter(a => !a.triggered)
  const buyCnt      = Object.values(signals).filter(s => s.signal==='BUY').length
  const sellCnt     = Object.values(signals).filter(s => s.signal==='SELL').length
  const SIG_ORDER   = { BUY:0, SELL:1, HOLD:2 }

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100vh',
      background:'#080d18', color:'#e2e8f0', overflow:'hidden', fontFamily:'system-ui,sans-serif' }}>

      {/* ══ TOP BAR ══ */}
      <header style={{ background:'#0a0f1e', borderBottom:'1px solid #1e293b',
        padding:'0 16px', height:52, display:'flex', alignItems:'center',
        justifyContent:'space-between', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <BarChart2 size={20} color="#3b82f6"/>
          <span style={{ fontWeight:800, fontSize:15, color:'#f1f5f9', letterSpacing:.5 }}>
            Dashboard de Inversiones
          </span>
        </div>
        <div style={{ display:'flex', gap:16, alignItems:'center' }}>
          {portfolio && (
            <>
              <div style={{ textAlign:'right' }}>
                <div style={{ fontSize:10, color:'#475569' }}>PORTAFOLIO</div>
                <div style={{ fontWeight:700, fontSize:14, color:'#f1f5f9' }}>{fmtU(portfolio.total_value)}</div>
              </div>
              <div style={{ textAlign:'right' }}>
                <div style={{ fontSize:10, color:'#475569' }}>P&L</div>
                <div style={{ fontWeight:700, fontSize:14, color:pctC(portfolio.total_pnl) }}>
                  {portfolio.total_pnl>=0?'+':''}{fmtU(portfolio.total_pnl)}
                  <span style={{ fontSize:10, marginLeft:4 }}>
                    ({portfolio.total_pnl>=0?'+':''}{portfolio.total_pnl_pct}%)
                  </span>
                </div>
              </div>
            </>
          )}
          {/* Signal pills */}
          <div style={{ display:'flex', gap:5 }}>
            <span style={{ background:'#052e16', border:'1px solid #16a34a', color:'#4ade80',
              padding:'2px 10px', borderRadius:20, fontSize:11, fontWeight:700 }}>🟢 {buyCnt}</span>
            <span style={{ background:'#450a0a', border:'1px solid #dc2626', color:'#f87171',
              padding:'2px 10px', borderRadius:20, fontSize:11, fontWeight:700 }}>🔴 {sellCnt}</span>
          </div>
          {/* Heatmap toggle */}
          <button onClick={() => setShowHeatmap(v => !v)}
            title="Heatmap de señales"
            style={{ background: showHeatmap ? '#1e3a5f' : 'none',
              border:`1px solid ${showHeatmap ? '#3b82f6' : '#1e293b'}`,
              borderRadius:6, padding:'4px 8px', color: showHeatmap ? '#60a5fa' : '#475569', cursor:'pointer' }}>
            <Grid size={14}/>
          </button>
          <div style={{ fontSize:10, color:'#334155' }}>
            {lastUpdate ? lastUpdate.toLocaleTimeString('es-MX') : 'Conectando...'}
          </div>
          <button onClick={loadAll} style={{ background:'none', border:'none', color:'#475569', cursor:'pointer' }}>
            <RefreshCw size={14}/>
          </button>
        </div>
      </header>

      <div style={{ display:'flex', flex:1, overflow:'hidden' }}>

        {/* ══ LEFT PANEL ══ */}
        <aside style={{ width:252, background:'#0a0f1e', borderRight:'1px solid #1e293b',
          display:'flex', flexDirection:'column', flexShrink:0 }}>
          <div style={{ display:'flex', borderBottom:'1px solid #1e293b' }}>
            {[
              { id:'watchlist', icon:<List size={12}/>,      label:'Lista' },
              { id:'portfolio', icon:<Briefcase size={12}/>, label:'Portafolio' },
              { id:'alerts',    icon:<Bell size={12}/>,
                label:`Alertas${activeAlerts.length ? ` (${activeAlerts.length})` : ''}` },
            ].map(t => (
              <button key={t.id} onClick={() => setLeftTab(t.id)} style={{
                flex:1, padding:'9px 0', background:'none', border:'none',
                borderBottom: leftTab===t.id ? '2px solid #3b82f6' : '2px solid transparent',
                color: leftTab===t.id ? '#60a5fa' : '#475569',
                cursor:'pointer', fontSize:11, fontWeight:600,
                display:'flex', alignItems:'center', justifyContent:'center', gap:4
              }}>{t.icon}{t.label}</button>
            ))}
          </div>

          <div style={{ flex:1, overflowY:'auto', padding:'6px 0' }}>

            {/* WATCHLIST */}
            {leftTab === 'watchlist' && Object.entries(WATCHLIST).map(([group, tickers]) => {
              const sorted = [...tickers].sort((a,b) =>
                (SIG_ORDER[signals[a]?.signal]??3) - (SIG_ORDER[signals[b]?.signal]??3))
              return (
                <div key={group}>
                  <div style={{ fontSize:10, color:'#334155', padding:'6px 10px 2px',
                    fontWeight:700, textTransform:'uppercase', letterSpacing:1 }}>{group}</div>
                  {sorted.map(ticker => {
                    const p   = prices[ticker] || {}
                    const sig = signals[ticker]
                    const isSel = ticker === selected
                    return (
                      <div key={ticker} onClick={() => setSelected(ticker)} style={{
                        padding:'7px 10px', cursor:'pointer',
                        background: isSel ? '#13192e' : 'transparent',
                        borderLeft: isSel ? '3px solid #3b82f6' : '3px solid transparent',
                      }}>
                        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                          <div>
                            <span style={{ fontWeight:700, fontSize:12, color:'#f1f5f9' }}>{ticker}</span>
                            {TICKER_NAMES[ticker] && (
                              <span style={{ fontSize:10, color:'#475569', marginLeft:5 }}>{TICKER_NAMES[ticker]}</span>
                            )}
                          </div>
                          {sig && <SignalBadge signal={sig.signal}/>}
                        </div>
                        <div style={{ display:'flex', justifyContent:'space-between', marginTop:1 }}>
                          <span style={{ fontSize:12, color:'#cbd5e1' }}>{p.price ? fmtU(p.price) : '–'}</span>
                          <span style={{ fontSize:11, color:pctC(p.change_pct) }}>
                            {p.change_pct!=null ? `${p.change_pct>=0?'+':''}${fmt(p.change_pct)}%` : '–'}
                          </span>
                        </div>
                        {/* Mini confidence dots */}
                        {sig && (
                          <div style={{ display:'flex', gap:2, marginTop:2 }}>
                            {[1,2,3,4,5].map(n => (
                              <div key={n} style={{
                                width:6, height:6, borderRadius:'50%',
                                background: sig.buy_count>=n
                                  ? (sig.signal==='BUY'?'#16a34a':sig.signal==='SELL'?'#dc2626':'#ca8a04')
                                  : '#1e293b'
                              }}/>
                            ))}
                          </div>
                        )}
                        <MiniSparkline data={priceHist[ticker]}/>
                      </div>
                    )
                  })}
                </div>
              )
            })}

            {/* PORTFOLIO */}
            {leftTab === 'portfolio' && (
              <div style={{ padding:8 }}>
                <button onClick={() => setShowAddPos(true)} style={{
                  width:'100%', background:'#1d4ed8', border:'none', borderRadius:6,
                  padding:'7px 0', color:'#fff', fontWeight:700, fontSize:12, cursor:'pointer',
                  display:'flex', alignItems:'center', justifyContent:'center', gap:5, marginBottom:8
                }}><Plus size={13}/> Agregar Posición</button>
                {!portfolio?.positions?.length && (
                  <p style={{ fontSize:12, color:'#334155', textAlign:'center', marginTop:20 }}>Sin posiciones</p>
                )}
                {portfolio?.positions?.map(pos => (
                  <div key={pos.id} style={{ background:'#13192e', borderRadius:6,
                    padding:9, marginBottom:6, border:'1px solid #1e293b' }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                      <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                        <span style={{ fontWeight:700, fontSize:12 }}>{pos.ticker}</span>
                        <SignalBadge signal={pos.signal}/>
                      </div>
                      <button onClick={() => deletePosition(pos.id).then(loadAll)}
                        style={{ background:'none', border:'none', color:'#ef4444', cursor:'pointer' }}>
                        <Trash2 size={12}/>
                      </button>
                    </div>
                    <div style={{ fontSize:11, color:'#64748b', marginTop:2 }}>
                      {pos.quantity} × {fmtU(pos.entry_price)}
                    </div>
                    <div style={{ fontSize:12, color:pctC(pos.pnl), fontWeight:600, marginTop:2 }}>
                      P&L: {pos.pnl>=0?'+':''}{fmtU(pos.pnl)} ({pos.pnl_pct>=0?'+':''}{pos.pnl_pct}%)
                    </div>
                    {pos.stop_loss  > 0 && <div style={{ fontSize:10, color:'#f87171', marginTop:2 }}>🛑 Stop: {fmtU(pos.stop_loss)}</div>}
                    {pos.take_profit> 0 && <div style={{ fontSize:10, color:'#4ade80' }}>🎯 Objetivo: {fmtU(pos.take_profit)}</div>}
                  </div>
                ))}
              </div>
            )}

            {/* ALERTS */}
            {leftTab === 'alerts' && (
              <div style={{ padding:8 }}>
                {/* Auto signal alerts */}
                {(() => {
                  const sigAlerts = alerts.filter(a => a.alert_type?.startsWith('signal_'))
                  return sigAlerts.length > 0 && (
                    <div style={{ marginBottom:10 }}>
                      <div style={{ fontSize:10, color:'#475569', fontWeight:700, letterSpacing:1,
                        textTransform:'uppercase', marginBottom:5 }}>🤖 Señales automáticas</div>
                      {sigAlerts.map(a => {
                        const isBuy = a.alert_type === 'signal_buy'
                        const cfg   = isBuy ? SIGNAL_CFG.BUY : SIGNAL_CFG.SELL
                        const parts = (a.direction||'').split(' | ')
                        return (
                          <div key={a.id} style={{ background:cfg.bg, border:`1px solid ${cfg.border}`,
                            borderRadius:7, padding:9, marginBottom:6, boxShadow:`0 0 8px ${cfg.glow}` }}>
                            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                              <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                                <span style={{ fontWeight:800, fontSize:13, color:cfg.text }}>{a.ticker}</span>
                                <SignalBadge signal={isBuy?'BUY':'SELL'}/>
                              </div>
                              <button onClick={() => deleteAlert(a.id)
                                .then(() => fetchAlerts().then(({alerts:al})=>setAlerts(al)))}
                                style={{ background:'none', border:'none', color:'#475569', cursor:'pointer' }}>
                                <Trash2 size={11}/>
                              </button>
                            </div>
                            {parts.slice(1).map((p,i) => (
                              <div key={i} style={{ fontSize:10, color:'#94a3b8', marginTop:2 }}>{p}</div>
                            ))}
                            <div style={{ fontSize:10, color:'#475569', marginTop:3 }}>
                              {new Date(a.created_at+'Z').toLocaleString('es-MX',
                                {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )
                })()}
                {/* Manual price alerts */}
                <div style={{ fontSize:10, color:'#475569', fontWeight:700, letterSpacing:1,
                  textTransform:'uppercase', marginBottom:5 }}>💰 Alertas de precio</div>
                <button onClick={() => setShowAddAlert(true)} style={{
                  width:'100%', background:'#1e293b', border:'1px solid #334155', borderRadius:6,
                  padding:'7px 0', color:'#94a3b8', fontWeight:600, fontSize:12, cursor:'pointer',
                  display:'flex', alignItems:'center', justifyContent:'center', gap:5, marginBottom:6
                }}><Plus size={13}/> Nueva alerta de precio</button>
                {alerts.filter(a => a.alert_type==='price').map(a => (
                  <div key={a.id} style={{
                    background: a.triggered ? '#0a1a0a' : '#13192e',
                    border:`1px solid ${a.triggered?'#166534':'#1e293b'}`,
                    borderRadius:6, padding:8, marginBottom:5
                  }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                      <span style={{ fontWeight:700, fontSize:12 }}>{a.ticker}</span>
                      <div style={{ display:'flex', gap:5, alignItems:'center' }}>
                        {a.triggered ? <BellOff size={11} color="#4ade80"/> : <Bell size={11} color="#facc15"/>}
                        <button onClick={() => deleteAlert(a.id)
                          .then(()=>fetchAlerts().then(({alerts:al})=>setAlerts(al)))}
                          style={{ background:'none', border:'none', color:'#ef4444', cursor:'pointer' }}>
                          <Trash2 size={11}/>
                        </button>
                      </div>
                    </div>
                    <div style={{ fontSize:11, color:'#94a3b8', marginTop:2 }}>
                      {a.direction==='above'?'↑ Sobre':'↓ Bajo'} {fmtU(a.target_price)}
                    </div>
                    <div style={{ fontSize:10, color:a.triggered?'#4ade80':'#facc15', marginTop:2 }}>
                      {a.triggered ? '✓ Activada' : '⏳ Pendiente'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>

        {/* ══ CENTER PANEL ══ */}
        <main style={{ flex:1, display:'flex', flexDirection:'column',
          overflow:'hidden', padding:12, gap:8, minWidth:0 }}>

          {/* Market alerts banner */}
          <MarketAlert signals={signals} prices={prices}/>

          {/* Heatmap panel */}
          {showHeatmap && (
            <Card style={{ padding:12, flexShrink:0 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
                <SectionTitle>Heatmap de Señales — Top 20 Acciones</SectionTitle>
                <button onClick={() => setShowHeatmap(false)}
                  style={{ background:'none', border:'none', color:'#475569', cursor:'pointer' }}>
                  <X size={14}/>
                </button>
              </div>
              <SignalHeatmap signals={signals} prices={prices} onSelect={t => { setSelected(t); setShowHeatmap(false) }}/>
            </Card>
          )}

          {/* Ticker header */}
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
            <div style={{ display:'flex', alignItems:'center', gap:10 }}>
              <h2 style={{ fontSize:22, fontWeight:800, color:'#f1f5f9', margin:0 }}>{selected}</h2>
              {TICKER_NAMES[selected] && (
                <span style={{ fontSize:13, color:'#475569' }}>{TICKER_NAMES[selected]}</span>
              )}
              {selPrice && (
                <>
                  <span style={{ fontSize:20, fontWeight:700, color:'#f1f5f9' }}>{fmtU(selPrice.price)}</span>
                  <span style={{ fontSize:13, fontWeight:600, color:pctC(selPrice.change_pct),
                    display:'flex', alignItems:'center', gap:3 }}>
                    {selPrice.change_pct>=0 ? <TrendingUp size={14}/> : <TrendingDown size={14}/>}
                    {selPrice.change_pct>=0?'+':''}{fmt(selPrice.change_pct)}%
                  </span>
                </>
              )}
            </div>
            {selSig && <SignalBadge signal={selSig.signal} size="lg"/>}
          </div>

          {/* Price chart */}
          <Card style={{ flex:1, minHeight:0, padding:'10px 8px' }}>
            {(loading || chartLoading) ? (
              <div style={{ display:'flex', alignItems:'center', justifyContent:'center',
                height:'100%', color:'#334155' }}>Cargando datos...</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top:8, right:12, left:8, bottom:4 }}>
                  <defs>
                    <linearGradient id="pg" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#3b82f6" stopOpacity={.4}/>
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b"/>
                  <XAxis dataKey="date" tick={{ fill:'#475569', fontSize:9 }} interval="preserveStartEnd"/>
                  <YAxis domain={['auto','auto']} tick={{ fill:'#334155', fontSize:10 }}
                    tickFormatter={v=>`$${fmt(v,0)}`} width={60}/>
                  <Tooltip
                    contentStyle={{ background:'#13192e', border:'1px solid #334155', borderRadius:6, fontSize:12 }}
                    formatter={v=>[fmtU(v),'Precio']}/>
                  {ind.bb_upper > 0 && <ReferenceLine y={ind.bb_upper} stroke="#ca8a04" strokeDasharray="4 2"
                    label={{ value:'BB+', fill:'#ca8a04', fontSize:9 }}/>}
                  {ind.bb_lower > 0 && <ReferenceLine y={ind.bb_lower} stroke="#ca8a04" strokeDasharray="4 2"
                    label={{ value:'BB-', fill:'#ca8a04', fontSize:9 }}/>}
                  {ind.ema200 > 0 && <ReferenceLine y={ind.ema200} stroke="#a78bfa" strokeDasharray="3 3"
                    label={{ value:'EMA200', fill:'#a78bfa', fontSize:9 }}/>}
                  {ind.ema50  > 0 && <ReferenceLine y={ind.ema50}  stroke="#fb923c" strokeDasharray="3 3"
                    label={{ value:'EMA50',  fill:'#fb923c', fontSize:9 }}/>}
                  {selSig?.stop_loss_buy > 0 && selSig.signal==='BUY' &&
                    <ReferenceLine y={selSig.stop_loss_buy}  stroke="#ef4444" strokeDasharray="5 3"
                      label={{ value:'STOP', fill:'#ef4444', fontSize:9 }}/>}
                  {selSig?.take_profit_buy > 0 && selSig.signal==='BUY' &&
                    <ReferenceLine y={selSig.take_profit_buy} stroke="#4ade80" strokeDasharray="5 3"
                      label={{ value:'OBJETIVO', fill:'#4ade80', fontSize:9 }}/>}
                  <Area type="monotone" dataKey="v" stroke="#3b82f6" strokeWidth={2} fill="url(#pg)" dot={false}/>
                </AreaChart>
              </ResponsiveContainer>
            )}
          </Card>

          {/* Indicator boxes */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(110px,1fr))', gap:6, flexShrink:0 }}>
            {[
              { label:'RSI (14)',    value:fmt(ind.rsi),      color:ind.rsi<40?'#4ade80':ind.rsi>65?'#f87171':'#facc15' },
              { label:'MACD',        value:fmt(ind.macd,4),   color:ind.macd>0?'#4ade80':'#f87171' },
              { label:'EMA 20',      value:fmtU(ind.ema20),   color:'#60a5fa' },
              { label:'EMA 50',      value:fmtU(ind.ema50),   color:'#fb923c' },
              { label:'EMA 200',     value:fmtU(ind.ema200),  color:'#a78bfa' },
              { label:'BB Superior', value:fmtU(ind.bb_upper),color:'#fbbf24' },
              { label:'BB Inferior', value:fmtU(ind.bb_lower),color:'#fbbf24' },
              { label:'ATR (14)',    value:fmtU(ind.atr),     color:'#94a3b8' },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ background:'#0a0f1e', border:'1px solid #1e293b', borderRadius:6, padding:'7px 10px' }}>
                <div style={{ fontSize:9, color:'#334155', marginBottom:2 }}>{label}</div>
                <div style={{ fontSize:13, fontWeight:700, color }}>{value || '–'}</div>
              </div>
            ))}
          </div>
        </main>

        {/* ══ RIGHT PANEL ══ */}
        <aside style={{ width:240, background:'#0a0f1e', borderLeft:'1px solid #1e293b',
          display:'flex', flexDirection:'column', flexShrink:0, overflowY:'auto' }}>

          <div style={{ display:'flex', borderBottom:'1px solid #1e293b', flexShrink:0 }}>
            {[
              { id:'signal',  icon:<Activity size={12}/>, label:'Señal' },
              { id:'history', icon:<Clock size={12}/>,    label:'Historial' },
            ].map(t => (
              <button key={t.id} onClick={() => setRightTab(t.id)} style={{
                flex:1, padding:'9px 0', background:'none', border:'none',
                borderBottom: rightTab===t.id ? '2px solid #3b82f6' : '2px solid transparent',
                color: rightTab===t.id ? '#60a5fa' : '#475569',
                cursor:'pointer', fontSize:11, fontWeight:600,
                display:'flex', alignItems:'center', justifyContent:'center', gap:4
              }}>{t.icon}{t.label}</button>
            ))}
          </div>

          <div style={{ flex:1, padding:10, overflowY:'auto', display:'flex', flexDirection:'column', gap:12 }}>

            {/* SIGNAL DETAIL */}
            {rightTab === 'signal' && selSig && (
              <>
                {/* Confidence bar */}
                <div>
                  <SectionTitle>Señal Actual</SectionTitle>
                  <div style={{ marginBottom:10 }}>
                    <SignalBadge signal={selSig.signal} size="lg"/>
                  </div>
                  <ConfidenceBar
                    buyCount={selSig.buy_count}
                    sellCount={selSig.sell_count}
                    signal={selSig.signal}
                  />
                </div>

                {/* SL & TP */}
                {selPrice?.price > 0 && (
                  <div>
                    <SectionTitle>Niveles Clave</SectionTitle>
                    <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
                      <div style={{ background:'#1a0a0a', border:'1px solid #7f1d1d', borderRadius:6, padding:'8px 10px' }}>
                        <div style={{ display:'flex', alignItems:'center', gap:5, marginBottom:2 }}>
                          <Shield size={12} color="#f87171"/>
                          <span style={{ fontSize:10, color:'#94a3b8', fontWeight:700 }}>STOP LOSS</span>
                        </div>
                        <div style={{ fontSize:14, fontWeight:800, color:'#f87171' }}>
                          {fmtU(selSig.stop_loss_buy)}
                        </div>
                        <div style={{ fontSize:9, color:'#64748b' }}>
                          −{fmtU(selPrice.price - selSig.stop_loss_buy)}
                          ({fmt((selPrice.price - selSig.stop_loss_buy)/selPrice.price*100)}%)
                        </div>
                      </div>
                      <div style={{ background:'#0a1a0a', border:'1px solid #14532d', borderRadius:6, padding:'8px 10px' }}>
                        <div style={{ display:'flex', alignItems:'center', gap:5, marginBottom:2 }}>
                          <Target size={12} color="#4ade80"/>
                          <span style={{ fontSize:10, color:'#94a3b8', fontWeight:700 }}>OBJETIVO (TP)</span>
                        </div>
                        <div style={{ fontSize:14, fontWeight:800, color:'#4ade80' }}>
                          {fmtU(selSig.take_profit_buy)}
                        </div>
                        <div style={{ fontSize:9, color:'#64748b' }}>
                          +{fmtU(selSig.take_profit_buy - selPrice.price)}
                          ({fmt((selSig.take_profit_buy - selPrice.price)/selPrice.price*100)}%)
                        </div>
                      </div>
                      <div style={{ background:'#13192e', border:'1px solid #1e293b', borderRadius:6, padding:'7px 10px' }}>
                        <div style={{ fontSize:9, color:'#64748b', marginBottom:3 }}>SOPORTE / RESISTENCIA</div>
                        <div style={{ fontSize:11, color:'#94a3b8' }}>
                          Soporte: <span style={{ color:'#4ade80', fontWeight:700 }}>{fmtU(selSig.support)}</span>
                        </div>
                        <div style={{ fontSize:11, color:'#94a3b8' }}>
                          Resistencia: <span style={{ color:'#f87171', fontWeight:700 }}>{fmtU(selSig.resistance)}</span>
                        </div>
                        <div style={{ fontSize:9, color:'#475569', marginTop:3 }}>
                          ATR: {fmtU(selSig.atr)} (volatilidad diaria)
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Active conditions */}
                {selSig.active_buy_reasons?.length > 0 && (
                  <div>
                    <SectionTitle>✅ Condiciones Cumplidas</SectionTitle>
                    {selSig.active_buy_reasons.map((r,i) => (
                      <div key={i} style={{ fontSize:11, color:'#4ade80', marginBottom:4,
                        display:'flex', gap:5, alignItems:'flex-start' }}>
                        <span style={{ flexShrink:0 }}>✓</span><span>{r}</span>
                      </div>
                    ))}
                  </div>
                )}
                {selSig.active_sell_reasons?.length > 0 && (
                  <div>
                    <SectionTitle>⚠️ Señales de Venta</SectionTitle>
                    {selSig.active_sell_reasons.map((r,i) => (
                      <div key={i} style={{ fontSize:11, color:'#f87171', marginBottom:4,
                        display:'flex', gap:5, alignItems:'flex-start' }}>
                        <span style={{ flexShrink:0 }}>✗</span><span>{r}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* What's missing for BUY */}
                {selSig.signal !== 'BUY' && selSig.missing_buy_conditions?.length > 0 && (
                  <div>
                    <SectionTitle>🎯 Falta para COMPRAR</SectionTitle>
                    <div style={{ background:'#0f172a', border:'1px solid #1e3a5f',
                      borderRadius:6, padding:'8px 10px' }}>
                      {selSig.missing_buy_conditions.map((r,i) => (
                        <div key={i} style={{ fontSize:11, color:'#94a3b8', marginBottom:3,
                          display:'flex', gap:5, alignItems:'flex-start' }}>
                          <span style={{ color:'#3b82f6', flexShrink:0 }}>○</span><span>{r}</span>
                        </div>
                      ))}
                      <div style={{ fontSize:10, color:'#334155', marginTop:6, borderTop:'1px solid #1e293b', paddingTop:5 }}>
                        Necesita {Math.max(0, 3 - selSig.buy_count)} condición(es) más
                      </div>
                    </div>
                  </div>
                )}

                {/* Market summary */}
                <div>
                  <SectionTitle>Resumen Mercado</SectionTitle>
                  {[
                    { s:'BUY',  label:'🟢 Comprar', count:buyCnt },
                    { s:'SELL', label:'🔴 Vender',  count:sellCnt },
                    { s:'HOLD', label:'🟡 Mantener',count:Object.values(signals).filter(x=>x.signal==='HOLD').length },
                  ].map(({ label, count }) => (
                    <div key={label} style={{ display:'flex', justifyContent:'space-between', padding:'3px 0' }}>
                      <span style={{ fontSize:12, color:'#94a3b8' }}>{label}</span>
                      <span style={{ fontSize:12, fontWeight:700, color:'#f1f5f9' }}>{count}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* SIGNAL HISTORY */}
            {rightTab === 'history' && (
              <div>
                <SectionTitle>Rendimiento de Señales</SectionTitle>
                {perfStats?.evaluated > 0 && (
                  <div style={{ background:'#0f172a', border:'1px solid #1e3a5f', borderRadius:6,
                    padding:'8px 10px', marginBottom:8 }}>
                    <div style={{ display:'flex', justifyContent:'space-between', padding:'2px 0' }}>
                      <span style={{ fontSize:11, color:'#94a3b8' }}>Señales evaluadas</span>
                      <span style={{ fontSize:11, fontWeight:700, color:'#f1f5f9' }}>{perfStats.evaluated}</span>
                    </div>
                    <div style={{ display:'flex', justifyContent:'space-between', padding:'2px 0' }}>
                      <span style={{ fontSize:11, color:'#94a3b8' }}>Aciertos</span>
                      <span style={{ fontSize:11, fontWeight:700,
                        color: perfStats.win_rate >= 50 ? '#4ade80' : '#f87171' }}>
                        {perfStats.win_rate}%
                      </span>
                    </div>
                    <div style={{ display:'flex', justifyContent:'space-between', padding:'2px 0' }}>
                      <span style={{ fontSize:11, color:'#94a3b8' }}>Promedio por señal</span>
                      <span style={{ fontSize:11, fontWeight:700,
                        color: perfStats.avg_pct >= 0 ? '#4ade80' : '#f87171' }}>
                        {perfStats.avg_pct >= 0 ? '+' : ''}{perfStats.avg_pct}%
                      </span>
                    </div>
                    <div style={{ fontSize:9, color:'#475569', marginTop:4, borderTop:'1px solid #1e293b', paddingTop:4 }}>
                      Si hubieras seguido cada señal (paper trading)
                    </div>
                  </div>
                )}
                {!history.length && (
                  <p style={{ fontSize:11, color:'#334155' }}>
                    Sin señales registradas aún. El sistema irá anotando cada señal
                    de COMPRA/VENTA y aquí verás si habría ganado o perdido.
                  </p>
                )}
                {history.map((h,i) => {
                  const cfg = SIGNAL_CFG[h.signal] || SIGNAL_CFG.HOLD
                  return (
                    <div key={i} style={{ background:'#13192e',
                      border:`1px solid ${cfg.border}22`, borderRadius:6,
                      padding:'7px 9px', marginBottom:5 }}>
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                        <span style={{ fontWeight:700, fontSize:12 }}>{h.ticker}</span>
                        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                          {h.pct_since != null && (
                            <span style={{ fontSize:11, fontWeight:800,
                              color: h.pct_since >= 0 ? '#4ade80' : '#f87171' }}>
                              {h.pct_since >= 0 ? '+' : ''}{h.pct_since}%
                            </span>
                          )}
                          <SignalBadge signal={h.signal}/>
                        </div>
                      </div>
                      <div style={{ fontSize:11, color:'#64748b', marginTop:2 }}>
                        {fmtU(h.signal_price ?? h.price)} · {new Date(h.ts+'Z').toLocaleString('es-MX',
                          {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* ══ MODALS ══ */}
      {showAddPos && (
        <Modal title="Agregar Posición" onClose={() => setShowAddPos(false)}>
          <form onSubmit={handleAddPos}>
            <FSelect label="Activo" value={posForm.ticker}
              onChange={e=>setPosForm(f=>({...f,ticker:e.target.value}))}>
              {ALL_TICKERS.map(t=><option key={t} value={t}>{t} — {TICKER_NAMES[t]||t}</option>)}
            </FSelect>
            <FInput label="Precio de entrada (USD)" type="number" step="0.01" required
              value={posForm.entry_price} onChange={e=>setPosForm(f=>({...f,entry_price:e.target.value}))}/>
            <FInput label="Cantidad" type="number" step="0.0001" required
              value={posForm.quantity} onChange={e=>setPosForm(f=>({...f,quantity:e.target.value}))}/>
            <FInput label="Fecha" type="date" required
              value={posForm.entry_date} onChange={e=>setPosForm(f=>({...f,entry_date:e.target.value}))}/>
            <PBtn type="submit">Agregar Posición</PBtn>
          </form>
        </Modal>
      )}
      {showAddAlert && (
        <Modal title="Nueva Alerta de Precio" onClose={() => setShowAddAlert(false)}>
          <form onSubmit={handleAddAlert}>
            <FSelect label="Activo" value={alertForm.ticker}
              onChange={e=>setAlertForm(f=>({...f,ticker:e.target.value}))}>
              {ALL_TICKERS.map(t=><option key={t} value={t}>{t} — {TICKER_NAMES[t]||t}</option>)}
            </FSelect>
            <FInput label="Precio objetivo (USD)" type="number" step="0.01" required
              value={alertForm.target_price}
              onChange={e=>setAlertForm(f=>({...f,target_price:e.target.value}))}/>
            <FSelect label="Dirección" value={alertForm.direction}
              onChange={e=>setAlertForm(f=>({...f,direction:e.target.value}))}>
              <option value="above">↑ Precio sube sobre el objetivo</option>
              <option value="below">↓ Precio baja del objetivo</option>
            </FSelect>
            <PBtn type="submit" color="#6d28d9">Crear Alerta</PBtn>
          </form>
        </Modal>
      )}

      <Toasts toasts={toasts} onDismiss={id => setToasts(prev => prev.filter(t => t.id !== id))}/>

      <style>{`
        @keyframes slideIn { from { opacity:0; transform:translateX(30px) } to { opacity:1; transform:none } }
        ::-webkit-scrollbar { width:4px }
        ::-webkit-scrollbar-track { background:#0a0f1e }
        ::-webkit-scrollbar-thumb { background:#1e293b; border-radius:2px }
        * { box-sizing:border-box }
      `}</style>
    </div>
  )
}
