import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import ChatMarkdown from "@/components/chat/ChatMarkdown";
import { LANGUAGES } from "./highlight";

// Performance pass (Stage P3): highlighting carries 21 languages instead of lowlight's 37 "common" ones.
describe("code highlighting in answers", () => {
  it("colours a labelled fence", () => {
    const { container } = render(<ChatMarkdown>{"```python\ndef area(r):\n    return 3.14 * r * r\n```"}</ChatMarkdown>);
    const code = container.querySelector("pre code")!;
    expect(code.className).toMatch(/hljs/);
    expect(code.querySelector(".hljs-keyword")?.textContent).toBe("def");
    expect(code.textContent).toContain("return 3.14 * r * r");
  });

  it("shows a fence in a language it doesn't carry as plain code, and never guesses unlabelled code", () => {
    const { container } = render(<ChatMarkdown>{"```haskell\nmain = print 1\n```\n\n```\nx = 1\n```"}</ChatMarkdown>);
    const [haskell, plain] = [...container.querySelectorAll("pre code")];
    expect(haskell.textContent).toBe("main = print 1\n");
    expect(haskell.className).toMatch(/hljs/);
    expect(haskell.querySelector("span")).toBeNull();
    expect(plain.className).not.toMatch(/hljs/);
  });

  it("keeps the languages a course is likely to use", () => {
    for (const l of ["python", "java", "c", "cpp", "javascript", "typescript", "sql", "bash", "r", "csharp", "go", "rust"]) {
      expect(Object.keys(LANGUAGES)).toContain(l);
    }
  });
});
