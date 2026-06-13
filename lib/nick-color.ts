// Deterministic nick color from username hash
export function getNickColor(nick: string): string {
  // Normalize case so the same user always maps to the same color. Orochi uses
  // ascii CASEMAPPING, so a plain lowercase fold matches the server's identity.
  const key = nick.toLowerCase();
  // Hash the nick to pick from a palette of 12 readable colors
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = key.charCodeAt(i) + ((hash << 5) - hash);
  }
  const NICK_COLORS = [
    '#60a5fa', // blue
    '#34d399', // emerald
    '#a78bfa', // violet
    '#f472b6', // pink
    '#fb923c', // orange
    '#facc15', // yellow
    '#38bdf8', // sky
    '#4ade80', // green
    '#e879f9', // fuchsia
    '#f87171', // red
    '#2dd4bf', // teal
    '#c084fc', // purple
  ];
  return NICK_COLORS[Math.abs(hash) % NICK_COLORS.length];
}
