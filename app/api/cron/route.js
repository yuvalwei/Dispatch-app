import { ensureSchema, getLatestSnapshot, insertSnapshot } from "../../../lib/db";
import { fetchHeadlines, fetchStock, fetchPodcast, fetchTrends } from "../../../lib/anthropic";

export const maxDuration = 60; // seconds — web search + 4 model calls can take a little while
const TRENDS_TTL_MS = 48 * 60 * 60 * 1000;

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

    const [headlines, stock, podcast, trendsResult] = await Promise.all([
      fetchHeadlines(),
      fetchStock(),
      fetchPodcast(),
      trendsAreFresh ? Promise.resolve(null) : fetchTrends(),
    ]);

    const trends = trendsAreFresh ? previous.trends : trendsResult.trends;
    const trendsCreatedAt = trendsAreFresh ? previous.trends_created_at : new Date();

    const snapshot = await insertSnapshot({
      mainHeadline: headlines.main_headline,
      stories: headlines.stories,
      stock,
      podcast,
      trends,
      trendsCreatedAt,
    });

    return Response.json({
      ok: true,
      snapshotId: snapshot.id,
      trendsRefreshed: !trendsAreFresh,
    });
  } catch (err) {
    console.error("Cron job failed:", err);
    return Response.json({ ok: false, error: String(err.message || err) }, { status: 500 });
  }
}