import { describe, expect, it } from "vitest";
import { FileTooLargeError, parseFileReadResponse } from "./use-file-read.js";

describe("parseFileReadResponse", () => {
  it("returns content and size for a successful read", () => {
    const result = parseFileReadResponse({ ok: true, content: "hello", size: 5 });
    expect(result).toEqual({ content: "hello", size: 5 });
  });

  it("throws FileTooLargeError with size and maxBytes for a file_too_large response", () => {
    let caught: unknown;
    try {
      parseFileReadResponse({
        ok: false,
        error: "file_too_large",
        size: 12 * 1024 * 1024,
        maxBytes: 5 * 1024 * 1024,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(FileTooLargeError);
    expect((caught as FileTooLargeError).size).toBe(12 * 1024 * 1024);
    expect((caught as FileTooLargeError).maxBytes).toBe(5 * 1024 * 1024);
  });

  it("throws a plain Error (not FileTooLargeError) for is_directory", () => {
    let caught: unknown;
    try {
      parseFileReadResponse({ ok: false, error: "is_directory" });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(FileTooLargeError);
    expect((caught as Error).message).toBe("is_directory");
  });

  it("throws a generic Error when the server omits an error code", () => {
    let caught: unknown;
    try {
      parseFileReadResponse({ ok: false });
    } catch (e) {
      caught = e;
    }
    expect((caught as Error).message).toBe("file read failed");
  });

  it("defaults size to 0 when the server omits it on a file_too_large response", () => {
    let caught: unknown;
    try {
      parseFileReadResponse({ ok: false, error: "file_too_large" });
    } catch (e) {
      caught = e;
    }
    expect((caught as FileTooLargeError).size).toBe(0);
    expect((caught as FileTooLargeError).maxBytes).toBeUndefined();
  });
});
