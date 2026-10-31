# Backend tests

```bash
cd backend
pip install -r requirements-dev.txt
pytest -v
```

The suite uses a temporary data/upload directory and a fake embedding model, so it
needs no network and never touches `backend/data/`. It covers:

* `test_units.py` – pure logic (option parsing, answer mapping, key-cache, validators)
* `test_api.py` – upload, ownership, auth, chat, history isolation, rate-limit shape
* `test_progression.py` – equipment/reward exploits and **forced-collision race tests**
  (threads released at the same instant) for coins, quests, potions, caps, achievements
