// ─── Design tokens ────────────────────────────────────────────────────────────
// Capa única de valores visuales. Cambiar el tema = editar aquí, no 300 literales.

// Colores por ROL (no por valor). Tema gris-azulado medio.
export const C = {
  // superficies
  bg:         '#2b3950',  // fondo app
  surface:    '#313f58',  // header, paneles laterales
  card:       '#38465f',  // tarjetas
  card2:      '#3e4d6b',  // inputs, chips inactivos, filas
  border:     '#51617f',  // bordes
  borderSoft: '#4d5d7c',  // divisores suaves

  // texto (de más a menos contraste)
  textHi:     '#f1f5f9',  // títulos
  textBright: '#e2e8f0',
  text:       '#d4dcea',  // cuerpo
  text2:      '#bac6da',  // secundario
  muted:      '#aebbd1',  // tenue
  faint:      '#aebbd1',  // antes #93a2bb — subido por contraste (a11y)

  // marca (azul)
  brand:      '#3b82f6',
  brandLt:    '#60a5fa',
  brandLtr:   '#93c5fd',
  brandBg:    '#3a6396',
  brandStrong:'#1d4ed8',
  purple:     '#6d28d9',
  purpleLt:   '#a78bfa',

  // positivo (verde)
  pos:        '#4ade80',
  posStrong:  '#16a34a',
  posBg:      '#175c32',
  posBgDk:    '#1d3a28',
  posBorder:  '#1d6b3c',
  posBorder2: '#166534',
  posGlow:    '#16a34a33',

  // negativo (rojo)
  neg:        '#f87171',
  negStrong:  '#dc2626',
  negAlt:     '#ef4444',
  negBg:      '#702222',
  negBgDk:    '#3d2125',
  negBorder:  '#7f1d1d',
  negGlow:    '#dc262633',

  // neutro / MANTENER — apagado a propósito: estado neutro, no advertencia
  hold:       '#9aabc4',  // antes dorado #facc15
  holdBorder: '#51617f',  // antes #ca8a04
  holdBg:     '#3e4d6b',  // antes #46400f
  holdGlow:   'rgba(0,0,0,0)',  // sin glow

  // advertencia real (mercado en rojo, VIX, etc.) — sigue siendo ámbar
  warn:       '#fbbf24',
  orange:     '#fb923c',
}

// Escala tipográfica (px)
export const FS = {
  xxs: 10, xs: 11, sm: 12, base: 13, md: 14, lg: 16, xl: 20, xxl: 22,
}

// Radios
export const R = { sm: 6, md: 10, pill: 20 }

// Sombra de modal/overlay
export const SH = { overlay: 'rgba(0,0,0,.75)' }
