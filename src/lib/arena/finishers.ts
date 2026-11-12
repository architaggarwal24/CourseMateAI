/**
 * Each champion's FINAL MOVE (Stage 4): the finisher that ends a fight from the boss's knees. Your hero's comes from
 * its fighting style. Shared by the server (the fight) and the client (character select shows it).
 */
export const FINISHERS: Record<string, string> = {
  kaien: "Last Page Severance", asha: "Dawnbreaker", brak: "Mountain Fall", mira: "Grand Archive", vex: "Curtain of Shadows", thorne: "The Final Chapter",
};
export const STYLE_FINISHERS: Record<string, string> = {
  apprentice: "First Lesson", katana: "Hundred Cuts", spear: "Skypiercer", fists: "Avalanche of Fists", staff: "Starfall",
  daggers: "Silent Ending", greatsword: "Worldsplitter", chain_whip: "Serpent's Coil", war_fan: "Gale of Petals", twin_kamas: "Reaping Moon",
};
