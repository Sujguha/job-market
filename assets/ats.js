/**
 * ATS keyword-match checker.
 *
 * Privacy note: this file makes NO network requests. Everything below
 * runs synchronously in the browser on text already in the two textareas.
 * Nothing pasted here is sent anywhere, logged, or stored (not even in
 * localStorage) — refreshing the page erases it completely.
 *
 * This is a lightweight heuristic (weighted keyword overlap), not a
 * simulation of any real company's ATS software.
 */

const ATS_STOPWORDS = new Set([
  // English
  "the","a","an","and","or","but","if","then","than","so","of","in","on","at","to","for",
  "with","without","by","from","as","is","are","was","were","be","been","being","this","that",
  "these","those","it","its","we","you","your","our","they","their","he","she","his","her",
  "will","would","can","could","should","shall","may","might","must","do","does","did","have",
  "has","had","not","no","yes","all","any","each","other","some","such","only","own","same",
  "about","into","through","during","before","after","above","below","up","down","out","off",
  "over","under","again","further","once","here","there","when","where","why","how","what",
  "which","who","whom","while","both","more","most","etc","per","via","within","across",
  "including","include","includes","looking","seeking","role","job","work","working",
  "company","team","experience","years","year","ability","skills","skill","responsibilities",
  "requirements","required","preferred","strong","excellent","good","well","also","etc.",
  "new","us","our","you'll","we're","you're","they're","it's","company's",
  // German (common in DACH/NL job postings)
  "und","oder","mit","für","bei","ist","sind","eine","einer","einem","eines","der","die",
  "das","den","dem","zu","von","im","am","an","auf","ein","wird","werden","haben","hat",
  "sowie","sie","wir","ihre","ihr","als","auch","nach","über","um","aus","durch","sich",
]);

const ATS_MAX_KEYWORDS = 30;
const ATS_MIN_WORD_LEN = 3;

function atsTokenize(text) {
  return (text.toLowerCase().match(/[a-zäöüß0-9+.#-]{2,}/g) || []);
}

function atsCleanWord(w) {
  return w.replace(/^[-.#+]+|[-.#+]+$/g, "");
}

function atsExtractKeywords(jdText) {
  const rawWords = (jdText.match(/[A-Za-zÄÖÜäöüß0-9+.#-]+/g) || []);
  const lowerWords = rawWords.map((w) => atsCleanWord(w.toLowerCase())).filter(Boolean);

  // Acronyms / tool names: tokens that appear in the ORIGINAL text as 2-6
  // uppercase letters (SAP, AWS, PMP, ITIL, SAFe-ish mixed case too).
  const acronymCandidates = new Set();
  rawWords.forEach((w) => {
    const clean = atsCleanWord(w);
    if (/^[A-Z]{2,6}$/.test(clean)) acronymCandidates.add(clean.toLowerCase());
    if (/^[A-Z][a-z]{1,3}[A-Z]/.test(clean)) acronymCandidates.add(clean.toLowerCase()); // e.g. SAFe, ChaRM
  });

  // Unigram frequency (excluding stopwords/short words).
  const unigramFreq = {};
  lowerWords.forEach((w) => {
    if (w.length < ATS_MIN_WORD_LEN) return;
    if (ATS_STOPWORDS.has(w)) return;
    if (/^\d+$/.test(w)) return;
    unigramFreq[w] = (unigramFreq[w] || 0) + 1;
  });

  // Bigram frequency (two consecutive non-stopword words = likely a skill phrase).
  const bigramFreq = {};
  for (let i = 0; i < lowerWords.length - 1; i++) {
    const a = lowerWords[i], b = lowerWords[i + 1];
    if (a.length < ATS_MIN_WORD_LEN || b.length < ATS_MIN_WORD_LEN) continue;
    if (ATS_STOPWORDS.has(a) || ATS_STOPWORDS.has(b)) continue;
    const phrase = `${a} ${b}`;
    bigramFreq[phrase] = (bigramFreq[phrase] || 0) + 1;
  }

  const candidates = [];
  acronymCandidates.forEach((term) => {
    candidates.push({ term, weight: 3 + (unigramFreq[term] || 0) });
  });
  Object.entries(bigramFreq).forEach(([term, freq]) => {
    if (freq >= 2) candidates.push({ term, weight: freq * 2 });
  });
  Object.entries(unigramFreq).forEach(([term, freq]) => {
    if (freq >= 2 && !acronymCandidates.has(term)) candidates.push({ term, weight: freq });
  });

  // Dedupe (a bigram and its component unigrams can coexist — that's fine,
  // but exact-duplicate terms from different sources should merge).
  const merged = {};
  candidates.forEach(({ term, weight }) => {
    merged[term] = Math.max(merged[term] || 0, weight);
  });

  return Object.entries(merged)
    .map(([term, weight]) => ({ term, weight }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, ATS_MAX_KEYWORDS);
}

function atsHasTerm(cvTextLower, cvWordsSet, term) {
  if (term.includes(" ")) {
    return cvTextLower.includes(term);
  }
  if (cvWordsSet.has(term)) return true;
  // Mild stemming tolerance: does any CV word share the term's first ~5 chars?
  const stem = term.slice(0, Math.min(5, term.length));
  if (stem.length < 4) return false; // too short to stem-match safely
  for (const w of cvWordsSet) {
    if (w.startsWith(stem)) return true;
  }
  return false;
}

function atsScore(jdText, cvText) {
  const keywords = atsExtractKeywords(jdText);
  const cvTextLower = cvText.toLowerCase();
  const cvWordsSet = new Set(atsTokenize(cvText).map(atsCleanWord).filter((w) => w.length >= ATS_MIN_WORD_LEN));

  let matchedWeight = 0;
  let totalWeight = 0;
  const matched = [];
  const gaps = [];

  keywords.forEach(({ term, weight }) => {
    totalWeight += weight;
    if (atsHasTerm(cvTextLower, cvWordsSet, term)) {
      matchedWeight += weight;
      matched.push(term);
    } else {
      gaps.push(term);
    }
  });

  const pct = totalWeight > 0 ? Math.round((matchedWeight / totalWeight) * 100) : 0;
  return { pct, matched, gaps, keywordCount: keywords.length };
}

function atsScoreLabel(pct) {
  if (pct >= 75) return "Strong keyword overlap with this job description.";
  if (pct >= 50) return "Moderate overlap — some notable gaps worth a look.";
  if (pct >= 25) return "Limited overlap — consider whether your CV wording matches this role's language.";
  return "Low overlap — this may not be a close match, or your CV may need significant rewording for this role.";
}

function atsScoreColor(pct) {
  if (pct >= 75) return "var(--accent-live)";
  if (pct >= 50) return "var(--accent-signal)";
  if (pct >= 25) return "var(--accent-stale)";
  return "#E15759";
}

function atsRenderTags(container, terms, isGap) {
  if (!terms.length) {
    container.innerHTML = `<span class="hint">${isGap ? "No major gaps found." : "No matches found."}</span>`;
    return;
  }
  container.innerHTML = terms
    .map((t) => `<span class="ats-tag ${isGap ? "ats-tag-gap" : "ats-tag-match"}">${t}</span>`)
    .join("");
}

function setupATSChecker() {
  const btn = document.getElementById("ats-check-btn");
  if (!btn) return; // section not present on this page

  btn.addEventListener("click", () => {
    const jd = document.getElementById("ats-jd").value.trim();
    const cv = document.getElementById("ats-cv").value.trim();

    if (!jd || !cv) {
      alert("Please paste both a job description and your CV text before checking.");
      return;
    }

    const { pct, matched, gaps, keywordCount } = atsScore(jd, cv);

    const results = document.getElementById("ats-results");
    results.style.display = "block";

    const circle = document.getElementById("ats-score-circle");
    const value = document.getElementById("ats-score-value");
    const label = document.getElementById("ats-score-label");
    value.textContent = `${pct}%`;
    circle.style.setProperty("--score-color", atsScoreColor(pct));
    label.textContent = atsScoreLabel(pct);
    label.style.color = atsScoreColor(pct);

    document.getElementById("ats-matched-count").textContent = `(${matched.length}/${keywordCount})`;
    document.getElementById("ats-gap-count").textContent = `(${gaps.length}/${keywordCount})`;
    atsRenderTags(document.getElementById("ats-matched-list"), matched, false);
    atsRenderTags(document.getElementById("ats-gap-list"), gaps, true);

    results.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
}

setupATSChecker();
