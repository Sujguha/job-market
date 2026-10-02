/**
 * Plain-Node tests for assets/ats.js (no DOM, no framework — just asserts).
 * Run with: node tests/test_ats.js
 *
 * ats.js is written to be loaded as a plain script (not a module), so we
 * read and eval it here, stripping the auto-run setupATSChecker() call
 * which touches the DOM and isn't relevant to testing the scoring logic.
 */
const fs = require("fs");
const path = require("path");
const assert = require("assert");

let code = fs.readFileSync(path.join(__dirname, "..", "assets", "ats.js"), "utf8");
code = code.replace("setupATSChecker();", "");
eval(code);

let passed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${e.message}`);
    process.exitCode = 1;
  }
}

console.log("ATS checker tests:");

test("strong match scores high and finds real gaps", () => {
  const jd = "Senior Release Manager role requiring PMP certification, SAP ChaRM experience, and ITIL knowledge.";
  const cv = "PMP certified Release Manager with SAP ChaRM experience.";
  const r = atsScore(jd, cv);
  assert.ok(r.pct >= 50, `expected high score, got ${r.pct}`);
  assert.ok(r.gaps.includes("itil"), "expected 'itil' to be flagged as a gap");
});

test("completely unrelated CV scores 0", () => {
  const jd = "Java Backend Developer with Kubernetes and AWS experience.";
  const cv = "Experienced pastry chef specializing in French desserts.";
  const r = atsScore(jd, cv);
  assert.strictEqual(r.pct, 0);
});

test("empty inputs do not throw and return 0", () => {
  const r = atsScore("", "");
  assert.strictEqual(r.pct, 0);
  assert.strictEqual(r.keywordCount, 0);
});

test("acronyms are picked up even with a single occurrence", () => {
  const jd = "We use SAP extensively across all teams for finance processes.";
  const keywords = atsExtractKeywords(jd);
  const terms = keywords.map((k) => k.term);
  assert.ok(terms.includes("sap"), "expected 'sap' to be extracted as a keyword");
});

test("stopwords are never extracted as keywords", () => {
  const jd = "This is the role that we are looking for and it will be a great fit.";
  const keywords = atsExtractKeywords(jd);
  const terms = keywords.map((k) => k.term);
  ["this", "that", "and", "will", "the"].forEach((sw) => {
    assert.ok(!terms.includes(sw), `stopword '${sw}' should not be extracted`);
  });
});

test("repeated bigram phrases are extracted as keywords", () => {
  const jd = "Experience with stakeholder management is required. Strong stakeholder management skills are a must.";
  const keywords = atsExtractKeywords(jd);
  const terms = keywords.map((k) => k.term);
  assert.ok(terms.includes("stakeholder management"), "expected 'stakeholder management' bigram to be extracted");
});

console.log(`\n${passed} test(s) passed.`);
