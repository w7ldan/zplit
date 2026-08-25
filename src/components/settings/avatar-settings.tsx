"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { UserAvatar, type AvatarReference } from "@/components/identity/user-avatar";

type AvatarResponse = { mediaType: "image/webp"; byteSize: number; sha256: string };

function responseMessage(body: unknown, fallback: string) {
  return typeof body === "object" && body !== null && "error" in body && typeof body.error === "string" ? body.error : fallback;
}

export function AvatarSettings({ userId, avatar, children }: { userId: string; avatar: AvatarReference | null; children?: ReactNode }) {
  const input = useRef<HTMLInputElement>(null);
  const [current, setCurrent] = useState<AvatarReference | null>(avatar);
  const [preview, setPreview] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  async function upload(file: File) {
    const nextPreview = URL.createObjectURL(file);
    setPreview(nextPreview);
    setError("");
    setPending(true);
    const formData = new FormData();
    formData.set("avatar", file);
    try {
      const response = await fetch("/app/avatar", { method: "POST", body: formData, credentials: "same-origin" });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(responseMessage(body, "Unable to save this avatar."));
      if (typeof body !== "object" || body === null || !("avatar" in body) || typeof body.avatar !== "object" || body.avatar === null || !("sha256" in body.avatar) || typeof body.avatar.sha256 !== "string") {
        throw new Error("Unable to save this avatar.");
      }
      setCurrent(body.avatar as AvatarResponse);
      setPreview(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save this avatar.");
    } finally {
      setPending(false);
      if (input.current) input.current.value = "";
    }
  }

  async function remove() {
    setPending(true);
    setError("");
    try {
      const response = await fetch("/app/avatar", { method: "DELETE", credentials: "same-origin" });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(responseMessage(body, "Unable to remove this avatar."));
      setCurrent(null);
      setPreview(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to remove this avatar.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="settings-page__identity">
      <UserAvatar userId={userId} customAvatar={current} previewSrc={preview} decorative size="md" />
      <div className="settings-page__identity-details">
        {children}
        <div className="settings-page__avatar-control">
          <div className="settings-page__avatar-copy">
            <div className="settings-page__avatar-actions">
              <button className="action-link action-link--quiet settings-page__avatar-action" type="button" onClick={() => input.current?.click()} disabled={pending} aria-busy={pending}>
                {pending ? "Saving…" : "Change photo"}
              </button>
              {current ? <button className="action-link action-link--quiet settings-page__avatar-action" type="button" onClick={remove} disabled={pending}>Remove photo</button> : null}
              <input ref={input} className="settings-page__avatar-input" type="file" aria-label="Choose avatar image" accept="image/jpeg,image/png,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} />
            </div>
            <p className="settings-page__avatar-feedback" role={error ? "alert" : undefined}>{error || "\u00a0"}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
