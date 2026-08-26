#!/usr/bin/env python3
"""Benchmark one NVIDIA model at a time for War Minister JSON task."""

from __future__ import annotations

import json
import os
import re
import sys
import threading
import time
import warnings
from pathlib import Path

warnings.filterwarnings("ignore", category=Warning, module="requests")

import requests
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env", override=True)

INVOKE_URL = "https://integrate.api.nvidia.com/v1/chat/completions"

MODELS = [
    ("Nemotron-3-Ultra-550B", "nvidia/nemotron-3-ultra-550b-a55b", 600),
    ("DeepSeek-V4-Flash-0731", "deepseek-ai/deepseek-v4-flash-0731", 180, ["deepseek-ai/deepseek-v4-flash"]),
    ("MiniMax-M3", "minimaxai/minimax-m3", 180),
    ("Nemotron-3.5-Lightning-30B", "nvidia/nemotron-3.5-lightning-30b-a3b", 120),
    ("Laguna-XS-2.1", "poolside/laguna-xs-2.1", 120),
    ("Step-3.7-Flash", "stepfun-ai/step-3.7-flash", 120),
    ("Muse-Glimmer-30B", "meta/muse-glimmer-30b", 180),
    ("Llama-3.1-8B (baseline)", "meta/llama-3.1-8b-instruct", 60),
]

ALASKA_OWN = {
    17011799, 17012003, 17012427, 17012595, 17013599, 17013782,
    17013929, 17014153, 17014386, 17014576, 17015165, 17015452,
}


def compact_brief(pic: dict) -> str:
    lines = [
        f"WAR PICTURE game={pic.get('gameId')} me={pic.get('myNation')} day={pic.get('day')}",
    ]
    wars = pic.get("atWar") or []
    lines.append(
        "WARS live: "
        + ", ".join(f"{w.get('nation')}#{w.get('id')}" for w in wars[:6])
    )
    for z in pic.get("zones") or []:
        if z.get("nation") == "Russian Alaska" or z.get("playerId") == 150:
            lines.append(
                f"HIGH {z.get('nation')}: prov={','.join(z.get('provinces') or [])} "
                f"own[{','.join(str(x) for x in z.get('ownArmyIds') or [])}] "
                f"hostile[{','.join(str(x) for x in (z.get('hostileArmyIds') or [])[:6])}] "
                f"| {z.get('note')}"
            )
    own = pic.get("ownArmies") or []
    alaska_ids: set[int] = set()
    for z in pic.get("zones") or []:
        if z.get("playerId") == 150:
            alaska_ids.update(z.get("ownArmyIds") or [])
    lines.append("OWN (Alaska front):")
    for a in own:
        if a.get("id") in alaska_ids:
            units = ",".join(
                f"{u.get('size','?')}x{u.get('name','?')}" for u in (a.get("units") or [])
            ) or "?"
            pos = a.get("pos") or {}
            lines.append(
                f"  army {a.get('id')} @ {a.get('province')} "
                f"({pos.get('x','?')},{pos.get('y','?')}) [{units}]"
            )
    foreign = pic.get("foreignArmies") or []
    lines.append("HOSTILE (near Alaska):")
    for a in foreign:
        if a.get("ownerId") == 150 or "alaska" in str(a.get("nation", "")).lower():
            pos = a.get("pos") or {}
            lines.append(
                f"  army {a.get('id')} {a.get('nation')} @ {a.get('province')} "
                f"({pos.get('x','?')},{pos.get('y','?')})"
            )
    return "\n".join(lines)[:4500]


def load_fixture() -> tuple[str, str]:
    war_md = (ROOT / "src/cabinet/prompts/war.md").read_text(encoding="utf-8")
    pic = json.loads((ROOT / "data/cabinet/war-picture.json").read_text(encoding="utf-8"))
    brief = compact_brief(pic)
    tool_hint = (
        "CRITICAL: Output ONLY a single JSON object. No thinking, no markdown, no prose before/after.\n"
        'Required shape:\n'
        '{"facts":["..."],"concerns":["..."],"proposals":[{"type":"moveArmy","args":{"armyId":17011799,"x":0,"y":0},"risk":"medium","rationale":"..."}],'
        '"need_from":[],"draft_message":null,"public_line":"Threat board... Intent... Orders... Risk... Ask /approve"}\n'
        "Use real armyId and x,y from the war picture. public_line must cite army ids and provinces.\n"
        "Keep concise: max 4 proposals, public_line under 400 chars, no chain-of-thought."
    )
    system = f"{war_md}\n\n{tool_hint}"
    user = (
        "Standing goals:\n- focus: Russian Alaska\n- no-invade: Russian Alaska\n- hold: Alaska-border\n\n"
        "Standing war orders:\n- FOCUS Russian Alaska - prioritize this front\n"
        "- NO INVADE Russian Alaska - do not push deeper\n- HOLD Alaska-border - thin screen only\n\n"
        "Player question:\n@War Russian Alaska ONLY (ignore paper wars). List our troops + Russian stacks. "
        "INTENT=hold/disengage - retreat MOST, thin screen on border. moveArmy with real ids. Proposals for /approve.\n\n"
        f"Live war picture (authoritative):\n{brief}\n\nRespond with JSON only."
    )
    return system, user


def call_model(
    api_key: str,
    model: str,
    system: str,
    user: str,
    max_tokens: int,
    timeout_s: int,
) -> tuple[str, float, str | None]:
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    payload: dict = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "max_tokens": max_tokens,
        "temperature": 0.2,
        "top_p": 0.95,
        "stream": False,
        "response_format": {"type": "json_object"},
    }
    if "nemotron" in model.lower():
        payload["chat_template_kwargs"] = {"enable_thinking": False}
    done = threading.Event()
    t0 = time.perf_counter()

    def heartbeat() -> None:
        while not done.wait(10):
            elapsed = int(time.perf_counter() - t0)
            print(f"  ... still waiting ({elapsed}s)", flush=True)

    hb = threading.Thread(target=heartbeat, daemon=True)
    hb.start()
    try:
        resp = requests.post(INVOKE_URL, headers=headers, json=payload, timeout=timeout_s)
        elapsed = time.perf_counter() - t0
        if resp.status_code != 200:
            return "", elapsed, f"HTTP {resp.status_code}: {resp.text[:240]}"
        data = resp.json()
        content = (data.get("choices") or [{}])[0].get("message", {}).get("content") or ""
        usage = data.get("usage") or {}
        print(
            f"  tokens: prompt={usage.get('prompt_tokens','?')} "
            f"completion={usage.get('completion_tokens','?')}",
            flush=True,
        )
        return content.strip(), elapsed, None
    except requests.Timeout:
        return "", time.perf_counter() - t0, f"timeout after {timeout_s}s"
    except Exception as e:
        return "", time.perf_counter() - t0, str(e)
    finally:
        done.set()


def score(label: str, slug: str, raw: str, elapsed: float, err: str | None) -> dict:
    r = {
        "label": label,
        "slug": slug,
        "latency_s": round(elapsed, 2),
        "json_ok": False,
        "schema_ok": False,
        "alaska": False,
        "intent": False,
        "army_ids": 0,
        "valid_moves": 0,
        "public_len": 0,
        "score": 0,
        "error": err,
        "preview": "",
    }
    if err:
        return r

    try:
        parsed = json.loads(raw)
        r["json_ok"] = True
    except json.JSONDecodeError:
        r["error"] = "invalid JSON"
        r["preview"] = raw[:160].replace("\n", " ")
        return r

    pub = parsed.get("public_line") or ""
    if not isinstance(pub, str):
        pub = str(pub) if pub is not None else ""
    r["public_len"] = len(pub)
    r["preview"] = pub[:200].replace("\n", " ")

    required = ["facts", "concerns", "proposals", "need_from", "public_line"]
    missing = [k for k in required if k not in parsed]
    if missing:
        r["error"] = f"missing fields: {', '.join(missing)}"
        return r

    r["schema_ok"] = True
    blob = json.dumps(parsed)
    r["alaska"] = bool(re.search(r"russian alaska|new arkhangelsk|prince george|iskut", pub, re.I))
    r["intent"] = bool(re.search(r"hold|disengage|screen|retreat", pub, re.I))
    r["army_ids"] = sum(1 for aid in ALASKA_OWN if str(aid) in blob)
    for p in parsed.get("proposals") or []:
        if p.get("type") == "moveArmy":
            args = p.get("args") or {}
            aid = args.get("armyId")
            if aid in ALASKA_OWN and isinstance(args.get("x"), (int, float)) and isinstance(args.get("y"), (int, float)):
                r["valid_moves"] += 1

    r["score"] = (
        40
        + (15 if r["alaska"] else 0)
        + (10 if r["intent"] else 0)
        + min(r["army_ids"], 5) * 4
        + r["valid_moves"] * 8
        + (10 if r["public_len"] >= 120 else 5 if r["public_len"] >= 60 else 0)
        - min(elapsed, 30)
    )
    return r


def safe_print(text: str) -> None:
    enc = getattr(sys.stdout, "encoding", None) or "utf-8"
    print(text.encode(enc, errors="replace").decode(enc))


def print_models() -> None:
    print("Models (run one at a time):")
    for i, entry in enumerate(MODELS):
        label, slug, timeout = entry[0], entry[1], entry[2]
        print(f"  [{i}] {label}")
        print(f"      slug: {slug}  timeout: {timeout}s")


def run_one(entry: tuple) -> dict:
    label, slug, timeout = entry[0], entry[1], entry[2]
    alts = entry[3] if len(entry) > 3 else []
    api_key = os.environ.get("NVIDIA_API_KEY", "").strip()
    if not api_key:
        raise SystemExit("NVIDIA_API_KEY missing in .env")
    max_tokens = min(int(os.environ.get("NVIDIA_MAX_TOKENS", "2048")), 2048)
    system, user = load_fixture()

    print(f"\n=== [{label}] ===")
    print(f"slug: {slug}")
    print(f"fixture chars: {len(user)}  max_tokens: {max_tokens}  timeout: {timeout}s")
    print("calling NVIDIA API...", flush=True)

    slugs = [slug] + list(alts)
    raw, elapsed, err = "", 0.0, "no response"
    used = slug
    for s in slugs:
        if s != slug:
            print(f"retry slug: {s}", flush=True)
        raw, elapsed, err = call_model(api_key, s, system, user, max_tokens, timeout)
        used = s
        if not err:
            break

    r = score(label, used, raw, elapsed, err)
    print(f"\nRESULT: {'PASS' if r['schema_ok'] else 'FAIL'} in {r['latency_s']}s  score={r['score']:.0f}")
    if r["error"]:
        print(f"error: {r['error']}")
    if r["schema_ok"]:
        print(f"alaska={r['alaska']} intent={r['intent']} army_ids={r['army_ids']} valid_moves={r['valid_moves']}")
        print(f"public_line ({r['public_len']} chars):")
        safe_print(r["preview"])
    elif raw:
        print(f"raw preview: {raw[:300]}")
    return r


def main() -> None:
    if len(sys.argv) > 1 and sys.argv[1] in ("list", "--list", "-l"):
        print_models()
        return

    if len(sys.argv) < 2:
        print_models()
        print("\nUsage: py -3 scripts/benchmark_nvidia_models.py <index|slug>")
        print("Example: py -3 scripts/benchmark_nvidia_models.py 3")
        raise SystemExit(1)

    arg = sys.argv[1]
    if arg.isdigit():
        idx = int(arg)
        if idx < 0 or idx >= len(MODELS):
            raise SystemExit(f"index {idx} out of range 0..{len(MODELS)-1}")
        entry = MODELS[idx]
    else:
        matches = [m for m in MODELS if m[1] == arg or (len(m) > 3 and arg in m[3])]
        if not matches:
            raise SystemExit(f"unknown slug: {arg}")
        entry = matches[0]

    run_one(entry)


if __name__ == "__main__":
    main()
