export function ChallengesScreen() {
  return (
    <>
      <section className="panel stack">
        <h2 style={{ fontSize: 20 }}>Challenges</h2>
        <div className="small muted">Solo Bosses are a separate, permanent tier ladder. They are not part of this test build.</div>
      </section>
      <section className="panel stack" style={{ opacity: 0.7 }}>
        <div className="row spread">
          <div className="panel-title">Ashen King</div>
          <span className="tag">Coming later</span>
        </div>
        <div className="small muted">Finite tier ladder · unlocks and upgrades an Artifact.</div>
      </section>
      <section className="panel stack" style={{ opacity: 0.7 }}>
        <div className="row spread">
          <div className="panel-title">Seasons</div>
          <span className="tag">Future</span>
        </div>
        <div className="small muted">Season Boss, Season Rule and Season Relic. Only the Season Relic resets.</div>
      </section>
    </>
  );
}
