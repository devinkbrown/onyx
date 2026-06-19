/** /app — placeholder shell; the real chat surface lands in Phase 3.
 *  For now it confirms routing + tokens render under the obsidian theme. */
export default function AppRoute() {
  return (
    <main style={{ 'min-height': '100svh', display: 'grid', 'place-items': 'center', padding: '2rem' }}>
      <div style={{ 'text-align': 'center' }}>
        <h1 style={{ 'font-size': '2rem', margin: '0 0 0.5rem' }}>Ruri app shell</h1>
        <p style={{ color: 'var(--text-dim)' }}>Phase 3 — chat surface coming online.</p>
        <a style={{ color: 'var(--accent)' }} href="/">Back home</a>
      </div>
    </main>
  );
}
