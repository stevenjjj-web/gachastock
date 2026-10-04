// Proxy for Jupiter swap instructions. The API key stays on the server and never reaches the browser.

const JUP = "https://api.jup.ag/swap/v1";
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export async function POST(req: Request) {
  const { inputMint, outputMint, amount, userPublicKey } = await req.json();
  if (![inputMint, outputMint, userPublicKey].every((x) => typeof x === "string" && BASE58.test(x)))
    return Response.json({ error: "bad address" }, { status: 400 });
  if (!Number.isSafeInteger(amount) || amount <= 0) return Response.json({ error: "bad amount" }, { status: 400 });

  const headers: Record<string, string> = { "content-type": "application/json" };
  if (process.env.JUP_API_KEY) headers["x-api-key"] = process.env.JUP_API_KEY;

  const platformFeeBps = process.env.JUP_PLATFORM_FEE_BPS;
  const feeAccount = process.env.JUP_FEE_ACCOUNT;
  const q = new URLSearchParams({
    inputMint,
    outputMint,
    amount: String(amount),
    slippageBps: process.env.JUP_SLIPPAGE_BPS ?? "100",
  });
  if (platformFeeBps && feeAccount) q.set("platformFeeBps", platformFeeBps);

  const quote = await fetch(`${JUP}/quote?${q}`, { headers });
  if (!quote.ok) return Response.json({ error: "quote failed" }, { status: 502 });
  const quoteResponse = await quote.json();

  const swap = await fetch(`${JUP}/swap-instructions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      quoteResponse,
      userPublicKey,
      ...(platformFeeBps && feeAccount ? { feeAccount } : {}),
    }),
  });
  if (!swap.ok) return Response.json({ error: "swap build failed" }, { status: 502 });
  return Response.json(await swap.json());
}
