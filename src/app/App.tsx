import { PlatformSpikePage } from '../features/platform/PlatformSpikePage'

export function App() {
  const spikeEnabled = new URLSearchParams(window.location.search).get('spike') === '1'

  if (spikeEnabled) {
    return <PlatformSpikePage />
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <p className="eyebrow">Private diary</p>
        <h1>Headache diary</h1>
      </header>

      <main className="app-main">
        <section className="empty-card" aria-labelledby="empty-card-title">
          <p className="empty-card__mark" aria-hidden="true">
            ·
          </p>
          <h2 id="empty-card-title">Nothing recorded yet.</h2>
          <p>Your diary stays on this iPhone. We’ll keep the details ready for the next step.</p>
        </section>
      </main>
    </div>
  )
}
