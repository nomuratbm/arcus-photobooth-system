import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildDeliveryUrl } from "../delivery-url.mjs";

describe("delivery-url", () => {
  const validPhotoId = "a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d";
  const validKey = `final/${validPhotoId}.jpg`;
  const validDomain = "d123456abcdef8.cloudfront.net";

  it("builds correct URL for valid domain and key", () => {
    const url = buildDeliveryUrl(validDomain, validKey);
    assert.equal(url, `https://${validDomain}/${validKey}`);
  });

  it("trims whitespace from domain and key", () => {
    const url = buildDeliveryUrl(`  ${validDomain}  `, `  ${validKey}  `);
    assert.equal(url, `https://${validDomain}/${validKey}`);
  });

  it("rejects non-string domain", () => {
    assert.throws(() => buildDeliveryUrl(null, validKey), TypeError);
    assert.throws(() => buildDeliveryUrl(123, validKey), TypeError);
  });

  it("rejects non-string key", () => {
    assert.throws(() => buildDeliveryUrl(validDomain, null), TypeError);
    assert.throws(() => buildDeliveryUrl(validDomain, undefined), TypeError);
  });

  it("rejects domain with protocol prefix", () => {
    assert.throws(() => buildDeliveryUrl(`https://${validDomain}`, validKey), /Invalid CloudFront domain/);
    assert.throws(() => buildDeliveryUrl(`http://${validDomain}`, validKey), /Invalid CloudFront domain/);
  });

  it("rejects domain with path or trailing slash", () => {
    assert.throws(() => buildDeliveryUrl(`${validDomain}/`, validKey), /Invalid CloudFront domain/);
    assert.throws(() => buildDeliveryUrl(`${validDomain}/final`, validKey), /Invalid CloudFront domain/);
  });

  it("rejects key that does not start with final/", () => {
    assert.throws(() => buildDeliveryUrl(validDomain, `raw/${validPhotoId}.jpg`), /Key must start with final\//);
    assert.throws(() => buildDeliveryUrl(validDomain, `${validPhotoId}.jpg`), /Key must start with final\//);
  });

  it("rejects duplicated final/ prefix", () => {
    assert.throws(() => buildDeliveryUrl(validDomain, `final/final/${validPhotoId}.jpg`), /Invalid key path/);
  });

  it("rejects key with path traversal", () => {
    assert.throws(() => buildDeliveryUrl(validDomain, `final/../${validPhotoId}.jpg`), /Invalid key path/);
  });

  it("rejects key with wrong extension", () => {
    assert.throws(() => buildDeliveryUrl(validDomain, `final/${validPhotoId}.png`), /Key must end with \.jpg extension/);
  });

  it("rejects key with invalid photoId", () => {
    assert.throws(() => buildDeliveryUrl(validDomain, "final/not-a-uuid.jpg"), /Key contains invalid photoId/);
    assert.throws(() => buildDeliveryUrl(validDomain, `final/${validPhotoId.toUpperCase()}.jpg`), /Key contains invalid photoId/);
  });
});
