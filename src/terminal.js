// Text from the bank (payee names, descriptions, bank and account names) printed by the command-line tools.
// Control characters are shown as a visible "?" instead of being sent to the terminal, where escape codes
// could move the cursor, rewrite earlier lines (like a question you're about to answer) or set the title.
const CONTROL = new RegExp(`[\x00-\x08\x0a-\x1f\x7f-\x9f${String.fromCharCode(0x2028, 0x2029)}]`, 'g'); // all but tab, plus the Unicode line and paragraph separators
export const safe = (text) => String(text ?? '').replace(CONTROL, '?');
