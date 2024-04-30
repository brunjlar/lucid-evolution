import { Redeemer, RewardAddress, UTxO } from "@lucid-evolution/core-types";
import { TxBuilderConfig } from "../types.js";
import { Effect } from "effect";
import {
  ERROR_MESSAGE,
  TxBuilderError,
  TxBuilderErrorCause,
} from "../../Errors.js";
import { getAddressDetails } from "@lucid-evolution/utils";
import * as CML from "@dcspark/cardano-multiplatform-lib-nodejs";
import { toPartial, toV1, toV2 } from "./TxUtils.js";

export const stakeError = (cause: TxBuilderErrorCause, message?: string) =>
  new TxBuilderError({ cause, module: "Stake", message });

export const registerStake = (
  config: TxBuilderConfig,
  rewardAddress: RewardAddress,
): Effect.Effect<void, TxBuilderError> => {
  const program = Effect.gen(function* ($) {
    const addressDetails = getAddressDetails(rewardAddress);
    if (addressDetails.type !== "Reward")
      yield* $(stakeError("InvalidCredential", "Invalid stake credential"));
    const stakeCredential = yield* $(
      Effect.fromNullable(addressDetails.stakeCredential),
      Effect.orElseFail(() => stakeError("MissingStakeCredential")),
    );

    const credential =
      stakeCredential.type === "Key"
        ? CML.Credential.new_pub_key(
            CML.Ed25519KeyHash.from_hex(stakeCredential.hash),
          )
        : CML.Credential.new_script(
            CML.ScriptHash.from_hex(stakeCredential.hash),
          );
    const certBuilder = CML.SingleCertificateBuilder.new(
      CML.Certificate.new_stake_registration(credential),
    );
    config.txBuilder.add_cert(certBuilder.skip_witness());
  });

  return program;
};

export const deRegisterStake = (
  config: TxBuilderConfig,
  rewardAddress: RewardAddress,
  redeemer?: Redeemer,
): Effect.Effect<void, TxBuilderError> => {
  const program = Effect.gen(function* ($) {
    const addressDetails = getAddressDetails(rewardAddress);
    if (addressDetails.type !== "Reward")
      yield* $(stakeError("InvalidCredential", "Invalid stake credential"));
    const stakeCredential = yield* $(
      Effect.fromNullable(addressDetails.stakeCredential),
      Effect.orElseFail(() => stakeError("MissingStakeCredential")),
    );

    switch (stakeCredential.type) {
      case "Key": {
        const credential = CML.Credential.new_pub_key(
          CML.Ed25519KeyHash.from_hex(stakeCredential.hash),
        );
        const certBuilder = CML.SingleCertificateBuilder.new(
          CML.Certificate.new_stake_deregistration(credential),
        );
        config.txBuilder.add_cert(certBuilder.payment_key());
        break;
      }

      case "Script": {
        const credential = CML.Credential.new_script(
          CML.ScriptHash.from_hex(stakeCredential.hash),
        );
        const certBuilder = CML.SingleCertificateBuilder.new(
          CML.Certificate.new_stake_deregistration(credential),
        );
        const script = yield* $(
          Effect.fromNullable(config.scripts.get(stakeCredential.hash)),
          Effect.orElseFail(() =>
            stakeError(
              "MissingScript",
              `No script found, script hash: ${stakeCredential.hash}, consider using attach modules`,
            ),
          ),
        );
        const red = yield* $(
          Effect.fromNullable(redeemer),
          Effect.orElseFail(() =>
            stakeError("MissingRedeemer", ERROR_MESSAGE.MISSIG_REDEEMER),
          ),
        );
        switch (script.type) {
          case "PlutusV1": {
            certBuilder.plutus_script(
              toPartial(toV1(script.script), red),
              CML.RequiredSigners.new(),
            );
            break;
          }

          case "PlutusV2": {
            certBuilder.plutus_script(
              toPartial(toV2(script.script), red),
              CML.RequiredSigners.new(),
            );
            break;
          }
          case "Native": {
            yield* stakeError("NotFound");
            break;
          }
        }
      }
    }
  });

  return program;
};
