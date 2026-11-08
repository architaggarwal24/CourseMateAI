// The arena's bestiary (port of backend/core_brains/bestiary.py): the mythic creatures every boss is drawn from,
// picked instantly by the topic's words (else a stable hash of the topic). `species` is what the browser draws
// (src/lib/pixel/bestiary.ts has a sprite for every id). A model only writes a short flavour layer on top, later.
export interface Creature { name: string; origin: string; keywords: string[]; attacks: string[]; special: string; intro: string; hit: string[]; miss: string[]; rage: string; defeat: string }

export const CREATURES: Record<string, Creature> = {
 "hydra": {
  "name": "Hydra",
  "origin": "Greek",
  "keywords": [
   "biolog",
   "biochem",
   "cell",
   "gene",
   "evolut",
   "organ",
   "anatom",
   "medic",
   "disease",
   "virus",
   "immun",
   "branch",
   "recurs",
   "tree",
   "growth"
  ],
  "attacks": [
   "Twin-Fang Bite",
   "Venom Torrent",
   "Coil Crush"
  ],
  "special": "Regrowth",
  "intro": "Cut one head and two return. So it goes with {topic}.",
  "hit": [
   "A head falls... another stirs.",
   "You cut true. It will not last.",
   "Hssss! You know this part."
  ],
  "miss": [
   "Wrong! My heads multiply on your mistakes.",
   "Every error feeds me.",
   "Again you miss the root of {topic}."
  ],
  "rage": "ALL HEADS AWAKEN!",
  "defeat": "No head left to grow... you mastered {topic}."
 },
 "minotaur": {
  "name": "Minotaur",
  "origin": "Greek",
  "keywords": [
   "algorithm",
   "graph",
   "network",
   "maze",
   "path",
   "program",
   "comput",
   "code",
   "data",
   "struct",
   "search",
   "logic",
   "system"
  ],
  "attacks": [
   "Labyrinth Charge",
   "Horn Gore",
   "Axe Cleave"
  ],
  "special": "Endless Labyrinth",
  "intro": "You entered my labyrinth of {topic}. Few find the way out.",
  "hit": [
   "You found a true path!",
   "Grr... a clever turn.",
   "The thread holds. For now."
  ],
  "miss": [
   "A dead end! Turn back!",
   "Lost in the maze of {topic}.",
   "My horns find the lost."
  ],
  "rage": "THE WALLS CLOSE IN!",
  "defeat": "The labyrinth... solved..."
 },
 "cyclops": {
  "name": "Cyclops",
  "origin": "Greek",
  "keywords": [
   "optic",
   "light",
   "engineer",
   "machin",
   "mechan",
   "physic",
   "force",
   "energy",
   "electr",
   "material",
   "forge",
   "metal",
   "lens"
  ],
  "attacks": [
   "Boulder Hurl",
   "Forge Hammer",
   "Thunder Stomp"
  ],
  "special": "Eye of the Forge",
  "intro": "I forged thunder itself. Your grasp of {topic} is a pebble.",
  "hit": [
   "My eye... you strike clear!",
   "A well-forged answer.",
   "Hmph. Sharp aim."
  ],
  "miss": [
   "I see your every flaw!",
   "Crushed like ore.",
   "{topic} is not for the half-blind."
  ],
  "rage": "THE FORGE BURNS WHITE!",
  "defeat": "My eye closes... you saw further."
 },
 "fenrir": {
  "name": "Fenrir",
  "origin": "Norse",
  "keywords": [
   "econom",
   "market",
   "finance",
   "money",
   "trade",
   "war",
   "wars",
   "warfare",
   "politic",
   "law",
   "laws",
   "legal",
   "power",
   "govern",
   "revolut",
   "conflict"
  ],
  "attacks": [
   "Ragnarok Fang",
   "Frost Howl",
   "Chain Breaker"
  ],
  "special": "Devour the Sun",
  "intro": "No chain held me. Will your knowledge of {topic}?",
  "hit": [
   "Rrrgh! A chain tightens.",
   "You bind me with truth.",
   "Sharp... like Gleipnir."
  ],
  "miss": [
   "Your chains are thread!",
   "I smell doubt.",
   "The wolf feeds on wrong answers."
  ],
  "rage": "THE CHAINS SHATTER!",
  "defeat": "Bound at last... by what you know."
 },
 "jormungandr": {
  "name": "Jörmungandr",
  "origin": "Norse",
  "keywords": [
   "geolog",
   "geograph",
   "earth",
   "climate",
   "environment",
   "ecolog",
   "planet",
   "cycle",
   "circul",
   "loop",
   "global",
   "world",
   "ocean"
  ],
  "attacks": [
   "World Coil",
   "Poison Tide",
   "Tail Lash"
  ],
  "special": "Ouroboros",
  "intro": "I circle the whole world of {topic}. You stand inside my coil.",
  "hit": [
   "The coil loosens!",
   "Hsss... you know the cycle.",
   "A clean strike."
  ],
  "miss": [
   "Round and round your errors go.",
   "The tide takes the careless.",
   "Poisoned by a guess."
  ],
  "rage": "THE WORLD SERPENT RISES!",
  "defeat": "The circle breaks... it ends with you."
 },
 "kraken": {
  "name": "Kraken",
  "origin": "Norse",
  "keywords": [
   "fluid",
   "wave",
   "sea",
   "seas",
   "marine",
   "water",
   "chem",
   "reaction",
   "molecul",
   "solution",
   "acid",
   "pressure",
   "deep"
  ],
  "attacks": [
   "Tentacle Slam",
   "Ink Cloud",
   "Abyssal Grip"
  ],
  "special": "Maelstrom",
  "intro": "From the depths of {topic} I rise. Can you hold your breath?",
  "hit": [
   "A tentacle recoils!",
   "You cut through the ink.",
   "Grrbl... correct."
  ],
  "miss": [
   "Dragged down by doubt!",
   "Lost in the ink.",
   "The deep of {topic} swallows you."
  ],
  "rage": "THE MAELSTROM OPENS!",
  "defeat": "Back to the abyss... you surfaced."
 },
 "naga": {
  "name": "Naga",
  "origin": "Indian",
  "keywords": [
   "philosoph",
   "relig",
   "ethic",
   "moral",
   "cultur",
   "art",
   "arts",
   "artist",
   "music",
   "language",
   "literat",
   "poet",
   "myth",
   "india"
  ],
  "attacks": [
   "Serpent Coil",
   "Jewel Gaze",
   "Venom Fang"
  ],
  "special": "Thousand-Hood Guard",
  "intro": "I guard the treasures of {topic}. Prove you are worthy.",
  "hit": [
   "Worthy... perhaps.",
   "The jewel dims at your answer.",
   "You honour the old knowledge."
  ],
  "miss": [
   "Unworthy!",
   "The treasure stays hidden from you.",
   "You have not read deeply."
  ],
  "rage": "THE HOODS UNFURL!",
  "defeat": "The treasure is yours. Guard it well."
 },
 "rakshasa": {
  "name": "Rakshasa",
  "origin": "Indian",
  "keywords": [
   "psych",
   "mind",
   "behav",
   "social",
   "brain",
   "cognit",
   "illusion",
   "percep",
   "decept",
   "persuas",
   "market"
  ],
  "attacks": [
   "Illusion Claw",
   "Shapeshift Strike",
   "Night Feast"
  ],
  "special": "Maya Veil",
  "intro": "Nothing in {topic} is what it seems. I am the illusion.",
  "hit": [
   "You see through me!",
   "Clever mortal.",
   "My veil tears."
  ],
  "miss": [
   "Fooled again!",
   "You chase illusions.",
   "Ha! The obvious answer was a trap."
  ],
  "rage": "A HUNDRED FACES, ONE HUNGER!",
  "defeat": "The illusion fades... you saw truly."
 },
 "oni": {
  "name": "Oni",
  "origin": "Japanese",
  "keywords": [
   "sport",
   "health",
   "nutri",
   "exercis",
   "body",
   "muscl",
   "account",
   "business",
   "manage",
   "strateg",
   "exam",
   "test"
  ],
  "attacks": [
   "Kanabo Smash",
   "Thunder Drum",
   "Iron Club Sweep"
  ],
  "special": "Oni's Wrath",
  "intro": "My club has broken a thousand scholars of {topic}.",
  "hit": [
   "Gwah! A solid blow!",
   "You fight with knowledge.",
   "My drum skips a beat!"
  ],
  "miss": [
   "Weak! Like rice paper!",
   "My club laughs at you.",
   "Train harder at {topic}!"
  ],
  "rage": "THE WAR DRUMS THUNDER!",
  "defeat": "Oni bows... to a true scholar."
 },
 "kitsune": {
  "name": "Kitsune",
  "origin": "Japanese",
  "keywords": [
   "math",
   "algebra",
   "calcul",
   "geometr",
   "statist",
   "probab",
   "number",
   "equation",
   "proof",
   "theorem",
   "trick",
   "puzzle"
  ],
  "attacks": [
   "Foxfire",
   "Nine-Tail Whip",
   "Trickster's Mark"
  ],
  "special": "Nine Flames",
  "intro": "Nine tails, nine tricks. {topic} has more than you think.",
  "hit": [
   "Kon! You saw my trick.",
   "Clever... very clever.",
   "A tail singed!"
  ],
  "miss": [
   "Tricked!",
   "The foxfire leads you astray.",
   "Ha! Check your working."
  ],
  "rage": "ALL NINE FLAMES BURN!",
  "defeat": "A worthy mind... I yield my tails."
 },
 "sphinx": {
  "name": "Sphinx",
  "origin": "Egyptian",
  "keywords": [
   "riddle",
   "reason",
   "critic",
   "argument",
   "philosoph",
   "logic",
   "question",
   "ancient",
   "egypt",
   "archae",
   "history"
  ],
  "attacks": [
   "Riddle Strike",
   "Sand Talon",
   "Desert Roar"
  ],
  "special": "The Final Riddle",
  "intro": "Answer my riddles of {topic}, or be devoured.",
  "hit": [
   "Correct. Continue.",
   "You reason well.",
   "The sands shift in your favour."
  ],
  "miss": [
   "Wrong. The sands await.",
   "A riddle half-solved is a riddle failed.",
   "Think, mortal."
  ],
  "rage": "THE FINAL RIDDLE AWAKENS!",
  "defeat": "You have answered... pass, scholar."
 },
 "simurgh": {
  "name": "Simurgh",
  "origin": "Persian",
  "keywords": [
   "history",
   "knowledge",
   "wisdom",
   "educat",
   "learn",
   "teach",
   "literature",
   "astronom",
   "star",
   "space",
   "sky",
   "flight"
  ],
  "attacks": [
   "Gale Wing",
   "Ancient Screech",
   "Feather Storm"
  ],
  "special": "Wisdom of Ages",
  "intro": "I have watched {topic} for three thousand years. Show me what you learned.",
  "hit": [
   "Wise answer.",
   "My feathers ruffle in respect.",
   "You learn quickly."
  ],
  "miss": [
   "The ages forget the careless.",
   "Look again, young one.",
   "Shallow understanding."
  ],
  "rage": "THE SKY ITSELF ROARS!",
  "defeat": "Take a feather. You have earned my wisdom."
 },
 "ammit": {
  "name": "Ammit",
  "origin": "Egyptian",
  "keywords": [],
  "attacks": [
   "Heart Devour",
   "Scale Crush",
   "Crocodile Maw"
  ],
  "special": "The Weighing",
  "intro": "I remember every mistake you made. Tonight, I feast on them.",
  "hit": [
   "You... learned this one.",
   "The scale tips your way!",
   "Grrah! Not that heart."
  ],
  "miss": [
   "The same mistake! Delicious.",
   "Your heart is heavy with error.",
   "I remember this one too."
  ],
  "rage": "THE SCALES TIP TO RUIN!",
  "defeat": "Your heart is light... I starve."
 }
};

export const NEMESIS_SPECIES = "ammit";
const PICKABLE = Object.keys(CREATURES).filter((k) => k !== NEMESIS_SPECIES);
const HP_HINT: Record<string, number> = { easy: 60, medium: 90, hard: 130, nightmare: 180 };

const words = (topic: string) => (topic || "").toLowerCase().match(/[a-z]+/g) ?? [];
/** A short key (sea, sky, art...) only as a whole word; a longer stem also starts words ("thermodynam"). */
const matches = (word: string, k: string) => (k.length < 4 ? word === k : word.startsWith(k) || (word.length >= 5 && k.startsWith(word)));

/** The creature for a topic: most keyword hits wins; no hit (or a tie) by a stable hash, so a topic keeps its creature. */
export async function pickSpecies(topic: string, nemesis = false): Promise<string> {
  return (await summon(topic, null, nemesis)).species;
}

/**
 * The creature a topic summons, among the `open` ones (null: all). `wanted` is the one it would summon with every
 * creature open: when that one is still locked, the closest open creature stands in (most keyword hits, then the
 * stable hash), and the locked one's page remembers the topic.
 */
export async function summon(topic: string, open: Set<string> | null, nemesis = false): Promise<{ species: string; wanted: string }> {
  if (nemesis || (topic || "").startsWith("Nemesis: ")) return { species: NEMESIS_SPECIES, wanted: NEMESIS_SPECIES };
  const w = words(topic);
  const hex = [...new Uint8Array(await crypto.subtle.digest("SHA-1", new TextEncoder().encode((topic || "").trim().toLowerCase())))]
    .map((b) => b.toString(16).padStart(2, "0")).join("");
  const digest = BigInt(`0x${hex}`);
  const scores = Object.fromEntries(PICKABLE.map((sid) => [sid, w.reduce((n, word) => n + CREATURES[sid].keywords.filter((k) => matches(word, k)).length, 0)]));
  const choose = (from: string[]) => {
    const best = Math.max(0, ...from.map((s) => scores[s]));
    const pool = best > 0 ? from.filter((s) => scores[s] === best) : from;
    return pool[Number(digest % BigInt(pool.length))];
  };
  const wanted = choose(PICKABLE);
  if (!open || open.has(wanted)) return { species: wanted, wanted };
  const allowed = PICKABLE.filter((s) => open.has(s));
  return { species: allowed.length ? choose(allowed) : wanted, wanted };
}

const fill = (text: string, topic: string) => text.replaceAll("{topic}", topic);

/** A complete boss from the creature alone. */
export function baseBoss(species: string, topic: string, difficulty: string): Record<string, unknown> {
  const c = CREATURES[species] ?? CREATURES.hydra;
  const t = (topic || "the unknown").trim().slice(0, 80);
  return {
    // on nightmare it is the creature's Elder form (the Bestiary page that it unlocks)
    species: CREATURES[species] ? species : "hydra", origin: c.origin, name: difficulty === "nightmare" ? `Elder ${c.name}` : c.name, title: `Warden of ${t}`,
    tagline: `A ${c.origin} legend, bound to ${t}`, personality: `An ancient ${c.name.toLowerCase()} that guards ${t}`,
    conceptual_core: `The ${c.name} feeds on every gap in your understanding of ${t}.`, max_hp: HP_HINT[difficulty] ?? 120,
    rage_threshold: difficulty === "nightmare" ? 0.6 : 0.4, special_ability: c.special, weakness: t, attack_names: [...c.attacks],
    intro_taunt: fill(c.intro, t),
    phase1_taunts: [...[...c.miss.slice(0, 1), ...c.hit.slice(0, 1)].map((x) => fill(x, t)), `Show me what you know of ${t}.`],
    phase2_taunts: [c.rage, `Now the true depths of ${t}!`],
    hit_taunts: c.hit.map((x) => fill(x, t)), miss_taunts: c.miss.map((x) => fill(x, t)), defeat_taunt: fill(c.defeat, t),
  };
}
