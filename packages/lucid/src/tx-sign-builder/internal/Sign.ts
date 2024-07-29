import { Effect, pipe } from "effect";
import { ERROR_MESSAGE, TxSignerError } from "../../Errors.js";
import * as TxSignBuilder from "../TxSignBuilder.js";
import { PrivateKey } from "@lucid-evolution/core-types";
import { CML } from "../../core.js";

export const signError = (cause: unknown) => new TxSignerError({ cause });

export const withWallet = (config: TxSignBuilder.TxSignBuilderConfig) =>
  Effect.gen(function* () {
    const wallet = yield* pipe(
      Effect.fromNullable(config.lucidConfig.wallet),
      Effect.catchAll(() => signError(ERROR_MESSAGE.MISSING_WALLET)),
    );
    const witnesses = yield* Effect.tryPromise({
      try: () => wallet.signTx(config.txComplete),
      catch: (cause) => signError(cause),
    });
    config.witnessSetBuilder.add_existing(witnesses);
  });

export const withPrivateKey = (
  config: TxSignBuilder.TxSignBuilderConfig,
  privateKey: PrivateKey,
) =>
  Effect.gen(function* () {
    const priv = CML.PrivateKey.from_bech32(privateKey);
    const witness = CML.make_vkey_witness(
      CML.hash_transaction(config.txComplete.body()),
      priv,
    );
    config.witnessSetBuilder.add_vkey(witness);
  });
