// Lists the banks available in your country, so you know the exact name to pass to `npm run link`.
import { listBanks } from './enablebanking.js';
import { enableBanking } from './settings.js';
import { safe } from './terminal.js';

const { country } = enableBanking();
const banks = await listBanks(country);

for (const bank of banks.sort((a, b) => a.name.localeCompare(b.name))) {
  const days = bank.maximum_consent_validity ? Math.floor(bank.maximum_consent_validity / 86400) : '?';
  console.log(`${safe(bank.name).padEnd(40)} consent up to ${days} days`);
}
console.log(`\n${banks.length} banks in ${country}. Link one with: npm run link -- "<bank name>"`);
