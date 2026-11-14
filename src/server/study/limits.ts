// The study limits and the PDF storage key, shared by documents, courses and the Trash. Kept in a file that imports
// nothing so those three can all use them without importing each other in a circle (see
// src/server/import-cycles.test.ts for what that broke).

/** Courses one account can have. */
export const MAX_COURSES = 30;
/** PDFs one course can hold. */
export const MAX_COURSE_DOCUMENTS = 20;

/** Where a PDF's file lives in R2. */
export const r2Key = (userId: number, documentId: string) => `pdfs/${userId}/${documentId}.pdf`;
