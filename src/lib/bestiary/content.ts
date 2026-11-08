// The Bestiary book's words (Stage B2). The Scribe writes each page (lore from the real myths, then a fact from the
// old sources); a margin note in the voice of the champion you fight with; one line of tactics (the second line, the
// bane's clue, comes from the server: it must not be in the page before its time); and the creature's Elder form,
// met on nightmare difficulty. Shaped after the Codex in God of War (2018, Ragnarök): a sketch, a voice, two tips.

export interface PageText {
  epithet: string;
  lore: string;
  fact: string;
  tactic: string;
  elder: { name: string; text: string };
  /** Margin notes, by champion id. */
  notes: Record<string, string>;
}

export const SCRIBE = "The Scribe";

export const PAGES: Record<string, PageText> = {
  minotaur: {
    epithet: "Lord of the Labyrinth",
    lore: "Born of a queen's curse and a white bull from the sea, the Minotaur was walled into the Labyrinth that Daedalus built beneath Knossos. Every ninth year Athens sent youths into its dark, and none found the way out. Here it guards every maze of logic: paths, graphs, the order of steps. It does not think. It charges.",
    fact: "The Greeks also called it Asterion. Theseus killed it with the help of Ariadne's thread, the first recorded trick for escaping a maze: mark the way you came.",
    tactic: "Every few turns it lowers its horns and charges. A right Guard against the charge sends it stumbling.",
    elder: { name: "Elder Minotaur", text: "Older than the walls around it. Its charges come sooner and land harder." },
    notes: {
      kaien: "Sidestep, then cut. Bulls never learn.",
      asha: "Keep the spear low. It runs onto the point.",
      brak: "Horns are just handles. Grab and throw.",
      mira: "A labyrinth is a graph. I mapped it before it noticed me.",
      vex: "It can't charge what it can't see.",
      thorne: "Let it break its horns on my shield.",
    },
  },
  cyclops: {
    epithet: "Smith of Thunder",
    lore: "Three Cyclopes, sons of Earth and Sky, forged the thunderbolt for Zeus, the trident for Poseidon and the helm of darkness for Hades. Later tales made them shepherds and cannibals, like Polyphemus who trapped Odysseus in his cave. This one keeps the forge of physics and machines, where every force has its answer.",
    fact: "Hesiod names the forge-Cyclopes Brontes, Steropes and Arges: Thunder, Lightning and Bright. Odysseus escaped Polyphemus by calling himself Nobody.",
    tactic: "It winds up a boulder throw that hits three times as hard. Answer quickly, or meet it with Guard.",
    elder: { name: "Elder Cyclops", text: "Its single eye has watched a thousand forges cool. It throws more often, and never misses twice." },
    notes: {
      kaien: "One eye means one blind side.",
      asha: "Out of reach of the hammer, inside reach of my spear.",
      brak: "Big swing, long wind-up. Hit it while it winds.",
      mira: "Force equals mass times… duck.",
      vex: "Tell it your name is Nobody. Works every time.",
      thorne: "Boulders I can stop. The patience to wait is the hard part.",
    },
  },
  oni: {
    epithet: "The Club That Breaks Scholars",
    lore: "Horned, red or blue, armed with an iron club studded like a mace, the oni of Japanese tales haunt mountains and the gates of hell. They punish the careless and the lazy. Each February families throw roasted beans at the door and shout for the oni to leave and good luck to come in. This one stands between you and every exam.",
    fact: "The saying 'giving an oni an iron club' means making the strong stronger. The festival is Setsubun; the shout is 'Oni wa soto, fuku wa uchi'.",
    tactic: "Its war drum builds its rage beat by beat. A right answer at the right time breaks the rhythm.",
    elder: { name: "Elder Oni", text: "Its horns have grown through its helm. The drum beats faster and the club falls heavier." },
    notes: {
      kaien: "I have met many oni. This one at least announces itself.",
      asha: "Count the drum. Strike on the rest.",
      brak: "Finally, someone who likes clubs as much as I like fists.",
      mira: "Beans. Really? …I brought beans.",
      vex: "Rhythm is a habit. Habits are weaknesses.",
      thorne: "Stand firm through the noise. It tires before I do.",
    },
  },
  kitsune: {
    epithet: "Nine Tails, Nine Tricks",
    lore: "In Japan the fox is clever and long-lived; with each century it gains a tail and a power, until at nine tails it can see across the world and wear any shape. Some serve the rice god Inari as messengers. Others play cruel tricks on travellers. This one lives in mathematics and puzzles, where a false answer can look exactly like a true one.",
    fact: "Stone foxes guard Inari's shrines all over Japan, often holding a key or a jewel in their mouths. The most famous nine-tailed fox, Tamamo-no-Mae, fooled an emperor.",
    tactic: "It hides a false option among the answers. Pick the illusion and it costs you Focus.",
    elder: { name: "Elder Kitsune", text: "Nine tails, every one of them burning. Its illusions are harder to tell from the truth." },
    notes: {
      kaien: "Cut through the trick, not the fox.",
      asha: "Read the answers twice. One of them is smiling at you.",
      brak: "I don't do puzzles. I do punches. Punch the right answer.",
      mira: "A proof cannot lie. Show your working and the fox loses.",
      vex: "A trickster. I like her. I'll still win.",
      thorne: "Patience undoes cleverness.",
    },
  },
  naga: {
    epithet: "Guardian of Hidden Treasure",
    lore: "Half serpent, sometimes crowned with many hoods, the nagas of Indian and Buddhist lore rule rivers, wells and the treasures beneath the earth. They can be fierce or kind: the naga king Mucalinda spread his hoods over the Buddha to shield him from a storm. This one guards philosophy, culture and language, and the meaning hidden under words.",
    fact: "Nagas appear on temples from India to Cambodia, often as the balustrades of bridges and stairways at Angkor. The word naga simply means serpent in Sanskrit.",
    tactic: "It guards a treasure: answer right at the right moment and you steal hearts and Focus. Its venom lingers.",
    elder: { name: "Elder Naga", text: "A thousand hoods, a thousand years. It guards its hoard more jealously, and its venom bites deeper." },
    notes: {
      kaien: "Respect the guardian. Take the treasure anyway.",
      asha: "Venom works slowly. So should you not.",
      brak: "Scales are armour. Armour has gaps.",
      mira: "Every word hides an older word. Dig.",
      vex: "Treasure? Say no more.",
      thorne: "A guardian I understand. I would not let it pass either.",
    },
  },
  rakshasa: {
    epithet: "Master of Illusion",
    lore: "Rakshasas are the shape-shifting demons of Hindu epics, able to take any form and to cloud the minds of those who look on them. Their greatest king, ten-headed Ravana, ruled golden Lanka and carried off Sita, and the war to bring her home is the story of the Ramayana. This one feeds on the mind itself: perception, memory, the lies we tell ourselves.",
    fact: "Ravana is said to have had ten heads and twenty arms, and to have been a great scholar and devotee of Shiva before his pride undid him.",
    tactic: "Every few turns it raises a veil that soaks up blows. Strong answers tear it.",
    elder: { name: "Elder Rakshasa", text: "It has worn so many faces it has forgotten its own. Its veils return faster." },
    notes: {
      kaien: "Close your eyes. Answer what you know, not what you see.",
      asha: "It wears my face sometimes. Mine is braver.",
      brak: "Hit the real one. Then the others.",
      mira: "Memory is reconstruction. It counts on you forgetting that.",
      vex: "A fellow liar. Professionally, I'm impressed.",
      thorne: "A shield is honest. Let it try to lie to mine.",
    },
  },
  sphinx: {
    epithet: "Answer or Be Devoured",
    lore: "In Egypt the sphinx is a royal guardian, a lion with a king's head, and the Great Sphinx has watched the desert at Giza for four and a half thousand years. In Greece she was a winged monster on a rock outside Thebes, asking every traveller one riddle and devouring all who failed, until Oedipus answered. This one asks about logic, reasoning and history, and keeps score.",
    fact: "The riddle: what walks on four legs in the morning, two at noon and three in the evening? A human: crawling, walking, then with a cane.",
    tactic: "Every third question is a riddle worth half again as much, for you or for it.",
    elder: { name: "Elder Sphinx", text: "Its riddles have outlived the kingdoms that feared them. They come more often." },
    notes: {
      kaien: "Answer plainly. She hates that.",
      asha: "Don't rush the riddle. Rush the one after.",
      brak: "Morning, noon, evening. Human. I knew that one. I KNEW it.",
      mira: "A riddle is a question that wants you to be clever. Be correct instead.",
      vex: "I asked her one back. She's still thinking.",
      thorne: "I will stand here until the riddle runs out of words.",
    },
  },
  fenrir: {
    epithet: "The Wolf No Chain Could Hold",
    lore: "Fenrir, son of Loki, grew so fast the gods feared him. Two chains he broke like thread. The third, Gleipnir, was made by dwarves from six things that do not exist, and it held. Only Tyr dared put a hand in the wolf's mouth as a promise, and lost it. At Ragnarök Fenrir breaks free and swallows Odin. Here he hunts power, money and war.",
    fact: "Gleipnir was made of the sound of a cat's footfall, a woman's beard, the roots of a mountain, the sinews of a bear, the breath of a fish and the spittle of a bird.",
    tactic: "It bites harder with every answer you miss. Keep your streak of right answers alive.",
    elder: { name: "Elder Fenrir", text: "The wolf that swallows gods. Its chain is weaker, and its hunger worse." },
    notes: {
      kaien: "A promise kept cost Tyr a hand. Mine costs nothing: I win.",
      asha: "Keep it at the end of the spear. Never the end of its chain.",
      brak: "Big dog. I like big dogs. This one wants my arm.",
      mira: "Six impossible things. I wrote down a seventh: my patience.",
      vex: "Chains are made of small links. So is a win.",
      thorne: "Ragnarök can wait until I finish this page.",
    },
  },
  hydra: {
    epithet: "Many-Headed Regrowth",
    lore: "The Lernaean Hydra lived in the swamps of Lerna, its breath poison, its blood worse. Cut off a head and two grew back. Heracles faced it as his second labour and won only when his nephew Iolaus burned each neck before it could regrow; the one immortal head was buried under a rock. It thrives on biology, where every half-learned idea grows two more questions.",
    fact: "Heracles dipped his arrows in the Hydra's blood, and that poison later killed him. Biologists named a tiny freshwater animal Hydra because it regrows lost parts.",
    tactic: "Wrong answers grow new heads that heal it. Fewer mistakes mean fewer heads.",
    elder: { name: "Elder Hydra", text: "So many heads it no longer counts them. Each regrows faster than the last." },
    notes: {
      kaien: "Clean cuts. No second tries.",
      asha: "Count the heads. Then stop counting and strike.",
      brak: "Two heads back for one? Fine. I have two fists.",
      mira: "Regeneration needs stem cells. Burn the wound, as Iolaus did.",
      vex: "Leave it one head too few to argue with.",
      thorne: "Endure. It grows, but so does my resolve.",
    },
  },
  kraken: {
    epithet: "From the Deep",
    lore: "Norse sailors told of a creature so vast it could be mistaken for an island, which dragged ships under with its arms and churned whirlpools when it dived. The bishop Erik Pontoppidan wrote it into his natural history of Norway in 1752. It rules chemistry, fluids and pressure, everything that mixes, dissolves and pulls you down.",
    fact: "The legend was probably born of the giant squid, real and up to about twelve metres long, which no one photographed alive in the wild until 2004.",
    tactic: "Its tentacles lock one of your moves for a turn or two. Keep your other moves ready.",
    elder: { name: "Elder Kraken", text: "Older than the charts that warn of it. Its grip lasts longer." },
    notes: {
      kaien: "Arms grab. Blades don't care how many.",
      asha: "Reach is my friend. Its reach is longer. Hm.",
      brak: "Eight arms? I'll take four. You take four.",
      mira: "Pressure doubles every ten metres down. Stay near the surface.",
      vex: "It locks a move. I have others.",
      thorne: "Armour sinks. Good thing I don't plan to.",
    },
  },
  ammit: {
    epithet: "Devourer of the Dead",
    lore: "In the Hall of Two Truths, the heart of the dead is weighed against the feather of Ma'at, the goddess of truth and order. A heart heavy with wrongs is thrown to Ammit: crocodile head, lion's body, hippopotamus haunches. Whoever she eats dies a second time, forever. Here she is made of your own mistakes, and comes for them one by one.",
    fact: "The weighing is painted in the Book of the Dead, such as the Papyrus of Ani. Ammit's name means 'devourer of the dead'; she was feared, never worshipped.",
    tactic: "She devours your mistakes to heal. Her feather marks a question that hits twice as hard.",
    elder: { name: "Elder Ammit", text: "She has eaten the hearts of kings. Each mistake feeds her more." },
    notes: {
      kaien: "My heart is light. My blade is lighter.",
      asha: "Every wrong answer I ever gave, with teeth.",
      brak: "She's made of what I got wrong? She's going to be big.",
      mira: "Study the mistakes before she does.",
      vex: "Weighed and found… quick.",
      thorne: "Face what you did wrong. Then strike it down.",
    },
  },
  simurgh: {
    epithet: "Knowledge Itself",
    lore: "The Simurgh of Persian legend nests in the Tree of All Seeds and has seen the world destroyed three times. In the Shahnameh she raises the abandoned prince Zal and gives him a feather to burn when he needs her. In Attar's poem, thirty birds fly to find the Simurgh as their king and discover, at the end, that they are it. She keeps all knowledge, and asks for proof.",
    fact: "'Si murgh' means 'thirty birds' in Persian, the pun at the heart of Attar's Conference of the Birds (12th century).",
    tactic: "She heals as she watches and slows your clock. Steady right answers pluck her feathers.",
    elder: { name: "Elder Simurgh", text: "She has watched the world end three times and is not impressed by you. She heals faster." },
    notes: {
      kaien: "I bow before I strike. She would expect no less.",
      asha: "She has watched every battle. Give her one worth remembering.",
      brak: "Big bird knows everything. Does it know this fist?",
      mira: "Thirty birds. One answer. I think I understand the poem now.",
      vex: "I stole a feather. She let me. That's worse.",
      thorne: "The last page of the last chapter. Turn it slowly.",
    },
  },
  jormungandr: {
    epithet: "The Serpent That Circles the World",
    lore: "Jörmungandr, a child of Loki, was thrown by Odin into the sea around Midgard and grew until it circled the whole world and bit its own tail. Thor once hooked it with an ox head for bait, fishing with the giant Hymir. At Ragnarök they meet again: Thor kills the serpent, walks nine steps and falls dead from its venom. It holds the earth's great cycles: climate, water, rock.",
    fact: "When Jörmungandr lets go of its tail, the old poems say, Ragnarök begins. A serpent biting its tail is the ouroboros, a symbol of endless cycles.",
    tactic: "Its coils tighten on every turn you fail to break free. Strong answers loosen them.",
    elder: { name: "Elder Jörmungandr", text: "The world itself, coiled and waking. Its squeeze tightens faster." },
    notes: {
      kaien: "Nine steps after the last blow. I will take ten.",
      asha: "You don't fight the whole serpent. You fight the coil in front of you.",
      brak: "Thor needed an ox head. I brought snacks.",
      mira: "Every cycle has a weak point in its loop. Find it.",
      vex: "Bites its own tail. Some of us just have habits.",
      thorne: "The world-ender. Then let this be my last chapter.",
    },
  },
};

/** A page the player hasn't opened yet: a few words that say what kind of thing waits there. */
/**
 * Lost pages (Stage Q1): one more page of lore per creature, found by a Hunt on the quest board. The Nemesis has
 * none: no hunt calls it.
 */
export const LOST_PAGES: Record<string, string> = {
  minotaur: "Some say the Labyrinth was a palace, not a maze: the ruins of Knossos have so many rooms and corridors that visitors may have taken the whole place for one. The word itself may come from labrys, the double axe carved on its walls.",
  cyclops: "The Greeks believed the Cyclopes built the walls of Mycenae and Tiryns, whose stones are too large for human hands. Builders still call that style Cyclopean masonry.",
  oni: "On Setsubun, families in Japan throw roasted soybeans out of the door and shout \"Oni wa soto, fuku wa uchi\": demons out, luck in.",
  kitsune: "A kitsune grows a new tail every hundred years. At nine tails its fur turns silver or gold, and it can hear anything said anywhere. The fox statues at Inari's shrines are her messengers.",
  naga: "In the Buddhist stories, the naga king Mucalinda coiled beneath the Buddha and spread his hoods over him through seven days of storm while he meditated.",
  rakshasa: "Ravana, king of the rakshasas in the Ramayana, had ten heads and ruled from the golden city of Lanka. Even Rama praised his learning.",
  sphinx: "The Sphinx of Thebes asked what walks on four legs in the morning, two at noon and three at evening. Oedipus answered: a human, who crawls, then walks, then leans on a stick. The Sphinx threw herself from her rock.",
  fenrir: "Gleipnir, the ribbon that held Fenrir, was made of six things that do not exist: a cat's footfall, a woman's beard, a mountain's roots, a bear's sinews, a fish's breath and a bird's spittle. Tyr's hand was the pledge, and the price.",
  hydra: "Heracles could not beat the Hydra alone. Every head he cut grew back as two, until his nephew Iolaus burned each stump with a torch. The last head could not die, so Heracles buried it under a rock.",
  kraken: "In 1752 Bishop Pontoppidan wrote that the kraken was so wide that sailors took its back for islands. Many now think the legend began with sightings of the giant squid.",
  simurgh: "In the Shahnameh, the Simurgh raised the abandoned prince Zal in her nest and gave him three of her feathers. Burning one would call her back when he needed her.",
  jormungandr: "Thor once fished for the World Serpent with an ox head for bait and hooked it. The giant Hymir, terrified, cut the line before Thor's hammer could fall.",
};

export const SEALED_LINES = [
  "The ink on this page will not dry.",
  "Something scratches at this page from the other side.",
  "The binding grows warm when you touch it.",
  "A shape, half drawn, as if the Scribe fled.",
];
