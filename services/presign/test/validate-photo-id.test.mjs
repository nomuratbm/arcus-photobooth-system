import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { validatePhotoId } from "../validate-photo-id.mjs";

describe("validate-photo-id", () => {
  it("accepts valid lowercase UUID v4", () => {
    const valid = "a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d";
    assert.equal(validatePhotoId(valid), valid);
  });

  it("accepts crypto.randomUUID() generated IDs", () => {
    for (let i = 0; i < 20; i++) {
      const id = randomUUID();
      assert.equal(validatePhotoId(id), id);
    }
  });

  it("rejects uppercase UUID v4", () => {
    assert.equal(validatePhotoId("A1B2C3D4-E5F6-4A1B-8C2D-3E4F5A6B7C8D"), null);
    assert.equal(validatePhotoId("a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8D"), null);
  });

  it("rejects non-v4 UUID version bits", () => {
    assert.equal(validatePhotoId("a1b2c3d4-e5f6-1a1b-8c2d-3e4f5a6b7c8d"), null);
    assert.equal(validatePhotoId("a1b2c3d4-e5f6-7a1b-8c2d-3e4f5a6b7c8d"), null);
    assert.equal(validatePhotoId("a1b2c3d4-e5f6-0a1b-8c2d-3e4f5a6b7c8d"), null);
  });

  it("rejects non-RFC4122 variant bits", () => {
    assert.equal(validatePhotoId("a1b2c3d4-e5f6-4a1b-0c2d-3e4f5a6b7c8d"), null);
    assert.equal(validatePhotoId("a1b2c3d4-e5f6-4a1b-4c2d-3e4f5a6b7c8d"), null);
    assert.equal(validatePhotoId("a1b2c3d4-e5f6-4a1b-cc2d-3e4f5a6b7c8d"), null);
  });

  it("rejects all-zero UUID", () => {
    assert.equal(validatePhotoId("00000000-0000-0000-0000-000000000000"), null);
  });

  it("rejects non-string", () => {
    assert.equal(validatePhotoId(null), null);
    assert.equal(validatePhotoId(undefined), null);
    assert.equal(validatePhotoId(12345), null);
    assert.equal(validatePhotoId({}), null);
    assert.equal(validatePhotoId([]), null);
  });

  it("rejects empty string", () => {
    assert.equal(validatePhotoId(""), null);
    assert.equal(validatePhotoId("   "), null);
  });

  it("rejects overlong or short string", () => {
    assert.equal(validatePhotoId("a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8de"), null);
    assert.equal(validatePhotoId("a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8"), null);
  });

  it("rejects strings with path separators", () => {
    assert.equal(validatePhotoId("a1b2c3d4/e5f6/4a1b/8c2d/3e4f5a6b7c8d"), null);
    assert.equal(validatePhotoId("a1b2c3d4\\e5f6\\4a1b\\8c2d\\3e4f5a6b7c8d"), null);
  });

  it("rejects strings with dot-dot traversal", () => {
    assert.equal(validatePhotoId("../../../../../../../../etc/passwd"), null);
  });

  it("rejects non-UUID format strings", () => {
    assert.equal(validatePhotoId("not-a-valid-uuid-at-all-clearly!"), null);
  });

  it("trims whitespace from valid v4 ID", () => {
    const valid = "a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d";
    assert.equal(validatePhotoId(`  ${valid}  `), valid);
  });
});
