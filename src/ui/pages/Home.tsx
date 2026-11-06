import { navigate } from '../router'
import { Shell } from '../components'

export function Home() {
  return (
    <Shell title="VTTRPG">
      <p className="muted">A 3D tabletop for any ruleset. No accounts, no servers.</p>
      <div className="row">
        <button className="primary" onClick={() => navigate('/new')}>New game</button>
        <button onClick={() => {
          const link = prompt('Paste an invite link')
          if (link) window.location.href = link
        }}>Join with a link</button>
      </div>
      <p className="muted small">Dev stories: <a href="#/dev/table">table</a> · <a href="#/dev/dice">dice</a> · <a href="#/dev/net">net</a></p>
    </Shell>
  )
}
