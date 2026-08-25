import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { UsernameSettings } from "./username-settings";

const initialState = { error: "", value: "wildan" };

describe("UsernameSettings", () => {
  it("keeps the compact state until opened and returns focus on cancel", () => {
    render(<UsernameSettings username="wildan" action={vi.fn().mockResolvedValue(initialState)} />);
    const trigger = screen.getByRole("button", { name: "Edit" });
    expect(screen.getByText("@wildan")).toBeInTheDocument();
    expect(screen.queryByLabelText("Username")).not.toBeInTheDocument();
    fireEvent.click(trigger);
    expect(screen.getByLabelText("Username")).toHaveValue("wildan");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(document.activeElement).toBe(trigger);
    expect(screen.queryByLabelText("Username")).not.toBeInTheDocument();
  });

  it("preserves entered input and shows an inline error", async () => {
    const action = vi.fn().mockResolvedValue({ error: "That username is already taken.", value: "Wildan_2" });
    render(<UsernameSettings username={null} action={action} />);
    fireEvent.click(screen.getByRole("button", { name: "Set username" }));
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "Wildan_2" } });
    fireEvent.submit(screen.getByLabelText("Username").closest("form")!);
    await waitFor(() => expect(screen.getByText("That username is already taken.")).toBeInTheDocument());
    expect(screen.getByLabelText("Username")).toHaveValue("Wildan_2");
  });
});
