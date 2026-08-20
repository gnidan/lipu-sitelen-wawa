/**
 * SP projection -> one side of a Block. Total:
 * every codepoint classifies. Word chars ->
 * anchors (variation selectors, ni arrows — incl.
 * legacy ZWJ sequences and standard direction
 * codepoints — and in-cartouche naming chars fold
 * into facets); ALL other chars -> literal
 * gap.sp content, including matched and unmatched
 * structural markers (span promotion is
 * normalize's job) and "\n" for break inlines.
 * Unknown text -> unmarked verbatim anchors;
 * marked inline runs -> marked verbatim anchors.
 */

import {
  codepointToWord,
  isVariationSelector,
  niDirectionByCp,
  niDirectionByArrowCp,
  VARIATION_SELECTOR_BASE,
  ZWJ,
} from "../data";
import { codepoints } from "../convert/verbatim";
import {
  CARTOUCHE_START,
  CARTOUCHE_END,
  MIDDLE_DOT_CH,
  COLON_CH,
  TALLY_CH,
  isMarkerChar,
} from "./chars";
import type {
  Anchor,
  ParsedSide,
  SpInline,
} from "./types";

export function parseSp(
  inlines: SpInline[]
): ParsedSide {
  const anchors: Anchor[] = [];
  const gaps: string[] = [];
  let cur = "";
  let pendingVerbatim = "";
  let cartoucheDepth = 0;

  function pushAnchor(a: Anchor): void {
    gaps.push(cur);
    cur = "";
    anchors.push(a);
  }

  function flushVerbatim(): void {
    if (pendingVerbatim.length > 0) {
      const text = pendingVerbatim;
      pendingVerbatim = "";
      pushAnchor({ kind: "verbatim", text });
    }
  }

  /** The last anchor, only when it is a word AND
   *  nothing (gap content or pending verbatim)
   *  has accumulated after it — this model's
   *  analog of "the last token is a word". */
  function lastWord(): Anchor | undefined {
    const a = anchors[anchors.length - 1];
    return a &&
      a.kind === "word" &&
      cur === "" &&
      pendingVerbatim === ""
      ? a
      : undefined;
  }

  /** SCHEME FOLD RULE: a naming char folds into the
   *  preceding word's nameScheme ONLY when the facet
   *  can re-render the exact chars it absorbed. A
   *  nameScheme is one style with a count, so it can
   *  absorb a RUN of one naming char and nothing
   *  else; an earlier implementation let a
   *  different-style char OVERWRITE the facet, which
   *  silently ate the chars already folded ("[jan.,"
   *  reloaded as "[jan,", "[toki::" as "[toki:"). A
   *  char that cannot be absorbed is ordinary gap
   *  content instead — literal, byte-preserved, and
   *  it ends the foldable run (lastWord() requires
   *  an empty `cur`, so nothing after it folds
   *  either). */
  function addScheme(
    style: "morae" | "letters"
  ): boolean {
    const w = lastWord();
    if (cartoucheDepth === 0 || !w) return false;
    const s = w.nameScheme;
    if (!s) {
      w.nameScheme = { style, count: 1 };
      return true;
    }
    if (s.style !== style) return false;
    s.count += 1;
    return true;
  }

  function parseText(text: string): void {
    const cps = [...codepoints(text)];
    for (let i = 0; i < cps.length; i++) {
      const [cp] = cps[i];
      const ch = String.fromCodePoint(cp);

      // variation selector -> facet on prev word,
      // else verbatim (orphan VS)
      if (isVariationSelector(cp)) {
        const w = lastWord();
        // ...but not onto a word that already
        // carries naming chars: anchorSpText emits
        // the variation BEFORE schemeChars, so
        // folding here would re-render "[jan,VS" as
        // "[jan VS," — same re-renderability rule as
        // addScheme below. An unfoldable VS is an
        // orphan: literal text, exactly where it was
        // typed.
        if (w && !w.nameScheme) {
          w.variation =
            cp - VARIATION_SELECTOR_BASE + 1;
        } else {
          pendingVerbatim += ch;
        }
        continue;
      }

      // standard ni-direction codepoints
      const stdDir = niDirectionByCp(cp);
      if (stdDir) {
        flushVerbatim();
        pushAnchor({
          kind: "word",
          word: "ni",
          niDirection: stdDir.index,
        });
        continue;
      }

      // legacy ZWJ between ni and arrow: skip the
      // ZWJ so the arrow folds into the ni below.
      // Only when an arrow actually follows —
      // otherwise this is a real ZWJ gap char.
      if (cp === ZWJ) {
        const w = lastWord();
        const next = cps[i + 1];
        if (
          w &&
          w.word === "ni" &&
          !w.niDirection &&
          next !== undefined &&
          niDirectionByArrowCp(next[0]) !==
            undefined
        ) {
          continue;
        }
        flushVerbatim();
        cur += ch;
        continue;
      }

      // arrows: fold into preceding ni, else
      // literal gap char
      const arrow = niDirectionByArrowCp(cp);
      if (arrow) {
        flushVerbatim();
        const w = lastWord();
        if (
          w &&
          w.word === "ni" &&
          !w.niDirection &&
          // same re-renderability rule: the
          // direction renders before schemeChars
          !w.nameScheme
        ) {
          w.niDirection = arrow.index;
        } else {
          cur += ch;
        }
        continue;
      }

      // word glyphs
      const word = codepointToWord[cp];
      if (word !== undefined) {
        flushVerbatim();
        pushAnchor({ kind: "word", word });
        continue;
      }

      // marker chars (incl. space/ideo-space and
      // structural pair markers)
      if (isMarkerChar(cp)) {
        // a space inside an unmarked-Latin run
        // belongs to the verbatim text ("hi
        // there" stays one anchor)
        if (
          cp === 0x20 &&
          pendingVerbatim.length > 0
        ) {
          pendingVerbatim += " ";
          continue;
        }
        // naming chars inside a cartouche fold
        // into the preceding word's nameScheme
        if (ch === MIDDLE_DOT_CH) {
          if (addScheme("morae")) continue;
        }
        if (ch === TALLY_CH) {
          if (addScheme("letters")) continue;
        }
        if (ch === COLON_CH) {
          // same rule: a colon folds only onto a
          // word with NO scheme yet ({style:"word"}
          // renders exactly one colon, so a second
          // one would be eaten)
          const w = lastWord();
          if (
            cartoucheDepth > 0 &&
            w &&
            !w.nameScheme
          ) {
            w.nameScheme = { style: "word" };
            continue;
          }
        }
        flushVerbatim();
        if (ch === CARTOUCHE_START) {
          cartoucheDepth += 1;
        }
        if (ch === CARTOUCHE_END) {
          cartoucheDepth = Math.max(
            0,
            cartoucheDepth - 1
          );
        }
        cur += ch;
        continue;
      }

      // anything else: unmarked Latin/unknown ->
      // verbatim (totality)
      pendingVerbatim += ch;
    }
    flushVerbatim();
  }

  for (const inline of inlines) {
    if (inline.type === "break") {
      flushVerbatim();
      cur += "\n";
      continue;
    }
    if (inline.verbatim) {
      flushVerbatim();
      pushAnchor({
        kind: "verbatim",
        text: inline.text,
        marked: true,
      });
      continue;
    }
    parseText(inline.text);
  }
  flushVerbatim();
  gaps.push(cur);
  return { anchors, gaps };
}

export function spInlinesFromText(
  text: string
): SpInline[] {
  const out: SpInline[] = [];
  let rest = text;
  for (;;) {
    const nl = rest.indexOf("\n");
    if (nl === -1) {
      if (rest.length > 0) {
        out.push({
          type: "text",
          text: rest,
          verbatim: false,
        });
      }
      return out;
    }
    if (nl > 0) {
      out.push({
        type: "text",
        text: rest.slice(0, nl),
        verbatim: false,
      });
    }
    out.push({ type: "break" });
    rest = rest.slice(nl + 1);
  }
}
