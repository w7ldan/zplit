import Link from "next/link";
import { notFound } from "next/navigation";
import { getDatabase } from "@/db/client";
import { requireSession } from "@/auth/require-session";
import { LocalDateTime } from "@/components/editorial/local-date-time";
import { RepaymentForm } from "@/components/repayments/repayment-form";
import { RepaymentAllocationEditor } from "@/components/repayments/repayment-allocation-editor";
import { RepaymentPaymentProof } from "@/components/repayments/repayment-payment-proof";
import { formatRupiah } from "@/domain/rupiah";
import { normalizeUuid } from "@/domain/record-retrieval";
import { deletionImpactRevision, LedgerNotFoundError } from "@/domain/ledger-repository";
import { getAuthenticatedLedger } from "@/server/authenticated-ledger";
import { loadRepaymentFriendContext, removeRepaymentAllocationAction, replaceRepaymentAllocationsAction, searchFriendOptions, undoRepaymentAllocationAction, updateRepaymentAction } from "../actions";
import { RecordConfirmation } from "@/components/app/record-confirmation";
import { DeleteRecordForm } from "@/components/app/delete-record-form";
import { deleteRepaymentAction } from "../actions";
import { getRepaymentPaymentProofMetadata } from "@/server/repayment-payment-proofs";

export const dynamic = "force-dynamic";
export const metadata = { title: "Repayment details" };

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

type RepaymentRecordQuery = { created?: string | string[]; saved?: string | string[]; q?: string | string[]; page?: string | string[]; tripId?: string | string[] };
type RepaymentRecordData = {
  plan: Awaited<ReturnType<Awaited<ReturnType<typeof getAuthenticatedLedger>>["ledger"]["getRepaymentAllocationPlan"]>>;
  deletionImpact: Awaited<ReturnType<Awaited<ReturnType<typeof getAuthenticatedLedger>>["ledger"]["getRepaymentDeletionImpact"]>>;
  currentImpactRevision: string;
  contextTrip: { id: string; name: string } | undefined;
  friendOptions: Array<{ id: string; label: string; archived: boolean }>;
  formContext: Omit<Awaited<ReturnType<Awaited<ReturnType<typeof getAuthenticatedLedger>>["ledger"]["getRepaymentFriendContext"]>>, "option"> & { option: { id: string; label: string; archived: boolean } };
  recentPaymentMethods: string[];
  paymentProof: Awaited<ReturnType<typeof getRepaymentPaymentProofMetadata>>;
};

async function loadRepaymentRecordData(session: Awaited<ReturnType<typeof requireSession>>, repaymentId: string, query: RepaymentRecordQuery | undefined): Promise<RepaymentRecordData> {
  const database = getDatabase();
  const { ledger: repository } = await getAuthenticatedLedger(session);
  let plan;
  try {
    plan = await repository.getRepaymentAllocationPlan(repaymentId, { q: first(query?.q), page: first(query?.page) });
  } catch (error) {
    if (error instanceof LedgerNotFoundError) notFound();
    throw error;
  }
  const deletionImpact = await repository.getRepaymentDeletionImpact(repaymentId);
  const currentImpactRevision = deletionImpactRevision(deletionImpact);
  const requestedTripId = normalizeUuid(first(query?.tripId));
  const contextTrip = requestedTripId ? await repository.getTrip(requestedTripId).then((trip) => ({ id: trip.id, name: trip.name })).catch((error) => {
    if (error instanceof LedgerNotFoundError) return undefined;
    throw error;
  }) : undefined;
  const [friendOptionRows, friendContext, recentPaymentMethods, paymentProof] = await Promise.all([
    repository.searchFriends({ selectedId: plan.friendId }),
    repository.getRepaymentFriendContext(plan.friendId),
    repository.listRecentPaymentMethods(),
    getRepaymentPaymentProofMetadata(database, session.user.id, plan.id),
  ]);
  return {
    plan,
    deletionImpact,
    currentImpactRevision,
    contextTrip,
    friendOptions: friendOptionRows.map((friend) => ({ id: friend.id, label: friend.name, archived: friend.archived })),
    formContext: { ...friendContext, option: { id: friendContext.option.id, label: friendContext.option.name, archived: friendContext.option.archived } },
    recentPaymentMethods,
    paymentProof,
  };
}

function RepaymentRecordContent({ data, query }: { data: RepaymentRecordData; query: RepaymentRecordQuery | undefined }) {
  const { plan, contextTrip, deletionImpact, currentImpactRevision, friendOptions, formContext, recentPaymentMethods, paymentProof } = data;
  return (
    <section className="app-page repayment-record" id="top">
      <div className="editorial-grid editorial-shell repayment-record__layout">
        <div className="repayment-record__intro">
          <p className="technical-label">Repayment · allocate received money</p>
          <h1>{plan.friendName}</h1>
          <Link className="repayment-record__back" href={contextTrip ? "/app/trips/" + contextTrip.id : "/app/repayments"}>← Back to {contextTrip ? contextTrip.name : "repayments"}</Link>
        </div>
        {query?.created === "1" ? <RecordConfirmation queryKey="created" message="Repayment recorded. Review eligible shares below." /> : query?.saved === "1" ? <RecordConfirmation queryKey="saved" message="Repayment changes saved." /> : null}
        <div className="repayment-record__tasks">
          <div className="repayment-record__primary-task">
            <div className="repayment-record__allocations" id="repayment-allocations">
              <RepaymentAllocationEditor action={replaceRepaymentAllocationsAction.bind(null, plan.id)} plan={plan} allocationQuery={first(query?.q)} allocationPage={plan.sharePage?.page} removeAction={removeRepaymentAllocationAction} undoAction={undoRepaymentAllocationAction} />
            </div>
            <RepaymentPaymentProof repaymentId={plan.id} initialPaymentProof={paymentProof} />
          </div>
          <aside className="repayment-record__sidebar">
            <div className="repayment-record__controls">
              <div className="repayment-record__meta" aria-label="Repayment metadata">
                <div><span className="technical-label">Received</span><strong>{formatRupiah(plan.amount)}</strong></div>
                <div><span className="technical-label">Applied to shares</span><strong>{formatRupiah(plan.allocatedAmount)}</strong></div>
                <div><span className="technical-label">Needs allocation</span><strong>{formatRupiah(plan.unallocatedAmount)}</strong></div>
                <div><span className="technical-label">Payment date</span><LocalDateTime iso={plan.paidAt.toISOString()} mode="date" /></div>
                <div><span className="technical-label">Payment method</span><span>{plan.paymentMethod ?? "—"}</span></div>
                <div><span className="technical-label">Notes</span><span className="repayment-record__notes-value">{plan.notes ?? "—"}</span></div>
              </div>
              <div className="repayment-record__form">
                <p className="technical-label">EDIT RECORD</p>
                <RepaymentForm action={updateRepaymentAction.bind(null, plan.id)} friends={friendOptions} searchFriends={searchFriendOptions} recentPaymentMethods={recentPaymentMethods} mode="edit" friendLocked={plan.allocatedAmount > 0} initialFriendContext={formContext} loadFriendContext={loadRepaymentFriendContext} initialPaidAtUtc={plan.paidAt.toISOString()} initialValues={{ friendId: plan.friendId, amountRupiah: plan.amount.toString(), paidAtLocal: "", timezoneOffsetMinutes: "", paymentMethod: plan.paymentMethod ?? "", notes: plan.notes ?? "" }} />
              </div>
              <DeleteRecordForm action={deleteRepaymentAction.bind(null, plan.id)} recordType="repayment" impact={deletionImpact} impactRevision={currentImpactRevision} />
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}

export default async function RepaymentRecordPage({ params, searchParams }: { params: Promise<{ repaymentId: string }>; searchParams?: Promise<{ created?: string | string[]; saved?: string | string[]; q?: string | string[]; page?: string | string[]; tripId?: string | string[] }> }) {
  const session = await requireSession();
  const { repaymentId } = await params;
  const query = await searchParams;
  const data = await loadRepaymentRecordData(session, repaymentId, query);

  return <RepaymentRecordContent data={data} query={query} />;
}
