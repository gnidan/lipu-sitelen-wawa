import {
  describe, it, expect, vi, afterEach,
} from "vitest";
import {
  render, screen, fireEvent, cleanup,
} from "@testing-library/react";
import { VariantPopup } from "./VariantPopup";
import { getVariations } from "../../data";
import type { Editor } from "@tiptap/react";

// Mock BubbleMenu to simply render children and call
// shouldShow to determine visibility
vi.mock("@tiptap/react", () => ({
  BubbleMenu: ({
    children,
    shouldShow,
    editor,
  }: {
    children: React.ReactNode;
    shouldShow?: (args: {
      state: unknown;
    }) => boolean;
    editor: { state: unknown };
  }) => {
    const visible = shouldShow
      ? shouldShow({ state: editor.state })
      : true;
    return visible
      ? <div data-testid="bubble-menu">{children}</div>
      : null;
  },
}));

// Minimal mock of NodeSelection for instanceof checks
vi.mock("@tiptap/pm/state", () => {
  class MockNodeSelection {
    node: unknown;
    from: number;
    constructor(node: unknown, from = 0) {
      this.node = node;
      this.from = from;
    }
  }
  return { NodeSelection: MockNodeSelection };
});

// Re-import after mock so instanceof works
const { NodeSelection } = await import("@tiptap/pm/state");

function makeEditor(
  nodeType?: string,
  word?: string,
  variation = 0
): Editor {
  if (!nodeType) {
    // No node selected — plain text selection
    return {
      state: {
        selection: { from: 0, to: 0 },
      },
      view: {
        state: {
          selection: { from: 0, to: 0 },
          tr: { setNodeMarkup: vi.fn() },
        },
        dispatch: vi.fn(),
      },
    } as unknown as Editor;
  }

  const node = {
    type: { name: nodeType },
    attrs: { word, variation },
  };

  const sel = new (NodeSelection as any)(node, 0);

  const setNodeMarkup = vi.fn().mockReturnValue({});

  return {
    state: { selection: sel },
    view: {
      state: {
        selection: sel,
        tr: { setNodeMarkup },
      },
      dispatch: vi.fn(),
    },
  } as unknown as Editor;
}

describe("VariantPopup", () => {
  afterEach(cleanup);

  it("does not render when no node is selected", () => {
    const editor = makeEditor();
    render(<VariantPopup editor={editor} />);
    expect(screen.queryByTestId("bubble-menu"))
      .toBeNull();
  });

  it(
    "does not render for non-sitelenPona nodes",
    () => {
      const editor = makeEditor("paragraph", "toki");
      render(<VariantPopup editor={editor} />);
      expect(screen.queryByTestId("bubble-menu"))
        .toBeNull();
    }
  );

  it(
    "does not render for words without variations",
    () => {
      const editor = makeEditor("sitelenPona", "toki");
      render(<VariantPopup editor={editor} />);
      expect(screen.queryByTestId("bubble-menu"))
        .toBeNull();
    }
  );

  it(
    "renders variant options for words with variations",
    () => {
      const editor = makeEditor("sitelenPona", "ni");
      render(<VariantPopup editor={editor} />);

      expect(screen.getByTestId("bubble-menu"))
        .toBeTruthy();

      const variations = getVariations("ni");
      // +1 for the default option
      const buttons = screen.getAllByRole("button");
      expect(buttons).toHaveLength(
        variations.length + 1
      );
    }
  );

  it("shows default option with key 0", () => {
    const editor = makeEditor("sitelenPona", "ni");
    render(<VariantPopup editor={editor} />);

    const defaultBtn = screen.getByTitle("Default");
    expect(defaultBtn).toBeTruthy();
    expect(defaultBtn.textContent).toContain("0");
  });

  it(
    "dispatches transaction when variant is clicked",
    () => {
      const editor = makeEditor("sitelenPona", "ni");
      render(<VariantPopup editor={editor} />);

      const buttons = screen.getAllByRole("button");
      // Click second button (first variation)
      fireEvent.click(buttons[1]);

      const { dispatch } = editor.view;
      expect(dispatch).toHaveBeenCalled();
    }
  );
});
