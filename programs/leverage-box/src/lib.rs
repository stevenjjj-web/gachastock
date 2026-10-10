//! Leverage Box: open a box, get a random leveraged position on a live price, and settle
//! against the other players a minute later.
//!
//! USDC is deposited on Solana and held in one vault. The player's account and the arena are
//! then delegated to a MagicBlock Ephemeral Rollup, where everything else happens in real
//! time and without fees: MagicBlock VRF draws each box's side and leverage, MagicBlock's
//! Pyth Lazer oracle gives the start and end price, and a round settles in one instruction.
//! Winners split what losers lose, so the program is never anyone's counterparty.

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};
use ephemeral_rollups_sdk::anchor::{commit, delegate, ephemeral};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::MagicIntentBundleBuilder;
use ephemeral_vrf_sdk::anchor::{vrf, vrf_callback};
use ephemeral_vrf_sdk::instructions::{create_request_randomness_ix, RequestRandomnessParams};
use ephemeral_vrf_sdk::types::SerializableAccountMeta;

pub mod math;
use math::*;

declare_id!("7YqLqC9wArnHb7aKcCRxkFMbKYE2gqQnExXtMyBdZ5Rv");

/// MagicBlock's real-time pricing oracle; it owns the Pyth Lazer price feed accounts.
pub const PRICE_PROGRAM: Pubkey = pubkey!("PriCems5tHihc6UDXDjzjeawomAwBduWMGAi8ZUjppd");
const PRICE_OFFSET: usize = 73;
const PUBLISH_TIME_OFFSET: usize = 93;
const MAX_PRICE_AGE_SECS: i64 = 15;

pub const ARENA_SEED: &[u8] = b"arena";
pub const PLAYER_SEED: &[u8] = b"player";
pub const VAULT_SEED: &[u8] = b"vault";
pub const VAULT_AUTH_SEED: &[u8] = b"vault_auth";

pub const MAX_TICKETS: usize = 8;
pub const HISTORY: usize = 16;
/// A box whose draw has not arrived after this long can be cancelled and refunded.
pub const PENDING_TIMEOUT_SECS: i64 = 20;

pub const PHASE_OPEN: u8 = 0;
pub const PHASE_LIVE: u8 = 1;

#[ephemeral]
#[program]
pub mod leverage_box {
    use super::*;

    // ---- Solana ----

    /// Creates the arena for one price feed, and the vault on first use.
    pub fn init_arena(ctx: Context<InitArena>, feed_id: u32, args: ArenaArgs) -> Result<()> {
        require!(
            args.open_secs >= 5 && args.live_secs >= 5 && args.fee_bps <= 2_000 && args.min_stake > 0 && args.max_stake >= args.min_stake,
            BoxError::BadArgs
        );
        let feed = Pubkey::find_program_address(
            &[b"price_feed", b"pyth-lazer", feed_id.to_string().as_bytes()],
            &PRICE_PROGRAM,
        )
        .0;
        let arena = &mut ctx.accounts.arena;
        arena.admin = ctx.accounts.admin.key();
        arena.usdc_mint = ctx.accounts.usdc_mint.key();
        arena.feed_id = feed_id;
        arena.feed = feed;
        arena.open_secs = args.open_secs;
        arena.live_secs = args.live_secs;
        arena.fee_bps = args.fee_bps;
        arena.min_stake = args.min_stake;
        arena.max_stake = args.max_stake;
        arena.round = 1;
        arena.phase = PHASE_OPEN;
        arena.lock_at = 0;
        arena.history = vec![RoundResult::default(); HISTORY];
        arena.bump = ctx.bumps.arena;
        Ok(())
    }

    /// Changes the arena's timing, fee and stake limits. Takes effect from the next round, and
    /// works on Solana or in the rollup, wherever the arena currently lives.
    pub fn configure(ctx: Context<Configure>, args: ArenaArgs) -> Result<()> {
        require!(
            args.open_secs >= 5 && args.live_secs >= 5 && args.fee_bps <= 2_000 && args.min_stake > 0 && args.max_stake >= args.min_stake,
            BoxError::BadArgs
        );
        let arena = &mut ctx.accounts.arena;
        arena.open_secs = args.open_secs;
        arena.live_secs = args.live_secs;
        arena.fee_bps = args.fee_bps;
        arena.min_stake = args.min_stake;
        arena.max_stake = args.max_stake;
        Ok(())
    }

    /// Hands the arena to the Ephemeral Rollup. Rounds run there from now on.
    pub fn delegate_arena(ctx: Context<DelegateArena>, feed_id: u32) -> Result<()> {
        ctx.accounts.delegate_arena(
            &ctx.accounts.admin,
            &[ARENA_SEED, &feed_id.to_le_bytes()],
            DelegateConfig {
                validator: ctx.remaining_accounts.first().map(|a| a.key()),
                ..Default::default()
            },
        )?;
        Ok(())
    }

    /// Deposits USDC into the vault and credits the player's balance. `session` is a key the
    /// player's browser holds: it may open boxes and claim in the rollup, never withdraw.
    pub fn enter(ctx: Context<Enter>, amount: u64, session: Pubkey) -> Result<()> {
        require!(amount > 0, BoxError::BadArgs);
        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.owner_usdc.to_account_info(),
                    mint: ctx.accounts.usdc_mint.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.owner.to_account_info(),
                },
            ),
            amount,
            ctx.accounts.usdc_mint.decimals,
        )?;
        let player = &mut ctx.accounts.player;
        player.owner = ctx.accounts.owner.key();
        player.session = session;
        player.balance = player.balance.checked_add(amount).ok_or(BoxError::Overflow)?;
        player.deposited = player.deposited.saturating_add(amount);
        player.bump = ctx.bumps.player;
        Ok(())
    }

    /// Hands the player's account to the Ephemeral Rollup.
    pub fn delegate_player(ctx: Context<DelegatePlayer>) -> Result<()> {
        ctx.accounts.delegate_player(
            &ctx.accounts.owner,
            &[PLAYER_SEED, ctx.accounts.owner.key().as_ref()],
            DelegateConfig {
                validator: ctx.remaining_accounts.first().map(|a| a.key()),
                ..Default::default()
            },
        )?;
        Ok(())
    }

    /// Pays the whole balance back to the owner. Only works once the account is back on Solana.
    pub fn withdraw(ctx: Context<Withdraw>) -> Result<()> {
        let player = &mut ctx.accounts.player;
        require!(!player.pending && player.tickets.iter().all(|t| t.side == 0), BoxError::StillPlaying);
        let amount = player.balance;
        require!(amount > 0, BoxError::NothingToClaim);
        player.balance = 0;
        player.withdrawn = player.withdrawn.saturating_add(amount);
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.vault.to_account_info(),
                    mint: ctx.accounts.usdc_mint.to_account_info(),
                    to: ctx.accounts.owner_usdc.to_account_info(),
                    authority: ctx.accounts.vault_auth.to_account_info(),
                },
                &[&[VAULT_AUTH_SEED, &[ctx.bumps.vault_auth]]],
            ),
            amount,
            ctx.accounts.usdc_mint.decimals,
        )
    }

    // ---- Ephemeral Rollup ----

    /// Pays for a box and asks MagicBlock VRF for its draw. Signed by the owner or the session key.
    pub fn open_box(ctx: Context<OpenBox>, stake: u64, client_seed: [u8; 32]) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let arena = &mut ctx.accounts.arena;
        let player = &mut ctx.accounts.player;
        require!(player.is_authorized(&ctx.accounts.signer.key()), BoxError::Unauthorized);
        require!(arena.phase == PHASE_OPEN, BoxError::RoundLocked);
        require!(stake >= arena.min_stake && stake <= arena.max_stake, BoxError::BadArgs);
        require!(!player.pending, BoxError::DrawPending);
        let arena_key = arena.key();
        credit_settled(player, arena, arena_key)?;
        require!(player.tickets.iter().any(|t| t.side == 0), BoxError::TooManyTickets);
        player.balance = player.balance.checked_sub(stake).ok_or(BoxError::InsufficientBalance)?;
        player.pending = true;
        player.pending_arena = arena.key();
        player.pending_round = arena.round;
        player.pending_stake = stake;
        player.pending_at = now;
        // The countdown to the lock starts with the first box of a round
        if arena.tickets == 0 && arena.pending == 0 {
            arena.lock_at = now + arena.open_secs as i64;
        }
        arena.pending += 1;

        let ix = create_request_randomness_ix(RequestRandomnessParams {
            payer: ctx.accounts.signer.key(),
            oracle_queue: ctx.accounts.oracle_queue.key(),
            callback_program_id: crate::ID,
            callback_discriminator: instruction::CallbackBox::DISCRIMINATOR.to_vec(),
            caller_seed: client_seed,
            accounts_metas: Some(vec![
                SerializableAccountMeta { pubkey: player.key(), is_signer: false, is_writable: true },
                SerializableAccountMeta { pubkey: arena.key(), is_signer: false, is_writable: true },
            ]),
            ..Default::default()
        });
        ctx.accounts.invoke_signed_vrf(&ctx.accounts.signer.to_account_info(), &ix)?;
        Ok(())
    }

    /// The draw. Only the MagicBlock VRF program can call it. It picks the leverage tier and
    /// the side; the side leans towards whichever is lighter so the round stays balanced.
    pub fn callback_box(ctx: Context<CallbackBox>, randomness: [u8; 32]) -> Result<()> {
        let arena = &mut ctx.accounts.arena;
        let player = &mut ctx.accounts.player;
        require!(player.pending && player.pending_arena == arena.key(), BoxError::NoDrawPending);
        let stake = player.pending_stake;
        player.pending = false;
        arena.pending = arena.pending.saturating_sub(1);

        let slot = player.tickets.iter().position(|t| t.side == 0);
        // The round moved on while the draw was in flight: give the money back
        let (Some(slot), true) = (slot, arena.phase == PHASE_OPEN && arena.round == player.pending_round) else {
            player.balance = player.balance.checked_add(stake).ok_or(BoxError::Overflow)?;
            return Ok(());
        };

        let tier = pick_tier(u32::from_le_bytes(randomness[0..4].try_into().unwrap()));
        let weight = (stake as u128) * (LEVERAGE[tier as usize] as u128);
        let (w_long, w_short) = arena.weights();
        let long = pick_long(u32::from_le_bytes(randomness[4..8].try_into().unwrap()), w_long, w_short, weight);
        let side = if long { LONG } else { SHORT };
        arena.buckets[side][tier as usize] = arena.buckets[side][tier as usize].checked_add(stake).ok_or(BoxError::Overflow)?;
        arena.tickets += 1;
        arena.staked = arena.staked.checked_add(stake).ok_or(BoxError::Overflow)?;
        player.tickets[slot] = Ticket { arena: arena.key(), round: arena.round, stake, side: side as u8 + 1, tier };
        player.boxes = player.boxes.saturating_add(1);
        emit!(BoxOpened { player: player.owner, arena: arena.key(), round: arena.round, stake, long, tier });
        Ok(())
    }

    /// Moves the round on when it is due: locks it at the current oracle price, or settles it
    /// at the current oracle price and opens the next one. Anyone can call it; it does nothing
    /// when nothing is due, so it is safe to run on a timer.
    pub fn tick(ctx: Context<Tick>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let arena = &mut ctx.accounts.arena;
        if arena.phase == PHASE_OPEN {
            if arena.tickets == 0 || now < arena.lock_at {
                return Ok(());
            }
            arena.start_price = read_price(&ctx.accounts.feed, now)?;
            arena.phase = PHASE_LIVE;
            arena.end_at = now + arena.live_secs as i64;
            emit!(RoundLocked { arena: arena.key(), round: arena.round, start_price: arena.start_price, end_at: arena.end_at });
            return Ok(());
        }
        if now < arena.end_at {
            return Ok(());
        }
        let end_price = read_price(&ctx.accounts.feed, now)?;
        let r_ppm = return_ppm(arena.start_price, end_price);
        let (owed, claimed, moved) = settle(&arena.buckets, r_ppm);
        let result = RoundResult {
            round: arena.round,
            r_ppm,
            owed,
            claimed,
            moved,
            start_price: arena.start_price,
            end_price,
            staked: arena.staked,
            tickets: arena.tickets,
        };
        let i = (arena.round as usize) % HISTORY;
        arena.history[i] = result;
        emit!(RoundSettled { arena: arena.key(), round: arena.round, r_ppm, moved, start_price: arena.start_price, end_price });

        arena.volume = arena.volume.saturating_add(arena.staked);
        arena.round += 1;
        arena.phase = PHASE_OPEN;
        arena.buckets = [[0; TIERS]; 2];
        arena.tickets = 0;
        arena.staked = 0;
        arena.start_price = 0;
        arena.lock_at = 0;
        arena.end_at = 0;
        Ok(())
    }

    /// Credits the player's finished tickets to their balance. Anyone can call it for anyone.
    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        let arena_key = ctx.accounts.arena.key();
        credit_settled(&mut ctx.accounts.player, &mut ctx.accounts.arena, arena_key)?;
        Ok(())
    }

    /// Refunds a box whose draw never arrived.
    pub fn cancel_pending(ctx: Context<Claim>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let arena = &mut ctx.accounts.arena;
        let player = &mut ctx.accounts.player;
        require!(player.pending && player.pending_arena == arena.key(), BoxError::NoDrawPending);
        require!(now - player.pending_at > PENDING_TIMEOUT_SECS, BoxError::TooEarly);
        player.pending = false;
        player.balance = player.balance.checked_add(player.pending_stake).ok_or(BoxError::Overflow)?;
        arena.pending = arena.pending.saturating_sub(1);
        Ok(())
    }

    /// Sends the player's account back to Solana so the balance can be withdrawn.
    pub fn leave(ctx: Context<Leave>) -> Result<()> {
        let player = &ctx.accounts.player;
        require!(player.is_authorized(&ctx.accounts.signer.key()), BoxError::Unauthorized);
        require!(!player.pending && player.tickets.iter().all(|t| t.side == 0), BoxError::StillPlaying);
        ctx.accounts.player.exit(&crate::ID)?;
        MagicIntentBundleBuilder::new(
            ctx.accounts.signer.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit_and_undelegate(&[ctx.accounts.player.to_account_info()])
        .build_and_invoke()?;
        Ok(())
    }
}

/// Settles every ticket the player holds in this arena whose round has finished.
fn credit_settled(player: &mut Player, arena: &mut Arena, arena_key: Pubkey) -> Result<u64> {
    let mut credited = 0u64;
    for t in player.tickets.iter_mut() {
        if t.side == 0 || t.arena != arena_key || t.round >= arena.round {
            continue;
        }
        let res = arena.history[(t.round as usize) % HISTORY];
        // A result that has already been overwritten can no longer be priced: return the stake
        let (pay, fee) = if res.round == t.round {
            payout(t.stake, t.side as usize - 1 == LONG, t.tier as usize, res.r_ppm, res.owed, res.claimed, res.moved, arena.fee_bps)
        } else {
            (t.stake, 0)
        };
        player.balance = player.balance.checked_add(pay).ok_or(BoxError::Overflow)?;
        player.staked = player.staked.saturating_add(t.stake);
        player.returned = player.returned.saturating_add(pay);
        arena.fees = arena.fees.saturating_add(fee);
        player.last = LastResult { round: t.round, stake: t.stake, payout: pay, side: t.side, tier: t.tier };
        credited += pay;
        *t = Ticket::default();
    }
    Ok(credited)
}

/// Reads the price from MagicBlock's Pyth Lazer feed account and rejects stale data.
fn read_price(feed: &AccountInfo, now: i64) -> Result<i64> {
    require_keys_eq!(*feed.owner, PRICE_PROGRAM, BoxError::BadFeed);
    let data = feed.try_borrow_data()?;
    require!(data.len() >= PUBLISH_TIME_OFFSET + 8, BoxError::BadFeed);
    let price = i64::from_le_bytes(data[PRICE_OFFSET..PRICE_OFFSET + 8].try_into().unwrap());
    let published = i64::from_le_bytes(data[PUBLISH_TIME_OFFSET..PUBLISH_TIME_OFFSET + 8].try_into().unwrap());
    require!(price > 0, BoxError::BadFeed);
    require!(now - published <= MAX_PRICE_AGE_SECS, BoxError::StalePrice);
    Ok(price)
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace, Debug, PartialEq)]
pub struct RoundResult {
    pub round: u64,
    pub r_ppm: i64,
    pub owed: u64,
    pub claimed: u64,
    pub moved: u64,
    pub start_price: i64,
    pub end_price: i64,
    pub staked: u64,
    pub tickets: u32,
}

/// One market: a price feed and the round currently running on it.
#[account]
#[derive(InitSpace)]
pub struct Arena {
    pub admin: Pubkey,
    pub usdc_mint: Pubkey,
    pub feed_id: u32,
    pub feed: Pubkey,
    pub open_secs: u32,
    pub live_secs: u32,
    pub fee_bps: u16,
    pub min_stake: u64,
    pub max_stake: u64,

    // Current round
    pub round: u64,
    pub phase: u8,
    /// Boxes paid for whose draw has not arrived yet
    pub pending: u32,
    pub tickets: u32,
    pub staked: u64,
    pub lock_at: i64,
    pub end_at: i64,
    pub start_price: i64,
    /// Stake per side and leverage tier: `buckets[side][tier]`
    pub buckets: [[u64; TIERS]; 2],

    /// Results of the last `HISTORY` rounds, indexed by `round % HISTORY`. A Vec so it is
    /// deserialized on the heap; it always holds exactly `HISTORY` entries.
    #[max_len(HISTORY)]
    pub history: Vec<RoundResult>,
    pub fees: u64,
    pub volume: u64,
    pub bump: u8,
}

impl Arena {
    /// Leverage-weighted stake on each side.
    pub fn weights(&self) -> (u128, u128) {
        let side = |s: usize| (0..TIERS).map(|t| (self.buckets[s][t] as u128) * (LEVERAGE[t] as u128)).sum();
        (side(LONG), side(SHORT))
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace, Debug, PartialEq)]
pub struct Ticket {
    pub arena: Pubkey,
    pub round: u64,
    pub stake: u64,
    /// 0 = empty slot, 1 = long, 2 = short
    pub side: u8,
    pub tier: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace, Debug, PartialEq)]
pub struct LastResult {
    pub round: u64,
    pub stake: u64,
    pub payout: u64,
    pub side: u8,
    pub tier: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Player {
    pub owner: Pubkey,
    pub session: Pubkey,
    pub balance: u64,
    pub pending: bool,
    pub pending_arena: Pubkey,
    pub pending_round: u64,
    pub pending_stake: u64,
    pub pending_at: i64,
    pub tickets: [Ticket; MAX_TICKETS],
    pub last: LastResult,
    pub boxes: u64,
    pub staked: u64,
    pub returned: u64,
    pub deposited: u64,
    pub withdrawn: u64,
    pub bump: u8,
}

impl Player {
    pub fn is_authorized(&self, signer: &Pubkey) -> bool {
        *signer == self.owner || *signer == self.session
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ArenaArgs {
    pub open_secs: u32,
    pub live_secs: u32,
    pub fee_bps: u16,
    pub min_stake: u64,
    pub max_stake: u64,
}

#[event]
pub struct BoxOpened {
    pub player: Pubkey,
    pub arena: Pubkey,
    pub round: u64,
    pub stake: u64,
    pub long: bool,
    pub tier: u8,
}

#[event]
pub struct RoundLocked {
    pub arena: Pubkey,
    pub round: u64,
    pub start_price: i64,
    pub end_at: i64,
}

#[event]
pub struct RoundSettled {
    pub arena: Pubkey,
    pub round: u64,
    pub r_ppm: i64,
    pub moved: u64,
    pub start_price: i64,
    pub end_price: i64,
}

#[error_code]
pub enum BoxError {
    #[msg("Invalid arguments")]
    BadArgs,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("This round is locked; wait for the next one")]
    RoundLocked,
    #[msg("A box is still waiting for its draw")]
    DrawPending,
    #[msg("No box is waiting for a draw")]
    NoDrawPending,
    #[msg("Too many open tickets; claim the finished ones first")]
    TooManyTickets,
    #[msg("Not enough balance")]
    InsufficientBalance,
    #[msg("Tickets or a draw are still open")]
    StillPlaying,
    #[msg("Nothing to withdraw")]
    NothingToClaim,
    #[msg("Not available yet")]
    TooEarly,
    #[msg("This is not the arena's price feed")]
    BadFeed,
    #[msg("The price feed is stale")]
    StalePrice,
}

#[derive(Accounts)]
#[instruction(feed_id: u32)]
pub struct InitArena<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(init, payer = admin, space = 8 + Arena::INIT_SPACE, seeds = [ARENA_SEED, &feed_id.to_le_bytes()], bump)]
    pub arena: Box<Account<'info, Arena>>,
    /// CHECK: PDA that signs for the vault
    #[account(seeds = [VAULT_AUTH_SEED], bump)]
    pub vault_auth: AccountInfo<'info>,
    #[account(
        init_if_needed,
        payer = admin,
        seeds = [VAULT_SEED],
        bump,
        token::mint = usdc_mint,
        token::authority = vault_auth,
        token::token_program = token_program,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    pub usdc_mint: InterfaceAccount<'info, Mint>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Configure<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [ARENA_SEED, &arena.feed_id.to_le_bytes()], bump = arena.bump, has_one = admin @ BoxError::Unauthorized)]
    pub arena: Box<Account<'info, Arena>>,
}

#[delegate]
#[derive(Accounts)]
#[instruction(feed_id: u32)]
pub struct DelegateArena<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    /// CHECK: the arena PDA being delegated
    #[account(mut, del, seeds = [ARENA_SEED, &feed_id.to_le_bytes()], bump)]
    pub arena: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct Enter<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(init_if_needed, payer = owner, space = 8 + Player::INIT_SPACE, seeds = [PLAYER_SEED, owner.key().as_ref()], bump)]
    pub player: Box<Account<'info, Player>>,
    #[account(mut, seeds = [VAULT_SEED], bump)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = usdc_mint, token::authority = owner, token::token_program = token_program)]
    pub owner_usdc: InterfaceAccount<'info, TokenAccount>,
    #[account(address = vault.mint)]
    pub usdc_mint: InterfaceAccount<'info, Mint>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[delegate]
#[derive(Accounts)]
pub struct DelegatePlayer<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    /// CHECK: the player PDA being delegated
    #[account(mut, del, seeds = [PLAYER_SEED, owner.key().as_ref()], bump)]
    pub player: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut, seeds = [PLAYER_SEED, owner.key().as_ref()], bump = player.bump, has_one = owner @ BoxError::Unauthorized)]
    pub player: Box<Account<'info, Player>>,
    /// CHECK: PDA that signs for the vault
    #[account(seeds = [VAULT_AUTH_SEED], bump)]
    pub vault_auth: AccountInfo<'info>,
    #[account(mut, seeds = [VAULT_SEED], bump)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = usdc_mint, token::authority = owner, token::token_program = token_program)]
    pub owner_usdc: InterfaceAccount<'info, TokenAccount>,
    #[account(address = vault.mint)]
    pub usdc_mint: InterfaceAccount<'info, Mint>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[vrf]
#[derive(Accounts)]
pub struct OpenBox<'info> {
    /// The owner or the player's session key; also pays, which costs nothing in the rollup
    #[account(mut)]
    pub signer: Signer<'info>,
    #[account(mut, seeds = [PLAYER_SEED, player.owner.as_ref()], bump = player.bump)]
    pub player: Box<Account<'info, Player>>,
    #[account(mut, seeds = [ARENA_SEED, &arena.feed_id.to_le_bytes()], bump = arena.bump)]
    pub arena: Box<Account<'info, Arena>>,
    /// CHECK: MagicBlock's VRF queue for Ephemeral Rollups
    #[account(mut, address = ephemeral_vrf_sdk::consts::DEFAULT_EPHEMERAL_QUEUE)]
    pub oracle_queue: AccountInfo<'info>,
}

#[vrf_callback]
#[derive(Accounts)]
pub struct CallbackBox<'info> {
    #[account(mut, seeds = [PLAYER_SEED, player.owner.as_ref()], bump = player.bump)]
    pub player: Box<Account<'info, Player>>,
    #[account(mut, seeds = [ARENA_SEED, &arena.feed_id.to_le_bytes()], bump = arena.bump)]
    pub arena: Box<Account<'info, Arena>>,
}

#[derive(Accounts)]
pub struct Tick<'info> {
    #[account(mut, seeds = [ARENA_SEED, &arena.feed_id.to_le_bytes()], bump = arena.bump)]
    pub arena: Box<Account<'info, Arena>>,
    /// CHECK: the arena's Pyth Lazer price feed; owner and freshness are checked when read
    #[account(address = arena.feed @ BoxError::BadFeed)]
    pub feed: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut, seeds = [PLAYER_SEED, player.owner.as_ref()], bump = player.bump)]
    pub player: Box<Account<'info, Player>>,
    #[account(mut, seeds = [ARENA_SEED, &arena.feed_id.to_le_bytes()], bump = arena.bump)]
    pub arena: Box<Account<'info, Arena>>,
}

#[commit]
#[derive(Accounts)]
pub struct Leave<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
    #[account(mut, seeds = [PLAYER_SEED, player.owner.as_ref()], bump = player.bump)]
    pub player: Box<Account<'info, Player>>,
}
