import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AvatarSettings } from "./avatar-settings";

function response(body: unknown, ok = true, status = 200) {
  return { ok, status, json: vi.fn().mockResolvedValue(body) };
}

describe("AvatarSettings", () => {
  it("keeps the upload flow compact, previews, and shows remove only after success", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ avatar: { mediaType: "image/webp", byteSize: 4, sha256: "b".repeat(64) } }));
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(<AvatarSettings userId="user-a" avatar={null} />);
    expect(screen.getByRole("button", { name: "Change photo" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove photo" })).not.toBeInTheDocument();
    const file = new File([Uint8Array.from([1, 2, 3])], "avatar.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Choose avatar image") as HTMLInputElement, { target: { files: [file] } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/app/avatar", expect.objectContaining({ method: "POST", body: expect.any(FormData), credentials: "same-origin" })));
    expect(screen.getByRole("button", { name: "Remove photo" })).toBeInTheDocument();
    expect(container.querySelector("img")).toBeInTheDocument();
  });

  it("keeps a useful preview and local error after upload failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ error: "Avatar files must be 5 MiB or smaller." }, false, 400)));
    const { container } = render(<AvatarSettings userId="user-a" avatar={null} />);
    const file = new File([Uint8Array.from([1, 2, 3])], "avatar.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Choose avatar image") as HTMLInputElement, { target: { files: [file] } });
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Avatar files must be 5 MiB or smaller."));
    expect(container.querySelector("img")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove photo" })).not.toBeInTheDocument();
  });
});
