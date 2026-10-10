# Solana Blitz v9 submission

Copy for the form at https://build.magicblock.app/?stage=blitz#submit.

**Project name.** GachaStock

**One line.** Gacha for the stock market on Solana: stock blind boxes, stock memes and Leverage Box, drawn by MagicBlock VRF and settled between players, never against a house.

**Description.**

GachaStock turns playing the stock market into opening a box. There are three ways to play with 10 USDC.

Stock Blind Boxes are gacha packs of tokenized US stocks. 7.50 of every 10 USDC always comes back, the rest funds one prize pool that every machine shares, and MagicBlock VRF draws each pull. Stock Memes let anyone launch a machine on a basket of stocks, with its own coin on a bonding curve; 3% of every pull buys that coin for the player who pulled, so the people who play a machine come to own it.

Leverage Box is the newest game. A box holds a random long or short on a live price at 500× to 10,000×, drawn by MagicBlock VRF. A round locks at the Pyth Lazer oracle price, runs for 30 seconds and settles between its players. Perps need market makers or a pool to take the other side; here nobody has to, because the draw leans towards whichever side is lighter, so longs and shorts balance on their own. Losers lose `stake × leverage × move`, capped at their stake, and winners split exactly that. The program is never a counterparty and keeps 10% of winnings.

Leverage Box runs in a MagicBlock Ephemeral Rollup. A round lasts 45 seconds and a player opens several boxes in it, so each box confirming in milliseconds, without a fee or a wallet prompt, matters there. USDC stays in a vault on Solana throughout, and settlement is one O(1) instruction however many boxes a round has. The two gacha games run directly on Solana.

**MagicBlock products used.** VRF on Solana (gacha draws) and on the ephemeral queue (Leverage Box draws); an Ephemeral Rollup for Leverage Box (delegation, commit and undelegate); the Pyth Lazer price oracle in the rollup; session keys for gasless boxes.

**GitHub.** https://github.com/stevenjjj-web/gachastock

**Website.** https://gachastock-bice.vercel.app (Leverage Box is at `/arena`)

**Demo.**
- https://github.com/stevenjjj-web/gachastock/blob/main/docs/demo.mp4: a three-minute film of all three games, recorded in demo mode by `tests/record-launch.mjs`. In demo mode, Leverage Box uses the live oracle price and simulates the other players.
- https://github.com/stevenjjj-web/gachastock/blob/main/docs/devnet-walkthrough.mp4: the same Leverage Box flow against devnet, with real rollup transactions (90 seconds, recorded by `tests/record-demo.mjs`).

Upload both to a video host for links that play inline.

**Program addresses (devnet).**

- Leverage Box: `7YqLqC9wArnHb7aKcCRxkFMbKYE2gqQnExXtMyBdZ5Rv`
- Gacha machines: `7VAfdZyRRWCvLdPUpqYbeuSsvtQW4cp2PeVQvkAtBHHv`

**Explorer link (integration proof).** A box opened in the rollup with a session key, which requests MagicBlock VRF:
https://explorer.solana.com/tx/4aUdsh8XenvfKH5SymyL8mfVtVHvvynoWR5A3qpaMzvMbgXsYMHfm4JqvR2xQKecmBu2u4ibD6Rrg5wURjYnYHQ9?cluster=custom&customUrl=https%3A%2F%2Fdevnet-as.magicblock.app

The delegation of that player's account on Solana:
https://explorer.solana.com/tx/3DAQ7qTdHSDTrUUWiATp9m3zr16YtPMeRqrLRuSMMZ6KDLM9yQ97qPFuxKi63U99GTS7ssNJK1zkUDBW2MgVQwmy?cluster=devnet

The README links every step of that trip, from deposit to withdrawal.

**How to try it.**
1. Open the website, connect a devnet wallet and press `+ Test USDC`.
2. Open packs on the Gacha tab, or launch a machine on the Launchpad tab.
3. On the Arena tab, deposit and open boxes on the SOL arena. A round needs boxes on both sides to move money; alone, your own boxes land on both sides. `npx tsx arena-bot.ts 30 SOL` in `tests/` runs a second player.
