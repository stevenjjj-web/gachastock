# Solana Blitz v9 submission

Copy for the form at https://build.magicblock.app/?stage=blitz#submit.

**Project name.** GachaStock: Leverage Box

**One line.** Open a box, get a random leveraged long or short on a live price, and settle against the other players in under a minute, in a MagicBlock Ephemeral Rollup.

**Description.**

Leverage Box turns a leveraged trade into a gacha pull. You deposit USDC once on Solana; from then on every box is a gasless, pop-up-free transaction in an Ephemeral Rollup. MagicBlock VRF draws the box's side and leverage (500x to 10,000x) in about 10 ms. A round locks at the Pyth Lazer oracle price, runs for 30 seconds and settles at the oracle price.

What is new is who takes the other side: nobody has to. Perps let you choose a side, so they need market makers or a liquidity pool. Here the draw leans towards whichever side is lighter, so longs and shorts balance on their own and a round settles purely between its players. Losers lose `stake × leverage × move`, capped at their stake; winners split exactly that by weight. The program is never a counterparty and only takes 10% of winnings.

It is built for speed where speed is the product: draws, locks, live profit and loss, settlement and claims all happen in the rollup, and settlement is a single O(1) instruction however many tickets a round has. USDC itself never leaves Solana.

The same app also has gacha machines for tokenized stocks drawn by MagicBlock VRF on the base layer: a shared prize pool, a launchpad, and machine coins that players earn by pulling.

**MagicBlock products used.** Ephemeral Rollups (delegation, commit and undelegate), VRF (base layer and the ephemeral queue), the Pyth Lazer pricing oracle in the rollup, gasless transactions with a session key.

**GitHub.** https://github.com/stevenjjj-web/gachastock

**Website.** https://gachastock-bice.vercel.app/arena

**Demo.** https://github.com/stevenjjj-web/gachastock/blob/main/docs/demo.mp4 (90 seconds, captioned, recorded against devnet by `tests/record-demo.mjs`). Upload it to a video host for a link that plays inline.

**Program addresses (devnet).**

- Leverage Box: `7YqLqC9wArnHb7aKcCRxkFMbKYE2gqQnExXtMyBdZ5Rv`
- Gacha machines: `7VAfdZyRRWCvLdPUpqYbeuSsvtQW4cp2PeVQvkAtBHHv`

**Explorer link (integration proof).** A box opened in the rollup with a session key, which requests MagicBlock VRF:
https://explorer.solana.com/tx/4aUdsh8XenvfKH5SymyL8mfVtVHvvynoWR5A3qpaMzvMbgXsYMHfm4JqvR2xQKecmBu2u4ibD6Rrg5wURjYnYHQ9?cluster=custom&customUrl=https%3A%2F%2Fdevnet-as.magicblock.app

The delegation of that player's account on Solana:
https://explorer.solana.com/tx/3DAQ7qTdHSDTrUUWiATp9m3zr16YtPMeRqrLRuSMMZ6KDLM9yQ97qPFuxKi63U99GTS7ssNJK1zkUDBW2MgVQwmy?cluster=devnet

The README lists every step of the trip, from deposit to withdrawal.

**How to try it.** Open the website, connect a devnet wallet, press `+ Test USDC`, deposit, and open boxes on the SOL arena. A round needs boxes on both sides to move money; alone, your own boxes land on both sides. `npx tsx arena-bot.ts 30 SOL` in `tests/` runs a second player.
