require('dotenv').config();
const { fetchAndParse } = require('./src/parser');
const { runTier1 } = require('./src/validator-tier1');
const { runTier2 } = require('./src/validator-tier2');

fetchAndParse('1-onCvcp7EFuJWHT_jMeADHJTARg0d8rA').then(async parsed => {
  const t1 = runTier1(parsed);
  const t2 = await runTier2(parsed);
  const flagged = [...t1, ...t2].filter(r => r.status !== 'pass' && !r.fixable);
  console.log('Total flagged items:', flagged.length);
  flagged.forEach((f, i) => {
    console.log(i+1, '|', f.sheet || 'NO SHEET', '|', f.cell || 'NO CELL', '|', f.label || f.reason || f.issue);
  });
});
