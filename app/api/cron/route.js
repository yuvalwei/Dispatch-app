import { ensureSchema, getLatestSnapshot, insertSnapshot } from "../../../lib/db";
import { fetchHeadlines, fetchStock, fetchPodcast, fetchTrends } from "../../../lib/anthropic";

export const maxDuration = 300; // seconds — Vercel Hobby's actual ceiling (Fluid Compute); web search + several model calls in parallel needs real headroom
const TRENDS_TTL_MS = 48 * 60 * 60 * 1000;
const STOCK_TTL_MS = 24 * 60 * 60 * 1000;
const PODCAST_TTL_MS = 24 * 60 * 60 * 1000;

function isAuthorized(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // no secret configured yet (local/dev) — allow
  const auth = request.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

export async function GET(request) {
  if (!isAuthorized(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    await ensureSchema();

    const previous = await getLatestSnapshot();
    const trendsAreFresh =
      previous && Date.now() - new Date(previous.trends_created_at).getTime() < TRENDS_TTL_MS;
    const stockIsFresh =
      previous && Date.now() - new Date(previous.stock_created_at).getTime() < STOCK_TTL_MS;
    const podcastIsFresh =
      previous && Date.now() - new Date(previous.podcast_created_at).getTime() < PODCAST_TTL_MS;

    // Headlines/world desk/dispatches always refresh — that's the whole point
    // of pulling more often. Stock/podcast/trends only refetch once their
    // own TTL has actually expired, regardless of how often this route runs.
    const [headlines, stockResult, podcastResult, trendsResult] = await Promise.all([
      fetchHeadlines(),
      stockIsFresh ? Promise.resolve(null) : fetchStock(),
      podcastIsFresh ? Promise.resolve(null) : fetchPodcast(),
      trendsAreFresh ? Promise.resolve(null) : fetchTrends(),
    ]);

    const stock = stockIsFresh ? previous.stock : stockResult;
    const stockCreatedAt = stockIsFresh ? previous.stock_created_at : new Date();
    const podcast = podcastIsFresh ? previous.podcast : podcastResult;
    const podcastCreatedAt = podcastIsFresh ? previous.podcast_created_at : new Date();
    const trends = trendsAreFresh ? previous.trends : trendsResult.trends;
    const trendsCreatedAt = trendsAreFresh ? previous.trends_created_at : new Date();

    const snapshot = await insertSnapshot({
      mainHeadline: headlines.main_headline,
      worldStories: headlines.world_stories,
      stories: headlines.stories,
      stock,
      stockCreatedAt,
      podcast,
      podcastCreatedAt,
      trends,
      trendsCreatedAt,
    });

    return Response.json({
      ok: true,
      snapshotId: snapshot.id,
      refreshed: {
        headlines: true,
        stock: !stockIsFresh,
        podcast: !podcastIsFresh,
        trends: !trendsAreFresh,
      },
    });
  } catch (err) {
    console.error("Cron job failed:", err);
    return Response.json({ ok: false, error: String(err.message || err) }, { status: 500 });
  }
}
