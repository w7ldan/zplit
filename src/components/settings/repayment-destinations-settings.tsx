"use client";

import { useRef, useState, useTransition, type DragEvent } from "react";
import type { RepaymentDestinationFormAction, RepaymentDestinationOrderAction } from "@/app/app/settings/actions";
import { destinationTypeLabel, type RepaymentDestinationType } from "@/domain/repayment-destination";
import { RepaymentDestinationForm } from "./repayment-destination-form";

export type SettingsRepaymentDestination = {
  id: string;
  type: RepaymentDestinationType;
  name: string;
  identifier: string;
  accountName: string | null;
  note: string | null;
  shareOnBalanceLinks: boolean;
};

type DestinationDeleteAction = (formData: FormData) => Promise<void>;

export type SettingsRepaymentDestinationEntry = SettingsRepaymentDestination & {
  updateAction: RepaymentDestinationFormAction;
  deleteAction: DestinationDeleteAction;
};

type Props = {
  destinations: SettingsRepaymentDestinationEntry[];
  createAction: RepaymentDestinationFormAction;
  setOrderAction: RepaymentDestinationOrderAction;
};

const createFormId = "repayment-destination-create-form";

function serverSnapshot(destinations: SettingsRepaymentDestinationEntry[]) {
  return JSON.stringify(destinations.map(({ id, type, name, identifier, accountName, note, shareOnBalanceLinks }) => [id, type, name, identifier, accountName, note, shareOnBalanceLinks]));
}

function hasOrder(destinationIds: string[], ids: string[]) {
  return destinationIds.length === ids.length && destinationIds.every((id, index) => id === ids[index]);
}

function reconcileOrder(destinationIds: string[], preferredIds: string[]) {
  const availableIds = new Set(destinationIds);
  const preferredSet = new Set(preferredIds);
  return [
    ...preferredIds.filter((id) => availableIds.has(id)),
    ...destinationIds.filter((id) => !preferredSet.has(id)),
  ];
}

type OrderOverlay =
  | { kind: "optimistic"; ids: string[]; snapshot: string }
  | { kind: "rollback"; ids: string[]; snapshot: string };

export function RepaymentDestinationsSettings({ destinations, createAction, setOrderAction }: Props) {
  const destinationIds = destinations.map(({ id }) => id);
  const currentServerSnapshot = serverSnapshot(destinations);
  const [orderOverlay, setOrderOverlay] = useState<OrderOverlay | null>(null);
  const confirmedOrder = useRef(destinationIds);
  const [openForm, setOpenForm] = useState<{ id: string; snapshot: string } | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragTargetId, setDragTargetId] = useState<string | null>(null);
  const [orderError, setOrderError] = useState<{ message: string; snapshot: string } | null>(null);
  const createTrigger = useRef<HTMLButtonElement>(null);
  const editTriggers = useRef<Record<string, HTMLButtonElement | null>>({});
  const [isPending, startTransition] = useTransition();

  const destinationsById = new Map(destinations.map((destination) => [destination.id, destination]));
  const overlayIds = orderOverlay && (isPending || orderOverlay.snapshot === currentServerSnapshot)
    ? orderOverlay.ids
    : null;
  const preferredOrderIds = overlayIds && !hasOrder(destinationIds, overlayIds) ? overlayIds : destinationIds;
  const orderedDestinations = reconcileOrder(destinationIds, preferredOrderIds)
    .map((id) => destinationsById.get(id))
    .filter((destination): destination is SettingsRepaymentDestinationEntry => Boolean(destination));
  const visibleOpenForm = openForm?.snapshot === currentServerSnapshot ? openForm.id : null;
  const visibleOrderError = orderError?.snapshot === currentServerSnapshot ? orderError.message : "";

  function openFormFor(id: string) {
    setOpenForm({ id, snapshot: currentServerSnapshot });
  }

  function closeForm(trigger?: HTMLButtonElement | null) {
    setOpenForm(null);
    trigger?.focus();
  }

  function persistOrder(nextOrder: SettingsRepaymentDestinationEntry[]) {
    if (isPending) return;
    confirmedOrder.current = orderedDestinations.map(({ id }) => id);
    const nextOrderIds = nextOrder.map(({ id }) => id);
    setOrderOverlay({ kind: "optimistic", ids: nextOrderIds, snapshot: currentServerSnapshot });
    setOrderError(null);
    startTransition(async () => {
      try {
        const result = await setOrderAction(nextOrderIds);
        if (result.ok) {
          confirmedOrder.current = nextOrderIds;
          return;
        }
        setOrderOverlay({ kind: "rollback", ids: confirmedOrder.current, snapshot: currentServerSnapshot });
        setOrderError({ message: result.message, snapshot: currentServerSnapshot });
      } catch {
        setOrderOverlay({ kind: "rollback", ids: confirmedOrder.current, snapshot: currentServerSnapshot });
        setOrderError({ message: "Unable to save repayment destination order.", snapshot: currentServerSnapshot });
      }
    });
  }

  function moveDestination(sourceId: string, targetId: string) {
    const sourceIndex = orderedDestinations.findIndex(({ id }) => id === sourceId);
    const targetIndex = orderedDestinations.findIndex(({ id }) => id === targetId);
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return;
    const nextOrder = [...orderedDestinations];
    const [source] = nextOrder.splice(sourceIndex, 1);
    nextOrder.splice(targetIndex, 0, source!);
    persistOrder(nextOrder);
  }

  function handleDragStart(event: DragEvent<HTMLSpanElement>, id: string) {
    setDraggedId(id);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", id);
    }
  }

  function handleDrop(event: DragEvent<HTMLElement>, targetId: string) {
    event.preventDefault();
    const sourceId = draggedId;
    setDraggedId(null);
    setDragTargetId(null);
    if (sourceId) moveDestination(sourceId, targetId);
  }

  return (
    <>
      {orderedDestinations.length ? (
        <div className="settings-page__destinations">
          {orderedDestinations.map((destination, index) => {
            const editFormId = `repayment-destination-edit-${destination.id}`;
            const isDragging = draggedId === destination.id;
            const isDropTarget = dragTargetId === destination.id && !isDragging;
            return (
              <article
                className={`settings-page__destination${isDragging ? " settings-page__destination--dragging" : ""}${isDropTarget ? " settings-page__destination--drag-target" : ""}`}
                key={destination.id}
                aria-labelledby={`repayment-destination-${destination.id}-heading`}
                onDragOver={(event) => { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = "move"; setDragTargetId(destination.id); }}
                onDrop={(event) => handleDrop(event, destination.id)}
              >
                <div className="settings-page__destination-main">
                  <div className="settings-page__destination-copy">
                    <span
                      className="settings-page__destination-drag-handle"
                      role="img"
                      aria-label={`Drag ${destination.name} to reorder`}
                      draggable={!isPending}
                      onDragStart={(event) => handleDragStart(event, destination.id)}
                      onDragEnd={() => { setDraggedId(null); setDragTargetId(null); }}
                    >
                      <span aria-hidden="true">⋮⋮</span>
                    </span>
                    <div>
                      <h3 id={`repayment-destination-${destination.id}-heading`}>{destination.name}</h3>
                      <p className="settings-page__identifier">{destination.identifier}</p>
                      {destination.accountName ? <p>{destination.accountName}</p> : null}
                      {destination.note ? <p className="settings-page__note">{destination.note}</p> : null}
                    </div>
                  </div>
                  <span className="technical-label">{destinationTypeLabel(destination.type)}</span>
                </div>
                <div className="settings-page__destination-footer">
                  <span>{destination.shareOnBalanceLinks ? "Shown on balance links" : "Not shown on balance links"}</span>
                  <div className="settings-page__destination-actions">
                    <button className="text-link" type="button" disabled={isPending || index === 0} aria-busy={isPending} aria-label={`Move ${destination.name} up`} onClick={() => moveDestination(destination.id, orderedDestinations[index - 1]?.id ?? "")}>↑</button>
                    <button className="text-link" type="button" disabled={isPending || index === orderedDestinations.length - 1} aria-busy={isPending} aria-label={`Move ${destination.name} down`} onClick={() => moveDestination(destination.id, orderedDestinations[index + 1]?.id ?? "")}>↓</button>
                    <button
                      ref={(element) => { editTriggers.current[destination.id] = element; }}
                      className="text-link"
                      type="button"
                      aria-expanded={visibleOpenForm === destination.id}
                      aria-controls={editFormId}
                      aria-label={`Edit ${destination.name}`}
                      onClick={() => openFormFor(destination.id)}
                    >
                      Edit
                    </button>
                    <form action={destination.deleteAction}><button className="text-link" type="submit">Delete</button></form>
                  </div>
                </div>
                {visibleOpenForm === destination.id ? (
                  <div className="settings-page__disclosure" id={editFormId} aria-labelledby={`${editFormId}-heading`}>
                    <p className="technical-label" id={`${editFormId}-heading`}>EDIT DESTINATION</p>
                    <RepaymentDestinationForm
                      action={destination.updateAction}
                      mode="edit"
                      idPrefix={`repayment-destination-${destination.id}`}
                      initialValues={{ type: destination.type, name: destination.name, identifier: destination.identifier, accountName: destination.accountName ?? "", note: destination.note ?? "", shareOnBalanceLinks: destination.shareOnBalanceLinks }}
                      onCancel={() => closeForm(editTriggers.current[destination.id])}
                    />
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : <p className="settings-page__empty">No repayment destinations yet. Add somewhere friends can send repayments.</p>}
      {visibleOrderError ? <p className="settings-page__error" role="alert">{visibleOrderError}</p> : null}
      <div className="settings-page__add">
        <button ref={createTrigger} className="text-link" type="button" aria-expanded={visibleOpenForm === "create"} aria-controls={createFormId} onClick={() => openFormFor("create")}>New destination</button>
        {visibleOpenForm === "create" ? (
          <div className="settings-page__disclosure" id={createFormId} aria-labelledby="repayment-destination-create-heading">
            <p className="technical-label" id="repayment-destination-create-heading">ADD DESTINATION</p>
            <RepaymentDestinationForm action={createAction} onCancel={() => closeForm(createTrigger.current)} />
          </div>
        ) : null}
      </div>
    </>
  );
}
