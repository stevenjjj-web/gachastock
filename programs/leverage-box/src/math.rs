//! Pure settlement math for a round. Everything a round pays out comes from what its losing
//! tickets lose: the program never takes the other side. Rounding always favours solvency.

pub const TIERS: usize = 5;
/// Leverage of each tier. A weight, not a promised multiple: winners split what losers lose.
/// Rounds last well under a minute, when prices move a few hundredths of a percent, so the
/// numbers are large.
pub const LEVERAGE: [u64; TIERS] = [500, 1_000, 2_500, 5_000, 10_000];
/// Chance of each tier, in parts per million.
pub const TIER_PPM: [u32; TIERS] = [400_000, 300_000, 180_000, 90_000, 30_000];
pub const PPM: u128 = 1_000_000;

pub const LONG: usize = 0;
pub const SHORT: usize = 1;

pub fn pick_tier(roll: u32) -> u8 {
    let mut acc = 0u32;
    for (i, p) in TIER_PPM.iter().enumerate() {
        acc += p;
        if roll % (PPM as u32) < acc {
            return i as u8;
        }
    }
    0
}

/// Chooses the side for a new ticket of weight `w`. The lighter side is more likely, so the
/// two sides stay close to balanced without anyone having to take the other side on purpose.
pub fn pick_long(roll: u32, w_long: u128, w_short: u128, w: u128) -> bool {
    let total = w_long + w_short + w;
    if total == 0 {
        return roll % 2 == 0;
    }
    let p_long = (w_short + w / 2) * PPM / total;
    ((roll as u128) % PPM) < p_long
}

/// Price move over the round in parts per million, signed.
pub fn return_ppm(start: i64, end: i64) -> i64 {
    if start <= 0 {
        return 0;
    }
    (((end as i128) - (start as i128)) * (PPM as i128) / (start as i128)) as i64
}

/// `stake * leverage * |r|`, the uncapped amount a ticket moves by, rounded down.
fn swing(stake: u64, tier: usize, abs_r: u128) -> u128 {
    (stake as u128) * (LEVERAGE[tier] as u128) * abs_r / PPM
}

/// Totals for a finished round: what the losing side owes (each ticket capped at its stake),
/// what the winning side claims, and the amount that actually changes hands.
pub fn settle(buckets: &[[u64; TIERS]; 2], r_ppm: i64) -> (u64, u64, u64) {
    if r_ppm == 0 {
        return (0, 0, 0);
    }
    let abs_r = r_ppm.unsigned_abs() as u128;
    let (win, lose) = if r_ppm > 0 { (LONG, SHORT) } else { (SHORT, LONG) };
    let mut owed = 0u128;
    let mut claimed = 0u128;
    for tier in 0..TIERS {
        owed += swing(buckets[lose][tier], tier, abs_r).min(buckets[lose][tier] as u128);
        claimed += swing(buckets[win][tier], tier, abs_r);
    }
    let owed = owed.min(u64::MAX as u128) as u64;
    let claimed = claimed.min(u64::MAX as u128) as u64;
    (owed, claimed, owed.min(claimed))
}

/// What one ticket gets back, and the fee taken from its winnings. Losers are rounded up and
/// winners down, so a round can never pay out more than it took in.
pub fn payout(stake: u64, long: bool, tier: usize, r_ppm: i64, owed: u64, claimed: u64, moved: u64, fee_bps: u16) -> (u64, u64) {
    if r_ppm == 0 || moved == 0 {
        return (stake, 0);
    }
    let abs_r = r_ppm.unsigned_abs() as u128;
    if long == (r_ppm > 0) {
        let claim = swing(stake, tier, abs_r);
        let gain = (claim * (moved as u128) / (claimed.max(1) as u128)) as u64;
        let fee = ((gain as u128) * (fee_bps as u128) / 10_000) as u64;
        (stake + gain - fee, fee)
    } else {
        let liability = ((stake as u128) * (LEVERAGE[tier] as u128) * abs_r).div_ceil(PPM).min(stake as u128);
        let paid = (liability * (moved as u128)).div_ceil(owed.max(1) as u128).min(stake as u128) as u64;
        (stake - paid, 0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const USDC: u64 = 1_000_000;

    #[test]
    fn tier_odds_sum_to_one() {
        assert_eq!(TIER_PPM.iter().sum::<u32>(), PPM as u32);
        assert_eq!(pick_tier(0), 0);
        assert_eq!(pick_tier(399_999), 0);
        assert_eq!(pick_tier(400_000), 1);
        assert_eq!(pick_tier(999_999), 4);
    }

    #[test]
    fn the_lighter_side_is_more_likely() {
        // Nothing on either side: a coin flip
        assert!(pick_long(499_999, 0, 0, 1_000));
        assert!(!pick_long(500_000, 0, 0, 1_000));
        // All the weight is long, so the new ticket almost surely goes short
        let longs = (0..1_000u32).filter(|i| pick_long(i * 1_000, 1_000_000, 0, 1_000)).count();
        assert!(longs < 5, "{longs}");
    }

    #[test]
    fn a_flat_round_returns_every_stake() {
        let b = [[10 * USDC; TIERS]; 2];
        let (owed, claimed, moved) = settle(&b, 0);
        assert_eq!((owed, claimed, moved), (0, 0, 0));
        assert_eq!(payout(10 * USDC, true, 2, 0, owed, claimed, moved, 1_000), (10 * USDC, 0));
    }

    #[test]
    fn one_sided_rounds_move_nothing() {
        let mut b = [[0u64; TIERS]; 2];
        b[LONG][4] = 50 * USDC;
        for r in [-5_000, 5_000] {
            let (owed, claimed, moved) = settle(&b, r);
            assert_eq!(moved, 0);
            assert_eq!(payout(50 * USDC, true, 4, r, owed, claimed, moved, 1_000), (50 * USDC, 0));
        }
    }

    #[test]
    fn losers_are_capped_at_their_stake_and_winners_split_it() {
        // 10,000x short against 500x long, 10 USDC each, price up 0.1%
        let mut b = [[0u64; TIERS]; 2];
        b[SHORT][4] = 10 * USDC;
        b[LONG][0] = 10 * USDC;
        let r = 1_000;
        let (owed, claimed, moved) = settle(&b, r);
        // The short would owe 100 but only has 10; the long claims 500 * 0.1% * 10 = 5
        assert_eq!((owed, claimed, moved), (10 * USDC, 5 * USDC, 5 * USDC));
        assert_eq!(payout(10 * USDC, false, 4, r, owed, claimed, moved, 1_000), (5 * USDC, 0));
        assert_eq!(payout(10 * USDC, true, 0, r, owed, claimed, moved, 1_000), (14 * USDC + 500_000, 500_000));
    }

    /// Random rounds: whatever the tickets and the move, payouts plus fees never exceed stakes,
    /// and the shortfall is rounding dust only.
    #[test]
    fn rounds_conserve_money() {
        let mut s = 0x9e3779b97f4a7c15u64;
        let mut rnd = || {
            s ^= s << 13;
            s ^= s >> 7;
            s ^= s << 17;
            s
        };
        for _ in 0..20_000 {
            let n = 1 + (rnd() % 60) as usize;
            let mut buckets = [[0u64; TIERS]; 2];
            let mut tickets = vec![];
            for _ in 0..n {
                let stake = (1 + rnd() % 50) * USDC + rnd() % USDC;
                let tier = pick_tier((rnd() % 1_000_000) as u32) as usize;
                let (wl, ws): (u128, u128) = (0..TIERS).fold((0, 0), |(l, sh), t| {
                    (l + buckets[LONG][t] as u128 * LEVERAGE[t] as u128, sh + buckets[SHORT][t] as u128 * LEVERAGE[t] as u128)
                });
                let long = pick_long((rnd() % 1_000_000) as u32, wl, ws, stake as u128 * LEVERAGE[tier] as u128);
                buckets[if long { LONG } else { SHORT }][tier] += stake;
                tickets.push((stake, long, tier));
            }
            let r = (rnd() % 4_001) as i64 - 2_000; // up to ±0.2%
            let (owed, claimed, moved) = settle(&buckets, r);
            let staked: u64 = tickets.iter().map(|t| t.0).sum();
            let mut out = 0u64;
            for (stake, long, tier) in &tickets {
                let (pay, fee) = payout(*stake, *long, *tier, r, owed, claimed, moved, 1_000);
                out += pay + fee;
            }
            assert!(out <= staked, "paid {out} of {staked}");
            assert!(staked - out <= 2 * n as u64, "dust {} over {n} tickets", staked - out);
        }
    }
}
