// Writes test/fixtures/*.apkg for manual testing in the browser. Run: npx tsx test/gen-fixtures.ts
import { writeFileSync } from 'node:fs';
import { apkg11, apkg18 } from './helpers/fixtures';

writeFileSync('test/fixtures/basic11.apkg', await apkg11());
writeFileSync('test/fixtures/basic18.apkg', await apkg18());
console.log('ok');
