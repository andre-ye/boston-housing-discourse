#!/usr/bin/env python3
"""
Extract per-point cluster + subcluster labels as compact binary for the globe viewer.
Reads data/clusters_k50.npz and viz/tsne_chunks/subcluster_assignments.json.
Writes viz/tsne_chunks/point_labels.bin (int16 cluster, int8 local_sub, per point).
"""
import json
from pathlib import Path
import numpy as np

repo = Path(__file__).resolve().parents[1]
cl_npz = repo / "data" / "clusters_k50.npz"
sub_json = repo / "viz" / "tsne_chunks" / "subcluster_assignments.json"
out_bin = repo / "viz" / "tsne_chunks" / "point_labels.bin"

cl = np.load(cl_npz)
labels = None
for k in ("labels", "cluster", "clusters", "y"):
    if k in cl.files:
        labels = cl[k]; break
if labels is None:
    labels = cl[cl.files[0]]
labels = np.asarray(labels, dtype=np.int16)

sub = np.asarray(json.loads(sub_json.read_text())["data"], dtype=np.uint8)  # 255 = unassigned
assert labels.shape[0] == sub.shape[0], (labels.shape, sub.shape)
N = labels.shape[0]

# Layout: for each point, int16 cluster + int8 sub (little-endian).
# Use structured dtype of 3 bytes per point.
out = np.empty(N * 3, dtype=np.uint8)
lv = labels.astype(np.int16).view(np.uint8).reshape(-1, 2)
out.reshape(N, 3)[:, 0:2] = lv
out.reshape(N, 3)[:, 2] = sub
out_bin.write_bytes(out.tobytes())
print(f"wrote {out_bin} ({out_bin.stat().st_size/1e6:.2f} MB), N={N}")
