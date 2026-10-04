//! Pure draw logic: touches no accounts or tokens, only the machine's ledger, so it can be
//! unit-tested and simulated natively.

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
    // Launchpad machines carve the buyback and the creator's cut out of the fee
    require!(a.fee_bps >= BUYBACK_BPS + CREATOR_BPS, GachaError::BadSeason);
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

/// One pull on a machine: split the funds, roll the tier, apply pity, the jackpot threshold
/// and the cap, compute the prize.
pub fn draw_one(s: &Season, m: &mut Machine, dry_streak: &mut u16, r: &[u8; 32]) -> Result<PullResult> {
    let price = s.pack_price;
    let fee = bps(price, s.fee_bps);
    let to_pool = bps(price, s.pool_bps);
    // Rounding remainder goes to the floor so nothing leaks
    let floor = price
        .checked_sub(fee)
        .and_then(|x| x.checked_sub(to_pool))
        .ok_or(GachaError::Overflow)?;

    // Split the funds. Launchpad machines share the fee with coin holders and the creator.
    let (buyback, creator) = match m.kind {
        MachineKind::Launchpad => (bps(price, BUYBACK_BPS), bps(price, CREATOR_BPS)),
        MachineKind::Official => (0, 0),
    };
    let protocol = fee
        .checked_sub(buyback + creator)
        .ok_or(GachaError::Overflow)?;
    m.pending = m.pending.checked_sub(price).ok_or(GachaError::Overflow)?;
    m.protocol_fees = m.protocol_fees.checked_add(protocol).ok_or(GachaError::Overflow)?;
    m.buyback_accrued = m.buyback_accrued.checked_add(buyback).ok_or(GachaError::Overflow)?;
    m.creator_accrued = m.creator_accrued.checked_add(creator).ok_or(GachaError::Overflow)?;
    m.prize_pool = m.prize_pool.checked_add(to_pool).ok_or(GachaError::Overflow)?;

    // Roll the tier (2^64 mod 1e6, bias is negligible)
    let roll = u64::from_le_bytes(r[0..8].try_into().unwrap()) % PPM;
    let mut tier = pick_tier(roll as u32, &s.tiers);
    if tier < SR && dry_streak.saturating_add(1) >= s.pity {
        tier = SR;
    }

    // The jackpot only pays above the activation threshold; below it the roll falls through
    // to the best fixed tier the pool can afford.
    if tier == JACKPOT && m.prize_pool < s.jackpot_min_pool {
        tier = JACKPOT - 1;
    }
    // Prize and cap: a fixed tier above the pool cap is downgraded
    let bonus = if tier == JACKPOT {
        m.jackpots_won = m.jackpots_won.saturating_add(1);
        bps(m.prize_pool, s.jackpot_share_bps)
    } else {
        let cap = bps(m.prize_pool, s.cap_bps);
        while tier > 0 && s.tiers[tier as usize].bonus > cap {
            tier -= 1;
        }
        s.tiers[tier as usize].bonus
    };
    m.prize_pool = m.prize_pool.checked_sub(bonus).ok_or(GachaError::Insolvent)?;

    let value = floor.checked_add(bonus).ok_or(GachaError::Overflow)?;
    m.locked = m.locked.checked_add(value).ok_or(GachaError::Overflow)?;
    m.total_pulls = m.total_pulls.checked_add(1).ok_or(GachaError::Overflow)?;
    m.total_volume = m.total_volume.checked_add(price).ok_or(GachaError::Overflow)?;

    let stock_r = u64::from_le_bytes(r[8..16].try_into().unwrap());
    let stock_idx = m.basket[(stock_r % m.basket.len() as u64) as usize];

    *dry_streak = if tier >= SR {
        0
    } else {
        dry_streak.saturating_add(1)
    };

    Ok(PullResult {
        tier,
        value,
        stock_idx,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use anchor_lang::solana_program::hash::hashv;

    const USDC: u64 = 1_000_000;

    fn default_args() -> SeasonArgs {
        let t = |prob_ppm: u32, bonus: u64| Tier {
            prob_ppm,
            bonus: bonus * USDC,
        };
        SeasonArgs {
            pack_price: 10 * USDC,
            fee_bps: 800,
            pool_bps: 4_200,
            settle_fee_bps: 100,
            cap_bps: 2_500,
            jackpot_share_bps: 5_000,
            pity: 30,
            timeout_slots: 1_500,
            jackpot_min_pool: 4_000 * USDC,
            tiers: [
                t(630_400, 0),
                t(220_000, 3),
                t(120_000, 7),
                t(25_000, 25),
                t(4_000, 95),
                t(400, 495),
                t(200, 0),
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
            status: MachineStatus::Live,
            creator: Pubkey::new_unique(),
            season: 0,
            name: "Test".into(),
            symbol: "TEST".into(),
            theme: 0,
            basket: vec![2, 3, 4],
            pool_token: Pubkey::new_unique(),
            coin_mint: Pubkey::default(),
            pending: 0,
            prize_pool: 0,
            locked: 0,
            protocol_fees: 0,
            buyback_accrued: 0,
            creator_accrued: 0,
            market_usdc: 0,
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
        a.tiers[1].bonus = 20 * USDC;
        a.tiers[2].bonus = 21 * USDC;
        assert!(validate_season(&a).is_err());

        let mut a = default_args();
        a.cap_bps = 5_001;
        assert!(validate_season(&a).is_err());

        // The fee must be able to cover the buyback and the creator's cut
        let mut a = default_args();
        a.fee_bps = 250;
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
    fn jackpot_is_inactive_below_the_threshold() {
        let s = season(&default_args());
        let mut dry = 0u16;

        // Empty pool: a jackpot roll falls all the way down to N
        let mut m = machine(MachineKind::Official);
        m.pending = s.pack_price;
        let res = draw_one(&s, &mut m, &mut dry, &roll(999_999)).unwrap();
        assert_eq!(res.tier, 0);
        assert_eq!(res.value, 5 * USDC);

        // 3,000 USDC pool: still below 4,000, so it pays the Legend prize instead
        let mut m = machine(MachineKind::Official);
        m.pending = s.pack_price;
        m.prize_pool = 3_000 * USDC;
        let res = draw_one(&s, &mut m, &mut dry, &roll(999_999)).unwrap();
        assert_eq!(res.tier, 5);
        assert_eq!(res.value, 500 * USDC);
        assert_eq!(m.jackpots_won, 0);

        // At the threshold the jackpot pays half the pool, which then drops below it again
        let mut m = machine(MachineKind::Official);
        m.pending = s.pack_price;
        m.prize_pool = 4_000 * USDC;
        let res = draw_one(&s, &mut m, &mut dry, &roll(999_999)).unwrap();
        assert_eq!(res.tier, JACKPOT);
        assert_eq!(res.value, 5 * USDC + 2_002_100_000);
        assert_eq!(m.jackpots_won, 1);
        assert!(m.prize_pool < s.jackpot_min_pool);
    }

    #[test]
    fn pity_guarantees_sr_on_30th_pull() {
        let s = season(&default_args());
        let mut m = machine(MachineKind::Official);
        m.prize_pool = 1_000 * USDC;
        let mut dry = 0u16;
        for i in 1..=30u32 {
            m.pending += s.pack_price;
            let res = draw_one(&s, &mut m, &mut dry, &roll(0)).unwrap();
            assert_eq!(res.tier, if i == 30 { SR } else { 0 }, "pull {i}");
            assert!([2, 3, 4].contains(&res.stock_idx));
        }
        assert_eq!(dry, 0);
    }

    #[test]
    fn launchpad_machines_split_the_fee_three_ways() {
        let s = season(&default_args());
        let mut dry = 0u16;
        let mut m = machine(MachineKind::Launchpad);
        m.pending = s.pack_price;
        draw_one(&s, &mut m, &mut dry, &roll(0)).unwrap();
        assert_eq!(m.protocol_fees, 500_000);
        assert_eq!(m.buyback_accrued, 200_000);
        assert_eq!(m.creator_accrued, 100_000);

        let mut m = machine(MachineKind::Official);
        m.pending = s.pack_price;
        draw_one(&s, &mut m, &mut dry, &roll(0)).unwrap();
        assert_eq!(m.protocol_fees, 800_000);
        assert_eq!(m.buyback_accrued + m.creator_accrued, 0);
    }

    /// Economic simulation: 500k pulls × 4 seeds, asserting the ledger and a non-negative
    /// pool at every step, for an official machine from zero and a seeded launchpad machine.
    #[test]
    fn simulation_keeps_invariants() {
        let s = season(&default_args());
        for seed in 0u8..4 {
            let launchpad = seed % 2 == 1;
            let mut m = machine(if launchpad { MachineKind::Launchpad } else { MachineKind::Official });
            let mut balance: u64 = 0; // machine token account balance
            if launchpad {
                // Graduation seeds the pool with 4,000 USDC, so the jackpot is live from day one
                m.prize_pool = 4_000 * USDC;
                balance = m.prize_pool;
            }
            let seeded = m.prize_pool;
            let mut dry = 0u16;
            let mut paid_total: u64 = 0;
            let mut won_total: u64 = 0;
            let mut tier_hits = [0u64; TIER_COUNT];
            let mut min_jackpot = u64::MAX;
            let mut first_jackpot = 0u32;

            for i in 0u32..500_000 {
                // buy
                balance += s.pack_price;
                m.pending += s.pack_price;
                paid_total += s.pack_price;

                // callback
                let r = hashv(&[&[seed], &i.to_le_bytes()]).to_bytes();
                let res = draw_one(&s, &mut m, &mut dry, &r).unwrap();
                tier_hits[res.tier as usize] += 1;
                won_total += res.value;
                if res.tier == JACKPOT {
                    min_jackpot = min_jackpot.min(res.value);
                    if first_jackpot == 0 {
                        first_jackpot = i + 1;
                    }
                }
                assert_eq!(balance, m.owed().unwrap());

                // claim
                let fee = bps(res.value, s.settle_fee_bps);
                m.locked -= res.value;
                m.protocol_fees += fee;
                balance -= res.value - fee;
                assert_eq!(balance, m.owed().unwrap());
            }

            assert_eq!(m.pending, 0);
            assert_eq!(m.locked, 0);
            let rtp = won_total as f64 / paid_total as f64;
            println!(
                "seed {seed} ({}): rtp {:.4}, pool {} USDC, first jackpot at pull {first_jackpot}, min jackpot {} USDC, tiers {:?}",
                if launchpad { "launchpad" } else { "official" },
                rtp,
                m.prize_pool / USDC,
                min_jackpot / USDC,
                tier_hits
            );
            // Players get back about 92% of what they paid, plus whatever seed the pool started with
            let max_back = (paid_total as f64 * 0.92 + seeded as f64) / paid_total as f64;
            assert!(rtp > 0.89 && rtp <= max_back, "rtp {rtp}");
            // Every jackpot is at least half the activation threshold
            assert!(min_jackpot >= 2_000 * USDC, "min jackpot {min_jackpot}");
            assert_eq!(m.total_volume, paid_total);
            if launchpad {
                assert_eq!(m.buyback_accrued, bps(paid_total, BUYBACK_BPS));
                assert_eq!(m.creator_accrued, bps(paid_total, CREATOR_BPS));
            }
        }
    }
}
