import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { render } from "@testing-library/react";
import AppTemplate from "./template";

// Performance pass (Stage P1): the page's server HTML used to arrive with style="opacity:0" and stay invisible until
// the JavaScript loaded and faded it in (about 5 s on a slow phone). The first paint now shows the page at once;
// moving between pages inside the app keeps the short rise.
describe("page entrance", () => {
  it("the server HTML is visible: no opacity 0, no blur", () => {
    const html = renderToString(<AppTemplate><h1>Today</h1></AppTemplate>);
    expect(html).toContain("Today");
    expect(html).not.toMatch(/opacity:\s*0/);
    expect(html).not.toMatch(/blur\(/);
  });

  it("the first page on the client does not fade in; the next page (an in-app navigation) does", () => {
    const first = render(<AppTemplate><p>first</p></AppTemplate>);
    const firstPage = first.container.querySelector<HTMLElement>(".app-page")!;
    expect(firstPage.style.opacity === "" || firstPage.style.opacity === "1").toBe(true);
    first.unmount();
    const next = render(<AppTemplate><p>next</p></AppTemplate>);
    expect(next.container.querySelector<HTMLElement>(".app-page")!.style.opacity).toBe("0");
  });
});
