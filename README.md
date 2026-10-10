# GachaStock

**Gacha for the stock market, on Solana.** Three ways to play with 10 USDC, all settled between players and never against a house:

- **Stock Blind Boxes.** Rip a pack of tokenized US stocks. 7.50 of every 10 USDC comes back to you whatever you pull, and every machine plays for one shared jackpot.
- **Stock Memes.** Anyone can launch a machine on a basket of stocks, with its own coin. Every pull on that machine buys some of the coin for the player who pulled.
- **Leverage Box.** Open a box, get a random long or short on a live price at 500× to 10,000×, and settle against the other players 45 seconds later.

Every draw comes from MagicBlock VRF. Leverage Box also runs in a MagicBlock Ephemeral Rollup, so each box confirms straight away, with no fee and no wallet prompt.

- **Live on devnet:** https://gachastock-bice.vercel.app (Leverage Box is at [`/arena`](https://gachastock-bice.vercel.app/arena))
- **Demo videos:** a three-minute film of all three games, recorded in demo mode, and a 90-second captioned run of Leverage Box and a gacha pull against devnet. They are not kept in this repository; [Demo videos](#demo-videos) explains how to record them.
- **Built for** MagicBlock Solana Blitz v9. Devnet only, unaudited, test USDC.

## The games

### Stock Blind Boxes

A machine is a gacha machine with a theme and a basket of tokenized stocks (xStocks). A pack costs 10 USDC and opens as soon as MagicBlock VRF answers. Each pull lands on one of seven tiers and one stock from the basket:

| Tier | Pack is worth | Odds |
| --- | --- | --- |
| N | 7.50 | 78.875% |
| R | 11 | 17.5% |
| SR | 25 | 2.25% |
| SSR | 40 | 1.3% |
| UR | 100 | 0.05% |
| Legend | 500 | 0.02% |
| Jackpot | half the shared prize pool | 0.005% |

- **The floor.** 7.50 of every pack is always yours. Everything above it is paid from the prize pool.
- **One shared prize pool.** Every machine pays into the same pool and plays for it. The jackpot is half the pool and any machine can hit it. It only pays while the pool holds at least 2,000 USDC, so a jackpot is never smaller than 1,000 USDC; below that, a jackpot roll pays the best fixed tier the pool can afford. A fixed tier whose prize would exceed 25% of the pool is downgraded the same way.
- **Pity.** 60 pulls in a row without SR or better guarantees an SR.
- **Turbo.** Ten packs with a single random draw.
- **Claiming.** Take the value as the tokenized stock you pulled (one Jupiter swap) or as USDC. A 1% settlement fee applies. If the VRF callback never arrives, the pack is refunded in full after about 10 minutes.

Where each 10 USDC goes:

| | Floor | Prize pool | Coin for the player | Creator | Protocol |
| --- | --- | --- | --- | --- | --- |
| Official machine | 7.50 | 2.10 | — | — | 0.40 |
| Launchpad machine | 7.50 | 1.80 | 0.30 | 0.10 | 0.30 |

In simulation, players get back 93% of what they pay in prizes on average, and about a quarter of 10-pull sessions end in profit. `sim/RESULTS.md` has the numbers and how the parameters were chosen.

### Stock Memes

The launchpad lets anyone open a machine of their own in one transaction, for a 10 USDC fee:

1. Pick a name, a ticker, the pack art and up to 8 stocks from the whitelist of 11. Everything else comes from a fixed template and can never change.
2. The machine is open for pulls at once and plays for the same shared prize pool as every other machine.
3. Each launchpad machine has a coin. 3% of every pull buys that coin for the player who pulled, delivered with the claim, so the people who play a machine come to own its coin.
4. The coin starts on a bonding curve. Once 5,000 USDC has gone in, it graduates and all of that USDC becomes the coin's trading pool. Coins trade with a 1% fee.
5. The creator earns 1% of every pull on their machine.

The Machines page ranks every machine by volume, with its pulls, coin price, liquidity and how much coin its pulls have bought for players.

The coin rebate creates no value on its own: it moves 3% of what players pay into the coin's market. A player who sells straight away gets about face value back; holders gain only if later players keep playing and hold. Most machine coins will lose money.

### Leverage Box

Perpetual futures let you pick a side, so they need market makers or a pool to take the other one. In Leverage Box the side and the leverage come out of the box. The draw leans towards whichever side is lighter, so longs and shorts stay close to balanced on their own and a round can settle purely between its players. A rare high-leverage box takes a bigger share of what the losers lose, which makes it the prize of the box.

A round:

1. **Deposit** USDC once. The same approval registers a session key that lives in your browser.
2. **Open boxes** for 5, 10 or 25 USDC each. MagicBlock VRF draws the leverage tier and the side:

   | Leverage | 500× | 1,000× | 2,500× | 5,000× | 10,000× |
   | --- | --- | --- | --- | --- | --- |
   | Odds | 40% | 30% | 18% | 9% | 3% |

3. **Lock.** The first box starts a 15-second countdown. The round then locks at the oracle price.
4. **Live.** For 30 seconds every box shows what it would pay if the round ended now.
5. **Settle** at the oracle price. A box on the wrong side loses `stake × leverage × move`, never more than its stake. A box on the right side claims the same amount. The smaller of the two totals changes hands, shared pro rata on each side. Winners pay 10% of their winnings, the only fee. Results are credited automatically.
6. **Cash out** between rounds; the balance goes back to your wallet.

Leverage is a weight, not a promised multiple: winners can only receive what losers lost. The numbers are large because a round lasts 30 seconds, and prices move a few hundredths of a percent in that time. Arenas exist for SOL, BTC and ETH.

## How MagicBlock is used

The two gacha games run entirely on Solana, with MagicBlock VRF for their randomness. Leverage Box is the one place that uses an Ephemeral Rollup. A round lasts 45 seconds and a player may open several boxes in it, so it helps that each box confirms in milliseconds without a fee or a wallet prompt. USDC stays in a vault on Solana the whole time.

| Piece | Used by | How |
| --- | --- | --- |
| VRF | Gacha | `buy_packs` requests randomness; `callback_open` rolls the tiers and stocks. Only the VRF identity can call it. |
| VRF, ephemeral queue | Leverage Box | `open_box` requests randomness inside the rollup; `callback_box` draws the tier and the side. On devnet the draw lands about 10 ms after the request. |
| Ephemeral Rollup | Leverage Box | The `Arena` and `Player` accounts are delegated to the rollup; boxes, locks, settlement and claims run there. `leave` commits the player and hands the account back to Solana. |
| Pyth Lazer oracle | Leverage Box | `tick` reads the price feed account owned by MagicBlock's price program inside the rollup, checks its owner, address and freshness, and uses it to lock and settle rounds. |
| Session keys | Leverage Box | A key held in the browser signs boxes and claims. It holds no SOL and cannot withdraw. |

## Try it

### On devnet

1. Open https://gachastock-bice.vercel.app with a wallet set to devnet and a little devnet SOL for fees.
2. Press **+ Test USDC** for 500 test USDC.
3. **Gacha** tab: pick a machine and open a pack, or switch on turbo for ten. **Launchpad** tab: launch your own machine.
4. **Arena** tab: deposit, then open boxes on the SOL arena. A round needs boxes on both sides to move money; alone, your own boxes land on both sides. `npx tsx arena-bot.ts 30 SOL` in `tests/` runs a second player.

### Locally, in demo mode

```bash
cd web && npm install && npm run dev
```

Open http://localhost:3000. Without `NEXT_PUBLIC_PROGRAM_ID` the app runs in **demo mode**: no wallet and no real funds. Draws happen in the browser with the same rules as the programs and state lives in localStorage. The machines, their stats and the recent openings you see on first load are seeded sample data.

Leverage Box works in demo mode too. Its price is the live Pyth Lazer feed, read from MagicBlock's devnet rollup without a wallet. Boxes, rounds, settlement and the other players are simulated in the browser with the program's math (`web/lib/arena/use-demo-arena.ts`), and the first five rounds in its history are sample data. If the rollup cannot be reached, the price falls back to a random walk.

## Repository

```
programs/kaigu-gacha   Anchor program for the gacha machines, the launchpad and machine coins
programs/leverage-box  Anchor program for Leverage Box
web                    Next.js frontend (demo mode by default, chain mode with the env set)
sim                    Economic simulations the gacha parameters were chosen with
tests                  LiteSVM tests, devnet scripts, browser end-to-end runs and the demo recorders
```

## Frontend

Pages: **Gacha** (`/`: pick a machine, open packs, trade its coin), **Arena** (`/arena`: Leverage Box), **Machines** (`/machines`: the leaderboard), **Launchpad** (`/launch`) and **Inventory** (`/inventory`: unclaimed packs, holdings, coins and creator fees).

Fill in `web/.env.example` to switch to chain mode against a deployment; `web/.env.local` points at the devnet deployment below. The public devnet RPC rate-limits aggressively. Chain mode batches its reads, but for anything beyond a quick test, point `NEXT_PUBLIC_RPC_URL` at a dedicated endpoint. `NEXT_PUBLIC_ER_RPC_URL` picks the rollup endpoint (MagicBlock's public devnet endpoint in Asia by default).

The UI is in English by default. The language menu switches between English, Chinese, Japanese, Korean, Thai, Spanish, Portuguese, French, German, Vietnamese and Indonesian. Strings live in `web/lib/locales/`; `en.ts` defines the keys and every other locale must provide all of them.

## Programs

Toolchain: Anchor 0.31.1, Solana CLI 4.x, `ephemeral-vrf-sdk` 0.17.3 and, for Leverage Box, `ephemeral-rollups-sdk` 0.16.2 (both with `anchor-compat`). The rustup `cargo` must come first on `PATH`.

```bash
export PATH="$HOME/.cargo/bin:$PATH"
cargo test -p kaigu-gacha --release -- --nocapture   # unit tests + 2M-pull × 2-seed economic simulation
cargo test -p leverage-box                           # settlement math, including a 20,000-round conservation check
anchor build
anchor deploy --provider.cluster devnet
cd web && USDC_MINT=<test USDC mint> npx tsx scripts/init-season.ts   # gacha: season, shared vault, official machines
cd tests && npx tsx arena-admin.ts                                    # Leverage Box: create, delegate and configure the arenas
```

### kaigu-gacha

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

- **One vault.** All USDC sits in one token account. Its ledger is `pending + prize_pool + locked + protocol_fees + markets`, where `markets` is the sum of every machine's `market_usdc + creator_accrued`. Every instruction that moves funds ends by asserting that the balance covers the ledger, and a machine's coin market can never pay out more than its own `market_usdc`.
- **Pity and the cap.** A pity pull uses up the guarantee even when the cap downgrades it. Without that rule a small pool would leave every player on a permanent pity pull and never grow; the simulation found this in an earlier version.
- **Anti-sniping.** For the first 150 slots after launch a single coin purchase is capped at 100 USDC, and a creator can hold at most 5% of their own curve. Both can be sidestepped with more wallets, and neither applies to coins earned by pulling.
- **After graduation** the coin trades in a constant-product pool inside this program, opened at the curve's final price. Coins in the pool are minted only when someone buys them.

This version departs from the original design doc on purpose. The doc gives every machine its own prize pool seeded from the curve raise; here the pool is shared and the raise stays with the coin. The doc buys back and burns the coin with 2% of every pull; here 3% of every pull buys the coin for the player. The doc opens a machine only after its curve sells out and fails it after 7 days; here a machine is open from launch, so there is no failed state. The doc graduates to an external DEX; that integration is not built.

### leverage-box

| Instruction | Where | What it does |
| --- | --- | --- |
| `init_arena` | Solana | Creates the arena for one price feed, and the vault on first use |
| `configure` | either | Changes timing, fee and stake limits from the next round |
| `delegate_arena` | Solana | Hands the arena to the rollup |
| `enter` | Solana | Deposits USDC into the vault, credits the balance and registers the session key |
| `delegate_player` | Solana | Hands the player's account to the rollup (sent with `enter`) |
| `open_box` | Rollup | Pays for a box and requests its VRF draw; signed by the owner or the session key |
| `callback_box` | Rollup | The draw; only the VRF program can call it |
| `tick` | Rollup | Locks a round at the oracle price, or settles it and opens the next; anyone can call it |
| `claim` | Rollup | Credits finished tickets to the balance; anyone can call it for anyone |
| `cancel_pending` | Rollup | Refunds a box whose draw never arrived |
| `leave` | Rollup | Commits the player and sends the account back to Solana |
| `withdraw` | Solana | Pays the whole balance back to the owner; needs the owner's signature |

- **O(1) settlement.** The arena keeps stake per side and tier (10 buckets), so a round settles in one small instruction however many boxes it has, and stores three numbers per round. Tickets are priced from that result when claimed.
- **Solvency.** Rounding always favours the vault: losers are rounded up, winners down. A unit test runs 20,000 random rounds and checks that payouts plus fees never exceed stakes and fall short only by dust.
- **USDC stays on Solana.** The vault is a token account on the base layer. The rollup only moves balances between delegated accounts, and the game is zero-sum, so the vault always covers them.
- **Session keys are limited.** They can open boxes, claim and send the account home. They cannot withdraw.
- **No scheduler needed.** Every open page moves rounds on with `tick` and claims finished tickets in the background, signed by a throwaway key that holds no SOL.

## Devnet deployment

| | Address |
| --- | --- |
| Gacha program | `7VAfdZyRRWCvLdPUpqYbeuSsvtQW4cp2PeVQvkAtBHHv` |
| Leverage Box program | `7YqLqC9wArnHb7aKcCRxkFMbKYE2gqQnExXtMyBdZ5Rv` |
| Test USDC mint | `BsVdbtxGsuqHduBg4YwMSdkZfpWg5AHMvmhWXVSf2ne6` |
| Upgrade authority / admin | `2kafrqsmhB3yrEqhRxJRw3BBH1uL1XYvdupq2p6HZYNb` |

The gacha program was upgraded to this version on 2026-10-05. Season 2 is live with the parameters above, the shared vault started at zero, and there are three official machines (ids 4 to 6: Index, Tech, Trending). Machine 7 is a launchpad machine left over from the browser test, with its coin already graduated. Ids 0 to 3 and seasons 0 and 1 belong to the previous version; the frontend skips them, and packs bought under it can no longer be claimed.

The `+ Test USDC` button mints 500 test USDC to the connected wallet through `web/app/api/faucet` (devnet only). Throwaway devnet keys (faucet and mint authority, e2e wallet) live in `.keys/`, which is gitignored.

One player's full Leverage Box trip on devnet:

| Step | Where | Transaction |
| --- | --- | --- |
| Deposit and delegate | Solana | [3DAQ7q…](https://explorer.solana.com/tx/3DAQ7qTdHSDTrUUWiATp9m3zr16YtPMeRqrLRuSMMZ6KDLM9yQ97qPFuxKi63U99GTS7ssNJK1zkUDBW2MgVQwmy?cluster=devnet) |
| Open a box (session key, VRF request) | Rollup | [4aUdsh…](https://explorer.solana.com/tx/4aUdsh8XenvfKH5SymyL8mfVtVHvvynoWR5A3qpaMzvMbgXsYMHfm4JqvR2xQKecmBu2u4ibD6Rrg5wURjYnYHQ9?cluster=custom&customUrl=https%3A%2F%2Fdevnet-as.magicblock.app) |
| VRF callback | Rollup | [Q47oGi…](https://explorer.solana.com/tx/Q47oGi2voBRBpZpJbb61GmTBrmqTstymp2KcsyfjZhAJkwfXJp4UaWwGsBwmaNrMArmkzu7fHBf3whxRCeuHXPs?cluster=custom&customUrl=https%3A%2F%2Fdevnet-as.magicblock.app) |
| Claim | Rollup | [NrzWsr…](https://explorer.solana.com/tx/NrzWsr4Q1Lk9Kg14FyxHGFSXH5ZPqfty4NuQTjRaUk3pPMZvk4UEciHyroKNWT8wkCpnUbjhNXpXPVkeCBHDKvZ?cluster=custom&customUrl=https%3A%2F%2Fdevnet-as.magicblock.app) |
| Leave (commit and undelegate) | Rollup | [6yzcYB…](https://explorer.solana.com/tx/6yzcYBwcbBAy734QhuZUSYCb4r7yMBRsVy6sj9o7ynYEZSpQ2TYQ9HKbE6fG1oVdXKEmWaw2rJitNx2kx6YexKY?cluster=custom&customUrl=https%3A%2F%2Fdevnet-as.magicblock.app) |
| Undelegation lands | Solana | [2FEA5A…](https://explorer.solana.com/tx/2FEA5A9BdtK9DxK31Z6i558wjD1ZyksXBR38C2RGAVhSNVfH5B3QNgGSsuD14DHTCqbWU7J3u6Pt4W3DDa4xZWiQ?cluster=devnet) |
| Withdraw | Solana | [222S28…](https://explorer.solana.com/tx/222S288emmGvFxKs3sV9PxfWAHsR9PWCTx4rqWijG5typ7auwHGPVvbmRkzDAbs716BSvY7Sd8cgHJ7YfTesV3MX?cluster=devnet) |

## Tests

```bash
cargo test -p kaigu-gacha --release          # draw logic + economic simulation
cargo test -p leverage-box                   # settlement math + 20,000-round conservation check
cd tests && npm install
npm test                                     # LiteSVM: full gacha flow against the real MagicBlock VRF program
npx tsx devnet-smoke.ts 10 4                 # devnet: buy on machine 4 → live VRF callback → claim
npx tsx devnet-arena.ts 3                    # devnet: two players, one full Leverage Box round across Solana and the rollup
npx tsx arena-bot.ts 30 SOL                  # devnet: a second Leverage Box player for 30 minutes
node browser-e2e.mjs                         # devnet, in headless Chrome: connect, faucet, open, claim
node browser-e2e.mjs --launch                # also launch a machine, play it, graduate its coin, sell, withdraw
node browser-e2e.mjs --inventory             # claim whatever is waiting in Inventory
node shots.mjs http://localhost:3210         # screenshot tour (needs the app in demo mode)
```

`tests/fixtures` holds the VRF program and oracle queue account dumped from devnet. The LiteSVM test runs with signature verification off so it can play the oracle and sign the callback as the VRF identity.

## Demo videos

Videos are not committed (`.gitignore` excludes them); both recorders write to `tests/shots/`.

- **The launch film** is recorded by `tests/record-launch.mjs` from the app in demo mode (`node record-launch.mjs http://localhost:3210`, about 10 minutes, needs ffmpeg). It works in two passes. First it drives the real app in a browser, saves every frame the app paints with its timestamp, and logs a timeline of what the camera, cursor, captions and cards do. Then it renders the film frame by frame on `tests/film/stage.html` in parallel workers, so the output is smooth however slow the machine is. The score is synthesised by `tests/film/score.mjs`. Draws are random, so every take differs. Output: `tests/shots/launch.mp4`.
- **The devnet walkthrough** is recorded by `tests/record-demo.mjs` against devnet with the e2e wallet in `.keys/`, while `arena-bot.ts` plays the other side. Output: `tests/shots/demo.mp4`.

## Limits and open work

Stated plainly:

- **Status.** Devnet only, unaudited, test USDC.
- **Stock prices.** The gacha's stock prices are hard-coded demo values; Pyth is not wired in for equities. MagicBlock's oracle in the rollup has crypto feeds only, so the Leverage Box arenas are SOL, BTC and ETH; stock arenas need equity feeds there.
- **Claiming as stock.** This uses Jupiter `swap/v1` and is untested against real xStocks; the mint addresses in `web/lib/config.ts` are still empty. On devnet the button only reports that xStocks are unavailable.
- **Coin markets.** The post-graduation pool lives in this program, not on a DEX; no Raydium or Meteora integration exists. Machine coins have no on-chain token metadata.
- **Prize pool.** The shared pool is not seeded. Until it has grown, the top tiers are downgraded to what the pool can afford (about 8,000 to 9,500 pulls in simulation). Every pull, claim and coin trade writes the one vault account, so they cannot run in parallel.
- **Leaderboard.** It shows all-time totals. Per-hour and 24-hour figures need an indexer, which does not exist; recent openings in chain mode are read best-effort from the latest program transactions.
- **Leverage Box pools.** One pool mixes all leverage tiers, so low tiers have slightly negative expectation and high tiers positive; that is what makes a rare box worth pulling. Separate pools per risk class, ticket trading before the lock and a rolling jackpot are designed but not built.
- **Leverage Box mechanics.**
  - A round with one player still runs; that player is on both sides and only pays the fee.
  - Rounds move on when someone's page (or the bot) sends `tick`; a scheduled crank in the rollup is not wired up.
  - Protocol fees accrue in the arena account, and no instruction pays them out yet.
  - The deposit, the session key and the 8-ticket limit are per wallet across all arenas. To add funds you cash out and deposit again.
- **Test coverage.**
  - On devnet, `refund_timeout`, `fund_pool`, `withdraw_protocol_fees` and a graduation triggered by a pull are covered only by the LiteSVM tests.
  - Leverage Box has no integration test harness for the rollup; it is covered by unit tests and by the scripted devnet runs above.
- **Not built.** Embedded wallets, a gas relayer, share cards or Blinks, geo restrictions and spending limits.
- **Translations.** Languages other than English were machine-written and have not been reviewed by native speakers.

## Legal

Paid random draws may be regulated as gambling, random leveraged positions settled for money as derivatives, and a coin handed to players out of platform fees as a security. Do not run any of this for real money without legal advice. xStocks are not available to US persons. Nothing here is investment advice.
