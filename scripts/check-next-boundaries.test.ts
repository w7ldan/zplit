import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkSourceText } from "./check-next-boundaries";

const projectFile = (relative: string) => path.resolve(process.cwd(), relative);

describe("Next.js boundary checker", () => {
  it("accepts async Server Actions and erased exports", () => {
    expect(checkSourceText('"use server"; export type Result = string; export interface Input { value: string }; export async function save() {} export const remove = async () => {};', projectFile("src/app/actions.ts"))).toEqual([]);
  });

  it("rejects runtime objects and synchronous functions from use server modules", () => {
    const violations = checkSourceText('"use server"; export const state = {}; export function helper() {}', projectFile("src/app/actions.ts"));
    expect(violations).toHaveLength(2);
    expect(violations.map(({ message }) => message).join("\n")).toMatch(/state/);
    expect(violations.map(({ message }) => message).join("\n")).toMatch(/helper/);
  });

  it.each([
    ['import { requireGroupAccess } from "@/server/groups";', "runtime import"],
    ['import type { GroupAccess } from "@/server/groups";', "type-only import"],
    ['export { GroupAccess } from "@/server/groups";', "re-export"],
    ['const load = () => import("@/server/groups");', "dynamic import"],
    ['import type { Database } from "../../db/client";', "relative database import"],
  ])("rejects a Client Component %s", (statement) => {
    expect(checkSourceText(`"use client"; ${statement}`, projectFile("src/components/groups/fixture.tsx"))).toHaveLength(1);
  });

  it("allows a neutral contract import", () => {
    expect(checkSourceText('"use client"; import type { GroupDetail } from "@/domain/group-contracts";', projectFile("src/components/groups/fixture.tsx"))).toEqual([]);
  });
});
