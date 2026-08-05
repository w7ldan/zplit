import { describe, expect, it } from "vitest";
import { splitFriendPhone } from "./country-calling-codes";
import { validateFriendInput } from "./friend-input";

describe("friend phone country codes", () => {
  it("splits configured codes and uses Other for canonical unlisted codes", () => {
    expect(splitFriendPhone("+6281112345")).toMatchObject({ countryCode: "+62", phoneNumber: "81112345", legacyPhoneNumber: "" });
    expect(splitFriendPhone("+99912345678")).toMatchObject({ countryCode: "other", otherCountryCode: "+999", phoneNumber: "12345678", legacyPhoneNumber: "" });
  });

  it("preserves a noncanonical value until the phone fields change", () => {
    const preserved = validateFriendInput({ name: "Friend", countryCode: "other", otherCountryCode: "", phoneNumber: "0811 1234", legacyPhoneNumber: "0811 1234", phoneFieldsChanged: "0", notes: "" });
    expect(preserved).toMatchObject({ ok: true, value: { phoneNumber: "0811 1234" } });
  });

  it("normalizes formatted national numbers and rejects a domestic leading zero", () => {
    expect(validateFriendInput({ name: "Friend", countryCode: "+44", phoneNumber: "20 (1234) 5678", phoneFieldsChanged: "1", notes: "" })).toMatchObject({ ok: true, value: { phoneNumber: "+442012345678" } });
    expect(validateFriendInput({ name: "Friend", countryCode: "+62", phoneNumber: "081112345", phoneFieldsChanged: "1", notes: "" })).toMatchObject({ ok: false, errors: { phoneNumber: "Omit the domestic leading zero." } });
  });
});
