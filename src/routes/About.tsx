/** /about — placeholder; full editorial page lands in Phase 2. */
export default function About() {
  return (
    <main style={{ 'min-height': '100svh', display: 'grid', 'place-items': 'center', padding: '2rem' }}>
      <div style={{ 'max-width': '60ch' }}>
        <h1 style={{ 'font-size': '2.5rem', margin: '0 0 1rem' }}>About Ruri</h1>
        <p style={{ color: 'var(--text-dim)', 'line-height': 1.6 }}>
          Ruri (瑠璃) is the web client for the Orochi network. A full story page
          lands in Phase 2. <a style={{ color: 'var(--accent)' }} href="/">Back home</a>.
        </p>
      </div>
    </main>
  );
}
