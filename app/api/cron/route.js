import { after } from "next/server";
import { ensureSchema, getLatestSnapshot, insertSnapshot } from "../../../lib/db";
import { fetchHeadlines, fetchStock, fetchPodcast, fetchTrends } from "../../../lib/anthropic";

export const maxDuration = 300; // seconds — Vercel Hobby's actual ceiling (Fluid Compute)
const TRENDS_TTL_MS = 48 * 60 * 60 * 1000;
const STOCK_TTL_MS = 24 * 60 * 60 * 1000;
const PODCAST_TTL_MS = 24 * 60 * 60 * 1000;

function isAuthorized(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // no secret configured yet (local/dev) — allow
  const auth = request.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

async function runRefresh() {
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

  console.log("Dispatch refresh complete:", {
    snapshotId: snapshot.id,
    stockRefreshed: !stockIsFresh,
    podcastRefreshed: !podcastIsFresh,
    trendsRefreshed: !trendsAreFresh,
  });
}

export async function GET(request) {
  if (!isAuthorized(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  // Respond immediately (well under any external scheduler's timeout, e.g.
  // cron-job.org's free-tier 30s cap) and do the actual work afterward.
  // Since the caller doesn't wait for completion, check Vercel's Runtime
  // Logs (or just the dashboard page a minute later) to confirm success —
  // errors here won't come back as an HTTP error response anymore.
  after(async () => {
    try {
      await runRefresh();
    } catch (err) {
      console.error("Cron job failed:", err);
    }
  });

  return Response.json({ ok: true, message: "Refresh started in background" });
}
