/**
 * Word registry for toki pona, sourced from Linku data
 * and the UCSUR sitelen pona block (U+F1900–U+F19FF).
 *
 * Codepoints match src/data/ucsur.ts wordToCodepoint.
 */

export type WordCategory =
  | "core"
  | "common"
  | "uncommon"
  | "obscure"
  | "sandbox";

export interface WordEntry {
  word: string;
  codepoint: number;
  category: WordCategory;
  definition: string;
}

function w(
  word: string,
  codepoint: number,
  category: WordCategory,
  definition: string
): WordEntry {
  return { word, codepoint, category, definition };
}

/**
 * All toki pona words with UCSUR codepoints.
 * Keyed by word string.
 */
export const words: Record<string, WordEntry> = {
  // pu words (core) — U+F1900 through U+F1977
  "a": w(
    "a", 0xF1900, "core",
    "emphasis, emotion, confirmation"
  ),
  "akesi": w(
    "akesi", 0xF1901, "core",
    "reptile, amphibian, scaly creature"
  ),
  "ala": w(
    "ala", 0xF1902, "core",
    "no, not, nothing, zero"
  ),
  "alasa": w(
    "alasa", 0xF1903, "core",
    "to hunt, to forage, to seek"
  ),
  "ale": w(
    "ale", 0xF1904, "core",
    "all, every, everything; 100"
  ),
  "ali": w(
    "ali", 0xF1904, "core",
    "all, every, everything; 100 (= ale)"
  ),
  "anpa": w(
    "anpa", 0xF1905, "core",
    "bottom, lower, humble, to bow"
  ),
  "ante": w(
    "ante", 0xF1906, "core",
    "different, changed, to alter"
  ),
  "anu": w(
    "anu", 0xF1907, "core",
    "or (separating possibilities)"
  ),
  "awen": w(
    "awen", 0xF1908, "core",
    "to stay, to wait, enduring, to protect"
  ),
  "e": w(
    "e", 0xF1909, "core",
    "(direct object marker)"
  ),
  "en": w(
    "en", 0xF190A, "core",
    "and (between subjects)"
  ),
  "esun": w(
    "esun", 0xF190B, "core",
    "market, shop, trade, exchange"
  ),
  "ijo": w(
    "ijo", 0xF190C, "core",
    "thing, object, matter, entity"
  ),
  "ike": w(
    "ike", 0xF190D, "core",
    "bad, negative, complex, harmful"
  ),
  "ilo": w(
    "ilo", 0xF190E, "core",
    "tool, instrument, machine, device"
  ),
  "insa": w(
    "insa", 0xF190F, "core",
    "inside, center, between, middle"
  ),
  "jaki": w(
    "jaki", 0xF1910, "core",
    "dirty, disgusting, toxic, unclean"
  ),
  "jan": w(
    "jan", 0xF1911, "core",
    "person, human, somebody"
  ),
  "jelo": w(
    "jelo", 0xF1912, "core",
    "yellow, golden, amber"
  ),
  "jo": w(
    "jo", 0xF1913, "core",
    "to have, to carry, to own"
  ),
  "kala": w(
    "kala", 0xF1914, "core",
    "fish, sea creature, marine animal"
  ),
  "kalama": w(
    "kalama", 0xF1915, "core",
    "sound, noise, to make sound"
  ),
  "kama": w(
    "kama", 0xF1916, "core",
    "to come, to arrive, future, to become"
  ),
  "kasi": w(
    "kasi", 0xF1917, "core",
    "plant, leaf, herb, vegetation"
  ),
  "ken": w(
    "ken", 0xF1918, "core",
    "can, may, possible, ability"
  ),
  "kepeken": w(
    "kepeken", 0xF1919, "core",
    "to use, by means of, with"
  ),
  "kili": w(
    "kili", 0xF191A, "core",
    "fruit, vegetable, mushroom"
  ),
  "kiwen": w(
    "kiwen", 0xF191B, "core",
    "hard, solid, rock, metal, stone"
  ),
  "ko": w(
    "ko", 0xF191C, "core",
    "semi-solid, paste, powder, clay"
  ),
  "kon": w(
    "kon", 0xF191D, "core",
    "air, breath, spirit, essence, soul"
  ),
  "kule": w(
    "kule", 0xF191E, "core",
    "color, colorful, painted, pigment"
  ),
  "kulupu": w(
    "kulupu", 0xF191F, "core",
    "group, community, society, nation"
  ),
  "kute": w(
    "kute", 0xF1920, "core",
    "to listen, to hear, ear, to obey"
  ),
  "la": w(
    "la", 0xF1921, "core",
    "(context separator particle)"
  ),
  "lape": w(
    "lape", 0xF1922, "core",
    "to sleep, to rest, inactive"
  ),
  "laso": w(
    "laso", 0xF1923, "core",
    "blue, green, cyan, turquoise"
  ),
  "lawa": w(
    "lawa", 0xF1924, "core",
    "head, mind, to lead, to control"
  ),
  "len": w(
    "len", 0xF1925, "core",
    "cloth, clothing, fabric, cover"
  ),
  "lete": w(
    "lete", 0xF1926, "core",
    "cold, cool, frozen, raw"
  ),
  "li": w(
    "li", 0xF1927, "core",
    "(predicate marker particle)"
  ),
  "lili": w(
    "lili", 0xF1928, "core",
    "small, little, young, few, short"
  ),
  "linja": w(
    "linja", 0xF1929, "core",
    "long flexible thing, string, rope, hair"
  ),
  "lipu": w(
    "lipu", 0xF192A, "core",
    "flat thing, paper, document, book"
  ),
  "loje": w(
    "loje", 0xF192B, "core",
    "red, reddish, magenta, scarlet"
  ),
  "lon": w(
    "lon", 0xF192C, "core",
    "at, in, existing, real, true"
  ),
  "luka": w(
    "luka", 0xF192D, "core",
    "hand, arm, five, to touch"
  ),
  "lukin": w(
    "lukin", 0xF192E, "core",
    "to see, to look, eye, vision"
  ),
  "lupa": w(
    "lupa", 0xF192F, "core",
    "hole, door, window, orifice"
  ),
  "ma": w(
    "ma", 0xF1930, "core",
    "land, earth, country, territory"
  ),
  "mama": w(
    "mama", 0xF1931, "core",
    "parent, creator, ancestor, origin"
  ),
  "mani": w(
    "mani", 0xF1932, "core",
    "money, currency, large domesticated animal"
  ),
  "meli": w(
    "meli", 0xF1933, "core",
    "woman, female, feminine, wife"
  ),
  "mi": w(
    "mi", 0xF1934, "core",
    "I, me, we, us, my, our"
  ),
  "mije": w(
    "mije", 0xF1935, "core",
    "man, male, masculine, husband"
  ),
  "moku": w(
    "moku", 0xF1936, "core",
    "to eat, food, to drink, to consume"
  ),
  "moli": w(
    "moli", 0xF1937, "core",
    "death, dead, to die, to kill"
  ),
  "monsi": w(
    "monsi", 0xF1938, "core",
    "back, behind, rear, butt"
  ),
  "mu": w(
    "mu", 0xF1939, "core",
    "animal sound, moo, meow"
  ),
  "mun": w(
    "mun", 0xF193A, "core",
    "moon, star, night sky object"
  ),
  "musi": w(
    "musi", 0xF193B, "core",
    "fun, artistic, playful, game"
  ),
  "mute": w(
    "mute", 0xF193C, "core",
    "many, much, several, very, twenty"
  ),
  "nanpa": w(
    "nanpa", 0xF193D, "core",
    "number, ordinal marker"
  ),
  "nasa": w(
    "nasa", 0xF193E, "core",
    "unusual, strange, silly, drunk"
  ),
  "nasin": w(
    "nasin", 0xF193F, "core",
    "way, path, method, road, doctrine"
  ),
  "nena": w(
    "nena", 0xF1940, "core",
    "bump, hill, mountain, nose, button"
  ),
  "ni": w(
    "ni", 0xF1941, "core",
    "this, that"
  ),
  "nimi": w(
    "nimi", 0xF1942, "core",
    "name, word"
  ),
  "noka": w(
    "noka", 0xF1943, "core",
    "foot, leg, lower body, bottom"
  ),
  "o": w(
    "o", 0xF1944, "core",
    "(vocative or imperative marker)"
  ),
  "olin": w(
    "olin", 0xF1945, "core",
    "love, affection, compassion, respect"
  ),
  "ona": w(
    "ona", 0xF1946, "core",
    "they, them, it, he, she"
  ),
  "open": w(
    "open", 0xF1947, "core",
    "to open, to begin, to start, to turn on"
  ),
  "pakala": w(
    "pakala", 0xF1948, "core",
    "broken, damaged, mistake, to break"
  ),
  "pali": w(
    "pali", 0xF1949, "core",
    "to do, to work, to make, activity"
  ),
  "palisa": w(
    "palisa", 0xF194A, "core",
    "long hard thing, stick, rod, branch"
  ),
  "pan": w(
    "pan", 0xF194B, "core",
    "bread, grain, cereal, rice"
  ),
  "pana": w(
    "pana", 0xF194C, "core",
    "to give, to send, to emit, to provide"
  ),
  "pi": w(
    "pi", 0xF194D, "core",
    "(regrouping particle)"
  ),
  "pilin": w(
    "pilin", 0xF194E, "core",
    "feeling, heart, emotion, to think"
  ),
  "pimeja": w(
    "pimeja", 0xF194F, "core",
    "black, dark, shadow, unlit"
  ),
  "pini": w(
    "pini", 0xF1950, "core",
    "end, finished, past, closed, to stop"
  ),
  "pipi": w(
    "pipi", 0xF1951, "core",
    "insect, bug, spider, small creature"
  ),
  "poka": w(
    "poka", 0xF1952, "core",
    "side, hip, nearby, beside"
  ),
  "poki": w(
    "poki", 0xF1953, "core",
    "container, box, bowl, cup, bag"
  ),
  "pona": w(
    "pona", 0xF1954, "core",
    "good, simple, positive, friendly"
  ),
  "pu": w(
    "pu", 0xF1955, "core",
    "the Toki Pona book, interacting with pu"
  ),
  "sama": w(
    "sama", 0xF1956, "core",
    "same, similar, equal, sibling, peer"
  ),
  "seli": w(
    "seli", 0xF1957, "core",
    "fire, heat, warmth, chemical reaction"
  ),
  "selo": w(
    "selo", 0xF1958, "core",
    "outer layer, skin, shell, bark, boundary"
  ),
  "seme": w(
    "seme", 0xF1959, "core",
    "what, which (question word)"
  ),
  "sewi": w(
    "sewi", 0xF195A, "core",
    "above, high, divine, sacred, sky"
  ),
  "sijelo": w(
    "sijelo", 0xF195B, "core",
    "body, physical form, torso"
  ),
  "sike": w(
    "sike", 0xF195C, "core",
    "circle, round, ball, cycle, wheel"
  ),
  "sin": w(
    "sin", 0xF195D, "core",
    "new, fresh, additional, extra"
  ),
  "sina": w(
    "sina", 0xF195E, "core",
    "you, your"
  ),
  "sinpin": w(
    "sinpin", 0xF195F, "core",
    "face, front, wall, foremost"
  ),
  "sitelen": w(
    "sitelen", 0xF1960, "core",
    "image, picture, symbol, writing"
  ),
  "sona": w(
    "sona", 0xF1961, "core",
    "knowledge, to know, wise, skilled"
  ),
  "soweli": w(
    "soweli", 0xF1962, "core",
    "animal, land mammal, fuzzy creature"
  ),
  "suli": w(
    "suli", 0xF1963, "core",
    "big, important, tall, long, adult"
  ),
  "suno": w(
    "suno", 0xF1964, "core",
    "sun, light, brightness, glow"
  ),
  "supa": w(
    "supa", 0xF1965, "core",
    "flat surface, table, floor, platform"
  ),
  "suwi": w(
    "suwi", 0xF1966, "core",
    "sweet, cute, adorable, innocent"
  ),
  "tan": w(
    "tan", 0xF1967, "core",
    "from, because, reason, cause, origin"
  ),
  "taso": w(
    "taso", 0xF1968, "core",
    "only, just, but, however"
  ),
  "tawa": w(
    "tawa", 0xF1969, "core",
    "to, toward, moving, for, going"
  ),
  "telo": w(
    "telo", 0xF196A, "core",
    "water, liquid, fluid, beverage"
  ),
  "tenpo": w(
    "tenpo", 0xF196B, "core",
    "time, moment, period, duration"
  ),
  "toki": w(
    "toki", 0xF196C, "core",
    "language, to speak, communication"
  ),
  "tomo": w(
    "tomo", 0xF196D, "core",
    "house, building, room, structure"
  ),
  "tu": w(
    "tu", 0xF196E, "core",
    "two, pair, to divide, to split"
  ),
  "unpa": w(
    "unpa", 0xF196F, "core",
    "sexual, to have sex with"
  ),
  "uta": w(
    "uta", 0xF1970, "core",
    "mouth, lips, oral, jaw"
  ),
  "utala": w(
    "utala", 0xF1971, "core",
    "fight, battle, struggle, challenge"
  ),
  "walo": w(
    "walo", 0xF1972, "core",
    "white, light-colored, pale"
  ),
  "wan": w(
    "wan", 0xF1973, "core",
    "one, unique, united"
  ),
  "waso": w(
    "waso", 0xF1974, "core",
    "bird, flying creature, winged animal"
  ),
  "wawa": w(
    "wawa", 0xF1975, "core",
    "strong, powerful, energetic, intense"
  ),
  "weka": w(
    "weka", 0xF1976, "core",
    "away, absent, removed, to get rid of"
  ),
  "wile": w(
    "wile", 0xF1977, "core",
    "to want, to need, must, desire"
  ),

  // common (post-pu, widely used)
  "namako": w(
    "namako", 0xF1978, "common",
    "spice, extra, additional, ornament"
  ),
  "kin": w(
    "kin", 0xF1979, "common",
    "also, too, indeed, really"
  ),
  "oko": w(
    "oko", 0xF197A, "common",
    "eye (alternative for lukin)"
  ),
  "kipisi": w(
    "kipisi", 0xF197B, "common",
    "to cut, to split, to slice"
  ),
  "leko": w(
    "leko", 0xF197C, "common",
    "square, block, cube, stairs"
  ),
  "monsuta": w(
    "monsuta", 0xF197D, "common",
    "monster, fear, scary, frightening"
  ),
  "tonsi": w(
    "tonsi", 0xF197E, "common",
    "non-binary, transgender, gender-nonconforming"
  ),

  // uncommon
  "jasima": w(
    "jasima", 0xF197F, "uncommon",
    "mirror, reflect, opposite, reverse"
  ),
  "kijetesantakalu": w(
    "kijetesantakalu", 0xF1980, "uncommon",
    "raccoon, procyonid, musteloid"
  ),
  "soko": w(
    "soko", 0xF1981, "uncommon",
    "mushroom, fungus"
  ),
  "meso": w(
    "meso", 0xF1982, "uncommon",
    "medium, moderate, average, middle"
  ),
  "epiku": w(
    "epiku", 0xF1983, "uncommon",
    "epic, cool, awesome, amazing"
  ),
  "lanpan": w(
    "lanpan", 0xF1985, "uncommon",
    "to take, to seize, to steal"
  ),
  "n": w(
    "n", 0xF1986, "uncommon",
    "hmm, thinking sound, uh"
  ),
  "misikeke": w(
    "misikeke", 0xF1987, "uncommon",
    "medicine, health, cure, treatment"
  ),
  "ku": w(
    "ku", 0xF1988, "uncommon",
    "the Toki Pona Dictionary, interacting with ku"
  ),

  // sandbox (rare / experimental)
  "majuna": w(
    "majuna", 0xF19A2, "sandbox",
    "old, aged, ancient"
  ),
  "linluwi": w(
    "linluwi", 0xF19A4, "sandbox",
    "internet, network, web, connected"
  ),
  "su": w(
    "su", 0xF19A6, "sandbox",
    "the Toki Pona Picture Dictionary, " +
      "interacting with su"
  ),

  // Punctuation words (non-UCSUR codepoints)
  "te": w(
    "te", 0x300C, "core",
    "(begin quotation)"
  ),
  "to": w(
    "to", 0x300D, "core",
    "(end quotation)"
  ),
};

export function isWord(s: string): boolean {
  return s in words;
}

export function getWord(
  s: string
): WordEntry | undefined {
  return words[s];
}

export function wordsByCategory(
  cat: WordCategory
): WordEntry[] {
  return Object.values(words).filter(
    (entry) => entry.category === cat
  );
}

const CATEGORY_RANK: Record<WordCategory, number> = {
  core: 0,
  common: 1,
  uncommon: 2,
  obscure: 3,
  sandbox: 4,
};

/**
 * Return words whose name starts with the given
 * prefix, sorted by relevance: exact match first,
 * then by category rank, then alphabetical.
 */
/**
 * Pre-built map of first letter → first word
 * alphabetically for cartouche expansion.
 */
const FIRST_LETTER_MAP: Record<string, string> =
  {};
for (const entry of Object.values(words)) {
  const letter = entry.word[0];
  if (
    !(letter in FIRST_LETTER_MAP) ||
    entry.word < FIRST_LETTER_MAP[letter]
  ) {
    FIRST_LETTER_MAP[letter] = entry.word;
  }
}

/**
 * Return a toki pona word starting with the given
 * letter, or undefined if none exists.
 */
export function wordByFirstLetter(
  letter: string
): string | undefined {
  return FIRST_LETTER_MAP[letter.toLowerCase()];
}

export function wordsByPrefix(
  prefix: string
): WordEntry[] {
  const lower = prefix.toLowerCase();
  if (lower.length === 0) return [];

  const matches = Object.values(words).filter(
    (entry) => entry.word.startsWith(lower)
  );

  matches.sort((a, b) => {
    const aExact = a.word === lower ? 0 : 1;
    const bExact = b.word === lower ? 0 : 1;
    if (aExact !== bExact) return aExact - bExact;

    const aCat = CATEGORY_RANK[a.category];
    const bCat = CATEGORY_RANK[b.category];
    if (aCat !== bCat) return aCat - bCat;

    return a.word.localeCompare(b.word);
  });

  return matches;
}
