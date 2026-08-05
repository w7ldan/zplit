import { describe, expect, it } from "vitest";
import { validateFriendInput } from "./friend-input";

describe("friend input", () => {
  it("trims values and converts empty optional fields to null", () => {
    expect(validateFriendInput({ name: "  Ada Lovelace  ", countryCode: "+62", phoneNumber: " 81112345 ", notes: "  Ledger contact  ", phoneFieldsChanged: "1" })).toMatchObject({
      ok: true,
      value: { name: "Ada Lovelace", phoneNumber: "+6281112345", notes: "Ledger contact" },
    });
    expect(validateFriendInput({ name: "Ada", phoneNumber: "  ", notes: "" })).toMatchObject({
      ok: true,
      value: { name: "Ada", phoneNumber: null, notes: null },
    });
  });

  it("returns field-specific errors at the domain limits", () => {
    const result = validateFriendInput({ name: "", countryCode: "+62", phoneNumber: "1".repeat(33), notes: "n".repeat(2001) });
    expect(result).toMatchObject({
      ok: false,
      errors: {
        name: "Name is required.",
        phoneNumber: "Phone number must be 32 characters or fewer.",
        notes: "Notes must be 2000 characters or fewer.",
      },
    });
  });

  it("does not throw for ordinary malformed form values", () => {
    expect(validateFriendInput(null)).toMatchObject({ ok: false, errors: { name: "Name is required." } });
    expect(validateFriendInput({ name: 42, phoneNumber: {}, notes: [] })).toMatchObject({ ok: false });
  });
});
