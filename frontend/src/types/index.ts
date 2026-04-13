export interface HUDData {
  progress: {
    current_level: number;
    total_xp: number;
    coins: number;
    streak_days: number;
    xp_into_level: number;
    xp_to_next: number;
  };
  quests: Quest[];
  shop: ShopState;
}

export interface Quest {
  quest_type: string;
  description: string;
  current_count: number;
  target_count: number;
  completed: number;
  claimed: number;
  reward_xp: number;
  reward_coins: number;
}

export interface ShopState {
  shop_unlocked: boolean;
  level: number;
  coins: number;
  items: ShopItem[];
}

export interface ShopItem {
  id: string;
  name: string;
  type: string;
  price: number;
  owned: boolean;
  equipped: boolean;
  locked: boolean;
  can_afford: boolean;
  tier: string;
}

export interface SessionMeta {
  type: string;
  preview: string;
  updated: string;
}

export interface Message {
  role: "system" | "user" | "assistant";
  content: string;
  type?: string;
}

export interface QuizQuestion {
  id: number;
  question: string;
  options: string[];
  correct_answer: string;
  explanation?: string;
  difficulty?: string;
}

export interface QuizData {
  questions: QuizQuestion[];
}

export interface RewardPayload {
  ok: boolean;
  xp_gained: number;
  coins_gained: number;
  level_up?: { from: number; to: number };
}


export interface ArenaState {
  boss: BossData | null;
  playerHp: number;
  quiz: QuizData | null;
  currentQuestion: number;
  answers: Record<number, string>;
  level: number;
  topic: string;
  battleUrl?: string;
}

export interface BossData {
  name: string;
  title: string;
  max_hp: number;
  current_hp: number;
  special_ability: string;
  intro_taunt: string;
  personality: string;
  weakness: string;
}