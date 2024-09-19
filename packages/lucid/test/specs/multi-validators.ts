import { Effect, pipe } from "effect";
import {
  StakeContract,
  User,
  MintContract,
  SimpleStakeContract,
  SimpleMintContract,
} from "./services";
import { Constr, Data } from "@lucid-evolution/plutus";
import { fromText, RedeemerBuilder, UTxO } from "../../src";
import { handleSignSubmit, withLogRetry } from "./utils";

export const depositFunds = Effect.gen(function* () {
  const { user } = yield* User;
  const datum = Data.void();
  const stakeContract = yield* StakeContract;
  const mintContract = yield* MintContract;

  const stakeUtxos = yield* Effect.tryPromise(() =>
    user.utxosAt(stakeContract.contractAddress),
  );
  const mintUtxos = yield* Effect.tryPromise(() =>
    user.utxosAt(mintContract.contractAddress),
  );
  // To avoid increasing the number of utxos at contract
  if (stakeUtxos.length >= 10 && mintUtxos.length >= 3) return undefined;

  let txBuilder = user.newTx();

  // Lock 10 UTxOs at Stake Contract to test input index generated by RedeemerBuilder
  // for every script input when it will be later spent
  for (let i = 0; i < 10; i++) {
    txBuilder = txBuilder.pay.ToAddressWithData(
      stakeContract.contractAddress,
      {
        kind: "inline",
        value: datum,
      },
      undefined,
      stakeContract.stake,
    );
  }

  // Lock 3 UTxOs at Mint Contract to test input index generated by RedeemerBuilder
  // for selected script inputs when it will be later spent
  for (let i = 0; i < 3; i++) {
    txBuilder = txBuilder.pay.ToAddressWithData(
      mintContract.contractAddress,
      {
        kind: "inline",
        value: datum,
      },
      undefined,
      mintContract.mint,
    );
  }

  const signBuilder = yield* txBuilder.completeProgram();

  return signBuilder;
}).pipe(
  Effect.flatMap((tx) =>
    tx ? pipe(tx, handleSignSubmit, withLogRetry) : Effect.void,
  ),
  withLogRetry,
  Effect.orDie,
);

export const collectFundsInternal = Effect.gen(function* ($) {
  const { user } = yield* User;
  const stakeContract = yield* StakeContract;
  const mintContract = yield* MintContract;

  const stakeUtxos = yield* Effect.tryPromise(() =>
    user.utxosAt(stakeContract.contractAddress),
  );
  const mintUtxos = yield* Effect.tryPromise(() =>
    user.utxosAt(mintContract.contractAddress),
  );
  const stakeUtxoScriptRef = yield* Effect.fromNullable(
    stakeUtxos.find((utxo) => utxo.scriptRef ?? null),
  );
  const mintUtxoScriptRef = yield* Effect.fromNullable(
    mintUtxos.find((utxo) => utxo.scriptRef ?? null),
  );

  const selectedStakeUTxOs = stakeUtxos
    .filter((utxo) => {
      return (
        utxo.scriptRef &&
        (utxo.txHash !== stakeUtxoScriptRef.txHash ||
          utxo.outputIndex !== stakeUtxoScriptRef.outputIndex)
      );
    })
    .slice(0, 10);
  const selectedMintUTxOs = mintUtxos
    .filter((utxo) => {
      return (
        utxo.scriptRef &&
        (utxo.txHash !== mintUtxoScriptRef.txHash ||
          utxo.outputIndex !== mintUtxoScriptRef.outputIndex)
      );
    })
    .slice(0, 3);

  const rdmrBuilderSelfSpend: RedeemerBuilder = {
    kind: "self",
    makeRedeemer: (inputIndex: bigint) => {
      return Data.to(inputIndex);
    },
  };

  const rdmrBuilderSelectedSpend: RedeemerBuilder = {
    kind: "selected",
    makeRedeemer: (inputIndices: bigint[]) => {
      return Data.to(new Constr(0, [inputIndices]));
    },
    inputs: selectedMintUTxOs,
  };

  let txBuilder = user
    .newTx()
    .collectFrom(selectedStakeUTxOs, rdmrBuilderSelfSpend)
    .collectFrom(selectedMintUTxOs, rdmrBuilderSelectedSpend);

  selectedStakeUTxOs.forEach((utxo: UTxO) => {
    txBuilder = txBuilder.pay.ToContract(
      stakeContract.contractAddress,
      {
        kind: "inline",
        value: Data.void(),
      },
      { lovelace: 500_000n },
      utxo.scriptRef ? utxo.scriptRef : undefined,
    );
  });

  selectedMintUTxOs.forEach((utxo: UTxO) => {
    txBuilder = txBuilder.pay.ToContract(
      mintContract.contractAddress,
      {
        kind: "inline",
        value: Data.void(),
      },
      { lovelace: 7_000_000n },
      utxo.scriptRef ? utxo.scriptRef : undefined,
    );
  });

  const rdmrBuilderWithdraw: RedeemerBuilder = {
    kind: "selected",
    makeRedeemer: (inputIndices: bigint[]) => {
      return Data.to(new Constr(0, [inputIndices]));
    },
    inputs: selectedStakeUTxOs,
  };

  const rdmrBuilderMint: RedeemerBuilder = {
    kind: "selected",
    makeRedeemer: (inputIndices: bigint[]) => {
      return Data.to(new Constr(0, [inputIndices]));
    },
    inputs: selectedMintUTxOs,
  };

  const signBuilder = yield* txBuilder
    .withdraw(stakeContract.rewardAddress, 0n, rdmrBuilderWithdraw)
    .readFrom([stakeUtxoScriptRef, mintUtxoScriptRef])
    .mintAssets(
      {
        [mintContract.policyId + fromText("Test")]: 1n,
      },
      rdmrBuilderMint,
    )
    .setMinFee(200_000n)
    .completeProgram();
  return signBuilder;
});

export const collectFunds = pipe(
  collectFundsInternal,
  Effect.flatMap(handleSignSubmit),
  withLogRetry,
  Effect.orDie,
);

export const registerStake = Effect.gen(function* ($) {
  const { user } = yield* User;
  const { rewardAddress } = yield* StakeContract;
  const signBuilder = yield* user
    .newTx()
    .registerStake(rewardAddress)
    .completeProgram();

  return signBuilder;
}).pipe(
  Effect.flatMap(handleSignSubmit),
  Effect.catchTag("TxSubmitError", (error) =>
    error.message.includes("StakeKeyAlreadyRegisteredDELEG") ||
    error.message.includes("StakeKeyRegisteredDELEG")
      ? Effect.log("Stake Already registered")
      : Effect.fail(error),
  ),
  withLogRetry,
  Effect.orDie,
);

export const registerSimpleStake = Effect.gen(function* ($) {
  const { user } = yield* User;
  const { rewardAddress } = yield* SimpleStakeContract;
  const signBuilder = yield* user
    .newTx()
    .registerStake(rewardAddress)
    .completeProgram();

  return signBuilder;
}).pipe(
  Effect.flatMap(handleSignSubmit),
  Effect.catchTag("TxSubmitError", (error) =>
    error.message.includes("StakeKeyAlreadyRegisteredDELEG") ||
    error.message.includes("StakeKeyRegisteredDELEG")
      ? Effect.log("Stake Already registered")
      : Effect.fail(error),
  ),
  withLogRetry,
  Effect.orDie,
);

export const mintAndWithdraw = Effect.gen(function* () {
  const { user } = yield* User;
  const { stake, rewardAddress } = yield* SimpleStakeContract;
  const { mint, policyId } = yield* SimpleMintContract;

  const signBuilder = yield* user
    .newTx()
    .mintAssets(
      {
        [policyId + fromText("MintWithdraw")]: 1n,
      },
      Data.to(new Constr(0, [1n])),
    )
    .withdraw(rewardAddress, 0n, Data.to(new Constr(0, [fromText("1")])))
    .attach.WithdrawalValidator(stake)
    .attach.MintingPolicy(mint)
    .completeProgram();
  return signBuilder;
}).pipe(Effect.flatMap(handleSignSubmit), withLogRetry, Effect.orDie);
