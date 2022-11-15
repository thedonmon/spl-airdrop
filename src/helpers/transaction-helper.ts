/**
 * Credits: @strata-protocol
 */
import * as web3Js from '@solana/web3.js';
import { sleep, TimeoutError } from './utility';
import log from 'loglevel';
import { createAssociatedTokenAccountInstruction, getAssociatedTokenAddress } from '@solana/spl-token';

function getUnixTime(): number {
  return new Date().valueOf() / 1000;
}

export const awaitTransactionSignatureConfirmation = async (
  txid: web3Js.TransactionSignature,
  timeout: number,
  connection: web3Js.Connection,
  commitment: web3Js.Commitment = 'recent',
  queryStatus = false,
): Promise<web3Js.SignatureStatus | null | any> => {
  let done = false;
  let status: web3Js.SignatureStatus | null | any = {
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
      log.debug('Rejecting for timeout...');
      Promise.reject(new TimeoutError(txid));
    }, timeout);
    try {
      log.debug('COMMIMENT', commitment);
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
            log.error('Rejected via websocket', result.err);
            reject(status);
          } else {
            log.debug('Resolved via websocket', result);
            resolve(status);
          }
        },
        commitment,
      );
    } catch (e) {
      done = true;
      log.error('WS error in setup', txid, e);
    }
    while (!done && queryStatus) {
      // eslint-disable-next-line no-loop-func
      (async () => {
        try {
          const signatureStatuses = await connection.getSignatureStatuses([txid]);
          status = signatureStatuses && signatureStatuses.value[0];
          if (!done) {
            if (!status) {
              log.debug('REST null result for', txid, status);
            } else if (status.err) {
              log.error('REST error for', txid, status);
              done = true;
              reject(status.err);
            } else if (!status.confirmations && !status.confirmationStatus) {
              log.warn('REST no confirmations for', txid, status);
            } else {
              log.debug('REST confirmation for', txid, status);
              if (!status.confirmationStatus || status.confirmationStatus == commitment) {
                done = true;
                resolve(status);
              }
            }
          }
        } catch (e) {
          if (!done) {
            log.error('REST connection error: txid', txid, e);
          }
        }
      })();
      await sleep(2000);
    }
  });
  //Old connection objects probably can remove.
  //@ts-ignore
  if (connection._signatureSubscriptions && connection._signatureSubscriptions[subId]) {
    log.info('removing listener');
    connection.removeSignatureListener(subId);
  }
  done = true;
  log.debug('Returning status ', status);
  return Promise.resolve(status);
};

async function simulateTransaction(
  connection: web3Js.Connection,
  transaction: web3Js.Transaction,
  commitment: web3Js.Commitment,
): Promise<web3Js.RpcResponseAndContext<web3Js.SimulatedTransactionResponse>> {
  transaction.recentBlockhash = (await connection.getLatestBlockhash(commitment)).blockhash;
  const res = await connection.simulateTransaction(transaction);
  if (res.value.err) {
    throw new Error('failed to simulate transaction: ' + JSON.stringify(res.value.err));
  }
  return res;
}

export async function getOrCreateTokenAccountInstruction(mint: web3Js.PublicKey, user: web3Js.PublicKey, connection: web3Js.Connection, payer: web3Js.PublicKey|null = null): Promise<web3Js.TransactionInstruction | null> {
  const userTokenAccountAddress = await getAssociatedTokenAddress(mint, user, false);
  const userTokenAccount = await connection.getParsedAccountInfo(userTokenAccountAddress);
  if (userTokenAccount.value === null) {
      return createAssociatedTokenAccountInstruction(payer ? payer : user, userTokenAccountAddress, user, mint);
  } else {
      return null;
  }
}

const DEFAULT_TIMEOUT = 3 * 60 * 1000; // 3 minutes

export async function sendAndConfirmWithRetry(
  connection: web3Js.Connection,
  txn: Buffer,
  sendOptions: web3Js.SendOptions,
  commitment: web3Js.Commitment,
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

    if (!confirmation) throw new TimeoutError(txid);

    if (confirmation.err) {
      const tx = await connection.getTransaction(txid);
      log.error(tx?.meta?.logMessages?.join('\n'));
      log.error(confirmation.err);
      throw new Error('Transaction failed: Custom instruction error');
    }

    slot = confirmation?.slot || 0;
  } catch (err: any) {
    log.error('Unexpected error caught', err, err?.message);
    if (err.timeout) {
      throw new TimeoutError(txid);
    }
    let simulateResult: web3Js.SimulatedTransactionResponse | null = null;
    try {
      simulateResult = (
        await simulateTransaction(connection, web3Js.Transaction.from(txn), 'single')
      ).value;
    } catch (e: any) {
      log.warn('Simulation failed', e, e?.message);
    }
    if (simulateResult && simulateResult.err) {
      if (simulateResult.logs) {
        log.error(simulateResult.logs.join('\n'));
      }
    }

    if (err.err) {
      throw err.err;
    }

    throw err;
  } finally {
    done = true;
  }

  log.debug('Latency', txid, getUnixTime() - startTime);

  return Promise.resolve({ txid });
}
