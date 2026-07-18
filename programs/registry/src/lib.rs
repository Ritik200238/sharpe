//! SHARPE commitment registry — the on-chain, typed successor to the Memo path.
//!
//! One instruction: record a commitment `(kind, 32-byte hash)` in a PDA derived
//! from the hash. Because the PDA is seeded by the hash and the instruction
//! refuses to touch an already-initialized account, **a commitment can never be
//! overwritten or backdated** — the same tamper-proof guarantee the agent gets
//! from the Memo program today, but as queryable typed state instead of a log.
//!
//! Instruction data: `kind (1 byte) || hash (32 bytes)` = 33 bytes.
//! Accounts: `[authority (signer, payer), commit_pda (writable), system_program]`.
//! Account layout (81 bytes): `kind(1) | hash(32) | slot(8) | unix_ts(8) | authority(32)`.
#![allow(unexpected_cfgs)]
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    clock::Clock,
    entrypoint,
    entrypoint::ProgramResult,
    msg,
    program::invoke_signed,
    program_error::ProgramError,
    pubkey::Pubkey,
    rent::Rent,
    system_instruction,
    system_program,
    sysvar::Sysvar,
};

/// PDA seed prefix. Full seeds: `[COMMIT_SEED, hash]`.
const COMMIT_SEED: &[u8] = b"commit";
/// Serialized `Commitment` size in bytes.
const ACCOUNT_LEN: usize = 1 + 32 + 8 + 8 + 32;

entrypoint!(process_instruction);

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    if data.len() != 1 + 32 {
        msg!("sharpe-registry: expected 33 bytes (kind || hash), got {}", data.len());
        return Err(ProgramError::InvalidInstructionData);
    }
    let kind = data[0];
    let hash: [u8; 32] = data[1..33].try_into().unwrap();

    let accounts_iter = &mut accounts.iter();
    let authority = next_account_info(accounts_iter)?; // signer + rent payer
    let commit_pda = next_account_info(accounts_iter)?; // the commitment account
    let system = next_account_info(accounts_iter)?; // system program

    if !authority.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if *system.key != system_program::ID {
        return Err(ProgramError::IncorrectProgramId);
    }

    // The PDA is fully determined by the hash, so its address IS the commitment
    // key — recomputable by anyone from the published record.
    let (expected_pda, bump) = Pubkey::find_program_address(&[COMMIT_SEED, &hash], program_id);
    if expected_pda != *commit_pda.key {
        return Err(ProgramError::InvalidSeeds);
    }
    // Immutable: a commitment that already exists is never rewritten.
    if !commit_pda.data_is_empty() {
        msg!("sharpe-registry: commitment already recorded — refusing to overwrite");
        return Err(ProgramError::AccountAlreadyInitialized);
    }

    let rent = Rent::get()?;
    let lamports = rent.minimum_balance(ACCOUNT_LEN);
    invoke_signed(
        &system_instruction::create_account(
            authority.key,
            commit_pda.key,
            lamports,
            ACCOUNT_LEN as u64,
            program_id,
        ),
        &[authority.clone(), commit_pda.clone(), system.clone()],
        &[&[COMMIT_SEED, &hash, &[bump]]],
    )?;

    let clock = Clock::get()?;
    let mut store = commit_pda.try_borrow_mut_data()?;
    store[0] = kind;
    store[1..33].copy_from_slice(&hash);
    store[33..41].copy_from_slice(&clock.slot.to_le_bytes());
    store[41..49].copy_from_slice(&clock.unix_timestamp.to_le_bytes());
    store[49..81].copy_from_slice(authority.key.as_ref());

    msg!("sharpe-registry: committed kind {} at slot {}", kind, clock.slot);
    Ok(())
}
