# Reviewing and publishing chapter pages

Chapter pages (`/cbse/class-10/science/...`) are drafted with AI help and stay out of Google until a person checks
them. This is how to check one and put it live.

## Why the review matters

Google's spam policy treats AI pages published without care as "scaled content abuse", and wrong answers on a study
page hurt students. Every page you publish carries your name as the checker, so check it properly.

## Checking a chapter

1. Run the app (`npm run dev`) and open the chapter, e.g. `http://localhost:3000/cbse/class-10/science/chemical-reactions-and-equations`.
   A draft says "Draft: not yet checked" under the title.
2. Open the content file: `src/lib/content/cbse-10-science.ts`.
3. With the NCERT textbook open, check every:
   - summary paragraph and key point (facts, equations, names)
   - flashcard (the answer really answers the question)
   - quiz question (exactly one right option; the `answer` number points at it, counting from 0; the explanation is right)
   - common mistake
4. Fix anything wrong in the file. Keep the words your own: never paste text, questions or diagrams from the textbook.
5. Check the chapter is still in this year's syllabus (`syllabus.url` in the same file).

## Putting it live

Add a `reviewed` line to the chapter, with your name and today's date:

```ts
reviewed: { by: "Archit Aggarwal", on: "2026-11-20" },
```

Then run `npm run check`. After the next deploy the page:

- is indexable (no `noindex`) and listed in the sitemap
- shows "Checked by ... on ..." under the title
- carries the flashcard markup that can show it in Google's flashcard results

The chapter list (`/cbse/class-10/science`) goes live with its first reviewed chapter.

## Adding chapters

Add the next chapter to the `chapters` list in the same file, in order, with the same fields. Ask Claude to draft it,
then review it as above. Publish a few a week rather than many at once, and watch Search Console: a page with no
impressions after about 8 weeks should be improved, not copied.

## Changing a live chapter

Edit it, check the change against the textbook, and set its `updated` date to today. If you made a real correction,
update `reviewed.on` too.
