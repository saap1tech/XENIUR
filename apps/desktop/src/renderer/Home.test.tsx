import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Home } from "./Home.js";

const noop = vi.fn();

describe("Home visual hierarchy", () => {
  it("leads with Worlds and active situations without turning language into a prompt hero", () => {
    const html = renderToStaticMarkup(<Home
      worlds={[{
        id: "11111111-1111-4111-8111-111111111111", title: "Rainwear 2027",
        emoji: "R", summary: "Research to delivery", createdAt: 1, lastOpenedAt: null,
      }]}
      active={[]}
      info={null}
      economy={null}
      onOpen={noop}
      onCreate={noop}
      onApprove={noop}
      onReject={noop}
      onExplore={noop}
      onWorkflows={noop}
    />);

    expect(html).toContain("Work in view.");
    expect(html).toContain("Your Worlds");
    expect(html).toContain("Active situations");
    expect(html).toContain("Language is available inside each World as a shortcut.");
    expect(html).not.toContain("<textarea");
    expect(html).not.toMatch(/placeholder=/);
    expect(html.indexOf("Your Worlds")).toBeLessThan(html.indexOf("Language is available"));
  });
});
