import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockApi } from "./fixtures/api";
import { settle } from "./helpers";

// Files stage 3: files attached to a tutor question, like Claude. In a real browser the picture is shrunk on a
// canvas to JPEG before it goes, and the cards pass axe.

test("a picture attached to a question is shrunk to JPEG in the browser and sent with that question only", async ({ page }) => {
  await mockApi(page);
  const bodies: Record<string, unknown>[] = [];
  await page.route("**/api/v1/chat/stream", async (route) => {
    bodies.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: "text/event-stream",
      body: `event: token\ndata: ${JSON.stringify({ text: "That's a plant cell." })}\n\nevent: sources\ndata: ${JSON.stringify({ mode: "chat", sources: [], citations: [], blocked: false, needs_clarification: false, rewards: null })}\n\n` });
  });
  await page.goto("/study?tab=chat&doc=doc-1");
  // a 2000 x 1000 PNG drawn in the page itself, so its size is known
  const png = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 2000; c.height = 1000;
    const g = c.getContext("2d")!;
    g.fillStyle = "#2a7"; g.fillRect(0, 0, 2000, 1000);
    const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), "image/png"));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  await page.getByLabel("Choose files to attach").setInputFiles({ name: "cell.png", mimeType: "image/png", buffer: Buffer.from(png) });
  const tray = page.getByRole("list", { name: "Attached to your next question" });
  await expect(tray.getByText("cell.png")).toBeVisible();
  await settle(page);
  const axe = await new AxeBuilder({ page }).include(".ws-composer-bar").analyze();
  expect(axe.violations).toEqual([]);
  await page.getByRole("textbox", { name: "Message" }).fill("What is this?");
  await page.keyboard.press("Enter");
  await expect(page.getByText("That's a plant cell.")).toBeVisible();
  const sent = (bodies[0].attachments as { kind: string; mime: string; data: string }[])[0];
  expect(sent).toMatchObject({ kind: "image", mime: "image/jpeg" });
  const size = await page.evaluate(async (b64) => {
    const img = await createImageBitmap(await (await fetch(`data:image/jpeg;base64,${b64}`)).blob());
    return [img.width, img.height];
  }, sent.data);
  expect(size).toEqual([1600, 800]);                                              // shrunk to 1,600 px on its long side
  await expect(page.getByRole("article", { name: "You" }).getByRole("list", { name: "Attached" })).toContainText("cell.png");
  await page.getByRole("textbox", { name: "Message" }).fill("Thanks");
  await page.keyboard.press("Enter");
  await expect.poll(() => bodies.length).toBe(2);
  expect(bodies[1].attachments).toBeUndefined();
});
