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
    expect(container.querySelectorAll(".user-avatar")).toHaveLength(1);
    expect(container.querySelector("img")).toBeInTheDocument();
  });

  it("uses the one avatar for selected-image preview", async () => {
    let resolveUpload!: (value: ReturnType<typeof response>) => void;
    const fetchMock = vi.fn().mockReturnValue(new Promise<ReturnType<typeof response>>((resolve) => { resolveUpload = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(<AvatarSettings userId="user-a" avatar={null} />);
    const file = new File([Uint8Array.from([1, 2, 3])], "avatar.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Choose avatar image") as HTMLInputElement, { target: { files: [file] } });
    await waitFor(() => expect(container.querySelectorAll(".user-avatar")).toHaveLength(1));
    expect(container.querySelector("img")).toBeInTheDocument();
    resolveUpload(response({ avatar: { mediaType: "image/webp", byteSize: 4, sha256: "b".repeat(64) } }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Remove photo" })).toBeInTheDocument());
    expect(container.querySelectorAll(".user-avatar")).toHaveLength(1);
  });

  it("restores the deterministic default in place after remove", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(null));
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(<AvatarSettings userId="user-a" avatar={{ sha256: "a".repeat(64) }} />);
    expect(container.querySelector("img")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove photo" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Remove photo" })).not.toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith("/app/avatar", expect.objectContaining({ method: "DELETE", credentials: "same-origin" }));
    expect(container.querySelectorAll(".user-avatar")).toHaveLength(1);
    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(container.querySelector("svg")).toBeInTheDocument();
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
