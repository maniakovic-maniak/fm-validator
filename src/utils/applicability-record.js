'use strict';
// applicability-record.js - says which procedures were set aside because they do not belong in this kind of model, and why.
//
// An absence in a model is a defect only if the model needs the thing that is absent. The reviewer sometimes returns
// "No debt schedule was found" together with its own statement that the model has no debt. Earlier patches kept those
// answers as "uncertain" and fed them to the scope candidates; they still counted as open items and could be queued for
// remediation. This marks them Not Applicable, so they are outside the P1-P3 counts and the Remediation tab, and records
// each one here with the reviewer's reason, so the decision is visible and a person can overrule it.
//
// What it does not do: it does not delete the finding, change the procedure's status (coverage figures are untouched),
// or decide applicability from the sheet list. A fatal-severity rule is never set aside this way. The macro-store entry
// is a disclosure only: a value store that macros refill may be stale, and this tool does not test that.
const { isNotApplicableAbsence, contextOf, textOf } = require('./absence-policy');

const SEV_FATAL = new Set(['fatal']);
const MACRO_STORE_SHEET = /saved\s*results|results?\s*store|macro\s*(output|results?)|paste\s*values/i;

/** Marks reviewer answers that are absences the reviewer says do not apply. Mutates results; returns the ids marked. */
function markNotApplicable(results, { ruleById = new Map() } = {}) {
  const marked = [];
  for (const r of results || []) {
    if (!isNotApplicableAbsence(r)) continue;
    const rule = ruleById.get(r.id);
    const sev = String((rule && rule.severity) || r.severity || '').toLowerCase();
    if (SEV_FATAL.has(sev)) continue;
    if (r.record_type) continue;
    r.record_type = 'Not Applicable';
    r._applicability = {
      basis: 'reviewer statement',
      subject: textOf(r).replace(/\s+/g, ' ').trim().slice(0, 200),
      reason: contextOf(r).replace(/\s+/g, ' ').trim().slice(0, 300),
    };
    marked.push(r.id);
  }
  return marked;
}

/** The record shown in the report. facts: { sheetNames, hasVba } */
function buildApplicabilityRecord(findings, facts = {}) {
  const rows = [];
  for (const f of findings || []) {
    if (!f || f.record_type !== 'Not Applicable' || !f._applicability) continue;
    rows.push({ id: f.id, subject: f._applicability.subject, decision: 'Not applicable to this model', basis: f._applicability.basis, reason: f._applicability.reason });
  }
  const store = (facts.sheetNames || []).filter(n => MACRO_STORE_SHEET.test(n));
  if (store.length && facts.hasVba) {
    rows.push({ id: '-', subject: `Values held on ${store.slice(0, 3).join(', ')} may be refilled by macros`, decision: 'Freshness not tested', basis: 'workbook structure',
      reason: 'The audit reads the saved values. It does not run macros, so it cannot tell whether a macro-maintained store matches the current inputs. This is a disclosure, not a finding.' });
  }
  return rows;
}

module.exports = { markNotApplicable, buildApplicabilityRecord, MACRO_STORE_SHEET };
