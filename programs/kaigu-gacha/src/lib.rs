//! GachaStock: gacha machines for tokenized US stocks on Solana.
//!
//! Tickets only, never the house: every machine holds only USDC and pays prizes from its own
//! player-funded pool. Randomness comes from MagicBlock VRF; the draw happens in the callback,
//! which only touches the ledger. Anyone can launch a machine together with a machine coin
//! that sells on a bonding curve, seeds the prize pool at graduation, and is bought back and
//! burned with part of every pull's fee.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hashv;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Burn, MintTo, Token};
use anchor_spl::token_interface::{
    self, Mint, TokenAccount, TokenInterface, TransferChecked,
};
use ephemeral_vrf_sdk::anchor::{vrf, vrf_callback};
use ephemeral_vrf_sdk::instructions::{create_request_randomness_ix, RequestRandomnessParams};
use ephemeral_vrf_sdk::types::SerializableAccountMeta;

pub mod draw;
pub mod market;
pub mod state;

use draw::*;
use market::*;
use state::*;

declare_id!("7VAfdZyRRWCvLdPUpqYbeuSsvtQW4cp2PeVQvkAtBHHv");

#[program]
pub mod kaigu_gacha {
    use super::*;

    /// Creates the Config. Only the program upgrade authority (multisig) may call it.
    pub fn initialize(ctx: Context<Initialize>, treasury: Pubkey) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.admin = ctx.accounts.admin.key();
        config.treasury = treasury;
        config.usdc_mint = ctx.accounts.usdc_mint.key();
        config.reserved = Pubkey::default();
        config.paused = true; // opens once the first season is published
        config.active_season = 0;
        config.season_count = 0;
        config.bump = ctx.bumps.config;
        Ok(())
    }

    /// Publishes a new season and makes it the one new machines are created under.
    /// Published seasons are immutable; existing machines keep their own season.
    pub fn create_season(ctx: Context<CreateSeason>, args: SeasonArgs) -> Result<()> {
        validate_season(&args)?;
        let config = &mut ctx.accounts.config;
        let id = config.season_count;
        ctx.accounts.season.set_inner(Season {
            id,
            pack_price: args.pack_price,
            fee_bps: args.fee_bps,
            pool_bps: args.pool_bps,
            settle_fee_bps: args.settle_fee_bps,
            cap_bps: args.cap_bps,
            jackpot_share_bps: args.jackpot_share_bps,
            pity: args.pity,
            timeout_slots: args.timeout_slots,
            jackpot_min_pool: args.jackpot_min_pool,
            tiers: args.tiers,
            whitelist: args.whitelist,
            bump: ctx.bumps.season,
        });
        config.active_season = id;
        config.season_count = id.checked_add(1).ok_or(GachaError::Overflow)?;
        config.paused = false;
        Ok(())
    }

    /// Creates an official machine: open immediately, no machine coin, whole fee to the protocol.
    pub fn create_machine(ctx: Context<CreateMachine>, args: MachineArgs) -> Result<()> {
        validate_machine_args(&args, ctx.accounts.season.whitelist.len())?;
        let registry = &mut ctx.accounts.registry;
        let id = registry.machine_count;
        registry.machine_count = id.checked_add(1).ok_or(GachaError::Overflow)?;
        registry.bump = ctx.bumps.registry;
        ctx.accounts.machine.set_inner(new_machine(
            id,
            MachineKind::Official,
            MachineStatus::Live,
            ctx.accounts.admin.key(),
            ctx.accounts.season.id,
            args,
            ctx.accounts.pool_token.key(),
            Pubkey::default(),
            ctx.bumps.machine,
        ));
        emit!(MachineCreated {
            machine: ctx.accounts.machine.key(),
            id,
            creator: ctx.accounts.admin.key(),
            coin_mint: Pubkey::default(),
            launchpad: false,
        });
        Ok(())
    }

    /// Launchpad: anyone can launch a machine and its coin. The creator picks the name,
    /// ticker, art and a stock basket from the whitelist; everything else comes from the
    /// template and nothing can be changed afterwards. The coin sells on a bonding curve and
    /// the machine opens once the curve sells out.
    pub fn launch_machine(ctx: Context<LaunchMachine>, args: MachineArgs) -> Result<()> {
        require!(!ctx.accounts.config.paused, GachaError::Paused);
        validate_machine_args(&args, ctx.accounts.season.whitelist.len())?;
        let clock = Clock::get()?;

        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.creator_usdc.to_account_info(),
                    mint: ctx.accounts.usdc_mint.to_account_info(),
                    to: ctx.accounts.pool_token.to_account_info(),
                    authority: ctx.accounts.creator.to_account_info(),
                },
            ),
            LAUNCH_FEE,
            ctx.accounts.usdc_mint.decimals,
        )?;

        let registry = &mut ctx.accounts.registry;
        let id = registry.machine_count;
        registry.machine_count = id.checked_add(1).ok_or(GachaError::Overflow)?;
        registry.bump = ctx.bumps.registry;

        let mut machine = new_machine(
            id,
            MachineKind::Launchpad,
            MachineStatus::Curve,
            ctx.accounts.creator.key(),
            ctx.accounts.season.id,
            args,
            ctx.accounts.pool_token.key(),
            ctx.accounts.coin_mint.key(),
            ctx.bumps.machine,
        );
        machine.protocol_fees = LAUNCH_FEE;
        ctx.accounts.machine.set_inner(machine);
        ctx.accounts.curve.set_inner(Curve {
            machine: ctx.accounts.machine.key(),
            deadline: clock
                .unix_timestamp
                .checked_add(SALE_SECS)
                .ok_or(GachaError::Overflow)?,
            launch_slot: clock.slot,
            sold: 0,
            creator_bought: 0,
            pool_coins: 0,
            burned: 0,
            bought_back: 0,
            graduated_at: 0,
            bump: ctx.bumps.curve,
        });
        assert_solvent(&mut ctx.accounts.pool_token, &ctx.accounts.machine)?;
        emit!(MachineCreated {
            machine: ctx.accounts.machine.key(),
            id,
            creator: ctx.accounts.creator.key(),
            coin_mint: ctx.accounts.coin_mint.key(),
            launchpad: true,
        });
        Ok(())
    }

    /// Buys the machine coin with at most `usdc_in` (fee included). Before graduation this
    /// trades on the bonding curve; the purchase that sells the last curve coin graduates the
    /// machine: 4,000 USDC of the raise seeds its prize pool and the rest backs the trading
    /// pool. After graduation it trades against that pool.
    pub fn coin_buy(ctx: Context<CoinTrade>, usdc_in: u64, min_coins_out: u64) -> Result<()> {
        require!(!ctx.accounts.config.paused, GachaError::Paused);
        require!(usdc_in > 0, GachaError::TooSmall);
        let clock = Clock::get()?;
        let m = &ctx.accounts.machine;
        let c = &ctx.accounts.curve;
        let user = ctx.accounts.user.key();

        let (coins_out, net, fee) = match m.status {
            MachineStatus::Curve => {
                require!(clock.unix_timestamp <= c.deadline, GachaError::MarketClosed);
                if clock.slot < c.launch_slot.saturating_add(EARLY_SLOTS) {
                    require!(usdc_in <= EARLY_MAX_USDC, GachaError::EarlyCap);
                }
                let q = curve_buy(m.market_usdc, c.sold, usdc_in)?;
                if user == m.creator {
                    require!(
                        c.creator_bought.saturating_add(q.coins_out) <= CREATOR_MAX_COINS,
                        GachaError::CreatorCap
                    );
                }
                (q.coins_out, q.net, q.fee)
            }
            MachineStatus::Live => {
                let fee = bps(usdc_in, TRADE_FEE_BPS);
                let net = usdc_in - fee;
                (pool_buy(m.market_usdc, c.pool_coins, net), net, fee)
            }
            MachineStatus::Failed => return err!(GachaError::MarketClosed),
        };
        require!(coins_out > 0, GachaError::TooSmall);
        require!(coins_out >= min_coins_out, GachaError::Slippage);
        let (id, bump) = (m.id, m.bump);

        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.user_usdc.to_account_info(),
                    mint: ctx.accounts.usdc_mint.to_account_info(),
                    to: ctx.accounts.pool_token.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            net.checked_add(fee).ok_or(GachaError::Overflow)?,
            ctx.accounts.usdc_mint.decimals,
        )?;
        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.coin_token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.coin_mint.to_account_info(),
                    to: ctx.accounts.user_coin.to_account_info(),
                    authority: ctx.accounts.machine.to_account_info(),
                },
                &[&[b"machine", &id.to_le_bytes(), &[bump]]],
            ),
            coins_out,
        )?;

        let m = &mut ctx.accounts.machine;
        let c = &mut ctx.accounts.curve;
        m.market_usdc = m.market_usdc.checked_add(net).ok_or(GachaError::Overflow)?;
        m.protocol_fees = m.protocol_fees.checked_add(fee).ok_or(GachaError::Overflow)?;
        match m.status {
            MachineStatus::Curve => {
                c.sold = c.sold.checked_add(coins_out).ok_or(GachaError::Overflow)?;
                if user == m.creator {
                    c.creator_bought = c.creator_bought.saturating_add(coins_out);
                }
                if c.sold == CURVE_SUPPLY {
                    let (seed, pool_usdc, pool_coins) = graduation_split(m.market_usdc)?;
                    m.prize_pool = m.prize_pool.checked_add(seed).ok_or(GachaError::Overflow)?;
                    m.market_usdc = pool_usdc;
                    m.status = MachineStatus::Live;
                    c.pool_coins = pool_coins;
                    c.graduated_at = clock.unix_timestamp;
                    emit!(MachineGraduated {
                        machine: m.key(),
                        seed,
                        pool_usdc,
                        pool_coins,
                    });
                }
            }
            _ => {
                c.pool_coins = c.pool_coins.checked_sub(coins_out).ok_or(GachaError::Insolvent)?;
            }
        }
        emit!(CoinTraded {
            machine: m.key(),
            user,
            is_buy: true,
            usdc: net,
            coins: coins_out,
            fee,
        });
        assert_solvent(&mut ctx.accounts.pool_token, &ctx.accounts.machine)
    }

    /// Sells machine coins. On the curve this pays the curve price; if the curve missed its
    /// deadline the machine is marked failed and holders sell back along the curve with no
    /// fee. After graduation it trades against the pool.
    pub fn coin_sell(ctx: Context<CoinTrade>, coins_in: u64, min_usdc_out: u64) -> Result<()> {
        require!(coins_in > 0, GachaError::TooSmall);
        let now = Clock::get()?.unix_timestamp;
        let m = &mut ctx.accounts.machine;
        let c = &mut ctx.accounts.curve;
        let user = ctx.accounts.user.key();
        if m.status == MachineStatus::Curve && now > c.deadline {
            m.status = MachineStatus::Failed;
        }

        let (gross, fee) = match m.status {
            MachineStatus::Curve | MachineStatus::Failed => {
                let gross = curve_sell(m.market_usdc, c.sold, coins_in)?;
                c.sold -= coins_in;
                if user == m.creator {
                    c.creator_bought = c.creator_bought.saturating_sub(coins_in);
                }
                let fee = if m.status == MachineStatus::Failed {
                    0
                } else {
                    bps(gross, TRADE_FEE_BPS)
                };
                (gross, fee)
            }
            MachineStatus::Live => {
                let gross = pool_sell(m.market_usdc, c.pool_coins, coins_in);
                c.pool_coins = c.pool_coins.checked_add(coins_in).ok_or(GachaError::Overflow)?;
                (gross, bps(gross, TRADE_FEE_BPS))
            }
        };
        let out = gross - fee;
        require!(out > 0, GachaError::TooSmall);
        require!(out >= min_usdc_out, GachaError::Slippage);
        m.market_usdc = m.market_usdc.checked_sub(gross).ok_or(GachaError::Insolvent)?;
        m.protocol_fees = m.protocol_fees.checked_add(fee).ok_or(GachaError::Overflow)?;
        let (id, bump) = (m.id, m.bump);

        token::burn(
            CpiContext::new(
                ctx.accounts.coin_token_program.to_account_info(),
                Burn {
                    mint: ctx.accounts.coin_mint.to_account_info(),
                    from: ctx.accounts.user_coin.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            coins_in,
        )?;
        transfer_from_machine(
            &ctx.accounts.token_program,
            &ctx.accounts.pool_token,
            &ctx.accounts.usdc_mint,
            &ctx.accounts.user_usdc,
            &ctx.accounts.machine,
            id,
            bump,
            out,
        )?;
        emit!(CoinTraded {
            machine: ctx.accounts.machine.key(),
            user,
            is_buy: false,
            usdc: out,
            coins: coins_in,
            fee,
        });
        assert_solvent(&mut ctx.accounts.pool_token, &ctx.accounts.machine)
    }

    /// Spends accrued buyback funds on the machine coin and burns what it buys. Anyone can
    /// crank it; each call is capped so buybacks land in small pieces.
    pub fn crank_buyback(ctx: Context<CrankBuyback>, min_coins_out: u64) -> Result<()> {
        let m = &mut ctx.accounts.machine;
        let c = &mut ctx.accounts.curve;
        require!(m.status == MachineStatus::Live, GachaError::NotLive);
        let amount = m.buyback_accrued.min(MAX_BUYBACK_PER_CRANK);
        require!(amount > 0, GachaError::NothingToWithdraw);
        let coins = pool_buy(m.market_usdc, c.pool_coins, amount);
        require!(coins > 0, GachaError::TooSmall);
        require!(coins >= min_coins_out, GachaError::Slippage);
        // The bought coins were never minted, so taking them out of the pool burns them.
        m.buyback_accrued -= amount;
        m.market_usdc = m.market_usdc.checked_add(amount).ok_or(GachaError::Overflow)?;
        c.pool_coins -= coins;
        c.burned = c.burned.checked_add(coins).ok_or(GachaError::Overflow)?;
        c.bought_back = c.bought_back.checked_add(amount).ok_or(GachaError::Overflow)?;
        emit!(BuybackBurned {
            machine: m.key(),
            usdc: amount,
            coins,
        });
        Ok(())
    }

    /// Takes payment, creates the pack and requests randomness. The full amount stays pending
    /// until the callback, so a timeout can be refunded in full.
    pub fn buy_packs(
        ctx: Context<BuyPacks>,
        nonce: u64,
        count: u8,
        client_seed: [u8; 32],
    ) -> Result<()> {
        require!(!ctx.accounts.config.paused, GachaError::Paused);
        require!(
            ctx.accounts.machine.status == MachineStatus::Live,
            GachaError::NotLive
        );
        require!(
            count >= 1 && (count as usize) <= MAX_PULLS,
            GachaError::BadCount
        );
        let paid = ctx
            .accounts
            .season
            .pack_price
            .checked_mul(count as u64)
            .ok_or(GachaError::Overflow)?;

        // 1. Move the full amount into the machine's account as pending
        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.user_usdc.to_account_info(),
                    mint: ctx.accounts.usdc_mint.to_account_info(),
                    to: ctx.accounts.pool_token.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            paid,
            ctx.accounts.usdc_mint.decimals,
        )?;
        let machine = &mut ctx.accounts.machine;
        machine.pending = machine.pending.checked_add(paid).ok_or(GachaError::Overflow)?;

        // 2. Create the pack
        let pack_key = ctx.accounts.pack.key();
        let user_key = ctx.accounts.user.key();
        let machine_key = ctx.accounts.machine.key();
        ctx.accounts.pack.set_inner(Pack {
            owner: user_key,
            rent_payer: ctx.accounts.payer.key(),
            machine: machine_key,
            season: ctx.accounts.season.id,
            count,
            paid,
            status: PackStatus::Pending,
            request_slot: Clock::get()?.slot,
            locked_amount: 0,
            results: [PullResult::default(); MAX_PULLS],
            nonce,
            bump: ctx.bumps.pack,
        });

        let player = &mut ctx.accounts.player;
        if player.owner == Pubkey::default() {
            player.owner = user_key;
            player.bump = ctx.bumps.player;
        }

        // 3. Request randomness with callback_open and its accounts
        let seed = hashv(&[&client_seed, pack_key.as_ref()]).to_bytes();
        let ix = create_request_randomness_ix(RequestRandomnessParams {
            payer: ctx.accounts.payer.key(),
            oracle_queue: ctx.accounts.oracle_queue.key(),
            callback_program_id: crate::ID,
            callback_discriminator: instruction::CallbackOpen::DISCRIMINATOR.to_vec(),
            caller_seed: seed,
            accounts_metas: Some(vec![
                SerializableAccountMeta {
                    pubkey: pack_key,
                    is_signer: false,
                    is_writable: true,
                },
                SerializableAccountMeta {
                    pubkey: machine_key,
                    is_signer: false,
                    is_writable: true,
                },
                SerializableAccountMeta {
                    pubkey: ctx.accounts.season.key(),
                    is_signer: false,
                    is_writable: false,
                },
                SerializableAccountMeta {
                    pubkey: ctx.accounts.player.key(),
                    is_signer: false,
                    is_writable: true,
                },
            ]),
            ..Default::default()
        });
        ctx.accounts
            .invoke_signed_vrf(&ctx.accounts.payer.to_account_info(), &ix)?;

        assert_solvent(&mut ctx.accounts.pool_token, &ctx.accounts.machine)?;
        emit!(PacksBought {
            pack: pack_key,
            machine: machine_key,
            owner: user_key,
            count,
            paid,
        });
        Ok(())
    }

    /// Draw callback. Callable only by the MagicBlock VRF identity; it only updates the ledger and moves no tokens.
    pub fn callback_open(ctx: Context<CallbackOpen>, randomness: [u8; 32]) -> Result<()> {
        let season = &ctx.accounts.season;
        let machine = &mut ctx.accounts.machine;
        let pack = &mut ctx.accounts.pack;
        let player = &mut ctx.accounts.player;
        require!(pack.status == PackStatus::Pending, GachaError::BadStatus);

        // A 10-pack requests randomness once and derives each pull from hash(randomness, i)
        for i in 0..pack.count as usize {
            let r = hashv(&[&randomness, &[i as u8]]).to_bytes();
            let res = draw_one(season, machine, &mut player.dry_streak, &r)?;
            pack.locked_amount = pack
                .locked_amount
                .checked_add(res.value)
                .ok_or(GachaError::Overflow)?;
            pack.results[i] = res;
        }
        pack.status = PackStatus::Revealed;

        player.total_pulls = player
            .total_pulls
            .checked_add(pack.count as u64)
            .ok_or(GachaError::Overflow)?;
        player.total_spent = player
            .total_spent
            .checked_add(pack.paid)
            .ok_or(GachaError::Overflow)?;
        player.total_won = player
            .total_won
            .checked_add(pack.locked_amount)
            .ok_or(GachaError::Overflow)?;

        emit!(PackOpened {
            pack: pack.key(),
            machine: machine.key(),
            owner: pack.owner,
            count: pack.count,
            results: pack.results,
            locked_amount: pack.locked_amount,
            prize_pool_after: machine.prize_pool,
        });
        Ok(())
    }

    /// Sends the locked USDC to the user minus the settlement fee, closes the Pack and returns its rent.
    /// The frontend can append Jupiter swap instructions in the same transaction to turn the USDC into the pulled stock.
    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        require!(
            ctx.accounts.pack.status == PackStatus::Revealed,
            GachaError::BadStatus
        );
        let amount = ctx.accounts.pack.locked_amount;
        let fee = bps(amount, ctx.accounts.season.settle_fee_bps);
        let m = &mut ctx.accounts.machine;
        m.locked = m.locked.checked_sub(amount).ok_or(GachaError::Overflow)?;
        m.protocol_fees = m.protocol_fees.checked_add(fee).ok_or(GachaError::Overflow)?;
        let (id, bump) = (m.id, m.bump);
        transfer_from_machine(
            &ctx.accounts.token_program,
            &ctx.accounts.pool_token,
            &ctx.accounts.usdc_mint,
            &ctx.accounts.user_usdc,
            &ctx.accounts.machine,
            id,
            bump,
            amount.checked_sub(fee).ok_or(GachaError::Overflow)?,
        )?;
        assert_solvent(&mut ctx.accounts.pool_token, &ctx.accounts.machine)?;
        emit!(PackClaimed {
            pack: ctx.accounts.pack.key(),
            owner: ctx.accounts.owner.key(),
            amount,
            settle_fee: fee,
        });
        Ok(())
    }

    /// If the randomness callback times out, the pack owner gets the full payment back. Not affected by pause.
    pub fn refund_timeout(ctx: Context<Claim>) -> Result<()> {
        let pack = &ctx.accounts.pack;
        require!(pack.status == PackStatus::Pending, GachaError::BadStatus);
        let deadline = pack
            .request_slot
            .checked_add(ctx.accounts.season.timeout_slots)
            .ok_or(GachaError::Overflow)?;
        require!(Clock::get()?.slot > deadline, GachaError::TooEarly);
        let paid = pack.paid;

        let m = &mut ctx.accounts.machine;
        m.pending = m.pending.checked_sub(paid).ok_or(GachaError::Overflow)?;
        let (id, bump) = (m.id, m.bump);
        transfer_from_machine(
            &ctx.accounts.token_program,
            &ctx.accounts.pool_token,
            &ctx.accounts.usdc_mint,
            &ctx.accounts.user_usdc,
            &ctx.accounts.machine,
            id,
            bump,
            paid,
        )?;
        assert_solvent(&mut ctx.accounts.pool_token, &ctx.accounts.machine)?;
        emit!(PackRefunded {
            pack: ctx.accounts.pack.key(),
            owner: ctx.accounts.owner.key(),
            amount: paid,
        });
        Ok(())
    }

    /// Pays a machine's accrued fees to their fixed destinations: the protocol's share to the
    /// treasury and the creator's share to the creator. Anyone can crank it. No instruction
    /// can touch the prize pool, locked prizes, pending payments or the coin market's USDC.
    pub fn withdraw_fees(ctx: Context<WithdrawFees>) -> Result<()> {
        let m = &mut ctx.accounts.machine;
        let (protocol, creator) = (m.protocol_fees, m.creator_accrued);
        require!(protocol > 0 || creator > 0, GachaError::NothingToWithdraw);
        m.protocol_fees = 0;
        m.creator_accrued = 0;
        let (id, bump) = (m.id, m.bump);
        for (to, amount) in [
            (&ctx.accounts.treasury_usdc, protocol),
            (&ctx.accounts.creator_usdc, creator),
        ] {
            if amount > 0 {
                transfer_from_machine(
                    &ctx.accounts.token_program,
                    &ctx.accounts.pool_token,
                    &ctx.accounts.usdc_mint,
                    to,
                    &ctx.accounts.machine,
                    id,
                    bump,
                    amount,
                )?;
            }
        }
        assert_solvent(&mut ctx.accounts.pool_token, &ctx.accounts.machine)
    }

    /// Pauses new purchases, launches and coin buys; claims, refunds and coin sells keep working.
    pub fn set_paused(ctx: Context<AdminOnly>, paused: bool) -> Result<()> {
        ctx.accounts.config.paused = paused;
        Ok(())
    }
}

#[allow(clippy::too_many_arguments)]
fn new_machine(
    id: u64,
    kind: MachineKind,
    status: MachineStatus,
    creator: Pubkey,
    season: u16,
    args: MachineArgs,
    pool_token: Pubkey,
    coin_mint: Pubkey,
    bump: u8,
) -> Machine {
    Machine {
        id,
        kind,
        status,
        creator,
        season,
        name: args.name,
        symbol: args.symbol,
        theme: args.theme,
        basket: args.basket,
        pool_token,
        coin_mint,
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
        bump,
    }
}

#[allow(clippy::too_many_arguments)]
fn transfer_from_machine<'info>(
    token_program: &Interface<'info, TokenInterface>,
    pool_token: &InterfaceAccount<'info, TokenAccount>,
    mint: &InterfaceAccount<'info, Mint>,
    to: &InterfaceAccount<'info, TokenAccount>,
    machine: &Account<'info, Machine>,
    machine_id: u64,
    machine_bump: u8,
    amount: u64,
) -> Result<()> {
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            token_program.to_account_info(),
            TransferChecked {
                from: pool_token.to_account_info(),
                mint: mint.to_account_info(),
                to: to.to_account_info(),
                authority: machine.to_account_info(),
            },
            &[&[b"machine", &machine_id.to_le_bytes(), &[machine_bump]]],
        ),
        amount,
        mint.decimals,
    )
}

/// Solvency: the machine's token account holds at least everything its ledger owes.
fn assert_solvent(pool: &mut InterfaceAccount<TokenAccount>, m: &Machine) -> Result<()> {
    pool.reload()?;
    let owed = m.owed().ok_or(GachaError::Overflow)?;
    require!(pool.amount >= owed, GachaError::Insolvent);
    Ok(())
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(init, payer = admin, space = 8 + Config::INIT_SPACE, seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    pub usdc_mint: InterfaceAccount<'info, Mint>,
    #[account(constraint = program.programdata_address()? == Some(program_data.key()) @ GachaError::Unauthorized)]
    pub program: Program<'info, crate::program::KaiguGacha>,
    #[account(constraint = program_data.upgrade_authority_address == Some(admin.key()) @ GachaError::Unauthorized)]
    pub program_data: Account<'info, ProgramData>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreateSeason<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(mut, seeds = [b"config"], bump = config.bump, has_one = admin @ GachaError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = admin,
        space = 8 + Season::INIT_SPACE,
        seeds = [b"season", config.season_count.to_le_bytes().as_ref()],
        bump,
    )]
    pub season: Account<'info, Season>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreateMachine<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump, has_one = admin @ GachaError::Unauthorized)]
    pub config: Box<Account<'info, Config>>,
    #[account(seeds = [b"season", config.active_season.to_le_bytes().as_ref()], bump = season.bump)]
    pub season: Box<Account<'info, Season>>,
    #[account(init_if_needed, payer = admin, space = 8 + Registry::INIT_SPACE, seeds = [b"registry"], bump)]
    pub registry: Box<Account<'info, Registry>>,
    #[account(
        init,
        payer = admin,
        space = 8 + Machine::INIT_SPACE,
        seeds = [b"machine", registry.machine_count.to_le_bytes().as_ref()],
        bump,
    )]
    pub machine: Box<Account<'info, Machine>>,
    #[account(
        init,
        payer = admin,
        seeds = [b"machine_pool", machine.key().as_ref()],
        bump,
        token::mint = usdc_mint,
        token::authority = machine,
        token::token_program = token_program,
    )]
    pub pool_token: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = config.usdc_mint)]
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct LaunchMachine<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(seeds = [b"season", config.active_season.to_le_bytes().as_ref()], bump = season.bump)]
    pub season: Box<Account<'info, Season>>,
    #[account(init_if_needed, payer = creator, space = 8 + Registry::INIT_SPACE, seeds = [b"registry"], bump)]
    pub registry: Box<Account<'info, Registry>>,
    #[account(
        init,
        payer = creator,
        space = 8 + Machine::INIT_SPACE,
        seeds = [b"machine", registry.machine_count.to_le_bytes().as_ref()],
        bump,
    )]
    pub machine: Box<Account<'info, Machine>>,
    #[account(init, payer = creator, space = 8 + Curve::INIT_SPACE, seeds = [b"curve", machine.key().as_ref()], bump)]
    pub curve: Box<Account<'info, Curve>>,
    /// The machine coin: a classic SPL token whose only mint authority is the machine.
    #[account(
        init,
        payer = creator,
        seeds = [b"coin", machine.key().as_ref()],
        bump,
        mint::decimals = COIN_DECIMALS,
        mint::authority = machine,
        mint::token_program = coin_token_program,
    )]
    pub coin_mint: Box<Account<'info, token::Mint>>,
    #[account(
        init,
        payer = creator,
        seeds = [b"machine_pool", machine.key().as_ref()],
        bump,
        token::mint = usdc_mint,
        token::authority = machine,
        token::token_program = token_program,
    )]
    pub pool_token: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = creator,
        token::token_program = token_program,
    )]
    pub creator_usdc: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = config.usdc_mint)]
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub coin_token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CoinTrade<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [b"machine", machine.id.to_le_bytes().as_ref()], bump = machine.bump)]
    pub machine: Box<Account<'info, Machine>>,
    #[account(mut, seeds = [b"curve", machine.key().as_ref()], bump = curve.bump)]
    pub curve: Box<Account<'info, Curve>>,
    #[account(mut, address = machine.coin_mint)]
    pub coin_mint: Box<Account<'info, token::Mint>>,
    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = coin_mint,
        associated_token::authority = user,
        associated_token::token_program = coin_token_program,
    )]
    pub user_coin: Box<Account<'info, token::TokenAccount>>,
    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = user,
        token::token_program = token_program,
    )]
    pub user_usdc: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, address = machine.pool_token)]
    pub pool_token: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = config.usdc_mint)]
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub coin_token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CrankBuyback<'info> {
    pub payer: Signer<'info>,
    #[account(mut, seeds = [b"machine", machine.id.to_le_bytes().as_ref()], bump = machine.bump)]
    pub machine: Account<'info, Machine>,
    #[account(mut, seeds = [b"curve", machine.key().as_ref()], bump = curve.bump)]
    pub curve: Account<'info, Curve>,
}

#[vrf]
#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct BuyPacks<'info> {
    /// The user or a relayer; pays rent and the randomness fee
    #[account(mut)]
    pub payer: Signer<'info>,
    pub user: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [b"machine", machine.id.to_le_bytes().as_ref()], bump = machine.bump)]
    pub machine: Box<Account<'info, Machine>>,
    #[account(seeds = [b"season", machine.season.to_le_bytes().as_ref()], bump = season.bump)]
    pub season: Box<Account<'info, Season>>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + Player::INIT_SPACE,
        seeds = [b"player", user.key().as_ref()],
        bump,
    )]
    pub player: Box<Account<'info, Player>>,
    #[account(
        init,
        payer = payer,
        space = 8 + Pack::INIT_SPACE,
        seeds = [b"pack", user.key().as_ref(), nonce.to_le_bytes().as_ref()],
        bump,
    )]
    pub pack: Box<Account<'info, Pack>>,
    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = user,
        token::token_program = token_program,
    )]
    pub user_usdc: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, address = machine.pool_token)]
    pub pool_token: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = config.usdc_mint)]
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,
    pub token_program: Interface<'info, TokenInterface>,
    /// CHECK: only the official MagicBlock base-layer queue is accepted
    #[account(mut, address = ephemeral_vrf_sdk::consts::DEFAULT_QUEUE)]
    pub oracle_queue: AccountInfo<'info>,
}

// #[vrf_callback] injects the vrf_program_identity signer constraint so only the VRF program can call this callback.
#[vrf_callback]
#[derive(Accounts)]
pub struct CallbackOpen<'info> {
    #[account(mut, seeds = [b"pack", pack.owner.as_ref(), pack.nonce.to_le_bytes().as_ref()], bump = pack.bump)]
    pub pack: Account<'info, Pack>,
    #[account(mut, address = pack.machine)]
    pub machine: Account<'info, Machine>,
    #[account(seeds = [b"season", pack.season.to_le_bytes().as_ref()], bump = season.bump)]
    pub season: Account<'info, Season>,
    #[account(mut, seeds = [b"player", pack.owner.as_ref()], bump = player.bump)]
    pub player: Account<'info, Player>,
}

/// Shared by claim and refund_timeout: both pay the pack owner and close the pack.
#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(seeds = [b"season", pack.season.to_le_bytes().as_ref()], bump = season.bump)]
    pub season: Box<Account<'info, Season>>,
    #[account(mut, address = pack.machine)]
    pub machine: Box<Account<'info, Machine>>,
    #[account(
        mut,
        close = rent_payer,
        has_one = owner @ GachaError::Unauthorized,
        has_one = rent_payer @ GachaError::Unauthorized,
        seeds = [b"pack", owner.key().as_ref(), pack.nonce.to_le_bytes().as_ref()],
        bump = pack.bump,
    )]
    pub pack: Box<Account<'info, Pack>>,
    /// CHECK: validated by pack.has_one; only receives the returned rent
    #[account(mut)]
    pub rent_payer: AccountInfo<'info>,
    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = owner,
        token::token_program = token_program,
    )]
    pub user_usdc: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, address = machine.pool_token)]
    pub pool_token: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = config.usdc_mint)]
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct WithdrawFees<'info> {
    pub payer: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [b"machine", machine.id.to_le_bytes().as_ref()], bump = machine.bump)]
    pub machine: Box<Account<'info, Machine>>,
    #[account(mut, address = machine.pool_token)]
    pub pool_token: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = config.treasury,
        token::token_program = token_program,
    )]
    pub treasury_usdc: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = machine.creator,
        token::token_program = token_program,
    )]
    pub creator_usdc: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = config.usdc_mint)]
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [b"config"], bump = config.bump, has_one = admin @ GachaError::Unauthorized)]
    pub config: Account<'info, Config>,
}
