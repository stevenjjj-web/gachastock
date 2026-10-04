use anchor_lang::prelude::*;

pub const PPM: u64 = 1_000_000;
pub const MAX_PULLS: usize = 10;
pub const TIER_COUNT: usize = 7;
pub const MAX_WHITELIST: usize = 16;
pub const MAX_BASKET: usize = 8;

/// Tier indices: N, R, SR, SSR, UR, Legend, Jackpot
pub const SR: u8 = 2;
pub const JACKPOT: u8 = 6;

/// Launchpad machines split the per-pull fee: this much of the pack price buys the machine
/// coin for the player who pulled, this much goes to the creator, the rest to the protocol.
/// Official machines have no coin and no creator: the coin share goes to the prize pool and
/// the creator's share to the protocol.
pub const REBATE_BPS: u16 = 300;
pub const CREATOR_BPS: u16 = 100;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace, Debug, PartialEq)]
pub struct Tier {
    pub prob_ppm: u32,
    /// Prize-pool payout on top of the floor (USDC base units). Ignored for the jackpot tier.
    pub bonus: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace, Debug, PartialEq)]
pub struct PullResult {
    pub tier: u8,
    pub value: u64,
    /// Index into the season's stock whitelist
    pub stock_idx: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace, Debug, PartialEq, Eq)]
pub enum PackStatus {
    Pending,
    Revealed,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace, Debug, PartialEq, Eq)]
pub enum MachineKind {
    /// Run by the protocol; there is no machine coin.
    Official,
    /// Launched by anyone, with a machine coin that players earn by pulling.
    Launchpad,
}

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub treasury: Pubkey,
    pub usdc_mint: Pubkey,
    /// Unused; kept so the account layout stays stable across upgrades.
    pub reserved: Pubkey,
    pub paused: bool,
    pub active_season: u16,
    pub season_count: u16,
    pub bump: u8,
}

/// The one prize pool every machine plays for, and the only place the program holds USDC.
/// Its token account must always hold at least the sum of the ledger fields.
#[account]
#[derive(InitSpace, Default)]
pub struct Vault {
    pub token: Pubkey,

    // Ledger
    /// Paid for packs that are still waiting for their draw.
    pub pending: u64,
    pub prize_pool: u64,
    /// Revealed prizes that have not been claimed yet.
    pub locked: u64,
    pub protocol_fees: u64,
    /// Sum over all machines of `market_usdc + creator_accrued`.
    pub markets: u64,

    // Stats
    pub total_pulls: u64,
    pub total_volume: u64,
    pub jackpots_won: u32,
    pub bump: u8,
}

impl Vault {
    pub fn owed(&self) -> Option<u64> {
        self.pending
            .checked_add(self.prize_pool)?
            .checked_add(self.locked)?
            .checked_add(self.protocol_fees)?
            .checked_add(self.markets)
    }
}

/// Economic parameters shared by machines. Immutable once published; new parameters need a
/// new season, and every machine keeps the season it was created under.
#[account]
#[derive(InitSpace)]
pub struct Season {
    pub id: u16,
    pub pack_price: u64,
    pub fee_bps: u16,
    pub pool_bps: u16,
    pub settle_fee_bps: u16,
    pub cap_bps: u16,
    pub jackpot_share_bps: u16,
    pub pity: u16,
    pub timeout_slots: u64,
    /// The jackpot only pays while the prize pool is at least this large; below it a jackpot
    /// roll pays the best fixed tier the pool can afford.
    pub jackpot_min_pool: u64,
    pub tiers: [Tier; TIER_COUNT],
    /// Stock mints a machine may put in its basket.
    #[max_len(MAX_WHITELIST)]
    pub whitelist: Vec<Pubkey>,
    pub bump: u8,
}

#[account]
#[derive(InitSpace, Default)]
pub struct Registry {
    pub machine_count: u64,
    pub bump: u8,
}

/// One gacha machine: a theme, a stock basket and, for launchpad machines, a coin and a
/// creator. Machines hold no USDC themselves; the amounts below are their share of the vault.
#[account]
#[derive(InitSpace)]
pub struct Machine {
    pub id: u64,
    pub kind: MachineKind,
    pub creator: Pubkey,
    pub season: u16,
    #[max_len(32)]
    pub name: String,
    #[max_len(10)]
    pub symbol: String,
    /// Art / colour preset; display only.
    pub theme: u8,
    /// Indices into the season's stock whitelist.
    #[max_len(MAX_BASKET)]
    pub basket: Vec<u8>,
    /// Machine coin mint; default for official machines.
    pub coin_mint: Pubkey,

    // Ledger
    /// USDC backing the machine coin: the curve reserve before graduation, the pool's USDC side after.
    pub market_usdc: u64,
    pub creator_accrued: u64,

    // Stats
    pub total_pulls: u64,
    pub total_volume: u64,
    pub jackpots_won: u32,
    pub bump: u8,
}

/// Coin-side state of a launchpad machine's market.
#[account]
#[derive(InitSpace, Default)]
pub struct Curve {
    pub machine: Pubkey,
    pub launch_slot: u64,
    /// Coins sold by the curve and still outstanding. Stays at the full curve supply after graduation.
    pub sold: u64,
    pub creator_bought: u64,
    /// The curve sold out and the coin now trades against the pool.
    pub graduated: bool,
    pub graduated_at: i64,
    /// Coin side of the post-graduation pool. These coins are minted only when bought.
    pub pool_coins: u64,
    /// Coins bought for players by their pulls, and the USDC that paid for them.
    pub rebated_coins: u64,
    pub rebated_usdc: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Pack {
    pub owner: Pubkey,
    pub rent_payer: Pubkey,
    pub machine: Pubkey,
    pub season: u16,
    pub count: u8,
    pub paid: u64,
    pub status: PackStatus,
    pub request_slot: u64,
    pub locked_amount: u64,
    /// Machine coins the pulls bought for the owner; minted on claim.
    pub coins: u64,
    pub results: [PullResult; MAX_PULLS],
    pub nonce: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Player {
    pub owner: Pubkey,
    pub dry_streak: u16,
    pub total_pulls: u64,
    pub total_spent: u64,
    pub total_won: u64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct SeasonArgs {
    pub pack_price: u64,
    pub fee_bps: u16,
    pub pool_bps: u16,
    pub settle_fee_bps: u16,
    pub cap_bps: u16,
    pub jackpot_share_bps: u16,
    pub pity: u16,
    pub timeout_slots: u64,
    pub jackpot_min_pool: u64,
    pub tiers: [Tier; TIER_COUNT],
    pub whitelist: Vec<Pubkey>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct MachineArgs {
    pub name: String,
    pub symbol: String,
    pub theme: u8,
    pub basket: Vec<u8>,
}

#[event]
pub struct MachineCreated {
    pub machine: Pubkey,
    pub id: u64,
    pub creator: Pubkey,
    pub coin_mint: Pubkey,
    pub launchpad: bool,
}

#[event]
pub struct CoinTraded {
    pub machine: Pubkey,
    pub user: Pubkey,
    pub is_buy: bool,
    pub usdc: u64,
    pub coins: u64,
    pub fee: u64,
}

#[event]
pub struct MachineGraduated {
    pub machine: Pubkey,
    pub pool_usdc: u64,
    pub pool_coins: u64,
}

#[event]
pub struct PoolFunded {
    pub funder: Pubkey,
    pub amount: u64,
    pub prize_pool_after: u64,
}

#[event]
pub struct PacksBought {
    pub pack: Pubkey,
    pub machine: Pubkey,
    pub owner: Pubkey,
    pub count: u8,
    pub paid: u64,
}

#[event]
pub struct PackOpened {
    pub pack: Pubkey,
    pub machine: Pubkey,
    pub owner: Pubkey,
    pub count: u8,
    pub results: [PullResult; MAX_PULLS],
    pub locked_amount: u64,
    pub coins: u64,
    pub prize_pool_after: u64,
}

#[event]
pub struct PackClaimed {
    pub pack: Pubkey,
    pub owner: Pubkey,
    pub amount: u64,
    pub settle_fee: u64,
    pub coins: u64,
}

#[event]
pub struct PackRefunded {
    pub pack: Pubkey,
    pub owner: Pubkey,
    pub amount: u64,
}

#[error_code]
pub enum GachaError {
    #[msg("New purchases are paused")]
    Paused,
    #[msg("Pull count must be between 1 and 10")]
    BadCount,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Pack is in the wrong status")]
    BadStatus,
    #[msg("Season mismatch")]
    SeasonMismatch,
    #[msg("Prize pool or token balance is insufficient")]
    Insolvent,
    #[msg("Timeout has not elapsed yet")]
    TooEarly,
    #[msg("Invalid season parameters")]
    BadSeason,
    #[msg("Probabilities must sum to 1,000,000 ppm")]
    BadProbSum,
    #[msg("Expected fixed-tier payout must be below the per-pack prize pool inflow")]
    BudgetExceeded,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Nothing to withdraw")]
    NothingToWithdraw,
    #[msg("Invalid machine parameters")]
    BadMachine,
    #[msg("This machine coin is not trading")]
    MarketClosed,
    #[msg("Price moved past the slippage limit")]
    Slippage,
    #[msg("The creator's allocation on the curve is used up")]
    CreatorCap,
    #[msg("Purchase is above the limit for the first blocks after launch")]
    EarlyCap,
    #[msg("Trade amount is too small")]
    TooSmall,
    #[msg("The machine coin accounts are missing or do not match")]
    BadCoinAccount,
}
