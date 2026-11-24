// Sinking funds: a pot that keeps what's left over. Every payday its budget goes in, what's spent
// comes out, and the rest stays for the big months (a trip, the yearly gym or insurance). Pure maths, so
// it can be tested without a database.

// The budget that applied in a month: the latest change from that month or before (`history` is
// [{ from: 'YYYY-MM', cents }], oldest first). Before any change, the first one applies.
export function budgetIn(history, month) {
  let cents = history[0]?.cents ?? 0;
  for (const h of history) if (h.from <= month) cents = h.cents;
  return cents;
}

// Month by month from the start: what was carried in, put in, spent, and the balance after.
// `months` are budget months oldest first, `spent` the pot's net spend per month.
export function runFund({ months, spent, history, startCents = 0 }) {
  let balance = startCents;
  return months.map((month) => {
    const carried = balance;
    const putIn = budgetIn(history, month);
    const net = spent[month] ?? 0;
    balance = carried + putIn - net;
    // Spending over the month's budget is paid from what was carried in, as far as it goes.
    const fromFund = Math.max(0, Math.min(net - putIn, Math.max(0, carried)));
    return { month, carried, putIn, spent: net, fromFund, balance };
  });
}

// How many paydays come after `today` up to and including `due`: each one puts the budget in.
// `payday` is the start of the current month, e.g. '2026-09-24'.
export function paydaysUntil(payday, today, due) {
  const [y, m] = payday.split('-').map(Number);
  const day = Math.min(Number(payday.slice(8, 10)), 28);
  let n = 0;
  for (let i = 1; i <= 120; i++) {
    const d = new Date(Date.UTC(y, m - 1 + i, day)).toISOString().slice(0, 10);
    if (d > due) break;
    if (d > today) n += 1;
  }
  return n;
}

// The big costs coming up, each with what the fund should hold by then: the balance now, plus every
// payday's budget minus the everyday spending in the pot (its median month), minus the costs before it.
export function readiness({ balance, budget, everyday, upcoming, payday, today }) {
  let due = 0;
  return upcoming.map((u) => {
    due += u.cents;
    const paydays = paydaysUntil(payday, today, u.date);
    const expected = balance + paydays * Math.max(0, budget - everyday) - due;
    return { ...u, paydays, expected, ready: expected >= 0 };
  });
}
