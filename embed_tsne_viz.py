#!/usr/bin/env python3
"""
Embed text with sentence-transformers, run t-SNE (2D), export interactive Plotly HTML.

For large N, t-SNE is slow; use --max-rows to subsample or increase perplexity carefully.

High-quality local defaults (English):
  BAAI/bge-large-en-v1.5   — strong general-purpose dense embeddings (~1.3GB download)
  BAAI/bge-base-en-v1.5    — faster / smaller, still very good

Use --embeddings-out + --skip-tsne to compute vectors only (resume t-SNE / viz later).

Resume: if --checkpoint-path (or default next to --embeddings-out) exists, the run
continues after the last checkpointed row (same parquet row order and ids). Use
--no-resume to re-encode from scratch.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import torch
import plotly.express as px
from sklearn.manifold import TSNE
from sentence_transformers import SentenceTransformer
from tqdm.auto import tqdm


def build_text(row: pd.Series, max_chars: int) -> str:
    parts = []
    if row.get("title"):
        parts.append(str(row["title"]))
    parts.append(str(row.get("body") or ""))
    parts.append(f"[{row.get('type')}] r/{row.get('subreddit')}")
    s = "\n".join(parts).strip()
    if max_chars and len(s) > max_chars:
        s = s[: max_chars - 1] + "…"
    return s


def resolve_device(preferred: str) -> str:
    if preferred != "auto":
        return preferred
    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(line_buffering=True)
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(line_buffering=True)

    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--in",
        dest="inputs",
        type=Path,
        nargs="*",
        default=[],
        help="One or more Parquet shards (concatenated); default data/reddit_boston_housing.parquet",
    )
    ap.add_argument("--out-html", type=Path, default=Path("viz/tsne_boston_housing.html"))
    ap.add_argument("--model", default="sentence-transformers/all-MiniLM-L6-v2")
    ap.add_argument("--device", default="auto", help="auto | cpu | cuda | mps")
    ap.add_argument("--batch-size", type=int, default=32)
    ap.add_argument("--max-chars", type=int, default=8000, help="Cap input length (0 = no cap)")
    ap.add_argument(
        "--embeddings-out",
        type=Path,
        default=None,
        help="Write float32 embeddings + ids to this .npz (compressed)",
    )
    ap.add_argument(
        "--checkpoint-every",
        type=int,
        default=0,
        metavar="N",
        help="While encoding, save a partial .npz every N mini-batches (0 = off). Use with --checkpoint-path.",
    )
    ap.add_argument(
        "--checkpoint-path",
        type=Path,
        default=None,
        help="Partial embeddings path (default: <embeddings-out> with .checkpoint.npz)",
    )
    ap.add_argument(
        "--no-resume",
        action="store_true",
        help="Ignore existing checkpoint and encode all rows from scratch",
    )
    ap.add_argument("--skip-tsne", action="store_true", help="Only compute embeddings (no Plotly HTML)")
    ap.add_argument("--max-rows", type=int, default=0, help="0 = use all rows")
    ap.add_argument("--perplexity", type=float, default=30.0)
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    inputs = args.inputs or [Path("data/reddit_boston_housing.parquet")]
    dfs = [pd.read_parquet(p) for p in inputs]
    df = pd.concat(dfs, ignore_index=True)
    df = df.drop_duplicates(subset=["id"], keep="last")
    df["text"] = df.apply(lambda r: build_text(r, args.max_chars), axis=1)
    df["created_dt"] = pd.to_datetime(df["created_utc"], utc=True)
    df["year_month"] = df["created_dt"].dt.to_period("M").astype(str)

    if args.max_rows and len(df) > args.max_rows:
        df = df.sample(n=args.max_rows, random_state=args.seed).reset_index(drop=True)

    device = resolve_device(args.device)
    print(f"device={device} model={args.model} rows={len(df)}")
    model = SentenceTransformer(args.model, device=device)
    texts = df["text"].tolist()
    ids_arr = df["id"].astype(str).to_numpy()
    ts_arr = df["created_ts"].to_numpy(dtype=np.float64)
    ck_path = args.checkpoint_path
    if ck_path is None and args.embeddings_out is not None:
        ck_path = args.embeddings_out.with_suffix(".checkpoint.npz")

    def _save_checkpoint(full_emb: np.ndarray) -> None:
        if ck_path is None:
            return
        ck_path.parent.mkdir(parents=True, exist_ok=True)
        k = len(full_emb)
        np.savez_compressed(
            ck_path,
            ids=ids_arr[:k],
            embeddings=np.asarray(full_emb, dtype=np.float32),
            created_ts=ts_arr[:k],
            model=np.array(args.model),
            device=np.array(device),
            rows_done=np.array(k),
        )
        print(f"checkpoint rows={k} -> {ck_path.resolve()}", flush=True)

    start_row = 0
    base_emb: np.ndarray | None = None
    can_resume = (
        not args.no_resume
        and args.embeddings_out is not None
        and ck_path is not None
        and ck_path.is_file()
    )
    if can_resume:
        z = np.load(ck_path, allow_pickle=True)
        ck_ids = z["ids"]
        ck_ids = np.asarray(ck_ids, dtype=object) if ck_ids.dtype == object else ck_ids.astype(str)
        ck_ids = np.array([str(x) for x in ck_ids], dtype=str)
        ck_emb = np.asarray(z["embeddings"], dtype=np.float32)
        n_ck = len(ck_ids)
        if n_ck != len(ck_emb):
            raise SystemExit(f"checkpoint corrupt: len(ids)={n_ck} != len(embeddings)={len(ck_emb)}")
        if z.files and "model" in z:
            try:
                ck_m = np.asarray(z["model"]).item()
                if str(ck_m) != str(args.model):
                    print(
                        f"warning: checkpoint model {ck_m!r} != current {args.model!r}",
                        flush=True,
                    )
            except (ValueError, TypeError):
                pass
        if n_ck > len(df):
            raise SystemExit(
                f"checkpoint has {n_ck} rows but parquet only {len(df)}; use --no-resume or refresh parquet"
            )
        if not np.array_equal(ids_arr[:n_ck], ck_ids):
            raise SystemExit(
                "checkpoint ids do not match the first rows of the current parquet (order or content changed). "
                "Use --no-resume to re-encode, or restore the same parquet snapshot."
            )
        start_row = n_ck
        base_emb = ck_emb
        print(f"resume: loaded {n_ck} rows from checkpoint -> continue at row {start_row}/{len(texts)}", flush=True)

    n_batch = (len(texts) + args.batch_size - 1) // args.batch_size
    done_batches = start_row // args.batch_size
    remaining_batches = n_batch - done_batches

    if start_row >= len(texts):
        emb = base_emb if base_emb is not None else np.empty((0, 1), dtype=np.float32)
        print("checkpoint already covers all rows; skipping encode", flush=True)
    else:
        emb_new: list[np.ndarray] = []
        for bi, start in enumerate(
            tqdm(
                range(start_row, len(texts), args.batch_size),
                total=n_batch,
                initial=done_batches,
                desc="encode",
            )
        ):
            batch = texts[start : start + args.batch_size]
            chunk = model.encode(
                batch,
                batch_size=len(batch),
                show_progress_bar=False,
                convert_to_numpy=True,
                normalize_embeddings=True,
            )
            emb_new.append(chunk)
            global_batch_num = done_batches + bi + 1
            if args.checkpoint_every > 0 and ck_path is not None:
                if global_batch_num % args.checkpoint_every == 0:
                    tail = np.vstack(emb_new)
                    full = np.vstack([base_emb, tail]) if base_emb is not None else tail
                    _save_checkpoint(full)
        tail = np.vstack(emb_new)
        emb = np.vstack([base_emb, tail]) if base_emb is not None else tail

    if args.embeddings_out is not None:
        args.embeddings_out.parent.mkdir(parents=True, exist_ok=True)
        np.savez_compressed(
            args.embeddings_out,
            ids=df["id"].astype(str).to_numpy(),
            embeddings=np.asarray(emb, dtype=np.float32),
            created_ts=df["created_ts"].to_numpy(dtype=np.float64),
            model=np.array(args.model),
            device=np.array(device),
        )
        print(f"Wrote embeddings {emb.shape} -> {args.embeddings_out.resolve()}")

    if args.skip_tsne:
        return

    n = len(df)
    perplexity = min(args.perplexity, max(5, (n - 1) // 3))
    tsne = TSNE(
        n_components=2,
        perplexity=perplexity,
        learning_rate="auto",
        init="pca",
        random_state=args.seed,
    )
    xy = tsne.fit_transform(emb)
    df["tsne_x"] = xy[:, 0]
    df["tsne_y"] = xy[:, 1]

    # Short hover text
    df["hover"] = (
        df["type"].astype(str)
        + " | "
        + df["created_dt"].dt.strftime("%Y-%m-%d")
        + " | "
        + df["title"].fillna("").str.slice(0, 80)
    )

    fig = px.scatter(
        df,
        x="tsne_x",
        y="tsne_y",
        color="year_month",
        hover_name="hover",
        hover_data={
            "permalink": True,
            "score": True,
            "subreddit": True,
            "search_query": True,
            "tsne_x": False,
            "tsne_y": False,
        },
        title="Boston-area Reddit (housing / commute) — t-SNE of embeddings",
        labels={"year_month": "Month"},
    )
    fig.update_traces(marker=dict(size=6, opacity=0.75))
    fig.update_layout(legend_itemsizing="constant")

    # Time animation by month (discrete frames)
    dfa = df.sort_values("created_ts")
    xr = float(dfa["tsne_x"].abs().max()) * 1.1 + 1e-6
    yr = float(dfa["tsne_y"].abs().max()) * 1.1 + 1e-6
    fig_anim = px.scatter(
        dfa,
        x="tsne_x",
        y="tsne_y",
        animation_frame="year_month",
        color="subreddit",
        hover_name="hover",
        hover_data={"permalink": True, "score": True},
        title="Same embedding — points shown per month (global t-SNE layout)",
        range_x=[-xr, xr],
        range_y=[-yr, yr],
    )
    fig_anim.update_traces(marker=dict(size=6, opacity=0.8))
    fig_anim.update_xaxes(range=[-xr, xr], autorange=False)
    fig_anim.update_yaxes(range=[-yr, yr], autorange=False)

    args.out_html.parent.mkdir(parents=True, exist_ok=True)
    # Write multi-page HTML manually: plotly doesn't multi-export in one call easily
    static_path = args.out_html.with_name(args.out_html.stem + "_static.html")
    anim_path = args.out_html.with_name(args.out_html.stem + "_animated.html")
    fig.write_html(static_path, include_plotlyjs="cdn")
    fig_anim.write_html(anim_path, include_plotlyjs="cdn")
    print(f"Wrote {static_path} (color by month, use legend to filter)")
    print(f"Wrote {anim_path} (slider by month; positions are global t-SNE)")


if __name__ == "__main__":
    main()
