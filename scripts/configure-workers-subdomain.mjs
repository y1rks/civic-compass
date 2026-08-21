const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
const subdomain = process.env.CLOUDFLARE_WORKERS_SUBDOMAIN;

for (const [name, value] of [
  ["CLOUDFLARE_ACCOUNT_ID", accountId],
  ["CLOUDFLARE_API_TOKEN", apiToken],
  ["CLOUDFLARE_WORKERS_SUBDOMAIN", subdomain],
]) {
  if (!value) throw new Error(`${name} is required.`);
}

const subdomainPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
if (!subdomainPattern.test(subdomain)) {
  throw new Error("CLOUDFLARE_WORKERS_SUBDOMAIN must be a lowercase DNS label.");
}

const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/workers/subdomain`;
const headers = {
  Authorization: `Bearer ${apiToken}`,
  "Content-Type": "application/json",
};

async function cloudflareRequest(method, body) {
  const response = await fetch(endpoint, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json();

  if (!response.ok || !payload.success) {
    const messages = payload.errors?.map((error) => error.message).join("; ");
    throw new Error(`Cloudflare Workers subdomain request failed: ${messages || response.status}`);
  }

  return payload.result;
}

const current = await cloudflareRequest("GET");
if (current.subdomain === subdomain) {
  console.log(`workers.dev subdomain is already ${subdomain}.`);
} else {
  await cloudflareRequest("PUT", { subdomain });
  console.log(`workers.dev subdomain updated: ${current.subdomain} -> ${subdomain}`);
}
