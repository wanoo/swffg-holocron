#!/usr/bin/env python3
"""Check i18n parity (fr/en), validate module.json, zip the module into dist/."""
import json, pathlib, sys, zipfile

ROOT = pathlib.Path(__file__).parent
errors = []

def flat(d, prefix=""):
    out = {}
    for k, v in d.items():
        key = f"{prefix}.{k}" if prefix else k
        if isinstance(v, dict): out.update(flat(v, key))
        else: out[key] = v
    return out

fr = flat(json.load(open(ROOT / "lang/fr.json")))
en = flat(json.load(open(ROOT / "lang/en.json")))
for k in fr.keys() - en.keys(): errors.append(f"clé FR sans EN : {k}")
for k in en.keys() - fr.keys(): errors.append(f"clé EN sans FR : {k}")
print(f"lang: fr={len(fr)} clés, en={len(en)} clés")

manifest = json.load(open(ROOT / "module.json"))
for req in ("id", "title", "version", "esmodules", "languages"):
    if req not in manifest: errors.append(f"module.json : champ manquant {req}")

if errors:
    print("ERREURS :"); [print("  -", e) for e in errors]; sys.exit(1)

if "--zip" in sys.argv:
    z = ROOT / f"dist/{manifest['id']}.zip"
    z.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(z, "w", zipfile.ZIP_DEFLATED) as zf:
        # exclus du zip de release : outils de build (jamais expédiés), sources de packs
        # (packs/_src_*), et le LOCK LevelDB (transitoire). On GARDE packs/<name>/ (LevelDB).
        SKIP_TOP = ("dist", ".git", "build.py", "node_modules", "package.json",
                    "package-lock.json", "build_pack.mjs", "gen_events.mjs", "gen_tables.mjs")
        for p in ROOT.rglob("*"):
            rel = p.relative_to(ROOT)
            if rel.parts[0] in SKIP_TOP or rel.name in (".DS_Store", "LOCK"): continue
            if len(rel.parts) >= 2 and rel.parts[0] == "packs" and rel.parts[1].startswith("_src"): continue
            if p.is_file(): zf.write(p, pathlib.Path(manifest["id"]) / rel)
    # manifeste à côté du zip (install par URL)
    json.dump(manifest, open(ROOT / "dist/module.json", "w"), ensure_ascii=False, indent=2)
    print(f"zip : {z} ({z.stat().st_size / 1024:.0f} Ko)")
