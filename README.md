# GachaStock

A blind-box protocol for tokenized US stocks on Solana: 10 USDC a pack, a guaranteed 7.50 USDC floor, one prize pool shared by every machine, and a jackpot worth half of it. Tickets only, never the house.

```
programs/kaigu-gacha   Anchor program (draws settle in a MagicBlock VRF callback)
web                    Next.js frontend (demo mode by default)
sim                    Economic simulations the parameters were chosen with (see sim/RESULTS.md)
```

## What you can do

- **Machines.** The platform is a set of gacha machines. Each one has its own theme and stock basket and opens packs instantly: 10 USDC a pack, a guaranteed 7.50 USDC floor and seven tiers. Turbo mode opens ten packs with one random draw.
- **One shared prize pool.** Every machine pays into, and plays for, the same pool. The jackpot is half of it and any machine can hit it. It only pays while the pool is at least 2,000 USDC, so a jackpot is never smaller than 1,000 USDC; below the threshold a jackpot roll pays the best fixed tier the pool can afford. The pool starts from zero, so the top tiers only become payable once enough has been played (about 8,000 to 9,500 pulls in simulation). Anyone can add to the pool with `fund_pool`.
- **Play to own.** Anyone can launch a machine for a 10 USDC fee, choosing its name, ticker, art and a stock basket from the whitelist. It is open for pulls right away. Each launchpad machine has a coin, and 3% of every pull buys that coin for the player who pulled; the coins arrive with the claim. The coin starts on a bonding curve; once 5,000 USDC has gone in it graduates and all of it becomes the coin's trading pool. Nothing from the coin goes to the prize pool.
- **Where 10 USDC goes.** Launchpad machines: 7.50 floor, 1.80 prize pool, 0.30 buys the coin for the player, 0.10 creator, 0.30 protocol. Official machines have no coin and no creator: 7.50 floor, 2.10 prize pool, 0.40 protocol.
- **Leaderboard.** The Machines page ranks every machine by volume and shows its pulls, coin price, coin liquidity and how much coin its pulls have bought for players.

The coin rebate creates no value: it moves 3% of what players pay into the coin's market. A player who sells the coins straight away gets about face value back; holders gain only if later players keep playing and hold. `sim/RESULTS.md` has the numbers.

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
cargo test -p kaigu-gacha --release -- --nocapture   # unit tests + 2M-pull × 2-seed economic simulation
anchor build
anchor deploy --provider.cluster devnet
cd web && USDC_MINT=<test USDC mint> npx tsx scripts/init-season.ts   # season, the shared vault and the official machines
```

| Instruction | Caller | What it does |
| --- | --- | --- |
| `initialize` | upgrade authority | Creates Config |
| `create_season` | admin | Publishes immutable economic parameters and the stock whitelist |
| `init_vault` | admin | Opens the shared vault: the prize pool ledger and the program's one USDC account |
| `create_machine` | admin | Creates an official machine (no coin, no creator) |
| `launch_machine` | anyone | Launchpad: creates a machine, its coin mint and its curve for a 10 USDC fee; open for pulls at once |
| `coin_buy` | user | Buys the machine coin: on the curve before graduation (the buy that sells the last curve coin graduates it), against the pool after |
| `coin_sell` | holder | Sells the machine coin back to the curve or the pool |
| `buy_packs` | user | Takes payment as pending in the vault, creates the pack, requests VRF randomness |
| `callback_open` | VRF identity only | Splits funds, buys the machine coin for the player, rolls tiers, applies pity, the jackpot threshold and the cap; ledgers only |
| `claim` | pack owner | Pays out USDC minus the 1% settlement fee, mints the coins the pulls bought, closes the Pack |
| `refund_timeout` | pack owner | Full refund when no callback arrives within `timeout_slots` |
| `fund_pool` | anyone | Adds USDC to the shared prize pool; it can only leave as prizes |
| `withdraw_protocol_fees` | anyone | Sends the protocol's accrued fees to the treasury |
| `withdraw_creator_fees` | anyone | Sends a machine's accrued creator fees to its creator |
| `set_paused` | admin | Pauses purchases, launches and coin buys; claims, refunds and coin sells keep working |

Differences from the design doc, which this version departs from on purpose:

- The doc gives every machine its own prize pool and seeds it with 4,000 USDC of the curve raise. Here the pool is shared and the raise stays with the coin.
- The doc buys back and burns the coin with 2% of every pull. Here 3% of every pull buys the coin for the player instead.
- The doc opens a machine only after its curve sells out and fails it after 7 days. Here a machine is open from launch, so there is no failed state.
- The doc has graduation create a pool on an external DEX. That integration is not built: the post-graduation pool is a constant-product pool **inside this program**, opened at the curve's final price. Coins in the pool are minted only when someone buys them.

A pity pull uses up the guarantee even when the cap downgrades it. Without that rule a small pool leaves every player on a permanent pity pull and never grows; the simulation found this in the previous version.

Anti-sniping rules on the curve: for the first 150 slots after launch a single purchase is capped at 100 USDC, and the creator can hold at most 5% of the curve allocation. Both can be sidestepped with more wallets, and neither applies to coins earned by pulling.

All USDC sits in one vault token account. The vault's ledger is `pending + prize_pool + locked + protocol_fees + markets`, where `markets` is the sum of every machine's own `market_usdc + creator_accrued`. Every instruction that moves funds ends by asserting that the balance covers the ledger, and a machine's coin market can never pay out more than its own `market_usdc`.

## Devnet deployment

| | Address |
| --- | --- |
| Program | `7VAfdZyRRWCvLdPUpqYbeuSsvtQW4cp2PeVQvkAtBHHv` |
| Test USDC mint | `BsVdbtxGsuqHduBg4YwMSdkZfpWg5AHMvmhWXVSf2ne6` |
| Upgrade authority / admin | `2kafrqsmhB3yrEqhRxJRw3BBH1uL1XYvdupq2p6HZYNb` |

The program was upgraded to this version on 2026-10-05. Season 2 is live with the parameters above, the shared vault is open and started at zero, and there are three official machines (ids 4 to 6: Index, Tech, Trending). Machine 7 is a launchpad machine left over from the browser test, with its coin already graduated. Ids 0 to 3 are machines from the previous version; those accounts have a different layout and the frontend skips them, along with the other accounts earlier versions left behind (seasons 0 and 1, the old per-machine pools, limited drops). Packs bought under the previous version can no longer be claimed.

`web/.env.local` points the frontend at this deployment, and the
`+ Test USDC` button mints 500 test USDC to the connected wallet (devnet only, via `web/app/api/faucet`).
Throwaway devnet keys (faucet / mint authority, e2e wallet) live in `.keys/`, which is gitignored.

## Tests

```bash
cargo test -p kaigu-gacha --release          # draw logic + economic simulation
cd tests && npm install
npm test                                     # LiteSVM: full program flow against the real MagicBlock VRF program
npx tsx devnet-smoke.ts 10 4                 # devnet: buy on machine 4 → live VRF callback → claim
node browser-e2e.mjs                         # devnet, in headless Chrome: connect, faucet, open, claim
node browser-e2e.mjs --launch                # also launch a machine, play it, graduate its coin, sell, withdraw
node browser-e2e.mjs --inventory             # claim whatever is waiting in Inventory
node shots.mjs http://localhost:3210         # screenshot tour (needs the app in demo mode)
```

`tests/fixtures` holds the VRF program and oracle queue account dumped from devnet. The LiteSVM test runs with
signature verification off so it can play the oracle and sign the callback as the VRF identity.

## Not done / not verified

- The post-graduation pool lives in this program, not on a DEX; no Raydium or Meteora integration exists. Machine coins have no on-chain token metadata.
- On devnet `refund_timeout`, `fund_pool`, `withdraw_protocol_fees` and a graduation triggered by a pull are only covered by the LiteSVM tests, not exercised against the live cluster.
- The shared pool is not seeded. Until it has grown, the top tiers are downgraded to what the pool can afford.
- Every pull, claim and coin trade writes the one vault account, so they cannot run in parallel.
- The leaderboard shows all-time totals. Per-hour and 24-hour figures need an indexer, which does not exist; recent openings in chain mode are read best-effort from the latest program transactions.
- Claiming as stock uses Jupiter `swap/v1` (quote + swap-instructions) and is untested against real xStocks; the mint addresses in `web/lib/config.ts` are still empty. On devnet the button only reports that xStocks are unavailable.
- Stock prices are hard-coded demo values; Pyth is not wired in.
- Embedded wallets, a gas relayer, share cards / Blinks, geo restrictions and spending limits are not implemented.
- Translations other than English were machine-written and have not been reviewed by native speakers.
- Unaudited. Paid random draws may be regulated as gambling, and a coin handed to players out of platform fees may be treated as a security; the design doc itself says not to open the launchpad before getting legal advice.
