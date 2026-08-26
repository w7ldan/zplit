import Link from "next/link";
import { notFound } from "next/navigation";
import { getDatabase } from "@/db/client";
import { getAuthenticatedOrganizationLedger } from "@/server/authenticated-ledger";
import { LedgerNotFoundError, deletionImpactRevision } from "@/domain/ledger-repository";
import { RepaymentForm } from "@/components/repayments/repayment-form";
import { RepaymentAllocationEditor } from "@/components/repayments/repayment-allocation-editor";
import { RepaymentPaymentProof } from "@/components/repayments/repayment-payment-proof";
import { DeleteRecordForm } from "@/components/app/delete-record-form";
import { LocalDateTime } from "@/components/editorial/local-date-time";
import { formatRupiah } from "@/domain/rupiah";
import { getRepaymentPaymentProofMetadataForScope } from "@/server/repayment-payment-proofs";
import { deleteRepaymentAction, loadRepaymentFriendContext, removeRepaymentAllocationAction, replaceRepaymentAllocationsAction, searchFriendOptions, undoRepaymentAllocationAction, updateRepaymentAction } from "../../ledger-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Organization repayment details" };
function first(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] : value; }

export default async function OrganizationRepaymentPage({ params, searchParams = Promise.resolve({}) }: { params: Promise<{ organizationId: string; repaymentId: string }>; searchParams?: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const { organizationId, repaymentId } = await params;
  const query = await searchParams;
  const base = `/app/organizations/${organizationId}`;
  const access = await getAuthenticatedOrganizationLedger(organizationId, "ledger.view");
  let plan;
  try { plan = await access.ledger.getRepaymentAllocationPlan(repaymentId, { q: first(query.q), page: first(query.page) }); } catch (error) { if (error instanceof LedgerNotFoundError) notFound(); throw error; }
  const [impact, friendRows, friendContext, methods, proof] = await Promise.all([access.ledger.getRepaymentDeletionImpact(repaymentId), access.ledger.searchFriends({ selectedId: plan.friendId }), access.ledger.getRepaymentFriendContext(plan.friendId), access.ledger.listRecentPaymentMethods(), getRepaymentPaymentProofMetadataForScope(getDatabase(), access.ledgerScopeId, plan.id)]);
  const friendOptions = friendRows.map((friend) => ({ id: friend.id, label: friend.name, archived: friend.archived }));
  const formContext = { ...friendContext, option: { id: friendContext.option.id, label: friendContext.option.name, archived: friendContext.option.archived } };
  const canEdit = access.can("repayments.edit");
  return <section className="app-page repayment-record" id="top"><div className="editorial-grid editorial-shell repayment-record__layout"><div className="repayment-record__intro"><p className="technical-label">Organization Repayment · allocate received money</p><h1>{plan.friendName}</h1><Link className="repayment-record__back" href={`${base}/repayments`}>← Back to repayments</Link></div><div className="repayment-record__tasks"><div className="repayment-record__primary-task">{canEdit ? <RepaymentAllocationEditor action={replaceRepaymentAllocationsAction.bind(null, organizationId, plan.id)} plan={plan} allocationQuery={first(query.q)} allocationPage={plan.sharePage?.page} removeAction={removeRepaymentAllocationAction.bind(null, organizationId)} undoAction={undoRepaymentAllocationAction.bind(null, organizationId)} basePath={base} /> : <p className="app-page__lede">Repayment allocation is read-only for your current Organization access.</p>}<RepaymentPaymentProof repaymentId={plan.id} initialPaymentProof={proof} basePath={`${base}/repayments`} canEdit={canEdit} /></div><aside className="repayment-record__sidebar"><div className="repayment-record__controls"><div className="repayment-record__meta"><div><span className="technical-label">Received</span><strong>{formatRupiah(plan.amount)}</strong></div><div><span className="technical-label">Applied</span><strong>{formatRupiah(plan.allocatedAmount)}</strong></div><div><span className="technical-label">Needs allocation</span><strong>{formatRupiah(plan.unallocatedAmount)}</strong></div><div><span className="technical-label">Payment date</span><LocalDateTime iso={plan.paidAt.toISOString()} mode="date" /></div></div>{canEdit ? <RepaymentForm action={updateRepaymentAction.bind(null, organizationId, plan.id)} friends={friendOptions} searchFriends={searchFriendOptions.bind(null, organizationId)} recentPaymentMethods={methods} mode="edit" friendLocked={plan.allocatedAmount > 0} initialFriendContext={formContext} loadFriendContext={loadRepaymentFriendContext.bind(null, organizationId)} initialPaidAtUtc={plan.paidAt.toISOString()} initialValues={{ friendId: plan.friendId, amountRupiah: plan.amount.toString(), paidAtLocal: "", timezoneOffsetMinutes: "", paymentMethod: plan.paymentMethod ?? "", notes: plan.notes ?? "" }} /> : null}{access.can("repayments.delete") ? <DeleteRecordForm action={deleteRepaymentAction.bind(null, organizationId, plan.id)} recordType="repayment" impact={impact} impactRevision={deletionImpactRevision(impact)} /> : null}</div></aside></div></div></section>;
}
