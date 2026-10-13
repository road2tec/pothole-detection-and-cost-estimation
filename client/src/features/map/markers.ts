import L from 'leaflet';

const COLORS: Record<string, string> = { minor: '#4d7c0f', moderate: '#b45309', severe: '#b42318' };
// Letter inside the marker so severity is never conveyed by colour alone.
const LETTER: Record<string, string> = { minor: 'm', moderate: 'M', severe: 'S' };

const cache = new Map<string, L.DivIcon>();

export function severityIcon(severity?: string | null, repaired = false): L.DivIcon {
  const key = `${severity ?? 'none'}-${repaired}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const color = repaired ? '#6b7178' : (severity && COLORS[severity]) || '#57534e';
  const letter = repaired ? '✓' : (severity && LETTER[severity]) || '?';
  const icon = L.divIcon({
    className: '',
    iconSize: [26, 34],
    iconAnchor: [13, 33],
    popupAnchor: [0, -30],
    html: `<svg width="26" height="34" viewBox="0 0 26 34" aria-hidden="true"><path d="M13 33s11-11.2 11-19.5C24 6.6 19.1 2 13 2S2 6.6 2 13.5C2 21.8 13 33 13 33z" fill="${color}" stroke="#fff" stroke-width="2"/><text x="13" y="17.5" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-size="11" font-weight="700" fill="#fff">${letter}</text></svg>`,
  });
  cache.set(key, icon);
  return icon;
}

export function clusterIcon(cluster: { getChildCount: () => number }) {
  const n = cluster.getChildCount();
  const size = n < 10 ? 32 : n < 100 ? 38 : 44;
  return L.divIcon({ html: `<div class="marker-cluster-custom" style="width:${size}px;height:${size}px">${n}</div>`, className: '', iconSize: [size, size] });
}
