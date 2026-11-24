// The fixed visual language: one stroke icon set, and one colour and icon per pot.

// 24px grid, one stroke weight
export const ICONS = {
  jar: 'M8.5 3.5h7v3h-7z M9.5 6.5v1.8c-2.6 1-4 2.6-4 4.7v5.5a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V13c0-2.1-1.4-3.7-4-4.7V6.5 M5.5 14h13',
  list: 'M9 6.5h11 M9 12h11 M9 17.5h11 M4.5 6.5h.01 M4.5 12h.01 M4.5 17.5h.01',
  inbox: 'M4 13.5l2-8h12l2 8 M4 13.5V19h16v-5.5 M4 13.5h4.5l1 2h5l1-2H20',
  bank: 'M3.5 9.5L12 4l8.5 5.5 M5.5 10v7.5 M10 10v7.5 M14 10v7.5 M18.5 10v7.5 M3.5 20h17',
  sliders: 'M4 7h9 M17 7h3 M4 17h3 M11 17h9 M15 5v4 M9 15v4',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
  moon: 'M19.5 14.5A7.5 7.5 0 1 1 9.5 4.5a6 6 0 0 0 10 10z',
  sun: 'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z M12 3v2 M12 19v2 M3 12h2 M19 12h2 M5.6 5.6L7 7 M17 17l1.4 1.4 M5.6 18.4L7 17 M17 7l1.4-1.4',
  auto: 'M12 4a8 8 0 1 0 0 16z M12 4a8 8 0 0 1 0 16',
  left: 'M14.5 6l-6 6 6 6',
  right: 'M9.5 6l6 6-6 6',
  scissors: 'M6.5 4a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z M6.5 15a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z M8.6 8.2L20 17.5 M8.6 15.8L20 6.5',
  budget: 'M12 3.5a8.5 8.5 0 1 0 8.5 8.5H12z M15 3.2a8.6 8.6 0 0 1 5.8 5.8H15z',
  more: 'M5 12h1.5 M11.25 12h1.5 M17.5 12h1.5',
  down: 'M6 9.5l6 6 6-6',
  sync: 'M19.5 11A7.5 7.5 0 0 0 6.2 7.2L4.5 9 M4.5 4.5V9H9 M4.5 13a7.5 7.5 0 0 0 13.3 3.8l1.7-1.8 M19.5 19.5V15H15',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  plus: 'M12 5v14 M5 12h14',
  search: 'M10.5 4.5a6 6 0 1 0 0 12 6 6 0 0 0 0-12z M19.5 19.5l-4.5-4.5',
  sparkle: 'M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9-1.9 5.1-1.9-5.1L5 10.5l5.1-1.9z M18.5 16v4 M16.5 18h4',
  // categories
  groceries: 'M4 10h16l-1.6 9.5H5.6z M8.5 10l3-5.5 M15.5 10l-3-5.5 M9 14v2.5 M12 14v2.5 M15 14v2.5',
  eating: 'M7 3.5v17 M4.5 3.5v5a2.5 2.5 0 0 0 5 0v-5 M17 20.5v-17c-2.5 1.5-3.5 4-3.5 7.5h3.5',
  transport: 'M5 16.5v-6l2-5h10l2 5v6z M5 16.5V19 M19 16.5V19 M5 10.5h14 M8.5 13.5h.01 M15.5 13.5h.01',
  housing: 'M4 11l8-6.5 8 6.5 M6 9.5V20h12V9.5 M10 20v-5.5h4V20',
  utilities: 'M13 3L5.5 13H11l-1 8 7.5-10H12z',
  subscriptions: 'M17 3.5l3 3-3 3 M4 11.5V10a3.5 3.5 0 0 1 3.5-3.5H20 M7 20.5l-3-3 3-3 M20 12.5V14a3.5 3.5 0 0 1-3.5 3.5H4',
  shopping: 'M5 8h14l-1 12.5H6z M9 8V6.5a3 3 0 0 1 6 0V8',
  health: 'M12 20s-7.5-4.6-7.5-10.2A4.2 4.2 0 0 1 12 7.3a4.2 4.2 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z M8 12h2.5l1-2 2 4 1-2H16',
  insurance: 'M12 3.5l7 2.8v5c0 4.6-3 7.7-7 9.2-4-1.5-7-4.6-7-9.2v-5z M9 12l2.2 2.2L15.5 10',
  leisure: 'M4 7.5h16v3a1.8 1.8 0 0 0 0 3.5v3H4v-3a1.8 1.8 0 0 0 0-3.5z M14.5 7.5v1.5 M14.5 11.25v1.5 M14.5 15v1.5',
  travel: 'M20.5 4L3.5 11l7 2.5 2.5 7z M10.5 13.5l10-9.5',
  friends: 'M4 10h16v3.5H4z M5.5 13.5V20h13v-6.5 M12 10v10 M12 10c-1.5-3.5-5.5-4-5.5-1.5 0 1.3 2.5 1.5 5.5 1.5 3 0 5.5-.2 5.5-1.5 0-2.5-4-2-5.5 1.5',
  cash: 'M3 7h18v10H3z M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z M6 10v4 M18 10v4',
  growth: 'M4 17.5l5-5 3.5 3 7.5-8 M15 7.5h5v5',
  chart: 'M4 20V10 M10 20V4 M16 20v-7 M21 20H3',
  transfers: 'M4 8.5h14.5L15.5 5.5 M20 15.5H5.5l3 3',
  other: 'M6 12h.01 M12 12h.01 M18 12h.01',
  sports: 'M6.5 7.5v9 M17.5 7.5v9 M3.5 10v4 M20.5 10v4 M6.5 12h11',
  wallet: 'M4 7.5h14.5A1.5 1.5 0 0 1 20 9v10H4z M4 7.5L15 4.5v3 M15.5 13.5h.01',
  income: 'M12 3.5v11 M7.5 10l4.5 4.5 4.5-4.5 M4 15.5V20h16v-4.5',
  unsorted: 'M4 13.5l2-8h12l2 8 M4 13.5V19h16v-5.5 M4 13.5h4.5l1 2h5l1-2H20',
};
// ---------- one colour and one icon per pot ----------

export const CATEGORY_LOOK = {
  'Income': ['#1d7348', 'income'],
  'Housing': ['#9a6a3f', 'housing'],
  'Utilities': ['#b98510', 'utilities'],
  'Groceries': ['#6f9a1f', 'groceries'],
  'Eating out': ['#d2642c', 'eating'],
  'Transport': ['#2f6fd0', 'transport'],
  'Subscriptions': ['#3f8296', 'subscriptions'],
  'Shopping': ['#c4467b', 'shopping'],
  'Health': ['#14a08c', 'health'],
  'Insurance': ['#5f6f9c', 'insurance'],
  'Leisure': ['#7a5ce0', 'leisure'],
  'Travel': ['#1590c2', 'travel'],
  'Friends & gifts': ['#c03fae', 'friends'],
  'Cash': ['#7f8466', 'cash'],
  'Savings & transfers': ['#8a8f98', 'transfers'],
  'Other': ['#a68a7a', 'other'],
  'Sports': ['#949108', 'sports'],
  'Paypal': ['#1f5a8a', 'wallet'],
};
const SPARE = ['#a960a3', '#7e7730', '#a84a2e', '#9b5f7a', '#6d5a9a', '#3a6f6a']; // kept clear of the pots above and of the in, over and needs-you colours
export function look(category) {
  if (!category) return { color: 'var(--need)', icon: 'unsorted', label: 'Unsorted' };
  const known = CATEGORY_LOOK[category];
  if (known) return { color: known[0], icon: known[1], label: category };
  let hash = 0;
  for (const ch of category) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return { color: SPARE[hash % SPARE.length], icon: 'other', label: category };
}
