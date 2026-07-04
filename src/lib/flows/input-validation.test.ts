import { describe, it, expect } from "vitest";
import {
  isPlausiblePhone,
  isValidRegex,
  validateCollectedInput,
} from "./input-validation";

describe("validateCollectedInput — empty", () => {
  it("rejects empty / whitespace regardless of validation type", () => {
    expect(validateCollectedInput("", "any", undefined)).toBe(false);
    expect(validateCollectedInput("   ", "email", undefined)).toBe(false);
    expect(validateCollectedInput("\n\t", undefined, undefined)).toBe(false);
  });
});

describe("validateCollectedInput — any / undefined", () => {
  it("accepts any non-empty text", () => {
    expect(validateCollectedInput("hello", "any", undefined)).toBe(true);
    expect(validateCollectedInput("hello", undefined, undefined)).toBe(true);
    expect(validateCollectedInput("123", "any", undefined)).toBe(true);
  });
});

describe("validateCollectedInput — email", () => {
  it("accepts email-shaped input", () => {
    expect(validateCollectedInput("a@b.com", "email", undefined)).toBe(true);
    expect(
      validateCollectedInput("first.last@sub.example.co", "email", undefined),
    ).toBe(true);
    expect(validateCollectedInput("  a@b.io  ", "email", undefined)).toBe(true);
  });
  it("rejects non-emails", () => {
    expect(validateCollectedInput("asdf", "email", undefined)).toBe(false);
    expect(validateCollectedInput("a@b", "email", undefined)).toBe(false);
    expect(validateCollectedInput("a@ b.com", "email", undefined)).toBe(false);
    expect(validateCollectedInput("@b.com", "email", undefined)).toBe(false);
  });
});

describe("isPlausiblePhone / phone validation", () => {
  it("accepts phone-shaped input", () => {
    expect(isPlausiblePhone("+1 (555) 123-4567")).toBe(true);
    expect(isPlausiblePhone("5551234")).toBe(true);
    expect(isPlausiblePhone("+447911123456")).toBe(true);
    expect(validateCollectedInput("+1-555-123-4567", "phone", undefined)).toBe(
      true,
    );
  });
  it("rejects too-short, too-long, or lettered input", () => {
    expect(isPlausiblePhone("12345")).toBe(false); // 5 digits
    expect(isPlausiblePhone("1234567890123456")).toBe(false); // 16 digits
    expect(isPlausiblePhone("call me")).toBe(false);
    expect(validateCollectedInput("not a phone", "phone", undefined)).toBe(
      false,
    );
  });
});

describe("validateCollectedInput — regex", () => {
  it("accepts values matching the pattern", () => {
    expect(validateCollectedInput("AB12", "regex", "^[A-Z]{2}\\d{2}$")).toBe(
      true,
    );
  });
  it("rejects values not matching the pattern", () => {
    expect(validateCollectedInput("abcd", "regex", "^[A-Z]{2}\\d{2}$")).toBe(
      false,
    );
  });
  it("accepts (does not trap) when the pattern is missing or invalid", () => {
    expect(validateCollectedInput("anything", "regex", undefined)).toBe(true);
    expect(validateCollectedInput("anything", "regex", "([")).toBe(true);
  });
});

describe("isValidRegex", () => {
  it("distinguishes compilable from broken patterns", () => {
    expect(isValidRegex("^\\d+$")).toBe(true);
    expect(isValidRegex("([")).toBe(false);
  });
});
