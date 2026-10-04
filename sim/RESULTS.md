# v2 economics: simulation results

Simulated on 2026-10-04 with the scripts in this folder. The program now implements the
"v2, floor 7.5" column without the one-time pool seed; the "current" column is the previous
version, which is what devnet still runs. One thing differs from the model: official machines
have no coin, so their 0.30 goes to the prize pool and the pool grows faster than modelled here.

```bash
node search.mjs        # 24,000 random parameter sets, 200k pulls each
node refine.mjs 7.5 0.3  # long re-runs of the best candidates for one floor and rebate
node final.mjs         # full validation of the chosen sets, 8M pulls each
node coin.mjs          # machine coin under the play-to-own rebate
```

## What was changed in the model

1. Higher floor, smaller prize pool share.
2. One prize pool shared by every machine.
3. Part of the fee buys the machine's coin on every pull and gives it to the player.
4. The curve raise stays with the coin as liquidity; none of it seeds the prize pool.

## Recommended parameters

Per 10 USDC pack: 7.50 floor, 1.80 prize pool, 0.30 coin rebate, 0.10 creator, 0.30 protocol.

| Tier | Value | Odds | ppm |
| --- | --- | --- | --- |
| N | 7.5 | 78.875% | 788,750 |
| R | 11 | 17.5% | 175,000 |
| SR | 25 | 2.25% | 22,500 |
| SSR | 40 | 1.3% | 13,000 |
| UR | 100 | 0.05% | 500 |
| Legend | 500 | 0.02% | 200 |
| Jackpot | half the shared pool | 0.005% | 50 |

Pity after 60 pulls without SR or better, 25% cap, jackpot switched on at a 2,000 USDC pool.

## Player outcomes

Share of sessions that end in profit, and the typical (median) result, after the 1%
settlement fee. v2 figures count the coin rebate at what it sells for immediately.

| Session | Current | v2, floor 7.5 | v2, floor 8.0 |
| --- | --- | --- | --- |
| 10 pulls (100 USDC) | 7.8%, −31.7 | 25.0%, −12.4 | 26.7%, −11.9 |
| 20 pulls (200 USDC) | 9.4%, −59.4 | 21.2%, −17.8 | 15.8%, −14.9 |
| 50 pulls (500 USDC) | 5.2%, −139 | 13.8%, −43.6 | 9.9%, −42.9 |
| 100 pulls (1,000 USDC) | 6.2%, −263 | 9.0%, −79.5 | 6.5%, −77.1 |
| Worst 10% of 20-pull sessions | −79.2 | −38.6 | −29.7 |

Pulls that break even or better: 15.0% now, 21.1% at floor 7.5 (all of them real wins,
because R pays 11), 22.2% at floor 8.0 (of which only 2.2% beat the ticket, because R
pays exactly 10).

Players get back 93.0% in prizes (92.1% after the settlement fee, 95.0% counting the
rebate), against 92.0% (91.1%) today.

## Prize pool and jackpot

| | Current | v2, floor 7.5 |
| --- | --- | --- |
| Steady pool, mean | about 15,200 | about 6,150 |
| Jackpot, mean / median / smallest | 7,887 / 6,913 / 2,040 | 3,282 / 2,956 / 1,015 |
| Median gap between jackpots | 3,688 pulls | 15,181 pulls |
| Jackpot switched off | 2.1% of the time | 3.8% of the time |
| Cold start: Legend and jackpot payable after | 1,200 to 2,800 pulls | 8,200 to 9,500 pulls |

The jackpot is smaller and about four times rarer. That is the price of the higher floor:
1.80 per pull reaches the pool instead of 4.20. A one-time 2,000 USDC seed makes every tier
payable from the first pull.

## A bug the simulation found

In the deployed program a pity pull that the cap downgrades does not reset the dry streak.
With v2 parameters the R prize costs more than a pull adds to the pool, so during the cold
start every player eventually sits on a permanent pity pull, the pool pays out the best
affordable prize every time and never grows. At floor 8.0 the pool stayed below 50 USDC for
500,000 pulls; at floor 7.5 it stalled in some runs. The fix is to let a pity pull use up
the guarantee whether or not it was downgraded. The numbers above use the fixed rule.

## Machine coin (rebate 0.3 per pull)

- If every player holds, the curve graduates after 16,667 pulls; if half sell at once,
  after about 33,000; if everyone sells at once, never.
- The rebate creates no value. After 50,000 pulls players paid 15,000 USDC into the coin;
  the paper value was 255,000, and what everyone together could cash out was 14,025.
- Who gets it depends on who sells first. If the earliest players sell first, the first 10%
  of pulls collect 2.71 USDC per pull and almost nothing is left for the rest.
- A player who sells the rebate immediately always gets about face value (5.94 for 6.00).
  Only players who choose to hold carry the risk.
- An early player (20 pulls among the first 1,000) who holds: the 6 USDC of coin is worth
  11 at 2,000 pulls, 55 at 10,000 and 376 at 30,000, provided later players hold too.

## Not covered

- Whether players actually keep playing. The model measures outcomes, not behaviour.
- Speculators buying or selling the coin, and creators dumping it.
- Protocol revenue falls from 0.50 to 0.80 per pull to 0.30 (plus about 0.09 settlement fee).
