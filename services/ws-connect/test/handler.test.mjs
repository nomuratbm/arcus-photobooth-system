import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { handler } from "../index.mjs";

const VALID_UUID = "a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d";

function makeEvent(photoId, connectionId, multiValue) {
  return {
    requestContext: { connectionId },
    queryStringParameters: photoId !== undefined ? { photoId } : null,
    multiValueQueryStringParameters: multiValue !== undefined ? multiValue : null,
  };
}

function makeDdbClient() {
  const calls = [];
  return {
    calls,
    send: mock.fn(async (cmd) => {
      calls.push(cmd);
      return {};
    }),
  };
}

function makeDdbClientThatThrows(errorName) {
  return {
    calls: [],
    send: mock.fn(async () => {
      const err = new Error("mocked");
      err.name = errorName;
      throw err;
    }),
  };
}

describe("ws-connect", () => {
  beforeEach(() => {
    process.env.TABLE_NAME = "test-table";
  });

  it("saves a new photo with status connected and one-hour TTL", async () => {
    const ddb = makeDdbClient();
    const fixedTime = 1700000000000;
    const result = await handler(
      makeEvent(VALID_UUID, "conn-1"),
      {},
      { ddbClient: ddb, now: () => fixedTime }
    );

    assert.equal(result.statusCode, 200);
    assert.equal(ddb.calls.length, 1);

    const input = ddb.calls[0].input;
    assert.equal(input.TableName, "test-table");
    assert.deepStrictEqual(input.Key, { photoId: VALID_UUID });
    assert.equal(input.ExpressionAttributeValues[":cid"], "conn-1");
    assert.equal(input.ExpressionAttributeValues[":ttl"], Math.floor(fixedTime / 1000) + 3600);
    assert.equal(input.ExpressionAttributeValues[":initial_status"], "connected");
    assert.ok(input.UpdateExpression.includes("if_not_exists"));
  });

  it("rejects missing photoId", async () => {
    const ddb = makeDdbClient();
    const result = await handler(
      makeEvent(undefined, "conn-1"),
      {},
      { ddbClient: ddb }
    );
    assert.equal(result.statusCode, 400);
    assert.equal(ddb.calls.length, 0);
  });

  it("rejects empty photoId", async () => {
    const ddb = makeDdbClient();
    const result = await handler(
      makeEvent("", "conn-1"),
      {},
      { ddbClient: ddb }
    );
    assert.equal(result.statusCode, 400);
    assert.equal(ddb.calls.length, 0);
  });

  it("rejects non-UUID photoId", async () => {
    const ddb = makeDdbClient();
    const result = await handler(
      makeEvent("not-a-uuid", "conn-1"),
      {},
      { ddbClient: ddb }
    );
    assert.equal(result.statusCode, 400);
    assert.equal(ddb.calls.length, 0);
  });

  it("rejects non-v4 UUID (version 1 or 7)", async () => {
    const ddb = makeDdbClient();
    const result = await handler(
      makeEvent("a1b2c3d4-e5f6-7890-abcd-ef1234567890", "conn-1"),
      {},
      { ddbClient: ddb }
    );
    assert.equal(result.statusCode, 400);
    assert.equal(ddb.calls.length, 0);
  });

  it("rejects all-zero photoId", async () => {
    const ddb = makeDdbClient();
    const result = await handler(
      makeEvent("00000000-0000-0000-0000-000000000000", "conn-1"),
      {},
      { ddbClient: ddb }
    );
    assert.equal(result.statusCode, 400);
    assert.equal(ddb.calls.length, 0);
  });

  it("rejects photoId with path traversal", async () => {
    const ddb = makeDdbClient();
    const result = await handler(
      makeEvent("../../../etc/passwd", "conn-1"),
      {},
      { ddbClient: ddb }
    );
    assert.equal(result.statusCode, 400);
    assert.equal(ddb.calls.length, 0);
  });

  it("rejects missing connectionId", async () => {
    const ddb = makeDdbClient();
    const result = await handler(
      { requestContext: {}, queryStringParameters: { photoId: VALID_UUID } },
      {},
      { ddbClient: ddb }
    );
    assert.equal(result.statusCode, 400);
    assert.equal(ddb.calls.length, 0);
  });

  it("returns 500 when TABLE_NAME is not set", async () => {
    delete process.env.TABLE_NAME;
    const ddb = makeDdbClient();
    const result = await handler(
      makeEvent(VALID_UUID, "conn-1"),
      {},
      { ddbClient: ddb }
    );
    assert.equal(result.statusCode, 500);
    assert.equal(ddb.calls.length, 0);
  });

  it("returns 409 when ConditionalCheckFailedException (expired record)", async () => {
    const ddb = makeDdbClientThatThrows("ConditionalCheckFailedException");
    const result = await handler(
      makeEvent(VALID_UUID, "conn-1"),
      {},
      { ddbClient: ddb }
    );
    assert.equal(result.statusCode, 409);
  });

  it("propagates real DynamoDB errors", async () => {
    const ddb = makeDdbClientThatThrows("InternalServerError");
    await assert.rejects(
      () =>
        handler(
          makeEvent(VALID_UUID, "conn-1"),
          {},
          { ddbClient: ddb }
        ),
      (err) => err.name === "InternalServerError"
    );
  });

  it("preserves existing status on reconnect via if_not_exists", async () => {
    const ddb = makeDdbClient();
    await handler(
      makeEvent(VALID_UUID, "conn-2"),
      {},
      { ddbClient: ddb, now: () => 1700000000000 }
    );

    const expr = ddb.calls[0].input.UpdateExpression;
    assert.ok(expr.includes("if_not_exists(#st, :initial_status)"));
  });

  it("computes TTL as epoch seconds, not milliseconds", async () => {
    const ddb = makeDdbClient();
    const fixedTime = 1700000000000;
    await handler(
      makeEvent(VALID_UUID, "conn-1"),
      {},
      { ddbClient: ddb, now: () => fixedTime }
    );

    const ttlVal = ddb.calls[0].input.ExpressionAttributeValues[":ttl"];
    assert.equal(ttlVal, 1700000000 + 3600);
    assert.ok(ttlVal < 2000000000);
  });

  it("rejects photoId with uppercase characters", async () => {
    const ddb = makeDdbClient();
    const result = await handler(
      makeEvent(VALID_UUID.toUpperCase(), "conn-1"),
      {},
      { ddbClient: ddb }
    );
    assert.equal(result.statusCode, 400);
    assert.equal(ddb.calls.length, 0);
  });

  it("accepts consistent matching scalar and multiValue parameters", async () => {
    const ddb = makeDdbClient();
    const result = await handler(
      makeEvent(VALID_UUID, "conn-1", { photoId: [VALID_UUID] }),
      {},
      { ddbClient: ddb }
    );
    assert.equal(result.statusCode, 200);
    assert.equal(ddb.calls.length, 1);
  });

  it("rejects scalar photoId with duplicate multiValueQueryStringParameters", async () => {
    const ddb = makeDdbClient();
    const otherId = "b1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d";
    const result = await handler(
      makeEvent(VALID_UUID, "conn-1", { photoId: [VALID_UUID, otherId] }),
      {},
      { ddbClient: ddb }
    );
    assert.equal(result.statusCode, 400);
    assert.equal(ddb.calls.length, 0);
  });

  it("rejects scalar photoId with identical duplicate multiValueQueryStringParameters", async () => {
    const ddb = makeDdbClient();
    const result = await handler(
      makeEvent(VALID_UUID, "conn-1", { photoId: [VALID_UUID, VALID_UUID] }),
      {},
      { ddbClient: ddb }
    );
    assert.equal(result.statusCode, 400);
    assert.equal(ddb.calls.length, 0);
  });

  it("rejects inconsistent scalar and multiValue photoId values", async () => {
    const ddb = makeDdbClient();
    const otherId = "b1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d";
    const result = await handler(
      makeEvent(VALID_UUID, "conn-1", { photoId: [otherId] }),
      {},
      { ddbClient: ddb }
    );
    assert.equal(result.statusCode, 400);
    assert.equal(ddb.calls.length, 0);
  });

  it("rejects malformed multiValueQueryStringParameters (not array or empty)", async () => {
    const ddb = makeDdbClient();
    const res1 = await handler(
      makeEvent(VALID_UUID, "conn-1", { photoId: "not-an-array" }),
      {},
      { ddbClient: ddb }
    );
    assert.equal(res1.statusCode, 400);
    assert.equal(ddb.calls.length, 0);

    const res2 = await handler(
      makeEvent(VALID_UUID, "conn-1", { photoId: [] }),
      {},
      { ddbClient: ddb }
    );
    assert.equal(res2.statusCode, 400);
    assert.equal(ddb.calls.length, 0);
  });
});
