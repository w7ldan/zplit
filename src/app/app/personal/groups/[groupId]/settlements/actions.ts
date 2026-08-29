"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/auth/require-session";
import { getDatabase } from "@/db/client";
import {
  GroupSettlementInputError,
  normalizeGroupSettlementInput,
} from "@/domain/group-settlements";
import type {
  GroupSettlementActionState,
  GroupSettlementConfirmationState,
  GroupSettlementFormValues,
} from "@/domain/group-contracts";
import { validateReceiptFile, ReceiptFileValidationError } from "@/domain/receipt-file";
import {
  confirmGroupSettlement,
  createGroupSettlement,
  GroupSettlementError,
} from "@/server/group-settlements";
import { createGroupSettlementProof } from "@/server/group-settlement-proofs";

export type {
  GroupSettlementActionState,
  GroupSettlementConfirmationState,
  GroupSettlementFormValues,
} from "@/domain/group-contracts";

function text(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function valuesFromForm(formData: FormData): GroupSettlementFormValues {
  const choice = text(formData, "paymentMethodChoice");
  return {
    recipientParticipantId: text(formData, "recipientParticipantId"),
    amountRupiah: text(formData, "amountRupiah"),
    paymentMethodChoice: choice as GroupSettlementFormValues["paymentMethodChoice"],
    paymentMethodOther: text(formData, "paymentMethodOther"),
  };
}

function state(
  values: GroupSettlementFormValues,
  fieldErrors: GroupSettlementActionState["fieldErrors"] = {},
  formError = "",
): GroupSettlementActionState {
  return { fieldErrors, formError, values };
}

function inputErrorState(error: unknown, values: GroupSettlementFormValues) {
  if (error instanceof GroupSettlementInputError) {
    const fieldErrors: Partial<Record<GroupSettlementInputError["code"], GroupSettlementActionState["fieldErrors"]>> = {
      invalid_amount: { amountRupiah: "Use a positive whole-rupiah amount." },
      invalid_payment_method: { paymentMethodChoice: "Choose a payment method." },
      invalid_input: { recipientParticipantId: "Choose an eligible recipient." },
    };
    return state(
      values,
      fieldErrors[error.code],
      error.code === "same_participant"
        ? "Choose someone other than yourself."
        : "Please correct the marked fields.",
    );
  }
  if (error instanceof GroupSettlementError) {
    const messages: Partial<Record<GroupSettlementError["code"], string>> = {
      invalid_id: "This Group payment is no longer available.",
      invalid_user: "Your session is no longer available.",
      not_found: "This Group payment is no longer available.",
      forbidden: "You can only record a payment as yourself.",
      sender_not_found: "Your Group participant identity is no longer available.",
      sender_external: "External participants cannot record payments.",
      sender_not_active: "You are no longer an active Group member.",
      recipient_not_found: "Choose an eligible recipient.",
      recipient_external: "Payments can only be recorded to registered members.",
      recipient_not_active: "That recipient is no longer an active Group member.",
      debt_exceeded: "The amount cannot exceed the current debt. Reload and try again.",
      invalid_state: "This Group payment is no longer pending.",
      financial_integrity: "The accounting data changed. Reload and try again.",
    };
    return state(values, {}, messages[error.code] ?? "Unable to record this Group payment.");
  }
  return state(values, {}, "Unable to record this Group payment.");
}

async function readProof(formData: FormData) {
  const value = formData.get("proof");
  if (!(value instanceof File) || value.size === 0) return null;
  try {
    return validateReceiptFile({
      bytes: new Uint8Array(await value.arrayBuffer()),
      filename: value.name,
      mediaType: value.type.trim().toLowerCase(),
    }, "Payment proof");
  } catch (error) {
    if (error instanceof ReceiptFileValidationError) throw error;
    throw new ReceiptFileValidationError("This payment proof could not be processed.");
  }
}

export async function createGroupSettlementAction(
  groupId: string,
  senderParticipantId: string,
  _previousState: GroupSettlementActionState,
  formData: FormData,
): Promise<GroupSettlementActionState> {
  const values = valuesFromForm(formData);
  let input;
  try {
    input = normalizeGroupSettlementInput({
      senderParticipantId,
      recipientParticipantId: values.recipientParticipantId,
      amountRupiah: values.amountRupiah,
      paymentMethodChoice: values.paymentMethodChoice,
      paymentMethodOther: values.paymentMethodOther,
    });
  } catch (error) {
    return inputErrorState(error, values);
  }

  let proof;
  try {
    proof = await readProof(formData);
  } catch (error) {
    return state(values, { proof: error instanceof Error ? error.message : "Choose a valid payment proof image." }, "Please choose a valid payment proof image.");
  }

  const session = await requireSession();
  let settlement;
  try {
    settlement = await createGroupSettlement(getDatabase(), groupId, session.user.id, input);
  } catch (error) {
    return inputErrorState(error, values);
  }

  let proofFailed = false;
  if (proof) {
    try {
      await createGroupSettlementProof(getDatabase(), groupId, settlement.id, session.user.id, proof);
    } catch {
      proofFailed = true;
    }
  }

  const path = `/app/personal/groups/${groupId}/settlements`;
  revalidatePath(`/app/personal/groups/${groupId}`);
  revalidatePath(path);
  const query = new URLSearchParams({ created: "1" });
  if (proofFailed) query.set("proof", "failed");
  redirect(`${path}/${settlement.id}?${query.toString()}`);
}

export async function confirmGroupSettlementAction(
  groupId: string,
  settlementId: string,
  _previousState: GroupSettlementConfirmationState,
  _formData: FormData,
): Promise<GroupSettlementConfirmationState> {
  void _previousState;
  void _formData;
  const session = await requireSession();
  try {
    await confirmGroupSettlement(getDatabase(), groupId, settlementId, session.user.id);
  } catch (error) {
    const messages: Partial<Record<GroupSettlementError["code"], string>> = {
      forbidden: "Only the payment recipient can confirm this payment.",
      recipient_not_active: "The recipient is no longer an active Group member.",
      debt_exceeded: "The current debt changed. Reload before confirming this payment.",
      invalid_state: "This Group payment is no longer pending.",
      not_found: "This Group payment is no longer available.",
      financial_integrity: "The accounting data changed. Reload and try again.",
    };
    const message = error instanceof GroupSettlementError
      ? messages[error.code] ?? "Unable to confirm this Group payment."
      : "Unable to confirm this Group payment.";
    return { error: message };
  }
  revalidatePath(`/app/personal/groups/${groupId}`);
  revalidatePath(`/app/personal/groups/${groupId}/settlements`);
  revalidatePath(`/app/personal/groups/${groupId}/settlements/${settlementId}`);
  return { error: "", success: "Payment confirmed. The canonical Group balance has been refreshed." };
}
