import { AnchorProvider, Provider } from "@project-serum/anchor";
import {
  Commitment,
  Connection,
  Finality,
  PublicKey,
  RpcResponseAndContext,
  SendOptions,
  SignatureResult,
  SignatureStatus,
  Signer,
  SimulatedTransactionResponse,
  Transaction,
  TransactionInstruction,
  TransactionSignature,
} from "@solana/web3.js";
import { sleep, TimeoutError } from "./utility";
import { ProgramError } from "./anchorError";
import log from 'loglevel';

async function promiseAllInOrder<T>(
  it: (() => Promise<T>)[]
): Promise<Iterable<T>> {
  let ret: T[] = [];
  for (const i of it) {
    ret.push(await i());
  }

  return ret;
}

export interface InstructionResult<A> {
  instructions: TransactionInstruction[];
  signers: Signer[];
  output: A;
}

export interface BigInstructionResult<A> {
  instructions: TransactionInstruction[][];
  signers: Signer[][];
  output: A;
}

export async function sendInstructions(
  idlErrors: Map<number, string>,
  provider: AnchorProvider,
  instructions: TransactionInstruction[],
  signers: Signer[],
  payer: PublicKey = provider.wallet.publicKey,
  commitment: Commitment = "confirmed"
): Promise<string> {
  let tx = new Transaction();
  tx.recentBlockhash = (
    await provider.connection.getLatestBlockhash()
  ).blockhash;
  tx.feePayer = payer || provider.wallet.publicKey;
  tx.add(...instructions);
  if (signers.length > 0) {
    tx.partialSign(...signers);
  }
  tx = await provider.wallet.signTransaction(tx);

  try {
    const { txid } = await sendAndConfirmWithRetry(
      provider.connection,
      tx.serialize(),
      {
        skipPreflight: true,
      },
      commitment
    );
    return txid;
  } catch (e) {
    console.error(e);
    const wrappedE = ProgramError.parse(e, idlErrors);
    throw wrappedE == null ? e : wrappedE;
  }
}

type Truthy<T> = T extends false | "" | 0 | null | undefined ? never : T; // from lodash

function truthy<T>(value: T): value is Truthy<T> {
  return !!value;
}

export async function sendMultipleInstructions(
  idlErrors: Map<number, string>,
  provider: AnchorProvider,
  instructionGroups: TransactionInstruction[][],
  signerGroups: Signer[][],
  payer?: PublicKey,
  finality: Finality = "confirmed"
): Promise<Iterable<string>> {
  const recentBlockhash = (
    await provider.connection.getLatestBlockhash("confirmed")
  ).blockhash;
  const txns = instructionGroups
    .map((instructions, index) => {
      const signers = signerGroups[index];
      if (instructions.length > 0) {
        console.log(provider.wallet.publicKey.toBase58(), payer?.toBase58());
        const tx = new Transaction({
          feePayer: payer || provider.wallet.publicKey,
          recentBlockhash,
        });
        tx.add(...instructions);
        if (signers.length > 0) {
          tx.partialSign(...signers);
        }

        return tx;
      }
    })
    .filter(truthy);

  const txnsSigned = (await provider.wallet.signAllTransactions(txns)).map(
    (tx) => tx.serialize()
  );

  console.log("Sending multiple transactions...");
  try {
    return await promiseAllInOrder(
      txnsSigned.map((txn) => async () => {
        const { txid } = await sendAndConfirmWithRetry(
          provider.connection,
          txn,
          {
            skipPreflight: true,
          },
          finality
        );
        return txid;
      })
    );
  } catch (e) {
    console.error(e);
    const wrappedE = ProgramError.parse(e, idlErrors);
    throw wrappedE == null ? e : wrappedE;
  }
}

function getUnixTime(): number {
  return new Date().valueOf() / 1000;
}

export const awaitTransactionSignatureConfirmation = async (
  txid: TransactionSignature,
  timeout: number,
  connection: Connection,
  commitment: Commitment = "recent",
  queryStatus = false,
): Promise<SignatureStatus | null | any> => {
  let done = false;
  let status: SignatureStatus | null | any = {
    slot: 0,
    confirmations: 0,
    err: null,
  };
  let subId = 0;
  status = await new Promise(async (resolve, reject) => {
    setTimeout(() => {
      if (done) {
        return Promise.resolve();
      }
      done = true;
      log.debug("Rejecting for timeout...");
      Promise.reject(new TimeoutError(txid));
    }, timeout);
    try {
      log.debug("COMMIMENT", commitment);
      subId = connection.onSignature(
        txid,
        (result: any, context: any) => {
          done = true;
          status = {
            err: result.err,
            slot: context.slot,
            confirmations: 0,
          };
          if (result.err) {
            log.error("Rejected via websocket", result.err);
            reject(status);
          } else {
            log.debug("Resolved via websocket", result);
            resolve(status);
          }
        },
        commitment
      );
      log.info('SUB ID>>> ', subId);
    } catch (e) {
      done = true;
      log.error("WS error in setup", txid, e);
    }
    while (!done && queryStatus) {
      // eslint-disable-next-line no-loop-func
      (async () => {
        try {
          const signatureStatuses = await connection.getSignatureStatuses([
            txid,
          ]);
          log.info('SIG STATUSS>>>', JSON.stringify(signatureStatuses, null, 2));
          status = signatureStatuses && signatureStatuses.value[0];
          if (!done) {
            if (!status) {
              log.debug("REST null result for", txid, status);
            } else if (status.err) {
              log.error("REST error for", txid, status);
              done = true;
              reject(status.err);
            } else if (!status.confirmations && !status.confirmationStatus) {
              log.warn("REST no confirmations for", txid, status);
            } else {
              log.debug("REST confirmation for", txid, status);
              if (
                !status.confirmationStatus || status.confirmationStatus ==
                commitment
              ) {
                done = true;
                resolve(status);
              }
            }
          }
        } catch (e) {
          if (!done) {
            log.error("REST connection error: txid", txid, e);
          }
        }
      })();
      await sleep(2000);
    }
  });

  //@ts-ignore
  if (connection._signatureSubscriptions && connection._signatureSubscriptions[subId]) {
    log.info('removing listener');
    connection.removeSignatureListener(subId);
  }
  done = true;
  log.debug("Returning status ", status);
  return Promise.resolve(status);
};

async function simulateTransaction(
  connection: Connection,
  transaction: Transaction,
  commitment: Commitment
): Promise<RpcResponseAndContext<SimulatedTransactionResponse>> {
  transaction.recentBlockhash = (await connection.getLatestBlockhash(commitment)).blockhash;
  const res = await connection.simulateTransaction(transaction);
  if (res.value.err) {
    throw new Error("failed to simulate transaction: " + JSON.stringify(res.value.err));
  }
  return res;
}

const DEFAULT_TIMEOUT = 3 * 60 * 1000; // 3 minutes
  /*
    A validator has up to 120s to accept the transaction and send it into a block.
    If it doesn’t happen within that timeframe, your transaction is dropped and you’ll need 
    to send the transaction again. You can get the transaction signature and periodically 
    Ping the network for that transaction signature. If you never get anything back, 
    that means it’s definitely been dropped. If you do get a response back, you can keep pinging 
    until it’s gone to a confirmed status to move on.
  */
export async function sendAndConfirmWithRetry(
  connection: Connection,
  txn: Buffer,
  sendOptions: SendOptions,
  commitment: Commitment,
  timeout = DEFAULT_TIMEOUT,
): Promise<{ txid: string }> {
  let done = false;
  let slot = 0;
  const txid = await connection.sendRawTransaction(txn, sendOptions);
  const startTime = getUnixTime();
  const blockhashResponse = await connection.getLatestBlockhashAndContext();
  const lastValidBlockHeight = blockhashResponse.context.slot + 150;
  let blockheight = await connection.getBlockHeight();
  (async () => {
    while (!done && getUnixTime() - startTime < timeout && blockheight < lastValidBlockHeight) {
      await connection.sendRawTransaction(txn, sendOptions);
      await sleep(500);
      blockheight = await connection.getBlockHeight();
    }
  })();
  try {
    const confirmation = await awaitTransactionSignatureConfirmation(
      txid,
      timeout,
      connection,
      commitment,
      true,
    );

    if (!confirmation)
      throw new TimeoutError(txid);

    if (confirmation.err) {
      const tx = await connection.getTransaction(txid);
      log.error(tx?.meta?.logMessages?.join("\n"));
      log.error(confirmation.err);
      throw new Error("Transaction failed: Custom instruction error");
    }

    slot = confirmation?.slot || 0;
  } catch (err: any) {
    log.error("Unexpected error caught", err, err?.message);
    if (err.timeout) {
      throw new TimeoutError(txid);
    }
    let simulateResult: SimulatedTransactionResponse | null = null;
    try {
      simulateResult = (
        await simulateTransaction(connection, Transaction.from(txn), "single")
      ).value;
    } catch (e: any) {
      log.warn('Simulation failed', e, e?.message);
    }
    if (simulateResult && simulateResult.err) {
      if (simulateResult.logs) {
        log.error(simulateResult.logs.join("\n"));
      }
    }

    if (err.err) {
      throw err.err
    }

    throw err;
  } finally {
    done = true;
  }

  log.debug("Latency", txid, getUnixTime() - startTime);

  return Promise.resolve({ txid });
}