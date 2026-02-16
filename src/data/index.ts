export {
  wordToCodepoint,
  codepointToWord,
  codepointToChar,
  charToCodepoint,
  isUcsurChar,
  asciiToUcsurControl,
  ucsurControlToAscii,
  isVariationSelector,
  words,
  currentFont,
  hasVariations,
  getVariations,
  isLongGlyphWord,
  isControlChar,
  isJoiner,
  isCartoucheChar,
} from "./font-capabilities";
export type {
  FontCapabilities,
} from "./font-capabilities";

export {
  STACKING_JOINER,
  SCALING_JOINER,
  START_OF_LONG_GLYPH,
  END_OF_LONG_GLYPH,
  START_OF_REVERSE_LONG_GLYPH,
  END_OF_REVERSE_LONG_GLYPH,
  START_OF_CARTOUCHE,
  END_OF_CARTOUCHE,
  CARTOUCHE_EXTENSION,
  MIDDLE_DOT,
  COLON,
  COMBINING_TALLY_MARK,
  IDEOGRAPHIC_SPACE,
  ZWJ,
  controlCharToName,
} from "./control-chars";

export {
  VARIATION_SELECTOR_BASE,
  variationIndexToSelector,
  glyphVariations,
  applyVariation,
} from "./variations";
export type { VariationInfo } from "./variations";

export {
  isWord,
  getWord,
  wordsByCategory,
  wordsByPrefix,
  wordByFirstLetter,
} from "./words";
export type {
  WordEntry,
  WordCategory,
} from "./words";

export {
  isNiArrowCp,
  NI_DIRECTIONS,
  niDirectionByVerbatim,
  niDirectionByArrowCp,
  niDirectionByIndex,
  niDirString,
  parseVerbatimDirection,
} from "./ni-directions";
export type {
  NiDirection,
} from "./ni-directions";
