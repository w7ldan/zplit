export type CopyStatus = "idle" | "copied" | "selected" | "failed";

export async function copyText(text: string, fallbackTarget: HTMLInputElement | HTMLTextAreaElement | null): Promise<CopyStatus> {
  try {
    await navigator.clipboard.writeText(text);
    return "copied";
  } catch {
    if (!fallbackTarget) return "failed";
    try {
      fallbackTarget.focus();
      fallbackTarget.select();
    } catch {
      return "failed";
    }
    try {
      return document.execCommand("copy") ? "copied" : "selected";
    } catch {
      return "selected";
    }
  }
}

export function copyLabel(status: CopyStatus, idle: string) {
  if (status === "copied") return "Copied";
  if (status === "selected") return "Selected — press Ctrl+C";
  if (status === "failed") return "Copy unavailable";
  return idle;
}
