# Boston Housing Discourse — 3D topic sphere

Interactive 3D globe of ~422k Reddit posts and comments about Boston housing and
transit, embedded with BGE-large, projected to a sphere, and clustered into
50 topics / 194 subtopics.

## Launching the visualizer

The viewer is static HTML + ES modules. Any static file server works; it just
needs `http://` (browsers block ES modules over `file://`).

```bash
# from the repo root
./scripts/serve_viz.sh
# then open http://127.0.0.1:8765/
```

Or by hand:

```bash
cd viz
python3 -m http.server 8765
```

Plain `http.server` does **not** send `Cache-Control` on `.js` files. Browsers often reuse cached ES modules, so tour copy edits under `viz/js/tour/` used to stick until a hard reload. The app now adds a shared **`?v=YYYYMMDD`** query on the tour import chain (`viz/index.html` → `main.js` → `tour/index.js` → each beat file). **Bump that same version string in all those places** when you change tour beats and a normal reload still looks stale.

No build step. Three.js is loaded from a CDN via an import map in `index.html`.

## Repo layout

```
viz/                    the web app (commit-friendly, ~25 MB of JSON chunks)
  index.html            shell, nav overlay, globe canvas, detail card
  js/
    main.js             boots data → nav → globe and wires hover/click
    data.js             loads sphere_coords.bin, labels, centroids, palettes
    globe.js            Three.js globe: shader points, hover arcs, labels, picking
    nav.js              left-side stacked bars + Sankey ribbons (L1 → L2 → L3)
  tsne_chunks/          baked data the viewer fetches (see below)

scripts/                data pipeline (collect → embed → cluster → project)
  collect_reddit.py         pull posts/comments via PRAW
  ingest_reddit_dump.py     ingest archival zst/parquet dumps
  filter_parquet_by_keywords.py, apply_quality_filters.py
  embed_tsne_viz.py         BGE-large embeddings (checkpoint-aware)
  cluster_embeddings.py     KMeans-50 on embeddings
  compute_subclusters.py    per-cluster KMeans refinement
  compute_sphere_tsne3d.py  3D openTSNE (Barnes-Hut) + whiten + radial normalize
  lloyd_smooth_sphere.py    optional smoothing pass on the sphere
  compute_grid_samples.py   build sample grids for LLM labeling
  label_clusters.py         LLM-name clusters / subclusters
  bake_post_index.py        post-id → point-index map for hover arcs
  extract_point_labels.py   per-point (cluster, subcluster) → int bin
  chunk_tsne_payload.py     slice the full payload into ~20 MB JSON chunks
  serve_viz.sh              local static server for viz/
```

## Data files used by the viewer

All under `viz/tsne_chunks/`:

| file                              | shape / format                                          | used for                 |
|-----------------------------------|---------------------------------------------------------|--------------------------|
| `sphere_coords.bin`               | float32 interleaved `(lat, lon)` radians, N=422,114     | point positions          |
| `sphere_centroids.json`           | `{clusters: {id: {lat, lon, count}}, subclusters: …}`   | floating labels          |
| `sphere_manifest.json`            | `{n, format, method}`                                   | sanity check             |
| `point_labels.bin`                | 3 bytes/point: int16 cluster + uint8 subLocal           | colouring, picking       |
| `post_index.json`                 | `{postId: pointIdx}` for the ~38k parent posts          | hover thread arcs        |
| `manifest.json`                   | chunk file list + counts                                | chunk loader             |
| `chunk_00000.json` … `chunk_0002N.json` | per-point metadata (title, body, month, type, postId…) | hover / detail card      |
| `cluster_labels.json`, `subcluster_labels.json` | LLM-generated names                       | nav + labels             |
| `subcluster_assignments.json`     | per-point local subcluster id                           | pipeline / rebuild       |
| `positions.json`                  | merged LLM position labels per subcluster sample        | L3 ribbons               |
| `grid_cells_samples.json`, `grid_propositions.json`, `ngrams.json` | historical viewers (viewer2.html etc.) | experimental viewers |

The heavyweight source data (`data/reddit_boston_housing.parquet`, BGE
embeddings npz, dumps, logs) is **not** in git — see `.gitignore`. The viewer
does not need it; only the baked files under `viz/tsne_chunks/` are required.

## Controls

- **Drag** — rotate the globe.
- **Arrow keys** or the on-screen pad — rotate.
- **Mouse wheel** or `W` / `S` — zoom (adaptive speed).
- **Hover a point** — show card + 3D arcs to replies in the same thread.
- **Click a point** — open detail card with title, body, subreddit, month.
- **Click a cluster or subcluster bar** on the left — focus the globe on it.

## Regenerating the sphere projection

If you re-cluster or change embeddings, the sphere is rebuilt from scratch:

```bash
# 3D t-SNE → unit-sphere projection, writes sphere_coords.bin + centroids
python3 scripts/compute_sphere_tsne3d.py

# (optional) Lloyd smoothing on the sphere using k-NN in embedding space
python3 scripts/lloyd_smooth_sphere.py

# Re-bake the post → point-index map (~30 s)
python3 scripts/bake_post_index.py

# Re-extract per-point cluster/subcluster labels into point_labels.bin
python3 scripts/extract_point_labels.py
```

Each script prints its inputs and outputs at the top.

## Dependencies

- Python 3.10+ with `scripts/requirements.txt` (numpy, sklearn, openTSNE,
  sentence-transformers, pandas, pyarrow, praw, …).
- A Reddit API app in `.env` (see `.env.example`) — only needed for collection.
- No JS tooling; Three.js comes from unpkg via an import map.
