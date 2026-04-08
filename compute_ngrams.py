#!/usr/bin/env python3
"""
Build an n-gram frequency index (1–5 grams, top 1000 each) from
the parquet dataset. Outputs viz/tsne_chunks/ngrams.json.
"""

import json, re
from collections import Counter
from pathlib import Path

DATA_DIR   = Path(__file__).parent / "data"
PARQUET    = DATA_DIR / "reddit_boston_housing.parquet"
CHUNKS_DIR = Path(__file__).parent / "viz" / "tsne_chunks"
OUT_FILE   = CHUNKS_DIR / "ngrams.json"
TOP_N      = 1000
MAX_GRAM   = 5

# ── tokenise ──────────────────────────────────────────────────────────────────
_tok = re.compile(r"[a-z']+")

def tokenize(text: str) -> list[str]:
    if not text:
        return []
    return _tok.findall(text.lower())

STOPWORDS = {
    "a","an","the","and","or","but","in","on","at","to","for","of","with",
    "is","it","its","was","are","be","been","being","have","has","had",
    "do","does","did","will","would","could","should","may","might","shall",
    "not","no","nor","so","yet","both","either","neither","just","than",
    "that","this","these","those","then","they","them","their","there",
    "we","our","you","your","he","she","his","her","i","me","my","us",
    "what","which","who","whom","when","where","why","how","all","each",
    "more","most","other","some","such","only","own","same","as","if",
    "from","by","about","into","through","during","before","after","above",
    "below","between","out","up","down","off","over","under","again",
    "s","t","re","ve","ll","d","m","don","didn","doesn","isn","wasn",
    "aren","weren","won","can","nt",
}

def meaningful(tok: str) -> bool:
    return len(tok) >= 2 and tok not in STOPWORDS

def ngrams_from_tokens(tokens: list[str], n: int):
    for i in range(len(tokens) - n + 1):
        gram = tokens[i:i+n]
        if n == 1:
            if meaningful(gram[0]):
                yield gram[0]
        else:
            # require at least the last word to be meaningful
            if any(meaningful(g) for g in gram):
                yield " ".join(gram)

# ── accumulate ─────────────────────────────────────────────────────────────────
import pandas as pd

counters = [Counter() for _ in range(MAX_GRAM)]  # index 0 = unigrams

print(f"Loading {PARQUET} …")
df = pd.read_parquet(PARQUET, columns=["title", "body"])
total = len(df)
print(f"  {total:,} rows loaded")

title_arr = df["title"].fillna("").values
body_arr  = df["body"].fillna("").values

for i in range(total):
    tokens = tokenize(title_arr[i]) + tokenize(body_arr[i])
    for n in range(1, MAX_GRAM + 1):
        counters[n-1].update(ngrams_from_tokens(tokens, n))
    if (i + 1) % 50_000 == 0:
        print(f"  {i+1:,}/{total:,} rows", end="\r", flush=True)
print(f"  {total:,}/{total:,} rows done")

print("Selecting top n-grams…")
result = {}
for n in range(1, MAX_GRAM + 1):
    top = [gram for gram, _ in counters[n-1].most_common(TOP_N)]
    result[str(n)] = top
    print(f"  {n}-grams: {len(top)} entries (top: {top[:5]})")

with open(OUT_FILE, "w") as f:
    json.dump(result, f, separators=(",", ":"))

print(f"Written → {OUT_FILE}  ({OUT_FILE.stat().st_size // 1024} KB)")
