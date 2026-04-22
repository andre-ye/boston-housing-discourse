#!/usr/bin/env python3
"""
Audit script: spot-check position assignments by sampling 30 random points.
For each sample, display the cluster/sub, assigned position, and post content.
"""

import json
import random
import struct
import os

# File paths
WORKING_DIR = "/Users/andreye/courses/vis/final-proj reddit"
POINT_LABELS_BIN = os.path.join(WORKING_DIR, "viz/tsne_chunks/point_labels.bin")
POSITION_ASSIGNMENTS_BIN = os.path.join(WORKING_DIR, "viz/tsne_chunks/position_assignments.bin")
POSITIONS_JSON = os.path.join(WORKING_DIR, "viz/tsne_chunks/positions.json")
DATA_DIR = os.path.join(WORKING_DIR, "data")

# Read positions.json
with open(POSITIONS_JSON, 'r') as f:
    positions_data = json.load(f)

by_gid = positions_data['by_gid']

# Read binary files
with open(POINT_LABELS_BIN, 'rb') as f:
    point_labels_data = f.read()

with open(POSITION_ASSIGNMENTS_BIN, 'rb') as f:
    position_assignments_data = f.read()

# Parse point labels: 3 bytes per point (cl: int16, sub: uint8)
num_points = len(point_labels_data) // 3
print(f"Total points: {num_points}")
print(f"Total assignments: {len(position_assignments_data)}")
assert len(position_assignments_data) == num_points, "Mismatch in number of points"
print()

# Helper to get cluster posts
cluster_posts_cache = {}

def get_post(cl, sub, post_idx):
    """Get post from cluster_<cl>_posts.json by sub index and post index within sub."""
    if cl not in cluster_posts_cache:
        posts_file = os.path.join(DATA_DIR, f"cluster_{cl}_posts.json")
        if not os.path.exists(posts_file):
            return None
        with open(posts_file, 'r') as f:
            cluster_posts_cache[cl] = json.load(f)

    cluster = cluster_posts_cache[cl]
    if 'subs' in cluster and sub < len(cluster['subs']):
        sub_data = cluster['subs'][sub]
        if 'posts' in sub_data and post_idx < len(sub_data['posts']):
            return sub_data['posts'][post_idx]
    return None


# Sample 30 random points
sample_size = 30
sample_indices = random.sample(range(num_points), min(sample_size, num_points))
sample_indices.sort()

print(f"{'#':<3} {'gid':<4} {'cl':<4} {'sub':<3} {'pos':<3} | {'position name':<35} | {'description':<60} | {'post title':<50}")
print("-" * 220)

for idx, point_idx in enumerate(sample_indices, 1):
    # Parse point labels
    offset = point_idx * 3
    cl = struct.unpack('<h', point_labels_data[offset:offset+2])[0]  # signed int16
    sub = point_labels_data[offset+2]  # uint8

    # Get assignment
    assignment_idx = position_assignments_data[point_idx]

    # Get position info
    gid = str(cl)
    if gid not in by_gid:
        pos_name = "? (no gid)"
        description = ""
    else:
        gid_data = by_gid[gid]
        positions_list = gid_data.get('positions', [])

        if assignment_idx == 255:
            pos_name = "[UNASSIGNED]"
            description = ""
        elif assignment_idx < len(positions_list):
            pos_info = positions_list[assignment_idx]
            pos_name = pos_info.get('name', '?')
            description = pos_info.get('description', '')[:58]
        else:
            pos_name = f"? (idx {assignment_idx})"
            description = ""

    # Try to get a post for context
    post_title = ""
    try:
        post = get_post(cl, sub, 0)  # Get first post from this (cl, sub)
        if post:
            post_title = (post.get('t', '')[:48]).replace('\n', ' ')
    except:
        pass

    print(f"{idx:<3} {gid:<4} {cl:<4} {sub:<3} {assignment_idx:<3} | {pos_name:<35} | {description:<60} | {post_title:<50}")

print()
print(f"Total sampled: {len(sample_indices)}")
