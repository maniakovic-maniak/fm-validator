'use strict';
// Patch 50: the unique-formula count that prices a quote is independent of the audit's formula-family identity.
const fs = require('fs');
const { PricingCounter, pricingKey, KEY_VERSION } = require('./src/utils/pricing-formula-count');
const { normalizeFormula } = require('./src/validator-tier0');
let fails = 0;
const check = (n, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'}: ${n}`); if (!ok) fails++; };

check('the key is versioned', KEY_VERSION === 'pricing-key-v1');
check('every cell address becomes CELL, so a filled formula and its look-alikes share one price key', pricingKey('=A1+B1') === pricingKey('=A2+B1') && pricingKey('=A1+$B$1') === pricingKey('=C9+D9'));
check('the audit families are exact, so the same formulas are three different families', new Set([normalizeFormula('=A1+B1', 'C1'), normalizeFormula('=A2+B1', 'C2'), normalizeFormula('=A1+$B$1', 'C3')]).size === 3);
check('so the two counts differ, and the quote follows the pricing key only', (() => {
  const c = new PricingCounter(() => 'Low');
  ['=A1+B1', '=A2+B1', '=A1+$B$1'].forEach(f => c.add(f));
  return c.result().uniqueFormulaCount === 1 && c.result().fscoreDist.Low === 1;
})());
check('a different function is a different priced formula', pricingKey('=SUM(A1:A5)') !== pricingKey('=AVERAGE(A1:A5)'));
check('the band is the first formula\'s own, once per key', (() => {
  const seen = []; const c = new PricingCounter(f => { seen.push(f); return f.includes('IF') ? 'Moderate' : 'Low'; });
  c.add('=IF(A1,1,0)'); c.add('=IF(B7,1,0)'); c.add('=A1+B1');
  return seen.length === 2 && c.result().fscoreDist.Moderate === 1 && c.result().fscoreDist.Low === 1;
})());
check('result is a copy, not a live object', (() => { const c = new PricingCounter(() => 'Low'); c.add('=A1'); const r = c.result(); r.fscoreDist.Low = 99; return c.result().fscoreDist.Low === 1; })());

const srv = fs.readFileSync('server.js', 'utf8');
check('server.js quotes from the pricing count, not the family count', !/calculatePricing\(\s*tier0\.stats\.fscoreDist/.test(srv) && (srv.match(/tier0\.stats\.pricing/g) || []).length >= 2 && !/uniqueFormulaTotal\s*=\s*\(tier0\.stats && tier0\.stats\.uniqueFormulaCount\)/.test(srv));
const t0 = fs.readFileSync('src/validator-tier0.js', 'utf8');
check('tier 0 feeds the pricing counter from the formula text only', /pricingCounter\.add\(formula\)/.test(t0) && /pricing: pricingCounter\.result\(\)/.test(t0));

const eso = '/mnt/user-data/uploads/Final_Determinations_-_ESO_Licence_Model.xlsm';
if (fs.existsSync(eso)) {
  (async () => {
    const { parseExcel } = require('./src/parser'); const { runTier0 } = require('./src/validator-tier0');
    const log = console.log; console.log = () => {};
    const t = await runTier0(await parseExcel(eso)); console.log = log;
    const p = t.stats.pricing;
    check('ESO: 311 unique formulas for the quote, as quoted before Patch 30', p.uniqueFormulaCount === 311 && p.fscoreDist.Low === 293 && p.fscoreDist.Moderate === 17 && p.fscoreDist.High === 1);
    { const sub = 3 * p.fscoreDist.Low + 4 * p.fscoreDist.Moderate + 6 * p.fscoreDist.High + 7 * p.fscoreDist.Critical; check('ESO: the quote is $1,048 again (Fm-00052), not $2,550', sub + Math.round(sub * 0.1) === 1048); }
    check('ESO: the audit still reports its exact families (757)', t.stats.uniqueFormulaCount === 757);
    console.log(fails ? `${fails} FAILED` : 'All Patch 50 checks passed'); process.exit(fails ? 1 : 0);
  })();
} else { console.log('skip: ESO model not on this machine'); console.log(fails ? `${fails} FAILED` : 'All Patch 50 checks passed'); process.exit(fails ? 1 : 0); }
