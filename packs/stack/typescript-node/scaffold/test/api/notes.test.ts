import { describe, expect, it } from "vitest";
import { useApp } from "../helpers/app.js";

const app = useApp();

describe("notes API", () => {
  it("creates a note and reads it back", async () => {
    const created = await app().inject({
      method: "POST",
      url: "/notes",
      payload: { title: "first", body: "hello" },
    });
    expect(created.statusCode).toBe(201);

    const fetched = await app().inject({ method: "GET", url: `/notes/${created.json().id}` });

    expect(fetched.statusCode).toBe(200);
    expect(fetched.json()).toMatchObject({ title: "first", body: "hello" });
  });

  it("answers 404 for a note that does not exist", async () => {
    const response = await app().inject({ method: "GET", url: "/notes/does-not-exist" });

    expect(response.statusCode).toBe(404);
  });

  it("answers 422 when the title is only whitespace", async () => {
    const response = await app().inject({
      method: "POST",
      url: "/notes",
      payload: { title: "   " },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().detail).toMatch(/title must not be blank/);
  });

  it("answers 422 when the request body is missing a title", async () => {
    const response = await app().inject({ method: "POST", url: "/notes", payload: {} });

    expect(response.statusCode).toBe(422);
  });

  it("lists the notes it holds", async () => {
    await app().inject({ method: "POST", url: "/notes", payload: { title: "a" } });
    await app().inject({ method: "POST", url: "/notes", payload: { title: "b" } });

    const response = await app().inject({ method: "GET", url: "/notes" });

    expect(response.statusCode).toBe(200);
    const titles = response.json().map((note: { title: string }) => note.title);
    expect(titles.sort()).toEqual(["a", "b"]);
  });
});
