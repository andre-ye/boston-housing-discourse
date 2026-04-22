#!/usr/bin/env python3
"""Build viz/tsne_chunks/topic_descriptions.json from cluster/subcluster names.

Short LLM-style blurbs (template-based) for the viewer; re-run after renaming
topics in cluster_labels / subcluster_labels.
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VIZ = ROOT / "viz" / "tsne_chunks"

TOPIC_TEMPLATES = [
    'Posts and comments labeled “{name}” group similar language about Boston-area housing, neighborhoods, and transit.',
    'This topic (“{name}”) clusters Reddit discussion where users share experiences, debate policy, or ask for local advice.',
    '“{name}” captures one strand of Greater Boston housing and mobility discourse found across the ingested subreddits.',
]

SUB_TEMPLATES = [
    'Subtopic “{sub}” (under “{topic}”) refines the broader theme with more specific recurring wording in the data.',
    'Within “{topic}”, “{sub}” highlights a narrower slice of conversation—still drawn from the same embedding neighborhood.',
]


def main() -> None:
    clusters_raw = json.loads((VIZ / "cluster_labels.json").read_text())
    subs_raw = json.loads((VIZ / "subcluster_labels.json").read_text())
    emb = clusters_raw.get("embedding", clusters_raw)

    topics: dict[str, str] = {}
    for k, meta in emb.items():
        name = meta.get("name") or f"Topic {k}"
        tid = int(k)
        topics[str(tid)] = TOPIC_TEMPLATES[tid % len(TOPIC_TEMPLATES)].format(name=name)

    subtopics: dict[str, str] = {}
    for cl_str, arr in subs_raw.items():
        cl = int(cl_str)
        topic_name = emb.get(str(cl), {}).get("name") or f"Topic {cl}"
        for i, row in enumerate(arr):
            sub_name = row.get("name") or f"Subtopic {row.get('sub', i)}"
            sub_id = row.get("sub", i)
            key = f"{cl}_{sub_id}"
            subtopics[key] = SUB_TEMPLATES[(cl + sub_id) % len(SUB_TEMPLATES)].format(
                sub=sub_name, topic=topic_name
            )

    out = {"topics": topics, "subtopics": subtopics}
    dest = VIZ / "topic_descriptions.json"
    dest.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n")
    print(f"Wrote {dest} ({len(topics)} topics, {len(subtopics)} subtopics)")


if __name__ == "__main__":
    main()
