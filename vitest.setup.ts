import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { vi } from "vitest";

vi.mock("next/font/google", () => ({ Sora: () => ({ className: "", style: {} }) }));

afterEach(() => {
  cleanup();
});
