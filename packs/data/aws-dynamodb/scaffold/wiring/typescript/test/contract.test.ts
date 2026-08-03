import {
  CreateTableCommand,
  DeleteTableCommand,
  DynamoDBClient,
  waitUntilTableExists,
} from "@aws-sdk/client-dynamodb";
import { DeleteCommand, DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createNote } from "../src/domain/note.js";
import type { NoteRepository } from "../src/domain/note-repository.js";
import { DynamoNoteRepository } from "../src/infrastructure/dynamo-note-repository.js";
import { MemoryNoteRepository } from "../src/infrastructure/memory-note-repository.js";

/**
 * The one contract every note repository owes the interface. It is defined once and run against
 * each implementation below, so a store is substitutable only when its own column of this suite is
 * green. This is the TypeScript half of the EEP-ARCH-02 proof; the Python half mirrors it exactly.
 */
function contractSuite(makeRepo: () => Promise<NoteRepository>): void {
  it("stores a note and reads it back by id", async () => {
    const repo = await makeRepo();
    const note = createNote({ id: "n1", title: "first", body: "hello" });
    const added = await repo.add(note);
    expect(added).toEqual(note);
    expect(await repo.get("n1")).toEqual(note);
  });

  it("returns null for an id that was never added", async () => {
    const repo = await makeRepo();
    expect(await repo.get("missing")).toBeNull();
  });

  it("lists every note that was added", async () => {
    const repo = await makeRepo();
    await repo.add(createNote({ id: "a", title: "alpha" }));
    await repo.add(createNote({ id: "b", title: "beta" }));
    const ids = (await repo.listAll()).map((note) => note.id).sort();
    expect(ids).toEqual(["a", "b"]);
  });

  it("trims a title before it is stored", async () => {
    const repo = await makeRepo();
    await repo.add(createNote({ id: "t", title: "  spaced  " }));
    expect((await repo.get("t"))?.title).toBe("spaced");
  });
}

describe("MemoryNoteRepository (the in memory reference)", () => {
  contractSuite(() => Promise.resolve(new MemoryNoteRepository()));
});

const endpoint = process.env.DYNAMODB_ENDPOINT_URL;
const region = process.env.AWS_DEFAULT_REGION ?? "us-east-1";
const tableName = process.env.NOTES_TABLE_NAME ?? "notes-contract";

describe("DynamoNoteRepository (against DynamoDB Local)", () => {
  // Skipping the store the interface actually ships is the antipattern EEP-ARCH-02 names, so the
  // suite refuses to pass silently: with no local endpoint it fails with an instruction rather than
  // reporting a green run that proved only the reference.
  if (endpoint === undefined || endpoint === "") {
    it("requires DynamoDB Local", () => {
      throw new Error(
        "DYNAMODB_ENDPOINT_URL is not set; run scripts/contract-suite.sh to start DynamoDB Local",
      );
    });
    return;
  }

  const client = new DynamoDBClient({
    endpoint,
    region,
    credentials: { accessKeyId: "local", secretAccessKey: "local" },
  });
  const doc = DynamoDBDocumentClient.from(client);

  beforeAll(async () => {
    await client.send(
      new CreateTableCommand({
        TableName: tableName,
        AttributeDefinitions: [{ AttributeName: "id", AttributeType: "S" }],
        KeySchema: [{ AttributeName: "id", KeyType: "HASH" }],
        BillingMode: "PAY_PER_REQUEST",
      }),
    );
    await waitUntilTableExists({ client, maxWaitTime: 30 }, { TableName: tableName });
  });

  afterAll(async () => {
    await client.send(new DeleteTableCommand({ TableName: tableName }));
    client.destroy();
  });

  beforeEach(async () => {
    const scan = await doc.send(new ScanCommand({ TableName: tableName }));
    for (const item of scan.Items ?? []) {
      await doc.send(new DeleteCommand({ TableName: tableName, Key: { id: item.id } }));
    }
  });

  contractSuite(() => Promise.resolve(new DynamoNoteRepository({ tableName, endpoint, region })));
});
