const records = [
  { id: "01", expense: "Dinner", person: "Rani", amount: "Rp 84.000", status: "OPEN" },
  { id: "02", expense: "Taxi", person: "Dimas", amount: "Rp 42.500", status: "PART-PAID" },
  { id: "03", expense: "Tickets", person: "Naya", amount: "Rp 160.000", status: "SETTLED" },
];

export function LedgerStudy() {
  return (
    <div className="ledger-study" aria-labelledby="ledger-study-label">
      <p className="ledger-study__label technical-label" id="ledger-study-label">
        ILLUSTRATIVE INTERFACE DATA
      </p>
      <ul className="ledger-study__list" aria-label="Illustrative ledger records">
        {records.map((record, index) => (
          <li
            className={`ledger-study__row${index === 0 ? " ledger-study__row--selected" : ""}`}
            key={record.id}
          >
            <span className="ledger-study__index">{record.id}</span>
            <span className="ledger-study__cell">
              <span className="ledger-study__field-label">Expense</span>
              <span className="ledger-study__value">{record.expense}</span>
            </span>
            <span className="ledger-study__cell">
              <span className="ledger-study__field-label">Person</span>
              <span className="ledger-study__value">{record.person}</span>
            </span>
            <span className="ledger-study__cell ledger-study__cell--amount">
              <span className="ledger-study__field-label">Amount</span>
              <span className="ledger-study__value tabular-nums">{record.amount}</span>
            </span>
            <span className="ledger-study__cell">
              <span className="ledger-study__field-label">Status</span>
              <span className="ledger-study__status">{record.status}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="ledger-study__note">
        A record makes the person, amount, and state legible at a glance—without searching a message history.
      </p>
    </div>
  );
}
