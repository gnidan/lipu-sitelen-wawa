export {
  wordToCodepoint,
  codepointToWord,
  codepointToChar,
  charToCodepoint,
  isUcsurChar,
} from "./ucsur";

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
  isControlChar,
  isJoiner,
  isCartoucheChar,
  controlCharToName,
} from "./control-chars";

export {
  VARIATION_SELECTOR_BASE,
  variationIndexToSelector,
  glyphVariations,
  hasVariations,
  getVariations,
  applyVariation,
} from "./variations";
export type { VariationInfo } from "./variations";

export {
  asciiToUcsurControl,
  ucsurControlToAscii,
  isVariationSelector,
} from "./structural-map";

export {
  words,
  isWord,
  getWord,
  wordsByCategory,
  wordsByPrefix,
  wordByFirstLetter,
} from "./words";
export type { WordEntry, WordCategory } from "./words";
