//! Machine coin market: pure math for the bonding curve and the post-graduation pool.
//!
//! Before graduation the coin sells on a constant-product curve with virtual reserves. Once
//! the whole curve allocation is sold the machine graduates: most of the raise seeds the
//! machine's prize pool and the rest becomes the USDC side of a constant-product pool whose
//! coin side is priced at the curve's final price. Everything rounds in the market's favour.

use crate::draw::bps;
use crate::state::GachaError;
use anchor_lang::prelude::*;

pub const COIN_DECIMALS: u8 = 6;
const COIN: u64 = 1_000_000;
const USDC: u64 = 1_000_000;

/// Virtual reserves at launch. Chosen so that selling CURVE_SUPPLY raises exactly 5,000 USDC.
pub const VIRTUAL_COINS: u64 = 1_000_000_000 * COIN;
pub const VIRTUAL_USDC: u64 = 1_250 * USDC;
/// Coins the curve sells before graduation.
pub const CURVE_SUPPLY: u64 = 800_000_000 * COIN;
/// Of the raise, this much seeds the machine's prize pool; the rest backs the trading pool.
pub const SEED_USDC: u64 = 4_000 * USDC;

pub const TRADE_FEE_BPS: u16 = 100;
pub const LAUNCH_FEE: u64 = 10 * USDC;
pub const SALE_SECS: i64 = 7 * 24 * 3600;
/// For this many slots after launch a single purchase is capped, to blunt sniping.
pub const EARLY_SLOTS: u64 = 150;
pub const EARLY_MAX_USDC: u64 = 100 * USDC;
/// The creator may hold at most this much of the curve allocation.
pub const CREATOR_MAX_COINS: u64 = CURVE_SUPPLY / 20;
pub const MAX_BUYBACK_PER_CRANK: u64 = 25 * USDC;

fn k() -> u128 {
    (VIRTUAL_COINS as u128) * (VIRTUAL_USDC as u128)
}

fn ceil_div(a: u128, b: u128) -> u128 {
    a.div_ceil(b)
}

#[derive(Debug, PartialEq, Clone, Copy)]
pub struct CurveBuy {
    pub coins_out: u64,
    /// USDC added to the curve reserve
    pub net: u64,
    pub fee: u64,
}

/// Buys on the curve with a total budget (fee included). If the budget would buy more than
/// the curve has left, only the remainder is sold and only that much is charged.
pub fn curve_buy(reserve: u64, sold: u64, budget: u64) -> Result<CurveBuy> {
    require!(sold < CURVE_SUPPLY, GachaError::MarketClosed);
    let vu = (VIRTUAL_USDC as u128) + (reserve as u128);
    let vt = (VIRTUAL_COINS - sold) as u128;
    // fee is charged on top of the net amount: budget = net + net * fee_bps / 10_000
    let net = ((budget as u128) * 10_000 / (10_000 + TRADE_FEE_BPS as u128)) as u64;
    let new_vt = ceil_div(k(), vu + net as u128);
    let out = vt.saturating_sub(new_vt) as u64;
    let left = CURVE_SUPPLY - sold;
    if out < left {
        return Ok(CurveBuy {
            coins_out: out,
            net,
            fee: budget - net,
        });
    }
    // Fill exactly what is left and charge only for that.
    let needed = ceil_div(k(), vt - left as u128).saturating_sub(vu) as u64;
    Ok(CurveBuy {
        coins_out: left,
        net: needed,
        fee: (bps(needed, TRADE_FEE_BPS) + 1).min(budget.saturating_sub(needed)),
    })
}

/// USDC released from the curve reserve for selling `coins_in` back, before any fee.
pub fn curve_sell(reserve: u64, sold: u64, coins_in: u64) -> Result<u64> {
    require!(coins_in > 0 && coins_in <= sold, GachaError::TooSmall);
    let vu = (VIRTUAL_USDC as u128) + (reserve as u128);
    let vt = (VIRTUAL_COINS - sold) as u128;
    let new_vu = ceil_div(k(), vt + coins_in as u128);
    Ok((vu.saturating_sub(new_vu) as u64).min(reserve))
}

/// Split of the curve reserve at graduation: (prize pool seed, pool USDC, pool coins).
/// The pool's coin side is sized so its price equals the curve's final price.
pub fn graduation_split(reserve: u64) -> Result<(u64, u64, u64)> {
    let pool_usdc = reserve
        .checked_sub(SEED_USDC)
        .ok_or(GachaError::Insolvent)?;
    let vu = (VIRTUAL_USDC as u128) + (reserve as u128);
    let vt = (VIRTUAL_COINS - CURVE_SUPPLY) as u128;
    let pool_coins = ((pool_usdc as u128) * vt / vu) as u64;
    require!(pool_usdc > 0 && pool_coins > 0, GachaError::Insolvent);
    Ok((SEED_USDC, pool_usdc, pool_coins))
}

/// Coins bought from the pool for `usdc_in` (net of any fee).
pub fn pool_buy(pool_usdc: u64, pool_coins: u64, usdc_in: u64) -> u64 {
    let k = (pool_usdc as u128) * (pool_coins as u128);
    let new_coins = ceil_div(k, pool_usdc as u128 + usdc_in as u128);
    (pool_coins as u128).saturating_sub(new_coins) as u64
}

/// USDC paid by the pool for `coins_in`, before any fee.
pub fn pool_sell(pool_usdc: u64, pool_coins: u64, coins_in: u64) -> u64 {
    let k = (pool_usdc as u128) * (pool_coins as u128);
    let new_usdc = ceil_div(k, pool_coins as u128 + coins_in as u128);
    (pool_usdc as u128).saturating_sub(new_usdc) as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selling_the_whole_curve_raises_5000_usdc() {
        let b = curve_buy(0, 0, u64::MAX / 20_000).unwrap();
        assert_eq!(b.coins_out, CURVE_SUPPLY);
        assert_eq!(b.net, 5_000 * USDC);
        let (seed, pool_usdc, pool_coins) = graduation_split(b.net).unwrap();
        assert_eq!(seed, 4_000 * USDC);
        assert_eq!(pool_usdc, 1_000 * USDC);
        assert_eq!(pool_coins, 32_000_000 * COIN);
        // Pool opens at the curve's final price: 6,250 USDC / 200M coins
        assert_eq!(
            (pool_usdc as u128) * 200_000_000,
            (pool_coins as u128 / COIN as u128) * 6_250 * USDC as u128
        );
    }

    /// Many small buys then selling everything back never pays out more than went in, and
    /// the reserve always covers every outstanding coin.
    #[test]
    fn curve_round_trip_never_drains_the_reserve() {
        let (mut reserve, mut sold) = (0u64, 0u64);
        let mut lots = vec![];
        let mut paid_in = 0u64;
        for i in 0..200u64 {
            let budget = (1 + i % 37) * USDC + i * 7;
            let b = curve_buy(reserve, sold, budget).unwrap();
            assert!(b.net + b.fee <= budget);
            reserve += b.net;
            sold += b.coins_out;
            paid_in += b.net;
            lots.push(b.coins_out);
            // Whoever sells everything outstanding gets at most the reserve
            assert!(curve_sell(reserve, sold, sold).unwrap() <= reserve);
        }
        let mut paid_out = 0u64;
        for coins in lots.into_iter().rev() {
            let out = curve_sell(reserve, sold, coins).unwrap();
            reserve -= out;
            sold -= coins;
            paid_out += out;
        }
        assert_eq!(sold, 0);
        assert!(paid_out <= paid_in);
        // Rounding dust stays in the reserve; it is tiny
        assert!(paid_in - paid_out < 1_000, "dust {}", paid_in - paid_out);
    }

    #[test]
    fn final_buy_is_filled_partially_and_charged_only_for_the_fill() {
        let b = curve_buy(0, 0, 4_000 * USDC).unwrap();
        let (reserve, sold) = (b.net, b.coins_out);
        let last = curve_buy(reserve, sold, 1_000_000 * USDC).unwrap();
        assert_eq!(sold + last.coins_out, CURVE_SUPPLY);
        assert!(reserve + last.net >= 5_000 * USDC);
        assert!(reserve + last.net < 5_000 * USDC + 10);
        assert!(last.net + last.fee < 1_100 * USDC);
        assert!(curve_buy(reserve + last.net, CURVE_SUPPLY, USDC).is_err());
    }

    #[test]
    fn pool_trades_round_in_the_pools_favour() {
        let (mut u, mut c) = (1_000 * USDC, 32_000_000 * COIN);
        let k0 = u as u128 * c as u128;
        let out = pool_buy(u, c, 50 * USDC);
        u += 50 * USDC;
        c -= out;
        assert!(u as u128 * c as u128 >= k0);
        let back = pool_sell(u, c, out);
        assert!(back <= 50 * USDC);
        u -= back;
        c += out;
        assert!(u as u128 * c as u128 >= k0);
        // A buyback raises the price for everyone left
        let before = u as u128 * COIN as u128 / c as u128;
        let burned = pool_buy(u, c, 25 * USDC);
        let after = (u + 25 * USDC) as u128 * COIN as u128 / (c - burned) as u128;
        assert!(after > before);
    }
}
