export interface Unit {
  uid: string;
  cardId: string;
  atk: number;
  hp: number;
  maxHp: number;
  ready: boolean;
  shield?: boolean;
  kingfisherDrawTurn?: number;
}
export interface Player {
  hp: number;
  armor: number;
  mana: number;
  maxMana: number;
  board: Unit[];
  hand: string[];
  handIds?: string[];
  handBoosts?: Record<string, { turn: number; amount: number }>;
  deck: string[];
  fatigue: number;
  ritualUsed: boolean;
  ritualsLeft?: number;
}
export interface Match {
  schema: number;
  rules: string;
  contentVersion?: string;
  course?: string;
  id: string;
  grade: number;
  seed: string;
  deckId: string;
  opponentId: string;
  players: Player[];
  active: number;
  turn: number;
  seq: number;
  handSeq?: number;
  phase: string;
  winner: number | string | null;
  log: string[];
  questions: string[];
  questionIndex: number;
  correct: number;
  attempts: number;
  review: string[];
  archivedReview?: string[];
  pending: unknown;
  recorded: boolean;
  opening?: { player: number[] | null; opponent: number[] };
}
export type Action =
  | { type: "end" }
  | { type: "play"; index: number; target?: string }
  | { type: "attack"; uid: string; target: string }
  | { type: "power"; kind: "insight" | "spark" | "bloom"; target?: string };
export type QuestionBank = "school" | "teacher-academic";
export type TeacherCategory = "vocabulary" | "grammar" | "syntax" | "reading";
export interface Question {
  id: string;
  bank?: QuestionBank;
  grade: number | null;
  category?: TeacherCategory;
  passage?: string;
  type: string;
  topic: string;
  prompt: string;
  text: string;
  options: string[];
  answer: number;
  explanation: string;
  speak: string;
  target: string;
  semester?: number | null;
  unitId?: string;
  contentVersion?: string;
  listen?: string;
  sourcePages?: { pdf: number[]; printed: number[] };
}
export interface Mastery {
  seen: number;
  correct: number;
  streak: number;
  due: number;
  last: number;
}
export interface ScoreRecord {
  id: string;
  nickname: string;
  grade: number;
  seed: string;
  deckId: string;
  opponentId: string;
  rules: string;
  contentVersion?: string;
  course?: string;
  score: number;
  correct: number;
  attempts: number;
  turns: number;
  result: string;
  date: number;
}
export interface SaveData {
  schema: number;
  nickname: string;
  bank?: QuestionBank;
  teacherCourse?: "all" | TeacherCategory;
  grade: number;
  course: string;
  deckId: string;
  opponentId: string;
  sound: boolean;
  music: boolean;
  musicVolume: number;
  soundVolume: number;
  speech: boolean;
  reduced: boolean;
  mastery: Record<string, Mastery>;
  archivedMastery: Record<string, Mastery>;
  records: ScoreRecord[];
  match: Match | null;
}
