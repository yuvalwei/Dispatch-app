import { ensureSchema, getLatestSnapshot } from "../lib/db";

export const dynamic = "force-dynamic"; // always read fresh from the DB, never statically cache

function fmt(dt) {
  return new Date(dt).toLocaleString("en-GB", {
    weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
    timeZone: "Asia/Jerusalem",
  });
}
function hoursAgo(dt) {
  return Math.max(0, Math.round((Date.now() - new Date(dt).getTime()) / 3600000));
}
function relativeTime(iso) {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (isNaN(then)) return null;
  const diffMin = Math.round((Date.now() - then) / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.round(diffH / 24);
  return `${diffD}d ago`;
}

export default async function Page() {
  let snapshot = null;
  let loadError = null;
  try {
    await ensureSchema();
    snapshot = await getLatestSnapshot();
  } catch (err) {
    loadError = String(err.message || err);
  }

  return (
    <>
      <header>
        <div>
          <div className="wordmark">DISPATCH<span>.</span></div>
          <div className="subtag">Tel Aviv &amp; The World / Markets &amp; Power</div>
        </div>
        <div style={{textAlign: "right"}}>
          <span id="datetime" className="mono">{fmt(new Date())}</span>
          <div className="subtag" style={{marginTop: 2}}>Tel Aviv time</div>
        </div>
      </header>

      <main>
        {loadError && (
          <div className="empty-state">
            Couldn't reach the database: {loadError}. Check DATABASE_URL in your environment variables.
          </div>
        )}

        {!loadError && !snapshot && (
          <div className="empty-state">
            No dispatch yet. The daily cron job (see /api/cron) hasn't run for the first time —
            trigger it once manually to populate the dashboard.
          </div>
        )}

        {snapshot && (
          <>
            <section className="hero">
              <div className="section-header">
                <div className="eyebrow">Lead Story</div>
                <span className="stale-badge">updated {hoursAgo(snapshot.created_at)}h ago</span>
              </div>
              <h1>{snapshot.main_headline.title}</h1>
              <p>{snapshot.main_headline.dek}</p>
              <div className="src-line">
                {snapshot.main_headline.category} · {snapshot.main_headline.source}
                {relativeTime(snapshot.main_headline.published_at) ? " · " + relativeTime(snapshot.main_headline.published_at) : ""}
              </div>
              <br />
              <a className="readlink" href={snapshot.main_headline.url} target="_blank" rel="noopener noreferrer">
                Read the full story →
              </a>
            </section>

            {snapshot.world_stories && snapshot.world_stories.length > 0 && (
              <section>
                <div className="section-header">
                  <div className="eyebrow">World Desk</div>
                  <span className="stale-badge">updated {hoursAgo(snapshot.created_at)}h ago</span>
                </div>
                <div className="stories">
                  {snapshot.world_stories.map((s, i) => (
                    <div className="story" key={i}>
                      <div className="story-num mono">W{i + 1}</div>
                      <div>
                        <h3>{s.title}</h3>
                        <p>{s.one_liner}</p>
                        <div className="src-line">
                          {s.category ? s.category + " · " : ""}{s.source}
                          {relativeTime(s.published_at) ? " · " + relativeTime(s.published_at) : ""}
                        </div>
                        <a className="readlink" href={s.url} target="_blank" rel="noopener noreferrer">Read →</a>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section>
              <div className="section-header">
                <div className="eyebrow">Five Dispatches</div>
                <span className="stale-badge">updated {hoursAgo(snapshot.created_at)}h ago</span>
              </div>
              <div className="stories">
                {snapshot.stories.map((s, i) => (
                  <div className="story" key={i}>
                    <div className="story-num mono">0{i + 1}</div>
                    <div>
                      <h3>{s.title}</h3>
                      <p>{s.one_liner}</p>
                      <div className="src-line">
                        {s.category ? s.category + " · " : ""}{s.source}
                        {relativeTime(s.published_at) ? " · " + relativeTime(s.published_at) : ""}
                      </div>
                      <a className="readlink" href={s.url} target="_blank" rel="noopener noreferrer">Read →</a>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <div className="split">
              <div className="card">
                <div className="tag-row">
                  <span className="tag">Featured Position</span>
                  <span className="stale-badge">updated {hoursAgo(snapshot.created_at)}h ago</span>
                </div>
                <div className="ticker-symbol">{snapshot.stock.ticker}{snapshot.stock.exchange ? ` · ${snapshot.stock.exchange}` : ""}</div>
                <h3>{snapshot.stock.headline}</h3>
                <div className="meta">{snapshot.stock.company} · via {snapshot.stock.magazine_source}</div>
                <p>{snapshot.stock.summary}</p>
                <a className="readlink" href={snapshot.stock.url} target="_blank" rel="noopener noreferrer">Read the analysis →</a>
              </div>
              <div className="card">
                <div className="tag-row">
                  <span className="tag">Worth Listening</span>
                  <span className="stale-badge">updated {hoursAgo(snapshot.created_at)}h ago</span>
                </div>
                <h3>{snapshot.podcast.name}</h3>
                <div className="meta">{snapshot.podcast.network} · &quot;{snapshot.podcast.episode_title}&quot;</div>
                <p>{snapshot.podcast.summary}</p>
                <a className="readlink" href={snapshot.podcast.url} target="_blank" rel="noopener noreferrer">Listen →</a>
              </div>
            </div>

            <section>
              <div className="section-header">
                <div className="eyebrow">Signal Check</div>
                <span className="stale-badge">updated {hoursAgo(snapshot.trends_created_at)}h ago · refreshes every 48h</span>
              </div>
              {snapshot.trends.map((t, i) => (
                <div className="trend" key={i}>
                  <h4>{t.title}</h4>
                  <p>{t.description}</p>
                </div>
              ))}
            </section>
          </>
        )}
      </main>

      <footer>
        DISPATCH — compiled from Reuters, WSJ, Bloomberg, Haaretz, Ynet, Calcalist, Globes &amp; other primary sources · not financial advice
      </footer>
    </>
  );
}
