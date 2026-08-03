import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { type Note, noteSchema } from "../domain/note.js";
import type { NoteRepository } from "../domain/note-repository.js";

/**
 * The DynamoDB adapter for the note repository interface. This file drops into the typescript-node
 * backend's src/infrastructure/ unchanged: it imports the same entity and interface from ../domain,
 * so replacing MemoryNoteRepository with it in the composition root is the whole substitution.
 *
 * The table name is read from the environment by default, and the endpoint is overridable, so the
 * one adapter serves both a real regional table and a DynamoDB Local container with no code change.
 * Every item read back is validated into an entity through noteSchema, so a malformed row fails
 * loudly at this boundary rather than silently inside a workflow.
 */
export interface DynamoNoteRepositoryConfig {
  readonly tableName?: string;
  readonly endpoint?: string;
  readonly region?: string;
}

export class DynamoNoteRepository implements NoteRepository {
  readonly #doc: DynamoDBDocumentClient;
  readonly #tableName: string;

  constructor(config: DynamoNoteRepositoryConfig = {}) {
    const tableName = config.tableName ?? process.env.NOTES_TABLE_NAME;
    if (tableName === undefined || tableName === "") {
      throw new Error("NOTES_TABLE_NAME is not set and no tableName was provided");
    }
    this.#tableName = tableName;

    const endpoint = config.endpoint ?? process.env.DYNAMODB_ENDPOINT_URL;
    const region = config.region ?? process.env.AWS_DEFAULT_REGION;
    const client = new DynamoDBClient({
      ...(endpoint !== undefined && endpoint !== "" ? { endpoint } : {}),
      ...(region !== undefined && region !== "" ? { region } : {}),
    });
    this.#doc = DynamoDBDocumentClient.from(client);
  }

  async add(note: Note): Promise<Note> {
    const stored = noteSchema.parse(note);
    await this.#doc.send(
      new PutCommand({
        TableName: this.#tableName,
        Item: {
          id: stored.id,
          title: stored.title,
          body: stored.body,
          createdAt: stored.createdAt.toISOString(),
        },
      }),
    );
    return stored;
  }

  async get(id: string): Promise<Note | null> {
    const result = await this.#doc.send(
      new GetCommand({ TableName: this.#tableName, Key: { id } }),
    );
    return result.Item === undefined ? null : this.#toNote(result.Item);
  }

  async listAll(): Promise<Note[]> {
    const result = await this.#doc.send(new ScanCommand({ TableName: this.#tableName }));
    return (result.Items ?? []).map((item) => this.#toNote(item));
  }

  #toNote(item: Record<string, unknown>): Note {
    return noteSchema.parse({
      id: item.id,
      title: item.title,
      body: item.body,
      createdAt: new Date(String(item.createdAt)),
    });
  }
}
