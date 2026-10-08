/** Public content scopes only. Questions and answer keys stay in the authority. */
export const SCHOOL_BANK = "school";
export const TEACHER_BANK = "teacher-academic";
export const TEACHER_CATEGORIES = Object.freeze([
  Object.freeze({ id: "vocabulary", label: "学术词汇", labelEn: "Academic vocabulary" }),
  Object.freeze({ id: "grammar", label: "高级语法", labelEn: "Advanced grammar" }),
  Object.freeze({ id: "syntax", label: "复杂句法", labelEn: "Complex syntax" }),
  Object.freeze({ id: "reading", label: "学术阅读", labelEn: "Academic reading" }),
]);
export const bankFor = (bank) => bank === undefined ? SCHOOL_BANK : bank;
export const validBank = (bank) => bank === SCHOOL_BANK || bank === TEACHER_BANK;
export const isTeacherBank = (bank) => bank === TEACHER_BANK;
export const validTeacherCourse = (course) =>
  course === "all" || TEACHER_CATEGORIES.some(({ id }) => id === course);
