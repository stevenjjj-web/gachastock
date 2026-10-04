//! Pure draw logic: touches no token accounts, only the ledgers, so it can be unit-tested
//! and simulated natively.

use crate::market::buy_exact;
use crate::state::*;
use anchor_lang::prelude::*;

pub fn bps(amount: u64, b: u16) -> u64 {
    ((amount as u128) * (b as u128) / 10_000u128) as u64
}

pub fn validate_season(a: &SeasonArgs) -> Result<()> {
    require!(a.pack_price > 0, GachaError::BadSeason);
    require!(
        (a.fee_bps as u32) + (a.pool_bps as u32) < 10_000,
        GachaError::BadSeason
    );
    // The coin rebate and the creator's cut are carved out of the fee
    require!(a.fee_bps >= REBATE_BPS + CREATOR_BPS, GachaError::BadSeason);
    require!(a.settle_fee_bps <= 1_000, GachaError::BadSeason);
    require!(a.cap_bps > 0 && a.cap_bps <= 5_000, GachaError::BadSeason);
    require!(
        a.jackpot_share_bps > 0 && a.jackpot_share_bps <= 5_000,
        GachaError::BadSeason
    );
    require!(a.pity > 0, GachaError::BadSeason);
    require!(a.timeout_slots >= 150, GachaError::BadSeason);

    // The seven tier probabilities must sum to 1,000,000 ppm
    let sum: u64 = a.tiers.iter().map(|t| t.prob_ppm as u64).sum();
    require!(sum == PPM, GachaError::BadProbSum);

    // Fixed-tier bonuses strictly increase and N is 0; the jackpot pays a share of the pool, so its bonus must be 0
    require!(a.tiers[0].bonus == 0, GachaError::BadSeason);
    require!(a.tiers[JACKPOT as usize].bonus == 0, GachaError::BadSeason);
    for i in 1..JACKPOT as usize {
        require!(a.tiers[i].bonus > a.tiers[i - 1].bonus, GachaError::BadSeason);
    }

    // Expected fixed-tier payout Σ(prob_ppm × bonus) / 1e6 must be below the per-pack prize pool inflow
    let expected_ppm: u128 = a.tiers[..JACKPOT as usize]
        .iter()
        .map(|t| (t.prob_ppm as u128) * (t.bonus as u128))
        .sum();
    let inflow_ppm = (bps(a.pack_price, a.pool_bps) as u128) * (PPM as u128);
    require!(expected_ppm < inflow_ppm, GachaError::BudgetExceeded);

    require!(
        !a.whitelist.is_empty() && a.whitelist.len() <= MAX_WHITELIST,
        GachaError::BadSeason
    );
    Ok(())
}

pub fn validate_machine_args(a: &MachineArgs, whitelist_len: usize) -> Result<()> {
    require!(
        !a.name.trim().is_empty() && a.name.len() <= 32,
        GachaError::BadMachine
    );
    require!(
        (2..=10).contains(&a.symbol.len())
            && a.symbol
                .bytes()
                .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit()),
        GachaError::BadMachine
    );
    require!(
        !a.basket.is_empty() && a.basket.len() <= MAX_BASKET,
        GachaError::BadMachine
    );
    for (i, s) in a.basket.iter().enumerate() {
        require!((*s as usize) < whitelist_len, GachaError::BadMachine);
        require!(!a.basket[..i].contains(s), GachaError::BadMachine);
    }
    Ok(())
}

pub fn pick_tier(roll: u32, tiers: &[Tier; TIER_COUNT]) -> u8 {
    let mut acc = 0u32;
    for (i, t) in tiers.iter().enumerate() {
        acc += t.prob_ppm;
        if roll < acc {
            return i as u8;
        }
    }
    0
}

/// Where one pack price goes.
#[derive(Debug, PartialEq, Clone, Copy)]
pub struct Split {
    /// Always the player's
    pub floor: u64,
    /// Into the shared prize pool
    pub pool: u64,
    /// Buys the machine coin for the player
    pub rebate: u64,
    pub creator: u64,
    pub protocol: u64,
}

pub fn split(s: &Season, kind: MachineKind) -> Result<Split> {
    let price = s.pack_price;
    let fee = bps(price, s.fee_bps);
    let to_pool = bps(price, s.pool_bps);
    // Rounding remainder goes to the floor so nothing leaks
    let floor = price
        .checked_sub(fee)
        .and_then(|x| x.checked_sub(to_pool))
        .ok_or(GachaError::Overflow)?;
    let rebate = bps(price, REBATE_BPS);
    let creator = bps(price, CREATOR_BPS);
    let rest = fee
        .checked_sub(rebate + creator)
        .ok_or(GachaError::Overflow)?;
    Ok(match kind {
        MachineKind::Launchpad => Split {
            floor,
            pool: to_pool,
            rebate,
            creator,
            protocol: rest,
        },
        // No coin to buy and no creator to pay: the coin share feeds the prize pool instead
        MachineKind::Official => Split {
            floor,
            pool: to_pool + rebate,
            rebate: 0,
            creator: 0,
            protocol: rest + creator,
        },
    })
}

/// One pull on a machine: split the funds, buy the machine coin for the player, roll the
/// tier, apply pity, the jackpot threshold and the cap, compute the prize. Returns the pull
/// and the coins it bought.
pub fn draw_one(
    s: &Season,
    v: &mut Vault,
    m: &mut Machine,
    curve: Option<&mut Curve>,
    dry_streak: &mut u16,
    r: &[u8; 32],
    now: i64,
) -> Result<(PullResult, u64)> {
    let price = s.pack_price;
    let sp = split(s, m.kind)?;

    v.pending = v.pending.checked_sub(price).ok_or(GachaError::Overflow)?;
    v.protocol_fees = v.protocol_fees.checked_add(sp.protocol).ok_or(GachaError::Overflow)?;
    v.prize_pool = v.prize_pool.checked_add(sp.pool).ok_or(GachaError::Overflow)?;
    v.markets = v
        .markets
        .checked_add(sp.creator + sp.rebate)
        .ok_or(GachaError::Overflow)?;
    m.creator_accrued = m.creator_accrued.checked_add(sp.creator).ok_or(GachaError::Overflow)?;
    let coins = if sp.rebate > 0 {
        let c = curve.ok_or(GachaError::BadCoinAccount)?;
        let coins = buy_exact(&mut m.market_usdc, c, sp.rebate, now)?;
        c.rebated_coins = c.rebated_coins.checked_add(coins).ok_or(GachaError::Overflow)?;
        c.rebated_usdc = c.rebated_usdc.checked_add(sp.rebate).ok_or(GachaError::Overflow)?;
        coins
    } else {
        0
    };

    // Roll the tier (2^64 mod 1e6, bias is negligible)
    let roll = u64::from_le_bytes(r[0..8].try_into().unwrap()) % PPM;
    let mut tier = pick_tier(roll as u32, &s.tiers);
    let pity = tier < SR && dry_streak.saturating_add(1) >= s.pity;
    if pity {
        tier = SR;
    }

    // The jackpot only pays above the activation threshold; below it the roll falls through
    // to the best fixed tier the pool can afford.
    if tier == JACKPOT && v.prize_pool < s.jackpot_min_pool {
        tier = JACKPOT - 1;
    }
    // Prize and cap: a fixed tier above the pool cap is downgraded
    let bonus = if tier == JACKPOT {
        v.jackpots_won = v.jackpots_won.saturating_add(1);
        m.jackpots_won = m.jackpots_won.saturating_add(1);
        bps(v.prize_pool, s.jackpot_share_bps)
    } else {
        let cap = bps(v.prize_pool, s.cap_bps);
        while tier > 0 && s.tiers[tier as usize].bonus > cap {
            tier -= 1;
        }
        s.tiers[tier as usize].bonus
    };
    v.prize_pool = v.prize_pool.checked_sub(bonus).ok_or(GachaError::Insolvent)?;

    let value = sp.floor.checked_add(bonus).ok_or(GachaError::Overflow)?;
    v.locked = v.locked.checked_add(value).ok_or(GachaError::Overflow)?;
    for (pulls, volume) in [
        (&mut v.total_pulls, &mut v.total_volume),
        (&mut m.total_pulls, &mut m.total_volume),
    ] {
        *pulls = pulls.checked_add(1).ok_or(GachaError::Overflow)?;
        *volume = volume.checked_add(price).ok_or(GachaError::Overflow)?;
    }

    let stock_r = u64::from_le_bytes(r[8..16].try_into().unwrap());
    let stock_idx = m.basket[(stock_r % m.basket.len() as u64) as usize];

    // A pity pull uses up the guarantee even when the cap downgrades it. Otherwise a small
    // pool would leave every player on a permanent pity pull and could never grow.
    *dry_streak = if tier >= SR || pity {
        0
    } else {
        dry_streak.saturating_add(1)
    };

    Ok((
        PullResult {
            tier,
            value,
            stock_idx,
        },
        coins,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::market::{pool_sell, CURVE_SUPPLY};
    use anchor_lang::solana_program::hash::hashv;

    const USDC: u64 = 1_000_000;

    fn default_args() -> SeasonArgs {
        // Bonus on top of the 7.50 floor, in cents
        let t = |prob_ppm: u32, cents: u64| Tier {
            prob_ppm,
            bonus: cents * USDC / 100,
        };
        SeasonArgs {
            pack_price: 10 * USDC,
            fee_bps: 700,
            pool_bps: 1_800,
            settle_fee_bps: 100,
            cap_bps: 2_500,
            jackpot_share_bps: 5_000,
            pity: 60,
            timeout_slots: 1_500,
            jackpot_min_pool: 2_000 * USDC,
            tiers: [
                t(788_750, 0),
                t(175_000, 350),
                t(22_500, 1_750),
                t(13_000, 3_250),
                t(500, 9_250),
                t(200, 49_250),
                t(50, 0),
            ],
            whitelist: (0..11).map(|_| Pubkey::new_unique()).collect(),
        }
    }

    fn season(a: &SeasonArgs) -> Season {
        Season {
            id: 0,
            pack_price: a.pack_price,
            fee_bps: a.fee_bps,
            pool_bps: a.pool_bps,
            settle_fee_bps: a.settle_fee_bps,
            cap_bps: a.cap_bps,
            jackpot_share_bps: a.jackpot_share_bps,
            pity: a.pity,
            timeout_slots: a.timeout_slots,
            jackpot_min_pool: a.jackpot_min_pool,
            tiers: a.tiers,
            whitelist: a.whitelist.clone(),
            bump: 0,
        }
    }

    fn machine(kind: MachineKind) -> Machine {
        Machine {
            id: 0,
            kind,
            creator: Pubkey::new_unique(),
            season: 0,
            name: "Test".into(),
            symbol: "TEST".into(),
            theme: 0,
            basket: vec![2, 3, 4],
            coin_mint: Pubkey::default(),
            market_usdc: 0,
            creator_accrued: 0,
            total_pulls: 0,
            total_volume: 0,
            jackpots_won: 0,
            bump: 0,
        }
    }

    fn roll(n: u64) -> [u8; 32] {
        let mut r = [0u8; 32];
        r[0..8].copy_from_slice(&n.to_le_bytes());
        r
    }

    /// One pull on an official machine with the pool preset.
    fn pull(s: &Season, pool: u64, dry: &mut u16, n: u64) -> (PullResult, Vault) {
        let mut v = Vault {
            pending: s.pack_price,
            prize_pool: pool,
            ..Default::default()
        };
        let mut m = machine(MachineKind::Official);
        let (res, coins) = draw_one(s, &mut v, &mut m, None, dry, &roll(n), 0).unwrap();
        assert_eq!(coins, 0);
        (res, v)
    }

    #[test]
    fn default_season_is_valid() {
        validate_season(&default_args()).unwrap();
    }

    #[test]
    fn rejects_bad_seasons_and_machines() {
        let mut a = default_args();
        a.tiers[0].prob_ppm += 1;
        assert!(validate_season(&a).is_err());

        // Expected payout exceeds the pool inflow
        let mut a = default_args();
        a.tiers[1].bonus = 10 * USDC;
        assert!(validate_season(&a).is_err());

        let mut a = default_args();
        a.cap_bps = 5_001;
        assert!(validate_season(&a).is_err());

        // The fee must be able to cover the coin rebate and the creator's cut
        let mut a = default_args();
        a.fee_bps = 350;
        assert!(validate_season(&a).is_err());

        let ok = MachineArgs { name: "Mag 7 Mania".into(), symbol: "MAG7".into(), theme: 1, basket: vec![2, 3] };
        validate_machine_args(&ok, 11).unwrap();
        for bad in [
            MachineArgs { symbol: "mag7".into(), ..ok.clone() },
            MachineArgs { symbol: "X".into(), ..ok.clone() },
            MachineArgs { name: " ".into(), ..ok.clone() },
            MachineArgs { basket: vec![], ..ok.clone() },
            MachineArgs { basket: vec![2, 2], ..ok.clone() },
            MachineArgs { basket: vec![11], ..ok.clone() },
        ] {
            assert!(validate_machine_args(&bad, 11).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn every_pack_price_is_fully_accounted_for() {
        let s = season(&default_args());
        let l = split(&s, MachineKind::Launchpad).unwrap();
        assert_eq!(
            (l.floor, l.pool, l.rebate, l.creator, l.protocol),
            (7_500_000, 1_800_000, 300_000, 100_000, 300_000)
        );
        let o = split(&s, MachineKind::Official).unwrap();
        assert_eq!(
            (o.floor, o.pool, o.rebate, o.creator, o.protocol),
            (7_500_000, 2_100_000, 0, 0, 400_000)
        );
        for sp in [l, o] {
            assert_eq!(sp.floor + sp.pool + sp.rebate + sp.creator + sp.protocol, s.pack_price);
        }
    }

    #[test]
    fn jackpot_is_inactive_below_the_threshold() {
        let s = season(&default_args());
        let mut dry = 0u16;

        // Empty pool: a jackpot roll falls all the way down to N
        let (res, _) = pull(&s, 0, &mut dry, 999_999);
        assert_eq!(res.tier, 0);
        assert_eq!(res.value, 7_500_000);

        // 1,990 USDC pool: below the threshold, so it pays the Legend prize instead
        let (res, v) = pull(&s, 1_990 * USDC, &mut dry, 999_999);
        assert_eq!(res.tier, 5);
        assert_eq!(res.value, 500 * USDC);
        assert_eq!(v.jackpots_won, 0);

        // At the threshold the jackpot pays half the pool, which then drops below it again
        let (res, v) = pull(&s, 2_000 * USDC, &mut dry, 999_999);
        assert_eq!(res.tier, JACKPOT);
        assert_eq!(res.value, 7_500_000 + (2_000 * USDC + 2_100_000) / 2);
        assert_eq!(v.jackpots_won, 1);
        assert!(v.prize_pool < s.jackpot_min_pool);
    }

    #[test]
    fn pity_guarantees_sr_on_the_60th_pull() {
        let s = season(&default_args());
        let mut dry = 0u16;
        for i in 1..=60u32 {
            let (res, _) = pull(&s, 1_000 * USDC, &mut dry, 0);
            assert_eq!(res.tier, if i == 60 { SR } else { 0 }, "pull {i}");
            assert!([2, 3, 4].contains(&res.stock_idx));
        }
        assert_eq!(dry, 0);
    }

    #[test]
    fn a_downgraded_pity_pull_still_uses_up_the_guarantee() {
        let s = season(&default_args());
        // 20 USDC in the pool: the cap is 5, so SR (17.50) is out of reach and pity pays R
        let mut dry = s.pity - 1;
        let (res, _) = pull(&s, 20 * USDC, &mut dry, 0);
        assert_eq!(res.tier, 1);
        assert_eq!(dry, 0);
    }

    #[test]
    fn launchpad_pulls_buy_the_coin_for_the_player() {
        let s = season(&default_args());
        let mut dry = 0u16;
        let mut v = Vault { pending: s.pack_price, ..Default::default() };
        let mut m = machine(MachineKind::Launchpad);
        let mut c = Curve::default();
        let (_, coins) = draw_one(&s, &mut v, &mut m, Some(&mut c), &mut dry, &roll(0), 0).unwrap();
        // 0.30 USDC at the opening price of 0.00000125 buys just under 240,000 coins
        assert!(coins > 239_900 * USDC && coins < 240_000 * USDC, "{coins}");
        assert_eq!((c.sold, c.rebated_coins, c.rebated_usdc), (coins, coins, 300_000));
        assert_eq!((m.market_usdc, m.creator_accrued), (300_000, 100_000));
        assert_eq!((v.protocol_fees, v.prize_pool, v.markets), (300_000, 1_800_000, 400_000));
        assert_eq!(v.owed().unwrap(), s.pack_price);

        // A launchpad machine cannot draw without its curve
        v.pending = s.pack_price;
        assert!(draw_one(&s, &mut v, &mut m, None, &mut dry, &roll(0), 0).is_err());
    }

    /// Economic simulation: 2M pulls on the shared pool from zero, alternating between an
    /// official and a launchpad machine, asserting the ledgers at every step.
    #[test]
    fn simulation_keeps_invariants() {
        let s = season(&default_args());
        for seed in 0u8..2 {
            let mut v = Vault::default();
            let mut official = machine(MachineKind::Official);
            let mut launchpad = machine(MachineKind::Launchpad);
            let mut c = Curve::default();
            let mut balance: u64 = 0; // vault token account balance
            let mut dry = 0u16;
            let (mut paid_total, mut won_total, mut coins_total) = (0u64, 0u64, 0u64);
            let mut tier_hits = [0u64; TIER_COUNT];
            let mut min_jackpot = u64::MAX;
            let (mut first_legend, mut first_jackpot) = (0u32, 0u32);
            const PULLS: u32 = 2_000_000;

            for i in 0u32..PULLS {
                // buy
                balance += s.pack_price;
                v.pending += s.pack_price;
                paid_total += s.pack_price;

                // callback
                let r = hashv(&[&[seed], &i.to_le_bytes()]).to_bytes();
                let (res, coins) = if i % 2 == 0 {
                    draw_one(&s, &mut v, &mut official, None, &mut dry, &r, i as i64)
                } else {
                    draw_one(&s, &mut v, &mut launchpad, Some(&mut c), &mut dry, &r, i as i64)
                }
                .unwrap();
                tier_hits[res.tier as usize] += 1;
                won_total += res.value;
                coins_total += coins;
                if res.tier == JACKPOT {
                    min_jackpot = min_jackpot.min(res.value);
                    if first_jackpot == 0 {
                        first_jackpot = i + 1;
                    }
                }
                if res.tier == 5 && first_legend == 0 {
                    first_legend = i + 1;
                }
                assert_eq!(balance, v.owed().unwrap());
                assert_eq!(v.markets, launchpad.market_usdc + launchpad.creator_accrued);

                // claim
                let fee = bps(res.value, s.settle_fee_bps);
                v.locked -= res.value;
                v.protocol_fees += fee;
                balance -= res.value - fee;
                assert_eq!(balance, v.owed().unwrap());
            }

            assert_eq!((v.pending, v.locked), (0, 0));
            assert_eq!(v.total_volume, paid_total);
            assert_eq!(official.total_pulls + launchpad.total_pulls, PULLS as u64);
            let rtp = won_total as f64 / paid_total as f64;
            println!(
                "seed {seed}: rtp {:.4}, pool {} USDC, first legend at pull {first_legend}, first jackpot at pull {first_jackpot}, min jackpot {} USDC, tiers {:?}",
                rtp,
                v.prize_pool / USDC,
                min_jackpot / USDC,
                tier_hits
            );
            // Prizes can never exceed the floor plus what went into the pool: 7.5 + (1.8 + 2.1) / 2
            assert!(rtp > 0.92 && rtp <= 0.945, "rtp {rtp}");
            // The pool starts from zero and still reaches every tier
            assert!(first_legend > 0 && first_jackpot > 0);
            // Every jackpot is at least half the activation threshold
            assert!(min_jackpot >= 1_000 * USDC, "min jackpot {min_jackpot}");

            // Half the pulls were on the launchpad machine: 0.30 each bought its coin, 0.10 went to its creator
            let launchpad_paid = launchpad.total_volume;
            assert_eq!(c.rebated_usdc, bps(launchpad_paid, REBATE_BPS));
            assert_eq!(launchpad.market_usdc, c.rebated_usdc);
            assert_eq!(launchpad.creator_accrued, bps(launchpad_paid, CREATOR_BPS));
            assert_eq!(c.rebated_coins, coins_total);
            assert!(c.graduated && c.sold == CURVE_SUPPLY);
            // The coin is fully backed: everyone selling at once cannot take more than its market holds
            assert!(pool_sell(launchpad.market_usdc, c.pool_coins, coins_total) < launchpad.market_usdc);
        }
    }
}
