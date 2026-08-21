const baseUrl = process.env.CIVIC_COMPASS_PUBLIC_URL;
if (!baseUrl) throw new Error("CIVIC_COMPASS_PUBLIC_URL is required.");

async function expectOk(path) {
  const response = await fetch(new URL(path, baseUrl), {
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}.`);
  }

  return response;
}

await expectOk("/");
const health = await (await expectOk("/api/health")).json();

if (health?.status !== "ok" || health?.database !== "connected") {
  throw new Error(`Unexpected health response: ${JSON.stringify(health)}`);
}

const articles = await (await expectOk("/api/articles")).json();

if (!Array.isArray(articles?.articles) || articles.articles.length === 0) {
  throw new Error(`Unexpected articles response: ${JSON.stringify(articles)}`);
}

console.log(`Smoke test passed: ${new URL(baseUrl).origin}`);
