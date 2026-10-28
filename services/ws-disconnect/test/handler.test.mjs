import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { handler } from "../index.mjs";

const VALID_UUID = "a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d";
const VALID_UUID_2 = "b1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d";
const VALID_UUID_3 = "c1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d";

function makeEvent(connectionId) {
  return {
    requestContext: { connectionId },
  };
}

function makeDdbClient(queryItems = []) {
  const calls = [];
  return {
    calls,
    send: mock.fn(async (cmd) => {
      calls.push(cmd);
      if (cmd.constructor.name === "QueryCommand" || (cmd.input && cmd.input.IndexName)) {
        return { Items: queryItems, LastEvaluatedKey: undefined };
      }
      return {};
    }),
  };
}

function makePaginatedDdbClient(pages) {
  let queryCall = 0;
  const calls = [];
  return {
    calls,
    send: mock.fn(async (cmd) => {
      calls.push(cmd);
      if (cmd.input && cmd.input.IndexName) {
        const page = pages[queryCall] || { Items: [] };
        queryCall++;
        return page;
      }
      return {};
    }),
  };
}

describe("ws-disconnect", () => {
  beforeEach(() => {
    process.env.TABLE_NAME = "test-table";
    process.env.CONNECTION_INDEX_NAME = "connectionId-index";
  });

  it("removes connectionId from matching photo record", async () => {
    const ddb = makeDdbClient([{ photoId: VALID_UUID }]);
    const result = await handler(
      makeEvent("conn-1"),
      {},
      { ddbClient: ddb, sleepFn: async () => {} }
    );

    assert.equal(result.statusCode, 200);

    const updateCmd = ddb.calls.find(
      (c) => c.input && c.input.UpdateExpression
    );
    assert.ok(updateCmd);
    assert.ok(updateCmd.input.UpdateExpression.includes("REMOVE connectionId"));
    assert.equal(updateCmd.input.ExpressionAttributeValues[":cid"], "conn-1");
    assert.ok(updateCmd.input.ConditionExpression.includes("connectionId = :cid"));
  });

  it("handles no mapping found gracefully", async () => {
    const ddb = makeDdbClient([]);
    const result = await handler(
      makeEvent("conn-unknown"),
      {},
      { ddbClient: ddb, sleepFn: async () => {} }
    );
    assert.equal(result.statusCode, 200);
  });

  it("handles duplicate disconnect event", async () => {
    const ddb = makeDdbClient([{ photoId: VALID_UUID }]);
    ddb.send = mock.fn(async (cmd) => {
      ddb.calls.push(cmd);
      if (cmd.input && cmd.input.IndexName) {
        return { Items: [{ photoId: VALID_UUID }] };
      }
      const err = new Error("condition");
      err.name = "ConditionalCheckFailedException";
      throw err;
    });

    const result = await handler(
      makeEvent("conn-1"),
      {},
      { ddbClient: ddb, sleepFn: async () => {} }
    );
    assert.equal(result.statusCode, 200);
  });

  it("stale socket A does not remove reconnected socket B", async () => {
    const ddb = makeDdbClient([{ photoId: VALID_UUID }]);
    ddb.send = mock.fn(async (cmd) => {
      ddb.calls.push(cmd);
      if (cmd.input && cmd.input.IndexName) {
        return { Items: [{ photoId: VALID_UUID }] };
      }
      const err = new Error("condition");
      err.name = "ConditionalCheckFailedException";
      throw err;
    });

    const result = await handler(
      makeEvent("old-conn"),
      {},
      { ddbClient: ddb, sleepFn: async () => {} }
    );

    assert.equal(result.statusCode, 200);
    const updateCmd = ddb.calls.find((c) => c.input && c.input.UpdateExpression);
    assert.equal(updateCmd.input.ExpressionAttributeValues[":cid"], "old-conn");
  });

  it("handles pagination across GSI query", async () => {
    const ddb = makePaginatedDdbClient([
      {
        Items: [{ photoId: VALID_UUID_2 }],
        LastEvaluatedKey: { connectionId: "conn-1", photoId: VALID_UUID_2 },
      },
      {
        Items: [{ photoId: VALID_UUID_3 }],
      },
    ]);

    const result = await handler(
      makeEvent("conn-1"),
      {},
      { ddbClient: ddb, sleepFn: async () => {} }
    );

    assert.equal(result.statusCode, 200);
    const updateCmds = ddb.calls.filter((c) => c.input && c.input.UpdateExpression);
    assert.equal(updateCmds.length, 2);
  });

  it("returns 500 when TABLE_NAME is missing", async () => {
    delete process.env.TABLE_NAME;
    const ddb = makeDdbClient();
    const result = await handler(makeEvent("conn-1"), {}, { ddbClient: ddb });
    assert.equal(result.statusCode, 500);
  });

  it("returns 500 when CONNECTION_INDEX_NAME is missing", async () => {
    delete process.env.CONNECTION_INDEX_NAME;
    const ddb = makeDdbClient();
    const result = await handler(makeEvent("conn-1"), {}, { ddbClient: ddb });
    assert.equal(result.statusCode, 500);
  });

  it("returns 200 for missing connectionId in event", async () => {
    const ddb = makeDdbClient();
    const result = await handler(
      { requestContext: {} },
      {},
      { ddbClient: ddb }
    );
    assert.equal(result.statusCode, 200);
  });

  it("retries empty GSI lookup with bounded retries", async () => {
    let queryCount = 0;
    const ddb = {
      calls: [],
      send: mock.fn(async (cmd) => {
        ddb.calls.push(cmd);
        if (cmd.input && cmd.input.IndexName) {
          queryCount++;
          if (queryCount <= 3) {
            return { Items: [] };
          }
          return { Items: [{ photoId: VALID_UUID }] };
        }
        return {};
      }),
    };

    const result = await handler(
      makeEvent("conn-1"),
      {},
      { ddbClient: ddb, sleepFn: async () => {} }
    );

    assert.equal(result.statusCode, 200);
    assert.equal(queryCount, 4);
  });

  it("does not request consistent read from GSI", async () => {
    const ddb = makeDdbClient([{ photoId: VALID_UUID }]);
    await handler(
      makeEvent("conn-1"),
      {},
      { ddbClient: ddb, sleepFn: async () => {} }
    );
    const queryCmd = ddb.calls.find((c) => c.input && c.input.IndexName);
    assert.equal(queryCmd.input.ConsistentRead, undefined);
  });

  it("reports real DDB errors during cleanup", async () => {
    const ddb = {
      calls: [],
      send: mock.fn(async (cmd) => {
        ddb.calls.push(cmd);
        if (cmd.input && cmd.input.IndexName) {
          return { Items: [{ photoId: VALID_UUID }] };
        }
        const err = new Error("throttle");
        err.name = "ProvisionedThroughputExceededException";
        throw err;
      }),
    };

    const result = await handler(
      makeEvent("conn-1"),
      {},
      { ddbClient: ddb, sleepFn: async () => {} }
    );
    assert.equal(result.statusCode, 500);
  });

  it("preserves photo record status and data (only removes connectionId)", async () => {
    const ddb = makeDdbClient([{ photoId: VALID_UUID }]);
    await handler(
      makeEvent("conn-1"),
      {},
      { ddbClient: ddb, sleepFn: async () => {} }
    );
    const updateCmd = ddb.calls.find((c) => c.input && c.input.UpdateExpression);
    assert.equal(updateCmd.input.UpdateExpression, "REMOVE connectionId");
    assert.ok(!updateCmd.input.UpdateExpression.includes("status"));
    assert.ok(!updateCmd.input.UpdateExpression.includes("DELETE"));
  });
});
