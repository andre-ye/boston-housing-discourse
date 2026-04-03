#!/usr/bin/env bash
# Resume forward + reverse Reddit pipelines and BGE embedding (same args as before).
# Run from project root: chmod +x resume_all_jobs.sh && ./resume_all_jobs.sh

set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
export PYTHONUNBUFFERED=1

TORRENT_URL="${TORRENT_URL:-https://academictorrents.com/download/3d426c47c767d40f82c7ef0f47c3acacedd2bf44.torrent}"
REVERSE_WORKERS="${REVERSE_WORKERS:-8}"
TS="$(date +%Y%m%d_%H%M%S)"
RUN_F="$ROOT/logs/pipeline_runs/${TS}_forward_skip"
RUN_R="$ROOT/logs/pipeline_runs/${TS}_reverse_skip"
mkdir -p "$RUN_F" "$RUN_R"

echo "Forward log: $RUN_F/main.log"
nohup "$ROOT/.venv/bin/python" "$ROOT/pipeline_months.py" \
  --start 2020-01 --end 2025-12 --workers 3 --rate-limit 20M --flush-matches 250000 \
  --torrent "$TORRENT_URL" \
  --log-dir "$RUN_F" --no-console --skip-completed \
  >>"$RUN_F/nohup.out" 2>&1 &
echo $! >"$RUN_F/pipeline_launch.pid"
echo "Forward PID $(cat "$RUN_F/pipeline_launch.pid")"

echo "Reverse log: $RUN_R/main.log (REVERSE_WORKERS=$REVERSE_WORKERS)"
nohup "$ROOT/.venv/bin/python" "$ROOT/pipeline_months.py" \
  --start 2005-01 --end 2019-12 --workers "$REVERSE_WORKERS" --rate-limit 20M --flush-matches 250000 \
  --torrent "$TORRENT_URL" \
  --log-dir "$RUN_R" --no-console --reverse --skip-completed \
  >>"$RUN_R/nohup.out" 2>&1 &
echo $! >"$RUN_R/pipeline_launch.pid"
echo "Reverse PID $(cat "$RUN_R/pipeline_launch.pid")"

mkdir -p "$ROOT/logs"
nohup "$ROOT/.venv/bin/python" "$ROOT/embed_tsne_viz.py" \
  --in "$ROOT/data/reddit_boston_housing.parquet" \
  --model BAAI/bge-large-en-v1.5 \
  --batch-size 16 \
  --embeddings-out "$ROOT/data/embeddings_bge_large_en_v1_5.npz" \
  --checkpoint-every 50 \
  --skip-tsne \
  >>"$ROOT/logs/embed_bge_large.log" 2>&1 &
echo $! >"$ROOT/logs/embed_bge_large.pid"
echo "Embed PID $(cat "$ROOT/logs/embed_bge_large.pid") — tail -f logs/embed_bge_large.log"
