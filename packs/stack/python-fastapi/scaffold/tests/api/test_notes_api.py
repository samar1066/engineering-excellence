async def test_create_and_fetch_note(client):
    created = await client.post("/notes", json={"title": "first", "body": "hello"})
    assert created.status_code == 201
    note_id = created.json()["id"]

    fetched = await client.get(f"/notes/{note_id}")
    assert fetched.status_code == 200
    assert fetched.json()["title"] == "first"


async def test_missing_note_is_404(client):
    response = await client.get("/notes/does-not-exist")
    assert response.status_code == 404


async def test_blank_title_is_422(client):
    response = await client.post("/notes", json={"title": "   "})
    assert response.status_code == 422


async def test_list_notes(client):
    await client.post("/notes", json={"title": "a"})
    await client.post("/notes", json={"title": "b"})
    response = await client.get("/notes")
    assert {n["title"] for n in response.json()} == {"a", "b"}
