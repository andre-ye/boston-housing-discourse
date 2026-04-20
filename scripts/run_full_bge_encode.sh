#!/usr/bin/env bash
# Full BGE encode of data/reddit_boston_housing.parquet (all rows, normalized vectors).
# After it finishes, run clustering + t-SNE + viewer (see comments at bottom).

set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
export PYTHONUNBUFFERED=1

OUT="${OUT:-data/embeddings_bge_large_en_v1_5.npz}"
CK="${CK:-data/embeddings_bge_large_en_v1_5.checkpoint.npz}"
LOG="${LOG:-logs/embed_bge_full.log}"

mkdir -p logs data
# Stale checkpoints break resume when parquet row order/ids change
if [[ -f "$CK" ]]; then
  echo "Removing checkpoint so encode matches current parquet: $CK"
  rm -f "$CK"
fi

echo "Logging to $LOG — tail -f $LOG"
nohup .venv/bin/python embed_tsne_viz.py \
  --in data/reddit_boston_housing.parquet \
  --model BAAI/bge-large-en-v1.5 \
  --device auto \
  --batch-size 16 \
  --embeddings-out "$OUT" \
  --checkpoint-every 50 \
  --skip-tsne \
  --no-resume \
  >>"$LOG" 2>&1 &
echo $! >logs/embed_bge_full.pid
echo "Started embed PID $(cat logs/embed_bge_full.pid)"

# --- After encode completes ---
# 1) Clusters in embedding space (not t-SNE):
#    .venv/bin/python cluster_embeddings.py --npz "$OUT" --out data/clusters_k50.npz --k 50 --pca-dims 64
# 2) Full-corpus t-SNE + split viewer (long run; OpenTSNE):
#    .venv/bin/python build_interactive_tsne_viewer.py \
#      --parquet data/reddit_boston_housing.parquet \
#      --npz "$OUT" \
#      --tsne-max-points 0 \
#      --tsne-backend opentsne \
#      --tsne-pca-dims 50 \
#      --payload-mode external \
#      --out viz/tsne_full_split.html
