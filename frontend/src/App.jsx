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
import * as XLSX from 'xlsx'

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
  BUY:  { label:'🟢 COMPRAR',  bg:'#175c32', border:'#16a34a', text:'#4ade80', glow:'#16a34a33' },
  SELL: { label:'🔴 VENDER',   bg:'#702222', border:'#dc2626', text:'#f87171', glow:'#dc262633' },
  HOLD: { label:'🟡 MANTENER', bg:'#46400f', border:'#ca8a04', text:'#facc15', glow:'#ca8a0433' },
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
        <span style={{ fontSize:10, color:'#bac6da', fontWeight:700, textTransform:'uppercase', letterSpacing:.5 }}>
          Confianza
        </span>
        <span style={{ fontSize:11, color, fontWeight:700 }}>{label}</span>
      </div>
      <div style={{ background:'#51617f', borderRadius:20, height:8, overflow:'hidden' }}>
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
            background: buyCount>=n ? color : '#51617f',
            border:`1px solid ${buyCount>=n ? color : '#93a2bb'}`,
            color: buyCount>=n ? '#fff' : '#aebbd1'
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
    <div style={{ background:'#38465f', border:'1px solid #51617f', borderRadius:8, padding:12, ...style }}>
      {children}
    </div>
  )
}
function StatBox({ label, value, color='#f1f5f9', sub }) {
  return (
    <div style={{ background:'#51617f', borderRadius:6, padding:'8px 12px', flex:1 }}>
      <div style={{ fontSize:10, color:'#bac6da', marginBottom:2 }}>{label}</div>
      <div style={{ fontSize:14, fontWeight:700, color }}>{value}</div>
      {sub && <div style={{ fontSize:10, color:'#aebbd1', marginTop:1 }}>{sub}</div>}
    </div>
  )
}
function SectionTitle({ children }) {
  return (
    <div style={{ fontSize:10, color:'#aebbd1', fontWeight:700, letterSpacing:1,
      textTransform:'uppercase', marginBottom:6 }}>{children}</div>
  )
}
function Modal({ title, onClose, children }) {
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.75)', zIndex:200,
      display:'flex', alignItems:'center', justifyContent:'center' }} onClick={onClose}>
      <div style={{ background:'#38465f', border:'1px solid #93a2bb', borderRadius:10,
        padding:24, minWidth:340, maxWidth:480, width:'90%' }} onClick={e=>e.stopPropagation()}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
          <h3 style={{ color:'#f1f5f9', fontWeight:700, margin:0 }}>{title}</h3>
          <button onClick={onClose} style={{ background:'none', border:'none', color:'#d4dcea', cursor:'pointer' }}>
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
      <label style={{ display:'block', fontSize:12, color:'#d4dcea', marginBottom:4 }}>{label}</label>
      <input {...p} style={{ width:'100%', background:'#51617f', border:'1px solid #93a2bb',
        borderRadius:6, padding:'8px 10px', color:'#f1f5f9', fontSize:14, outline:'none',
        boxSizing:'border-box' }}/>
    </div>
  )
}
function FSelect({ label, children, ...p }) {
  return (
    <div style={{ marginBottom:12 }}>
      <label style={{ display:'block', fontSize:12, color:'#d4dcea', marginBottom:4 }}>{label}</label>
      <select {...p} style={{ width:'100%', background:'#51617f', border:'1px solid #93a2bb',
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
            background:'#38465f', border:`2px solid ${cfg.border}`,
            borderRadius:10, padding:'12px 14px', boxShadow:`0 4px 20px ${cfg.glow}`,
            animation:'slideIn .3s ease'
          }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
              <span style={{ fontWeight:800, fontSize:14, color:cfg.text }}>
                🔔 {t.ticker} — {cfg.label}
              </span>
              <button onClick={()=>onDismiss(t.id)}
                style={{ background:'none', border:'none', color:'#bac6da', cursor:'pointer' }}>
                <X size={14}/>
              </button>
            </div>
            {t.reasons?.length > 0 && (
              <ul style={{ margin:0, padding:'0 0 0 14px', fontSize:11, color:'#d4dcea' }}>
                {t.reasons.map((r,i)=><li key={i}>{r}</li>)}
              </ul>
            )}
            <div style={{ display:'flex', gap:8, marginTop:8 }}>
              {t.stop_loss > 0 && (
                <span style={{ fontSize:11, background:'#702222', color:'#f87171', padding:'2px 6px', borderRadius:4 }}>
                  Stop: {fmtU(t.stop_loss)}
                </span>
              )}
              {t.take_profit > 0 && (
                <span style={{ fontSize:11, background:'#175c32', color:'#4ade80', padding:'2px 6px', borderRadius:4 }}>
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
        <div key={i} style={{ background:'#38465f', border:`1px solid ${a.color}55`,
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

// ─── Vista de Rendimiento (paper trading) ────────────────────────────────────
function PerfView({ onClose, onSelect }) {
  const [data,         setData]         = useState(null)
  const [tickerFilter, setTickerFilter] = useState('ALL')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [dateFrom,     setDateFrom]     = useState('')
  const [dateTo,       setDateTo]       = useState('')

  useEffect(() => {
    fetch(`${API_BASE}/signal_performance`).then(r => r.json())
      .then(setData).catch(() => setData({ trades:[], stats:{}, per_ticker:{} }))
  }, [])

  if (!data) return (
    <div style={{ position:'fixed', inset:0, background:'#2b3950', zIndex:150,
      display:'flex', alignItems:'center', justifyContent:'center', color:'#aebbd1' }}>
      Cargando rendimiento…
    </div>
  )

  const { trades = [], stats = {}, per_ticker = {} } = data
  const capital  = stats.capital_per_trade || 1000
  const tickers  = Object.keys(per_ticker).sort()
  const filtered = trades.filter(t =>
    (tickerFilter === 'ALL' || t.ticker === tickerFilter) &&
    (statusFilter === 'ALL' || t.status === statusFilter) &&
    (!dateFrom || t.entry_ts.slice(0,10) >= dateFrom) &&
    (!dateTo   || t.entry_ts.slice(0,10) <= dateTo))

  // Análisis financiero del filtro actual
  const fStats = (() => {
    const open      = filtered.filter(t => t.status === 'open')
    const closed    = filtered.filter(t => t.status === 'closed')
    const openVal   = open.filter(t => t.pnl_usd != null)
    const winners   = closed.filter(t => (t.pct ?? 0) > 0)
    const losers    = closed.filter(t => (t.pct ?? 0) <= 0)
    const realized  = closed.reduce((s,t) => s + (t.pnl_usd || 0), 0)
    const unrealized= openVal.reduce((s,t) => s + (t.pnl_usd || 0), 0)
    const capOpen   = open.length * capital
    const capClosed = closed.length * capital
    return {
      capOpen, capClosed,
      realized,   realizedPct:   capClosed ? realized   / capClosed * 100 : null,
      unrealized, unrealizedPct: capOpen   ? unrealized / capOpen   * 100 : null,
      total: realized + unrealized,
      totalPct: (capOpen + capClosed) ? (realized + unrealized) / (capOpen + capClosed) * 100 : null,
      win: closed.length ? Math.round(winners.length / closed.length * 100) : null,
      nWin: winners.length, nLose: losers.length,
      daysToWin:  winners.length ? winners.reduce((s,t) => s + t.days_held, 0) / winners.length : null,
      daysAll: filtered.length ? filtered.reduce((s,t) => s + t.days_held, 0) / filtered.length : null,
      open, closed,
    }
  })()

  // P&L acumulado de operaciones cerradas (orden cronológico de cierre)
  const cumData = (() => {
    const closed = [...fStats.closed].filter(t => t.exit_ts)
      .sort((a,b) => a.exit_ts.localeCompare(b.exit_ts))
    let acc = 0
    return closed.map(t => ({ name: `${t.ticker} ${new Date(t.exit_ts+'Z').toLocaleDateString('es-MX',{day:'numeric',month:'short'})}`,
      v: +(acc += t.pnl_usd).toFixed(2) }))
  })()

  const downloadExcel = () => {
    const reasonTxt = r => r === 'take_profit' ? 'Take Profit' : r === 'stop_loss' ? 'Stop Loss'
      : r === 'sell_signal' ? 'Señal de venta' : ''
    const ops = filtered.map(t => ({
      'Activo': t.ticker, 'Nombre': TICKER_NAMES[t.ticker] || '',
      'Estado': t.status === 'open' ? 'Abierta' : 'Cerrada',
      'Fecha entrada': t.entry_ts?.slice(0,16).replace('T',' '),
      'Precio entrada': t.entry_price,
      'Stop Loss': t.stop_loss ?? null, 'Take Profit': t.take_profit ?? null,
      'Fecha salida': t.exit_ts ? t.exit_ts.slice(0,16).replace('T',' ') : '',
      'Precio salida': t.exit_price ?? null,
      'Motivo cierre': reasonTxt(t.exit_reason),
      'Días en posición': t.days_held,
      'Resultado %': t.pct ?? null, 'Resultado USD': t.pnl_usd ?? null,
      'Capital por trade': capital,
    }))
    const resumen = [
      { 'Métrica': 'Capital invertido (abiertas)',  'Valor': fStats.capOpen },
      { 'Métrica': 'Ganancia realizada (USD)',      'Valor': +fStats.realized.toFixed(2) },
      { 'Métrica': 'Ganancia realizada (%)',        'Valor': fStats.realizedPct != null ? +fStats.realizedPct.toFixed(2) : null },
      { 'Métrica': 'Ganancia no realizada (USD)',   'Valor': +fStats.unrealized.toFixed(2) },
      { 'Métrica': 'Resultado total (USD)',         'Valor': +fStats.total.toFixed(2) },
      { 'Métrica': 'Aciertos % (cerradas)',         'Valor': fStats.win },
      { 'Métrica': 'Operaciones ganadas',           'Valor': fStats.nWin },
      { 'Métrica': 'Operaciones perdidas',          'Valor': fStats.nLose },
      { 'Métrica': 'Días promedio hasta ganancia',  'Valor': fStats.daysToWin != null ? +fStats.daysToWin.toFixed(1) : null },
      { 'Métrica': 'Días promedio en posición',     'Valor': fStats.daysAll != null ? +fStats.daysAll.toFixed(1) : null },
      { 'Métrica': 'Operaciones abiertas',          'Valor': fStats.open.length },
      { 'Métrica': 'Operaciones cerradas',          'Valor': fStats.closed.length },
      { 'Métrica': 'Generado',                      'Valor': new Date().toLocaleString('es-MX') },
    ]
    const wb  = XLSX.utils.book_new()
    const ws1 = XLSX.utils.json_to_sheet(ops)
    ws1['!cols'] = Object.keys(ops[0] || {'':''}).map(k => ({ wch: Math.max(k.length + 2, 14) }))
    XLSX.utils.book_append_sheet(wb, ws1, 'Operaciones')
    const ws2 = XLSX.utils.json_to_sheet(resumen)
    ws2['!cols'] = [{ wch: 32 }, { wch: 18 }]
    XLSX.utils.book_append_sheet(wb, ws2, 'Resumen')
    XLSX.writeFile(wb, `rendimiento_${new Date().toISOString().slice(0,10)}.xlsx`)
  }

  const fmtDate = ts => new Date(ts + 'Z').toLocaleDateString('es-MX', { day:'numeric', month:'short' })
  const fmtDT   = ts => new Date(ts + 'Z').toLocaleString('es-MX', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })
  const money   = v => v == null ? '–'
    : `${v < 0 ? '-' : '+'}$${Math.abs(v).toLocaleString('es-MX', { minimumFractionDigits:2, maximumFractionDigits:2 })}`
  const chip = (active) => ({
    padding:'5px 14px', borderRadius:20, fontSize:12, fontWeight:700, cursor:'pointer',
    background: active ? '#3a6396' : '#3e4d6b',
    border: `1px solid ${active ? '#3b82f6' : '#51617f'}`,
    color: active ? '#60a5fa' : '#bac6da',
  })

  return (
    <div style={{ position:'fixed', inset:0, background:'#2b3950', zIndex:150,
      display:'flex', flexDirection:'column', overflow:'hidden' }}>
      {/* Header */}
      <div style={{ background:'#313f58', borderBottom:'1px solid #51617f', padding:'12px 20px',
        display:'flex', justifyContent:'space-between', alignItems:'center', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <Activity size={18} color="#3b82f6"/>
          <span style={{ fontWeight:800, fontSize:16, color:'#f1f5f9' }}>Rendimiento de Señales — Paper Trading</span>
        </div>
        <button onClick={onClose} style={{ background:'#3e4d6b', border:'1px solid #51617f',
          borderRadius:6, padding:'6px 14px', color:'#d4dcea', cursor:'pointer', fontSize:13,
          display:'flex', alignItems:'center', gap:6 }}><X size={14}/> Cerrar</button>
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:20, maxWidth:1100, width:'100%', margin:'0 auto', boxSizing:'border-box' }}>

        {/* Fila 1: capital y resultados */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(170px, 1fr))', gap:10, marginBottom:10 }}>
          <StatBox label="CAPITAL INVERTIDO (abiertas)" value={`$${fStats.capOpen.toLocaleString()}`}
            sub={`${fStats.open.length} posiciones × $${capital.toLocaleString()}`}/>
          <StatBox label="GANANCIA REALIZADA" color={pctC(fStats.realized)}
            value={money(fStats.realized)}
            sub={fStats.realizedPct != null
              ? `${fStats.realizedPct>=0?'+':''}${fmt(fStats.realizedPct)}% sobre $${fStats.capClosed.toLocaleString()} cerrados`
              : 'sin operaciones cerradas aún'}/>
          <StatBox label="GANANCIA NO REALIZADA ⓘ" color={pctC(fStats.unrealized)}
            value={money(fStats.unrealized)}
            sub={fStats.unrealizedPct != null
              ? `${fStats.unrealizedPct>=0?'+':''}${fmt(fStats.unrealizedPct)}% flotante — mide exposición, no éxito` : '–'}/>
          <StatBox label="RESULTADO TOTAL" color={pctC(fStats.total)}
            value={money(fStats.total)}
            sub={fStats.totalPct != null ? `${fStats.totalPct>=0?'+':''}${fmt(fStats.totalPct)}% del capital usado` : '–'}/>
        </div>
        {/* Fila 2: calidad del sistema */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(170px, 1fr))', gap:10, marginBottom:18 }}>
          <StatBox label="ACIERTOS (cerradas)" color={fStats.win == null ? '#f1f5f9' : fStats.win >= 50 ? '#4ade80' : '#f87171'}
            value={fStats.win != null ? `${fStats.win}%` : '–'}
            sub={fStats.closed.length ? `${fStats.nWin} ganadas · ${fStats.nLose} perdidas` : 'aún sin cierres'}/>
          <StatBox label="TIEMPO HASTA LA GANANCIA" value={fStats.daysToWin != null ? `${fmt(fStats.daysToWin,1)} días` : '–'}
            sub="promedio de las ganadoras"/>
          <StatBox label="DÍAS EN POSICIÓN" value={fStats.daysAll != null ? `${fmt(fStats.daysAll,1)} días` : '–'}
            sub="promedio de todas"/>
          <StatBox label="OPERACIONES" value={`${filtered.length}`}
            sub={`${fStats.open.length} abiertas · ${fStats.closed.length} cerradas`}/>
        </div>

        {/* Filters */}
        <div style={{ display:'flex', gap:8, marginBottom:14, flexWrap:'wrap', alignItems:'center' }}>
          <select value={tickerFilter} onChange={e => setTickerFilter(e.target.value)}
            style={{ background:'#3e4d6b', border:'1px solid #51617f', borderRadius:6,
              padding:'6px 10px', color:'#f1f5f9', fontSize:13, outline:'none' }}>
            <option value="ALL">Todas las acciones</option>
            {tickers.map(t => <option key={t} value={t}>{t} — {TICKER_NAMES[t] || t}</option>)}
          </select>
          {[['ALL','Todas'],['open','Abiertas'],['closed','Cerradas']].map(([v,l]) => (
            <button key={v} onClick={() => setStatusFilter(v)} style={chip(statusFilter===v)}>{l}</button>
          ))}
          <span style={{ fontSize:11, color:'#aebbd1', marginLeft:8 }}>Desde</span>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            style={{ background:'#3e4d6b', border:'1px solid #51617f', borderRadius:6,
              padding:'5px 8px', color:'#f1f5f9', fontSize:12, outline:'none', colorScheme:'dark' }}/>
          <span style={{ fontSize:11, color:'#aebbd1' }}>Hasta</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            style={{ background:'#3e4d6b', border:'1px solid #51617f', borderRadius:6,
              padding:'5px 8px', color:'#f1f5f9', fontSize:12, outline:'none', colorScheme:'dark' }}/>
          {(dateFrom || dateTo) && (
            <button onClick={() => { setDateFrom(''); setDateTo('') }} style={chip(false)}>✕ Fechas</button>
          )}
          <button onClick={downloadExcel} style={{ ...chip(false), marginLeft:'auto',
            display:'flex', alignItems:'center', gap:5 }}>⬇ Exportar Excel</button>
        </div>

        {/* Ganancia acumulada (cerradas) */}
        {cumData.length >= 2 && (
          <div style={{ background:'#38465f', border:'1px solid #51617f', borderRadius:10,
            padding:'12px 14px', marginBottom:16 }}>
            <SectionTitle>Ganancia realizada acumulada</SectionTitle>
            <ResponsiveContainer width="100%" height={140}>
              <AreaChart data={cumData} margin={{ top:4, right:8, left:0, bottom:0 }}>
                <defs>
                  <linearGradient id="cumG" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#4ade80" stopOpacity={.4}/>
                    <stop offset="95%" stopColor="#4ade80" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#4d5d7c" strokeDasharray="3 3"/>
                <XAxis dataKey="name" tick={{ fill:'#aebbd1', fontSize:10 }}/>
                <YAxis tick={{ fill:'#aebbd1', fontSize:10 }} tickFormatter={v => `$${v}`}/>
                <Tooltip contentStyle={{ background:'#313f58', border:'1px solid #51617f', borderRadius:6 }}
                  labelStyle={{ color:'#d4dcea' }} formatter={v => [`$${v}`, 'P&L acumulado']}/>
                <ReferenceLine y={0} stroke="#93a2bb"/>
                <Area type="monotone" dataKey="v" stroke="#4ade80" strokeWidth={2} fill="url(#cumG)"/>
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Per-ticker summary (only without ticker filter) */}
        {tickerFilter === 'ALL' && tickers.length > 1 && (
          <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:16 }}>
            {tickers.map(t => {
              const s = per_ticker[t]
              return (
                <div key={t} onClick={() => setTickerFilter(t)} style={{
                  background:'#38465f', border:'1px solid #51617f', borderRadius:8,
                  padding:'8px 12px', cursor:'pointer', minWidth:110 }}>
                  <div style={{ fontWeight:800, fontSize:13, color:'#f1f5f9' }}>{t}</div>
                  <div style={{ fontSize:11, color:pctC(s.total_pnl_usd), fontWeight:700 }}>
                    {s.total_pnl_usd>=0?'+':''}{fmtU(s.total_pnl_usd)}
                  </div>
                  <div style={{ fontSize:10, color:'#aebbd1' }}>{s.trades} trade{s.trades!==1?'s':''}</div>
                </div>
              )
            })}
          </div>
        )}

        {/* Trades table */}
        {!filtered.length ? (
          <div style={{ textAlign:'center', color:'#93a2bb', padding:40, fontSize:14 }}>
            Aún no hay operaciones registradas con este filtro.<br/>
            <span style={{ fontSize:12 }}>Cada señal de COMPRA abre una posición simulada y cada VENTA la cierra.</span>
          </div>
        ) : (
          <div style={{ background:'#38465f', border:'1px solid #51617f', borderRadius:10, overflow:'hidden' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
              <thead>
                <tr style={{ background:'#3e4d6b', color:'#aebbd1', fontSize:11, textTransform:'uppercase', letterSpacing:.5 }}>
                  {['Activo','Estado','Entrada','SL / TP','Salida','Días','Resultado %','Resultado $'].map(h => (
                    <th key={h} style={{ padding:'10px 12px', textAlign:'left', fontWeight:700 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((t, i) => (
                  <tr key={i} onClick={() => { onSelect(t.ticker); onClose() }}
                    style={{ borderTop:'1px solid #4d5d7c', cursor:'pointer' }}
                    onMouseEnter={e => e.currentTarget.style.background='#3e4d6b'}
                    onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                    <td style={{ padding:'9px 12px', fontWeight:800, color:'#f1f5f9' }}>
                      {t.ticker}
                      <span style={{ fontSize:10, color:'#aebbd1', marginLeft:6 }}>{TICKER_NAMES[t.ticker]}</span>
                    </td>
                    <td style={{ padding:'9px 12px' }}>
                      <span style={{ fontSize:11, fontWeight:700, padding:'2px 8px', borderRadius:10,
                        background: t.status==='open' ? '#3a6396' : '#51617f',
                        color: t.status==='open' ? '#60a5fa' : '#d4dcea' }}>
                        {t.status==='open' ? '● Abierta' : 'Cerrada'}
                      </span>
                    </td>
                    <td style={{ padding:'9px 12px', color:'#d4dcea' }}>
                      {fmtU(t.entry_price)}<span style={{ color:'#aebbd1', fontSize:11 }}> · {fmtDT(t.entry_ts)}</span>
                    </td>
                    <td style={{ padding:'9px 12px', fontSize:11 }}>
                      <span style={{ color:'#f87171' }}>{t.stop_loss ? fmtU(t.stop_loss) : '–'}</span>
                      <span style={{ color:'#93a2bb' }}> / </span>
                      <span style={{ color:'#4ade80' }}>{t.take_profit ? fmtU(t.take_profit) : '–'}</span>
                    </td>
                    <td style={{ padding:'9px 12px', color:'#d4dcea' }}>
                      {t.exit_price ? <>
                        {fmtU(t.exit_price)}
                        <span style={{ color:'#aebbd1', fontSize:11 }}>
                          {t.exit_ts ? ` · ${fmtDT(t.exit_ts)}` : ' · actual'}
                        </span>
                        {t.exit_reason && (
                          <span style={{ marginLeft:6, fontSize:10, fontWeight:700, padding:'1px 6px',
                            borderRadius:8,
                            background: t.exit_reason==='take_profit' ? '#175c32'
                              : t.exit_reason==='stop_loss' ? '#702222' : '#51617f',
                            color: t.exit_reason==='take_profit' ? '#4ade80'
                              : t.exit_reason==='stop_loss' ? '#f87171' : '#d4dcea' }}>
                            {t.exit_reason==='take_profit' ? '🎯 TP' : t.exit_reason==='stop_loss' ? '🛑 SL' : 'Señal venta'}
                          </span>
                        )}
                      </> : '–'}
                    </td>
                    <td style={{ padding:'9px 12px', color:'#d4dcea' }}>{fmt(t.days_held,1)}</td>
                    <td style={{ padding:'9px 12px', fontWeight:700, color:pctC(t.pct) }}>
                      {t.pct != null ? `${t.pct>=0?'+':''}${fmt(t.pct)}%` : '–'}
                    </td>
                    <td style={{ padding:'9px 12px', fontWeight:700, color:pctC(t.pnl_usd) }}>
                      {money(t.pnl_usd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p style={{ fontSize:11, color:'#93a2bb', marginTop:14 }}>
          📋 Simulación: cada señal de COMPRA invierte ${(stats.capital_per_trade||1000).toLocaleString()} hipotéticos;
          la señal de VENTA cierra la posición. Las posiciones abiertas se valoran al precio actual.
          Esto es paper trading — ningún dinero real está en juego.
        </p>
      </div>
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
  const [showPerf,     setShowPerf]    = useState(false)
  const [search,       setSearch]      = useState('')
  const [sigFilter,    setSigFilter]   = useState('ALL')
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
      background:'#2b3950', color:'#e2e8f0', overflow:'hidden', fontFamily:'system-ui,sans-serif' }}>

      {/* ══ TOP BAR ══ */}
      <header style={{ background:'#313f58', borderBottom:'1px solid #51617f',
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
                <div style={{ fontSize:10, color:'#aebbd1' }}>PORTAFOLIO</div>
                <div style={{ fontWeight:700, fontSize:14, color:'#f1f5f9' }}>{fmtU(portfolio.total_value)}</div>
              </div>
              <div style={{ textAlign:'right' }}>
                <div style={{ fontSize:10, color:'#aebbd1' }}>P&L</div>
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
            <span style={{ background:'#175c32', border:'1px solid #16a34a', color:'#4ade80',
              padding:'2px 10px', borderRadius:20, fontSize:11, fontWeight:700 }}>🟢 {buyCnt}</span>
            <span style={{ background:'#702222', border:'1px solid #dc2626', color:'#f87171',
              padding:'2px 10px', borderRadius:20, fontSize:11, fontWeight:700 }}>🔴 {sellCnt}</span>
          </div>
          {/* Performance view toggle */}
          <button onClick={() => setShowPerf(true)}
            title="Rendimiento de señales (paper trading)"
            style={{ background:'none', border:'1px solid #51617f',
              borderRadius:6, padding:'4px 10px', color:'#aebbd1', cursor:'pointer',
              display:'flex', alignItems:'center', gap:5, fontSize:11, fontWeight:700 }}>
            <TrendingUp size={14}/> Rendimiento
          </button>
          {/* Heatmap toggle */}
          <button onClick={() => setShowHeatmap(v => !v)}
            title="Heatmap de señales"
            style={{ background: showHeatmap ? '#3a6396' : 'none',
              border:`1px solid ${showHeatmap ? '#3b82f6' : '#51617f'}`,
              borderRadius:6, padding:'4px 8px', color: showHeatmap ? '#60a5fa' : '#aebbd1', cursor:'pointer' }}>
            <Grid size={14}/>
          </button>
          <div style={{ fontSize:10, color:'#93a2bb' }}>
            {lastUpdate ? lastUpdate.toLocaleTimeString('es-MX') : 'Conectando...'}
          </div>
          <button onClick={loadAll} style={{ background:'none', border:'none', color:'#aebbd1', cursor:'pointer' }}>
            <RefreshCw size={14}/>
          </button>
        </div>
      </header>

      <div style={{ display:'flex', flex:1, overflow:'hidden' }}>

        {/* ══ LEFT PANEL ══ */}
        <aside style={{ width:252, background:'#313f58', borderRight:'1px solid #51617f',
          display:'flex', flexDirection:'column', flexShrink:0 }}>
          <div style={{ display:'flex', borderBottom:'1px solid #51617f' }}>
            {[
              { id:'watchlist', icon:<List size={12}/>,      label:'Lista' },
              { id:'portfolio', icon:<Briefcase size={12}/>, label:'Portafolio' },
              { id:'alerts',    icon:<Bell size={12}/>,
                label:`Alertas${activeAlerts.length ? ` (${activeAlerts.length})` : ''}` },
            ].map(t => (
              <button key={t.id} onClick={() => setLeftTab(t.id)} style={{
                flex:1, padding:'9px 0', background:'none', border:'none',
                borderBottom: leftTab===t.id ? '2px solid #3b82f6' : '2px solid transparent',
                color: leftTab===t.id ? '#60a5fa' : '#aebbd1',
                cursor:'pointer', fontSize:11, fontWeight:600,
                display:'flex', alignItems:'center', justifyContent:'center', gap:4
              }}>{t.icon}{t.label}</button>
            ))}
          </div>

          {/* Search + signal filter */}
          {leftTab === 'watchlist' && (
            <div style={{ padding:'8px 8px 4px', borderBottom:'1px solid #4d5d7c' }}>
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="🔍 Buscar acción…"
                style={{ width:'100%', background:'#3e4d6b', border:'1px solid #51617f',
                  borderRadius:6, padding:'6px 9px', color:'#f1f5f9', fontSize:12,
                  outline:'none', boxSizing:'border-box', marginBottom:6 }}/>
              <div style={{ display:'flex', gap:4 }}>
                {[['ALL','Todas','#bac6da'],['BUY','🟢 Comprar','#4ade80'],
                  ['SELL','🔴 Vender','#f87171'],['HOLD','🟡 Mant.','#facc15']].map(([v,l,c]) => (
                  <button key={v} onClick={() => setSigFilter(v)} style={{
                    flex:1, padding:'4px 0', borderRadius:5, fontSize:10, fontWeight:700,
                    cursor:'pointer', whiteSpace:'nowrap',
                    background: sigFilter===v ? '#3a6396' : 'transparent',
                    border:`1px solid ${sigFilter===v ? '#3b82f6' : '#51617f'}`,
                    color: sigFilter===v ? '#60a5fa' : c }}>{l}</button>
                ))}
              </div>
            </div>
          )}

          <div style={{ flex:1, overflowY:'auto', padding:'6px 0' }}>

            {/* WATCHLIST */}
            {leftTab === 'watchlist' && Object.entries(WATCHLIST).map(([group, tickers]) => {
              const q = search.trim().toLowerCase()
              const visible = tickers.filter(t =>
                (!q || t.toLowerCase().includes(q) || (TICKER_NAMES[t]||'').toLowerCase().includes(q)) &&
                (sigFilter === 'ALL' || signals[t]?.signal === sigFilter))
              if (!visible.length) return null
              const sorted = [...visible].sort((a,b) =>
                (SIG_ORDER[signals[a]?.signal]??3) - (SIG_ORDER[signals[b]?.signal]??3))
              return (
                <div key={group}>
                  <div style={{ fontSize:10, color:'#93a2bb', padding:'6px 10px 2px',
                    fontWeight:700, textTransform:'uppercase', letterSpacing:1 }}>{group}</div>
                  {sorted.map(ticker => {
                    const p   = prices[ticker] || {}
                    const sig = signals[ticker]
                    const isSel = ticker === selected
                    return (
                      <div key={ticker} onClick={() => setSelected(ticker)} style={{
                        padding:'7px 10px', cursor:'pointer',
                        background: isSel ? '#3e4d6b' : 'transparent',
                        borderLeft: isSel ? '3px solid #3b82f6' : '3px solid transparent',
                      }}>
                        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                          <div>
                            <span style={{ fontWeight:700, fontSize:12, color:'#f1f5f9' }}>{ticker}</span>
                            {TICKER_NAMES[ticker] && (
                              <span style={{ fontSize:10, color:'#aebbd1', marginLeft:5 }}>{TICKER_NAMES[ticker]}</span>
                            )}
                          </div>
                          {sig && <SignalBadge signal={sig.signal}/>}
                        </div>
                        <div style={{ display:'flex', justifyContent:'space-between', marginTop:1 }}>
                          <span style={{ fontSize:12, color:'#e2e8f0' }}>{p.price ? fmtU(p.price) : '–'}</span>
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
                                  : '#51617f'
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
                  <p style={{ fontSize:12, color:'#93a2bb', textAlign:'center', marginTop:20 }}>Sin posiciones</p>
                )}
                {portfolio?.positions?.map(pos => (
                  <div key={pos.id} style={{ background:'#3e4d6b', borderRadius:6,
                    padding:9, marginBottom:6, border:'1px solid #51617f' }}>
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
                    <div style={{ fontSize:11, color:'#bac6da', marginTop:2 }}>
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
                      <div style={{ fontSize:10, color:'#aebbd1', fontWeight:700, letterSpacing:1,
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
                                style={{ background:'none', border:'none', color:'#aebbd1', cursor:'pointer' }}>
                                <Trash2 size={11}/>
                              </button>
                            </div>
                            {parts.slice(1).map((p,i) => (
                              <div key={i} style={{ fontSize:10, color:'#d4dcea', marginTop:2 }}>{p}</div>
                            ))}
                            <div style={{ fontSize:10, color:'#aebbd1', marginTop:3 }}>
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
                <div style={{ fontSize:10, color:'#aebbd1', fontWeight:700, letterSpacing:1,
                  textTransform:'uppercase', marginBottom:5 }}>💰 Alertas de precio</div>
                <button onClick={() => setShowAddAlert(true)} style={{
                  width:'100%', background:'#51617f', border:'1px solid #93a2bb', borderRadius:6,
                  padding:'7px 0', color:'#d4dcea', fontWeight:600, fontSize:12, cursor:'pointer',
                  display:'flex', alignItems:'center', justifyContent:'center', gap:5, marginBottom:6
                }}><Plus size={13}/> Nueva alerta de precio</button>
                {alerts.filter(a => a.alert_type==='price').map(a => (
                  <div key={a.id} style={{
                    background: a.triggered ? '#1d3a28' : '#3e4d6b',
                    border:`1px solid ${a.triggered?'#166534':'#51617f'}`,
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
                    <div style={{ fontSize:11, color:'#d4dcea', marginTop:2 }}>
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
                  style={{ background:'none', border:'none', color:'#aebbd1', cursor:'pointer' }}>
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
                <span style={{ fontSize:13, color:'#aebbd1' }}>{TICKER_NAMES[selected]}</span>
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
                height:'100%', color:'#93a2bb' }}>Cargando datos...</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top:8, right:12, left:8, bottom:4 }}>
                  <defs>
                    <linearGradient id="pg" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#3b82f6" stopOpacity={.4}/>
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#51617f"/>
                  <XAxis dataKey="date" tick={{ fill:'#aebbd1', fontSize:9 }} interval="preserveStartEnd"/>
                  <YAxis domain={['auto','auto']} tick={{ fill:'#93a2bb', fontSize:10 }}
                    tickFormatter={v=>`$${fmt(v,0)}`} width={60}/>
                  <Tooltip
                    contentStyle={{ background:'#3e4d6b', border:'1px solid #93a2bb', borderRadius:6, fontSize:12 }}
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
              { label:'ATR (14)',    value:fmtU(ind.atr),     color:'#d4dcea' },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ background:'#313f58', border:'1px solid #51617f', borderRadius:6, padding:'7px 10px' }}>
                <div style={{ fontSize:9, color:'#93a2bb', marginBottom:2 }}>{label}</div>
                <div style={{ fontSize:13, fontWeight:700, color }}>{value || '–'}</div>
              </div>
            ))}
          </div>
        </main>

        {/* ══ RIGHT PANEL ══ */}
        <aside style={{ width:240, background:'#313f58', borderLeft:'1px solid #51617f',
          display:'flex', flexDirection:'column', flexShrink:0, overflowY:'auto' }}>

          <div style={{ display:'flex', borderBottom:'1px solid #51617f', flexShrink:0 }}>
            {[
              { id:'signal',  icon:<Activity size={12}/>, label:'Señal' },
              { id:'history', icon:<Clock size={12}/>,    label:'Historial' },
            ].map(t => (
              <button key={t.id} onClick={() => setRightTab(t.id)} style={{
                flex:1, padding:'9px 0', background:'none', border:'none',
                borderBottom: rightTab===t.id ? '2px solid #3b82f6' : '2px solid transparent',
                color: rightTab===t.id ? '#60a5fa' : '#aebbd1',
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
                      <div style={{ background:'#3d2125', border:'1px solid #7f1d1d', borderRadius:6, padding:'8px 10px' }}>
                        <div style={{ display:'flex', alignItems:'center', gap:5, marginBottom:2 }}>
                          <Shield size={12} color="#f87171"/>
                          <span style={{ fontSize:10, color:'#d4dcea', fontWeight:700 }}>STOP LOSS</span>
                        </div>
                        <div style={{ fontSize:14, fontWeight:800, color:'#f87171' }}>
                          {fmtU(selSig.stop_loss_buy)}
                        </div>
                        <div style={{ fontSize:9, color:'#bac6da' }}>
                          −{fmtU(selPrice.price - selSig.stop_loss_buy)}
                          ({fmt((selPrice.price - selSig.stop_loss_buy)/selPrice.price*100)}%)
                        </div>
                      </div>
                      <div style={{ background:'#1d3a28', border:'1px solid #1d6b3c', borderRadius:6, padding:'8px 10px' }}>
                        <div style={{ display:'flex', alignItems:'center', gap:5, marginBottom:2 }}>
                          <Target size={12} color="#4ade80"/>
                          <span style={{ fontSize:10, color:'#d4dcea', fontWeight:700 }}>OBJETIVO (TP)</span>
                        </div>
                        <div style={{ fontSize:14, fontWeight:800, color:'#4ade80' }}>
                          {fmtU(selSig.take_profit_buy)}
                        </div>
                        <div style={{ fontSize:9, color:'#bac6da' }}>
                          +{fmtU(selSig.take_profit_buy - selPrice.price)}
                          ({fmt((selSig.take_profit_buy - selPrice.price)/selPrice.price*100)}%)
                        </div>
                      </div>
                      <div style={{ background:'#3e4d6b', border:'1px solid #51617f', borderRadius:6, padding:'7px 10px' }}>
                        <div style={{ fontSize:9, color:'#bac6da', marginBottom:3 }}>SOPORTE / RESISTENCIA</div>
                        <div style={{ fontSize:11, color:'#d4dcea' }}>
                          Soporte: <span style={{ color:'#4ade80', fontWeight:700 }}>{fmtU(selSig.support)}</span>
                        </div>
                        <div style={{ fontSize:11, color:'#d4dcea' }}>
                          Resistencia: <span style={{ color:'#f87171', fontWeight:700 }}>{fmtU(selSig.resistance)}</span>
                        </div>
                        <div style={{ fontSize:9, color:'#aebbd1', marginTop:3 }}>
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
                    <div style={{ background:'#38465f', border:'1px solid #3a6396',
                      borderRadius:6, padding:'8px 10px' }}>
                      {selSig.missing_buy_conditions.map((r,i) => (
                        <div key={i} style={{ fontSize:11, color:'#d4dcea', marginBottom:3,
                          display:'flex', gap:5, alignItems:'flex-start' }}>
                          <span style={{ color:'#3b82f6', flexShrink:0 }}>○</span><span>{r}</span>
                        </div>
                      ))}
                      <div style={{ fontSize:10, color:'#93a2bb', marginTop:6, borderTop:'1px solid #51617f', paddingTop:5 }}>
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
                      <span style={{ fontSize:12, color:'#d4dcea' }}>{label}</span>
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
                  <div style={{ background:'#38465f', border:'1px solid #3a6396', borderRadius:6,
                    padding:'8px 10px', marginBottom:8 }}>
                    <div style={{ display:'flex', justifyContent:'space-between', padding:'2px 0' }}>
                      <span style={{ fontSize:11, color:'#d4dcea' }}>Señales evaluadas</span>
                      <span style={{ fontSize:11, fontWeight:700, color:'#f1f5f9' }}>{perfStats.evaluated}</span>
                    </div>
                    <div style={{ display:'flex', justifyContent:'space-between', padding:'2px 0' }}>
                      <span style={{ fontSize:11, color:'#d4dcea' }}>Aciertos</span>
                      <span style={{ fontSize:11, fontWeight:700,
                        color: perfStats.win_rate >= 50 ? '#4ade80' : '#f87171' }}>
                        {perfStats.win_rate}%
                      </span>
                    </div>
                    <div style={{ display:'flex', justifyContent:'space-between', padding:'2px 0' }}>
                      <span style={{ fontSize:11, color:'#d4dcea' }}>Promedio por señal</span>
                      <span style={{ fontSize:11, fontWeight:700,
                        color: perfStats.avg_pct >= 0 ? '#4ade80' : '#f87171' }}>
                        {perfStats.avg_pct >= 0 ? '+' : ''}{perfStats.avg_pct}%
                      </span>
                    </div>
                    <div style={{ fontSize:9, color:'#aebbd1', marginTop:4, borderTop:'1px solid #51617f', paddingTop:4 }}>
                      Si hubieras seguido cada señal (paper trading)
                    </div>
                  </div>
                )}
                {!history.length && (
                  <p style={{ fontSize:11, color:'#93a2bb' }}>
                    Sin señales registradas aún. El sistema irá anotando cada señal
                    de COMPRA/VENTA y aquí verás si habría ganado o perdido.
                  </p>
                )}
                {history.map((h,i) => {
                  const cfg = SIGNAL_CFG[h.signal] || SIGNAL_CFG.HOLD
                  return (
                    <div key={i} style={{ background:'#3e4d6b',
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
                      <div style={{ fontSize:11, color:'#bac6da', marginTop:2 }}>
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

      {showPerf && <PerfView onClose={() => setShowPerf(false)} onSelect={setSelected}/>}

      <Toasts toasts={toasts} onDismiss={id => setToasts(prev => prev.filter(t => t.id !== id))}/>

      <style>{`
        @keyframes slideIn { from { opacity:0; transform:translateX(30px) } to { opacity:1; transform:none } }
        ::-webkit-scrollbar { width:4px }
        ::-webkit-scrollbar-track { background:#313f58 }
        ::-webkit-scrollbar-thumb { background:#51617f; border-radius:2px }
        * { box-sizing:border-box }
      `}</style>
    </div>
  )
}
