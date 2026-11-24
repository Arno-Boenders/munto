// Savings maths, shared by the Savings page (and usable from the CLI). Money is integer cents.

export const DEFAULT_INFLATION = 0.02;

// Monthly rate for a yearly return: 6% a year is about 0.487% a month, compounded.
export const monthlyRate = (annual) => (1 + annual) ** (1 / 12) - 1;

// How much a plan puts in each month: the fixed amount, or the average of the last finished months.
export function monthlyDeposit(pot) {
  const plan = pot.plan;
  if (plan?.mode === 'off') return 0;
  if (plan?.mode === 'fixed') return plan.monthlyCents ?? 0;
  return Math.max(0, pot.average);
}

export const returnOf = (pot) => pot.plan?.annualReturn ?? pot.suggestedReturn;

// A pessimistic/optimistic spread around the expected return: wide for investments, narrow for cash.
export const spreadOf = (annual) => (annual >= 0.04 ? 0.03 : 0.005);

// The balance today: what you typed in (plus what moved since that day), or what you've moved in so far.
export function balanceNow(pot, today) {
  const plan = pot.plan;
  if (plan?.balanceCents == null) return { cents: Math.max(0, pot.net), known: false };
  const since = Object.entries(pot.byMonth).filter(([m]) => m > (plan.balanceDate ?? today).slice(0, 7)).reduce((s, [, v]) => s + v, 0);
  return { cents: plan.balanceCents + since, known: true };
}

// Month-by-month values for `months` months ahead. Returns [{ n, low, mid, high, deposited }], n = 0 is today.
export function project(pots, months, { extraCents = 0, inflation = 0, today }) {
  const active = pots.filter((p) => p.plan?.mode !== 'off');
  const state = active.map((p) => {
    const start = balanceNow(p, today).cents;
    const r = returnOf(p);
    return { lo: start, mid: start, hi: start, dep: monthlyDeposit(p), r, s: spreadOf(r) };
  });
  // Extra savings from the what-if slider grow at the plan's average return (weighted by deposits).
  const depTotal = state.reduce((a, b) => a + b.dep, 0);
  const extraR = depTotal > 0 ? state.reduce((a, b) => a + b.r * b.dep, 0) / depTotal : 0.02;
  if (extraCents) state.push({ lo: 0, mid: 0, hi: 0, dep: extraCents, r: extraR, s: spreadOf(extraR) });
  const startTotal = state.reduce((a, b) => a + b.mid, 0);
  const out = [];
  let deposited = startTotal;
  for (let n = 0; n <= months; n++) {
    if (n > 0) {
      for (const st of state) {
        st.lo = st.lo * (1 + monthlyRate(st.r - st.s)) + st.dep;
        st.mid = st.mid * (1 + monthlyRate(st.r)) + st.dep;
        st.hi = st.hi * (1 + monthlyRate(st.r + st.s)) + st.dep;
        deposited += st.dep;
      }
    }
    const real = inflation ? (1 + inflation) ** (n / 12) : 1;
    const sum = (k) => Math.round(state.reduce((a, b) => a + b[k], 0) / real);
    out.push({ n, low: sum('lo'), mid: sum('mid'), high: sum('hi'), deposited: Math.round(deposited / real) });
  }
  return out;
}

// Per account after `months` months (expected return), for the breakdown under the chart.
export function projectEach(pots, months, { inflation = 0, today }) {
  const real = inflation ? (1 + inflation) ** (months / 12) : 1;
  return pots.filter((p) => p.plan?.mode !== 'off').map((p) => {
    let v = balanceNow(p, today).cents;
    const dep = monthlyDeposit(p);
    const r = monthlyRate(returnOf(p));
    for (let n = 0; n < months; n++) v = v * (1 + r) + dep;
    return { key: p.key, cents: Math.round(v / real), deposits: dep };
  });
}

// When a goal is reached at the plan's pace: the first month the expected value gets there (null: not within `max`).
export function monthsToGoal(pots, target, { today, max = 600 } = {}) {
  const path = project(pots, max, { today });
  const hit = path.find((p) => p.mid >= target);
  return hit ? hit.n : null;
}

// How much more a month it takes to reach `target` in `months` months (0 if the plan already gets there).
export function extraNeeded(pots, target, months, { today }) {
  if (months <= 0) return null;
  const at = (extra) => project(pots, months, { today, extraCents: extra }).at(-1).mid;
  if (at(0) >= target) return 0;
  let lo = 0;
  let hi = Math.max(1000, target);
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (at(mid) >= target) hi = mid; else lo = mid;
  }
  return Math.ceil(hi / 100) * 100;
}
