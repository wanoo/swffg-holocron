# POC P0 — capacités du connecteur MCP (2026-07-10) → à intégrer dans docs/ARCHITECTURE.md

Résultats mesurés sur le gateway live (foundry-mcp-gateway, monde star-wars, Foundry v13/ffg 2.0.3) :

| Question | Résultat |
|---|---|
| `get_journals {where:{_id}}` | ✓ OK (5.9 s à froid, 1.3 Ko) |
| `requested_fields` sans pages | ✓ index de 39 journaux en **9.7 Ko** (clés _id/name/folder/sort/ownership/flags) — base de `journalsIndex` |
| `get_pack_documents` | requiert `type` + `pack` ; supporte `query` (objet Foundry), **`requested_fields`** et **`max_length`** (patchs fork déjà en place) |
| Pagination packs | ✓ **`query: {_id__in: [ids]}`** fonctionne (0.1 s à chaud) → index léger puis chunks de 50 ids. **AUCUN nouveau patch fork requis** |
| `upload_file` .zip | ✗ refusé (whitelist extensions) ; **.json accepté** → archive zéro-perte = fichiers .json individuels |
| `modify_document` combiné | ✓ flags + page imbriquée (`pages:[{_id, "text.content"}]`) en **1 seul appel** → écriture éditeur = 1 appel MCP |
| Latence | ~5-6 s par appel à froid (rebuild cache monde), **0.1-0.2 s à chaud** → SyncStore + cache disque indispensables au boot, confortable ensuite |
| Auth `/join` | GET /join → cookie session ; POST `{action:"join", userid, password}` → **200 `JOIN.LoginSuccess`** (bon mdp) / **401 `JOIN.ErrorInvalidPassword`** (mauvais). Testé avec l'user bot DÉJÀ connecté via le gateway : sa session n'est **pas perturbée** (gateway répond toujours). → flux de login Holocron validé |

Notes :
- `get_world` expose `world`, `activeUsers`, `paused`, `release`… (liste des packs à chercher dans `world.packs` — à confirmer en P3).
- Le fork stranjer local (~/stranjer-foundry-mcp, branche clever-basepath) contient déjà keep_id, get_pack_documents(+requested_fields/max_length), base-path.
