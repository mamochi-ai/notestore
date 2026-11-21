// Six themes. Shelf PNG geometry (baseline) was measured from the kit images:
// the back-wall / shelf-top junction and the front edge were detected per image,
// and the book baseline is placed ~60% into the shelf-top depth so books stand on it.
// (kit themes.json initial values: warm .88 library .85 abandoned .87 overseas .86 luxury .87 future .86)

export const THEMES = [
  {
    id: 'warm', name: '小さな本屋', blurb: 'あたたかい木の棚と、やわらかな光',
    img: 'assets/themes/warm.jpg', thumb: 'assets/themes/warm-thumb.jpg',
    imgW: 1536, imgH: 1024, baseline: 0.884, frontEdge: 0.916,
    dark: false,
    ui: { bg: '#f3ead9', paper: '#fbf6ea', panel: '#fbf7ee', ink: '#3a3128', sub: '#7a6a55', accent: '#3f523b', accentInk: '#fbf6ea', line: '#dccfb4', chip: '#efe5d1', frame: '#8a5a2e' },
    books: ['#3f5a44', '#b45f43', '#2e4566', '#e8dfc9', '#75856d', '#c9b691', '#8c4a3c', '#dcd2bd', '#55606e', '#a3b09a', '#efe8d8', '#6c7d5f'],
    material: 'cloth', foil: null, pop: 'paper', motifInk: null,
  },
  {
    id: 'library', name: '暗めの図書館', blurb: '静かなランプと、深い色の革表紙',
    img: 'assets/themes/library.jpg', thumb: 'assets/themes/library-thumb.jpg',
    imgW: 1536, imgH: 1024, baseline: 0.838, frontEdge: 0.867,
    dark: true,
    ui: { bg: '#15110d', paper: '#211a14', panel: '#1d1712', ink: '#f1e5c9', sub: '#bba984', accent: '#d2ad68', accentInk: '#1a140f', line: '#3f3327', chip: '#2a2119', frame: '#2a1a10' },
    books: ['#2f4a37', '#6e2f26', '#24324a', '#4a3a28', '#7a5a2c', '#1f2a22', '#5a2a2a', '#3b3a33', '#d9c9a3', '#3a2c22'],
    material: 'leather', foil: '#d8b86e', pop: 'dark', motifInk: '#d8b86e',
  },
  {
    id: 'abandoned', name: '廃屋', blurb: '崩れた壁と、時間を吸った本',
    img: 'assets/themes/abandoned.jpg', thumb: 'assets/themes/abandoned-thumb.jpg',
    imgW: 1536, imgH: 1024, baseline: 0.862, frontEdge: 0.89,
    dark: false,
    ui: { bg: '#dcd9d0', paper: '#ebe8e0', panel: '#eeebe4', ink: '#2e302b', sub: '#686a62', accent: '#4b5446', accentInk: '#f1efe8', line: '#c2beb2', chip: '#e2dfd6', frame: '#77736a' },
    books: ['#7d8072', '#9c8c7c', '#5d6457', '#bdb5a3', '#6f5a4c', '#8b9188', '#d6d0c0', '#4f4a44', '#a39176', '#6a7468'],
    material: 'worn', foil: null, pop: 'paper', motifInk: null,
  },
  {
    id: 'overseas', name: '海外の書店', blurb: 'パリの路地にある、青い木の書店',
    img: 'assets/themes/overseas.jpg', thumb: 'assets/themes/overseas-thumb.jpg',
    imgW: 1536, imgH: 1024, baseline: 0.856, frontEdge: 0.882,
    dark: false,
    ui: { bg: '#ece4d3', paper: '#f7f1e4', panel: '#f8f3e8', ink: '#28302e', sub: '#655f52', accent: '#1e5555', accentInk: '#f7f1e4', line: '#d5c9ae', chip: '#e7dec9', frame: '#1e4545' },
    books: ['#8f2f2c', '#e9dfc8', '#273a5c', '#a8423a', '#d8c9a5', '#3c5a3c', '#6e2430', '#efe7d4', '#2c4a4a', '#b9874f'],
    material: 'cloth', foil: '#c9a86a', pop: 'paper', motifInk: null,
  },
  {
    id: 'luxury', name: '高級書斎', blurb: '真鍮の光と、上質な革装',
    img: 'assets/themes/luxury.jpg', thumb: 'assets/themes/luxury-thumb.jpg',
    imgW: 1536, imgH: 1024, baseline: 0.866, frontEdge: 0.889,
    dark: true,
    ui: { bg: '#13100d', paper: '#1f1a15', panel: '#1b1612', ink: '#f2e7cd', sub: '#bba87d', accent: '#d8bb7f', accentInk: '#191613', line: '#3b3128', chip: '#28211b', frame: '#1c1410' },
    books: ['#1d1b1a', '#5a1f22', '#e6dcc5', '#2b2826', '#3a2a22', '#6f2f33', '#d3c6a6', '#22303a', '#14211b', '#efe6d0'],
    material: 'leather', foil: '#d8bb7f', pop: 'dark', motifInk: '#d8bb7f',
  },
  {
    id: 'future', name: '近未来', blurb: '金属の棚と、静かな光のライン',
    img: 'assets/themes/future.jpg', thumb: 'assets/themes/future-thumb.jpg',
    imgW: 1536, imgH: 1024, baseline: 0.855, frontEdge: 0.876,
    dark: true,
    ui: { bg: '#0e1720', paper: '#152230', panel: '#132029', ink: '#e4f1f6', sub: '#93b2c1', accent: '#7fdce8', accentInk: '#0d1820', line: '#264050', chip: '#1a2c38', frame: '#1b2730' },
    books: ['#e9eef2', '#c9d3da', '#2a3a4c', '#1b2733', '#9fb0bd', '#f4f6f8', '#3c5168', '#d8e1e7', '#11181f', '#b7c4ce'],
    material: 'matte', foil: '#7fdce8', pop: 'dark', motifInk: '#7fdce8',
  },
];

export const THEME_MAP = Object.fromEntries(THEMES.map((t) => [t.id, t]));
export const getTheme = (id) => THEME_MAP[id] || THEMES[0];

export const MATERIALS = [
  { id: 'cloth', name: '布' },
  { id: 'paper', name: '紙' },
  { id: 'leather', name: '革' },
  { id: 'worn', name: '古紙' },
  { id: 'matte', name: 'マット' },
];

/** Relative luminance of a hex color (0..1). */
export function luminance(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return 0.5;
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** Ink color for text printed on a book of color `bg` in theme `t`. */
export function contrast(a, b) {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
/** Ink for text printed on a book of colour `bg`: whichever ink reads best (foil only when legible). */
export function inkFor(bg, t) {
  const dark = t.id === 'future' ? '#1d2c3a' : '#33291f';
  const light = t.id === 'future' ? '#e8f8fc' : '#f8efd8';
  if (t.foil && t.material === 'leather' && contrast(t.foil, bg) >= 4) return t.foil;
  return contrast(dark, bg) >= contrast(light, bg) ? dark : light;
}

export function applyThemeVars(t, root = document.documentElement) {
  const u = t.ui;
  const s = root.style;
  s.setProperty('--bg', u.bg); s.setProperty('--paper', u.paper); s.setProperty('--panel', u.panel);
  s.setProperty('--ink', u.ink); s.setProperty('--sub', u.sub); s.setProperty('--accent', u.accent);
  s.setProperty('--accent-ink', u.accentInk); s.setProperty('--line', u.line); s.setProperty('--chip', u.chip);
  s.setProperty('--frame', u.frame);
  root.dataset.theme = t.id;
  root.dataset.dark = t.dark ? '1' : '0';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', u.bg);
}
