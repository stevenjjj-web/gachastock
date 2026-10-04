# GachaStock

A blind-box protocol for tokenized US stocks on Solana: 10 USDC a box, a guaranteed $5 floor, and a jackpot worth half the prize pool. Tickets only, never the house.

```
programs/kaigu-gacha   Anchor program (draws settle in a MagicBlock VRF callback)
web                    Next.js frontend (demo mode by default)
```

## What you can do

- **Machines.** The platform is a set of gacha machines. Each one has its own theme, stock basket and prize pool, and opens packs instantly: 10 USDC a pack, a guaranteed 5 USDC floor, seven tiers, and a jackpot worth half that machine's pool. Turbo mode opens ten packs with one random draw.
- **Jackpot threshold.** The jackpot only pays while a machine's pool is at least 4,000 USDC, so a jackpot is never smaller than 2,000 USDC. Below the threshold a jackpot roll pays the best fixed tier the pool can afford.
- **Launchpad and machine coins.** Anyone can launch a machine for a 10 USDC fee, choosing its name, ticker, art and a stock basket from the whitelist. The machine's coin sells on a bonding curve; when the curve has raised 5,000 USDC the machine graduates: 4,000 USDC seeds its prize pool (so the jackpot is live from the first pull) and the rest backs a trading pool for the coin. A curve that does not fill in 7 days fails, and holders sell back along the curve with no fee.
- **Fee split.** Official machines send the whole 8% fee to the protocol. Launchpad machines split it: 5% protocol, 2% buys back and burns the machine coin, 1% to the creator.
- **Leaderboard.** The Machines page ranks every machine by volume and shows its prize pool, jackpot status, buybacks, burned coins and coin price.

## Frontend

```bash
cd web && npm install && npm run dev
```

Dark, app-style layout with four pages: **Gacha** (`/`, pick a machine, open packs, trade its coin), **Machines** (`/machines`, the leaderboard), **Launchpad** (`/launch`) and **Inventory** (`/inventory`).

Without `NEXT_PUBLIC_PROGRAM_ID` the app runs in **demo mode**: draws happen in the browser with the same rules as the program, state lives in localStorage, and no real funds are involved. The machines, their stats and the recent openings you see on first load are seeded sample data.
Fill in `web/.env.example` (or uncomment the program id in `web/.env.local`) to switch to chain mode.

The public devnet RPC rate-limits aggressively. Chain mode batches its reads, but for anything beyond a quick test point `NEXT_PUBLIC_RPC_URL` at a dedicated endpoint.

The UI is English by default. The language menu in the top-right corner switches between English, Chinese, Japanese, Korean, Thai, Spanish, Portuguese, French, German, Vietnamese and Indonesian. Strings live in `web/lib/locales/`; `en.ts` defines the keys and every other locale must provide all of them.

## Program

Toolchain: Anchor 0.31.1, Solana CLI 4.x, `ephemeral-vrf-sdk` 0.17.3 (`anchor-compat`). The rustup `cargo` must come first on `PATH`.

```bash
export PATH="$HOME/.cargo/bin:$PATH"
cargo test -p kaigu-gacha --release -- --nocapture   # unit tests + 500k-pull × 4-seed economic simulation
anchor build
anchor deploy --provider.cluster devnet
cd web && USDC_MINT=<test USDC mint> npx tsx scripts/init-season.ts   # season + the official machines
```

| Instruction | Caller | What it does |
| --- | --- | --- |
| `initialize` | upgrade authority | Creates Config |
| `create_season` | admin | Publishes immutable economic parameters and the stock whitelist |
| `create_machine` | admin | Creates an official machine, open immediately |
| `launch_machine` | anyone | Launchpad: creates a machine, its coin mint and its curve for a 10 USDC fee |
| `coin_buy` | user | Buys the machine coin: on the curve before graduation (the buy that sells the last curve coin graduates the machine), against the pool after |
| `coin_sell` | holder | Sells the machine coin; a curve past its deadline is marked failed and sells back with no fee |
| `crank_buyback` | anyone | Spends accrued buyback fees on the coin and burns what it buys, capped per call |
| `buy_packs` | user | Takes payment as pending on a machine, creates the pack, requests VRF randomness |
| `callback_open` | VRF identity only | Splits funds, rolls tiers, applies pity, the jackpot threshold and the cap; ledger only |
| `claim` | pack owner | Pays out USDC minus the 1% settlement fee and closes the Pack |
| `refund_timeout` | pack owner | Full refund when no callback arrives within `timeout_slots` |
| `withdraw_fees` | anyone | Sends a machine's protocol fees to the treasury and the creator's share to the creator |
| `set_paused` | admin | Pauses purchases, launches and coin buys; claims, refunds and coin sells keep working |

The design doc names `curve_buy` / `curve_sell` / `graduate` / `refund_failed` / `withdraw_creator` separately. Here `coin_buy` and `coin_sell` cover the curve, graduation, the failed-launch exit and post-graduation trading, and `withdraw_fees` pays the creator.

The doc also has graduation create a pool on an external DEX. That integration is not built: the post-graduation pool is a constant-product pool **inside this program**, opened at the curve's final price. Coins in the pool are minted only when someone buys them, so a buyback burns by taking coins out of the pool that never enter circulation.

Anti-sniping rules on the curve: for the first 150 slots after launch a single purchase is capped at 100 USDC, and the creator can hold at most 5% of the curve allocation. Both can be sidestepped with more wallets.

Every machine has its own USDC account and ledger, and every instruction that moves funds ends by asserting that the balance covers the ledger: `pending + prize_pool + locked + protocol_fees + buyback_accrued + creator_accrued + market_usdc`.

## Devnet deployment

| | Address |
| --- | --- |
| Program | `7VAfdZyRRWCvLdPUpqYbeuSsvtQW4cp2PeVQvkAtBHHv` |
| Test USDC mint | `BsVdbtxGsuqHduBg4YwMSdkZfpWg5AHMvmhWXVSf2ne6` |
| Upgrade authority / admin | `2kafrqsmhB3yrEqhRxJRw3BBH1uL1XYvdupq2p6HZYNb` |

Season 1 is live with the default parameters, with three official machines (ids 0 to 2: Index, Tech, Trending). Their pools started at zero. Machine 3 is a launchpad machine left over from the browser test. Accounts created by earlier program versions (season 0, the old shared vault, limited drops) are orphaned and no longer readable.

`web/.env.local` points the frontend at this deployment, and the
`+ Test USDC` button mints 500 test USDC to the connected wallet (devnet only, via `web/app/api/faucet`).
Throwaway devnet keys (faucet / mint authority, e2e wallet) live in `.keys/`, which is gitignored.

## Tests

```bash
cargo test -p kaigu-gacha --release          # draw logic + economic simulation
cd tests && npm install
npm test                                     # LiteSVM: full program flow against the real MagicBlock VRF program
npx tsx devnet-smoke.ts 10 0                 # devnet: buy on machine 0 → live VRF callback → claim
node browser-e2e.mjs                         # devnet, in headless Chrome: connect, faucet, open, claim
node browser-e2e.mjs --launch                # also launch a machine, graduate it, play it, buy back, sell, withdraw
node browser-e2e.mjs --inventory             # claim whatever is waiting in Inventory
node shots.mjs http://localhost:3210         # screenshot tour (needs the app in demo mode)
```

`tests/fixtures` holds the VRF program and oracle queue account dumped from devnet. The LiteSVM test runs with
signature verification off so it can play the oracle and sign the callback as the VRF identity.

## Not done / not verified

- The post-graduation pool lives in this program, not on a DEX; no Raydium or Meteora integration exists. Machine coins have no on-chain token metadata.
- On devnet the failed-launch path and `refund_timeout` are only covered by the LiteSVM tests, not exercised against the live cluster.
- Buybacks are cranked by hand (a button on the coin panel, or anyone calling `crank_buyback`); there is no scheduled job.
- The leaderboard shows all-time totals. Per-hour and 24-hour figures need an indexer, which does not exist; recent openings in chain mode are read best-effort from the latest program transactions.
- Claiming as stock uses Jupiter `swap/v1` (quote + swap-instructions) and is untested against real xStocks; the mint addresses in `web/lib/config.ts` are still empty. On devnet the button only reports that xStocks are unavailable.
- Stock prices are hard-coded demo values; Pyth is not wired in.
- Embedded wallets, a gas relayer, share cards / Blinks, geo restrictions and spending limits are not implemented.
- Translations other than English were machine-written and have not been reviewed by native speakers.
- Unaudited. Paid random draws may be regulated as gambling, and a coin bought back with platform fees may be treated as a security; the design doc itself says not to open the launchpad before getting legal advice.
