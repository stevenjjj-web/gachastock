use anchor_lang::prelude::*;

pub const PPM: u64 = 1_000_000;
pub const MAX_PULLS: usize = 10;
pub const TIER_COUNT: usize = 7;
pub const MAX_WHITELIST: usize = 16;
pub const MAX_BASKET: usize = 8;

/// Tier indices: N, R, SR, SSR, UR, Legend, Jackpot
pub const SR: u8 = 2;
pub const JACKPOT: u8 = 6;

/// Launchpad machines split the per-pull fee: this much of the pack price buys back and
/// burns the machine coin, this much goes to the creator, the rest to the protocol.
pub const BUYBACK_BPS: u16 = 200;
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
    /// Run by the protocol; the whole fee goes to the protocol and there is no machine coin.
    Official,
    /// Launched by anyone, with a machine coin sold on a bonding curve.
    Launchpad,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace, Debug, PartialEq, Eq)]
pub enum MachineStatus {
    /// The machine coin is selling on the bonding curve; the machine is not open yet.
    Curve,
    /// Open for pulls.
    Live,
    /// The curve missed its deadline; holders sell back along the curve and the machine never opens.
    Failed,
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
    /// roll is treated as the best fixed tier the pool can afford.
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

/// One gacha machine: its own theme, stock basket and prize pool, with its own ledger.
/// The machine's USDC token account must always hold at least the sum of the ledger fields.
#[account]
#[derive(InitSpace)]
pub struct Machine {
    pub id: u64,
    pub kind: MachineKind,
    pub status: MachineStatus,
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
    pub pool_token: Pubkey,
    /// Machine coin mint; default for official machines.
    pub coin_mint: Pubkey,

    // Ledger
    pub pending: u64,
    pub prize_pool: u64,
    pub locked: u64,
    pub protocol_fees: u64,
    pub buyback_accrued: u64,
    pub creator_accrued: u64,
    /// USDC backing the machine coin: the curve reserve before graduation, the pool's USDC side after.
    pub market_usdc: u64,

    // Stats
    pub total_pulls: u64,
    pub total_volume: u64,
    pub jackpots_won: u32,
    pub bump: u8,
}

impl Machine {
    pub fn owed(&self) -> Option<u64> {
        self.pending
            .checked_add(self.prize_pool)?
            .checked_add(self.locked)?
            .checked_add(self.protocol_fees)?
            .checked_add(self.buyback_accrued)?
            .checked_add(self.creator_accrued)?
            .checked_add(self.market_usdc)
    }
}

/// Coin-side state of a launchpad machine's market.
#[account]
#[derive(InitSpace)]
pub struct Curve {
    pub machine: Pubkey,
    pub deadline: i64,
    pub launch_slot: u64,
    /// Coins sold by the curve and still outstanding (pre-graduation).
    pub sold: u64,
    pub creator_bought: u64,
    /// Coin side of the post-graduation pool. These coins are minted only when bought.
    pub pool_coins: u64,
    /// Coins removed for good by buybacks.
    pub burned: u64,
    /// USDC spent on buybacks so far.
    pub bought_back: u64,
    pub graduated_at: i64,
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
    pub seed: u64,
    pub pool_usdc: u64,
    pub pool_coins: u64,
}

#[event]
pub struct BuybackBurned {
    pub machine: Pubkey,
    pub usdc: u64,
    pub coins: u64,
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
    pub prize_pool_after: u64,
}

#[event]
pub struct PackClaimed {
    pub pack: Pubkey,
    pub owner: Pubkey,
    pub amount: u64,
    pub settle_fee: u64,
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
    #[msg("This machine is not open")]
    NotLive,
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
}
