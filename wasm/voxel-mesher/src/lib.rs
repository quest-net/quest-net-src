// Quest-Net voxel terrain mesher (WASM).
//
// This is the SINGLE source of truth for gameplay terrain meshing. It began as a
// port of a JS mesher (`buildVoxelTerrainBuffers` in
// src/components/Map/Terrain/geometry/VoxelTerrainGeometryUtils.ts), which was
// removed once this landed -- that TS file now only declares the shared buffer
// types and assembles the THREE.BufferGeometry on the main thread. There is no
// JS meshing fallback. Vertex emission ORDER is irrelevant (the geometry is
// indexed and order-independent), but the occupancy/fog volumes are grid-indexed
// and consumed by the AO shader, so their byte layout is load-bearing.
// See docs/wasm-voxel-meshing-plan.md.
//
// ABI: construct a `VoxelMesher` once (constant material + RGB tables), then
// call `build(...)` per terrain. `build` returns a `MeshBuild` whose `take_*`
// getters move each buffer out as a fresh JS typed array (wasm-bindgen copies
// it out of linear memory -> transferable).
//
// The greedy mesher is SPARSE: the voxel grid is typically <5% full, so rather
// than scan the whole volume 6x we group the occupied cells by face-slice and
// visit only those. See `build` pass 2 for details.

use wasm_bindgen::prelude::*;

mod svo;

// ---------------------------------------------------------------------------
// Per-face geometry definitions (mirror VOXEL_FACE_DEFINITIONS).
// neighborOffset is intentionally omitted -- the TS builder derives the
// neighbour delta from normalSign * stride, not from the table.
//
// Order is paired by axis: [+X, -X, +Y, -Y, +Z, -Z]. The sparse mesher relies
// on FACES[axis*2 + dir] giving the two opposite faces of `axis`.
// ---------------------------------------------------------------------------
struct Face {
    normal: [f32; 3],
    corners: [[f32; 3]; 4],
}

const FACES: [Face; 6] = [
    // +X
    Face {
        normal: [1.0, 0.0, 0.0],
        corners: [
            [0.5, -0.5, -0.5],
            [0.5, 0.5, -0.5],
            [0.5, 0.5, 0.5],
            [0.5, -0.5, 0.5],
        ],
    },
    // -X
    Face {
        normal: [-1.0, 0.0, 0.0],
        corners: [
            [-0.5, -0.5, 0.5],
            [-0.5, 0.5, 0.5],
            [-0.5, 0.5, -0.5],
            [-0.5, -0.5, -0.5],
        ],
    },
    // +Y
    Face {
        normal: [0.0, 1.0, 0.0],
        corners: [
            [-0.5, 0.5, 0.5],
            [0.5, 0.5, 0.5],
            [0.5, 0.5, -0.5],
            [-0.5, 0.5, -0.5],
        ],
    },
    // -Y
    Face {
        normal: [0.0, -1.0, 0.0],
        corners: [
            [-0.5, -0.5, -0.5],
            [0.5, -0.5, -0.5],
            [0.5, -0.5, 0.5],
            [-0.5, -0.5, 0.5],
        ],
    },
    // +Z
    Face {
        normal: [0.0, 0.0, 1.0],
        corners: [
            [-0.5, -0.5, 0.5],
            [0.5, -0.5, 0.5],
            [0.5, 0.5, 0.5],
            [-0.5, 0.5, 0.5],
        ],
    },
    // -Z
    Face {
        normal: [0.0, 0.0, -1.0],
        corners: [
            [0.5, -0.5, -0.5],
            [-0.5, -0.5, -0.5],
            [-0.5, 0.5, -0.5],
            [0.5, 0.5, -0.5],
        ],
    },
];

// ---------------------------------------------------------------------------
// Per-bucket growable accumulator. Vec growth replaces the TS hand-rolled
// ensureBucketCapacity/grow* helpers. `colors`/`surface_deform` are present
// only when the bucket's material uses them (decided at first-touch, matching
// createBucketState -- within a bucket every palette index shares these flags).
// ---------------------------------------------------------------------------
struct Bucket {
    bucket_id: u32,
    positions: Vec<f32>,
    normals: Vec<f32>,
    colors: Option<Vec<f32>>,
    surface_deform: Option<Vec<f32>>,
    tile_heights: Vec<f32>,
    highlights: Vec<f32>,
    indices: Vec<u32>,
}

impl Bucket {
    fn new(
        bucket_id: u32,
        uses_vertex_colors: bool,
        uses_surface_deform: bool,
        init_verts: usize,
    ) -> Bucket {
        let init_indices = init_verts / 4 * 6;
        Bucket {
            bucket_id,
            positions: Vec::with_capacity(init_verts * 3),
            normals: Vec::with_capacity(init_verts * 3),
            colors: if uses_vertex_colors {
                Some(Vec::with_capacity(init_verts * 3))
            } else {
                None
            },
            surface_deform: if uses_surface_deform {
                Some(Vec::with_capacity(init_verts))
            } else {
                None
            },
            tile_heights: Vec::with_capacity(init_verts),
            highlights: Vec::with_capacity(init_verts),
            indices: Vec::with_capacity(init_indices),
        }
    }

    #[inline]
    fn vertex_count(&self) -> u32 {
        self.tile_heights.len() as u32
    }
}

// ---------------------------------------------------------------------------
// Result object handed to JS. One Bucket per distinct interned bucket id, plus
// the occupancy byte volume and an optional fog byte volume. The `take_*`
// getters move buffers out (one copy into a fresh JS typed array).
// ---------------------------------------------------------------------------
#[wasm_bindgen]
pub struct MeshBuild {
    buckets: Vec<Bucket>,
    occupancy: Vec<u8>,
    fog: Option<Vec<u8>>,
    // Occupancy/fog grid dimensions. These equal the voxel dims when occ_factor
    // is 1, and are the coarsened (downsampled) dims otherwise. JS reads them
    // back to size the Data3DTexture rather than re-deriving the factor.
    occ_width: usize,
    occ_height: usize,
    occ_length: usize,
    voxel_count: u32,
}

#[wasm_bindgen]
impl MeshBuild {
    pub fn bucket_count(&self) -> usize {
        self.buckets.len()
    }

    /// Interned bucket id (maps to bucketKeyById JS-side).
    pub fn bucket_id(&self, i: usize) -> u32 {
        self.buckets[i].bucket_id
    }

    pub fn voxel_count(&self) -> u32 {
        self.voxel_count
    }

    /// Occupancy/fog grid dimensions (= voxel dims when not downsampled). The
    /// occupancy and fog volumes share these dims.
    pub fn occupancy_width(&self) -> u32 {
        self.occ_width as u32
    }
    pub fn occupancy_height(&self) -> u32 {
        self.occ_height as u32
    }
    pub fn occupancy_length(&self) -> u32 {
        self.occ_length as u32
    }

    pub fn take_positions(&mut self, i: usize) -> Vec<f32> {
        std::mem::take(&mut self.buckets[i].positions)
    }
    pub fn take_normals(&mut self, i: usize) -> Vec<f32> {
        std::mem::take(&mut self.buckets[i].normals)
    }
    pub fn take_colors(&mut self, i: usize) -> Option<Vec<f32>> {
        self.buckets[i].colors.take()
    }
    pub fn take_surface_deform(&mut self, i: usize) -> Option<Vec<f32>> {
        self.buckets[i].surface_deform.take()
    }
    pub fn take_tile_heights(&mut self, i: usize) -> Vec<f32> {
        std::mem::take(&mut self.buckets[i].tile_heights)
    }
    pub fn take_highlights(&mut self, i: usize) -> Vec<f32> {
        std::mem::take(&mut self.buckets[i].highlights)
    }
    pub fn take_indices(&mut self, i: usize) -> Vec<u32> {
        std::mem::take(&mut self.buckets[i].indices)
    }
    pub fn take_occupancy(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.occupancy)
    }
    pub fn take_fog(&mut self) -> Option<Vec<u8>> {
        self.fog.take()
    }
}

// ---------------------------------------------------------------------------
// The mesher. Constructed once with the constant per-palette-index tables
// (mirrors MATERIAL_LOOKUP) and the precomputed 256-entry RGB table (built
// JS-side via THREE.Color so color management matches bit-for-bit).
// ---------------------------------------------------------------------------
#[wasm_bindgen]
pub struct VoxelMesher {
    bucket_id: Vec<i32>,       // palette index -> interned bucket id
    occlusion_id: Vec<i32>,    // palette index -> interned occlusion group
    uses_vertex_colors: Vec<u8>,
    deforms_surface: Vec<u8>,
    preserves_faces: Vec<u8>,
    is_volumetric: Vec<u8>,
    rgb: Vec<f32>,             // 256 * 3, row-major (r,g,b per index)
    bucket_capacity: usize,    // max interned bucket id + 1
}

#[wasm_bindgen]
impl VoxelMesher {
    #[wasm_bindgen(constructor)]
    pub fn new(
        bucket_id: &[i32],
        occlusion_id: &[i32],
        uses_vertex_colors: &[u8],
        deforms_surface: &[u8],
        preserves_faces: &[u8],
        is_volumetric: &[u8],
        rgb: &[f32],
    ) -> VoxelMesher {
        console_error_panic_hook::set_once();
        let bucket_capacity = bucket_id.iter().copied().max().unwrap_or(-1) as usize + 1;
        VoxelMesher {
            bucket_id: bucket_id.to_vec(),
            occlusion_id: occlusion_id.to_vec(),
            uses_vertex_colors: uses_vertex_colors.to_vec(),
            deforms_surface: deforms_surface.to_vec(),
            preserves_faces: preserves_faces.to_vec(),
            is_volumetric: is_volumetric.to_vec(),
            rgb: rgb.to_vec(),
            bucket_capacity,
        }
    }

    /// Build geometry. `positions[i]` packed as x + y*256 + z*65536; `colors[i]`
    /// is the palette index. width/height/length are TACTICAL units; voxel dims
    /// = tactical * resolution.
    pub fn build(
        &self,
        positions: &[u32],
        colors: &[u8],
        width: u32,
        height: u32,
        length: u32,
        resolution: u32,
        occ_factor: u32,
    ) -> MeshBuild {
        let voxel_width = (width * resolution) as usize;
        let voxel_height = (height * resolution) as usize;
        let voxel_length = (length * resolution) as usize;
        let voxel_layer_size = voxel_width * voxel_length;
        // Occupancy/fog volumes can be coarser than the mesh: they only feed the
        // low-frequency AO + fog samplers. occ_factor == 1 reproduces the
        // full-resolution volume byte-for-byte (the regression anchor); larger
        // power-of-two factors coarsen by ceil-divide to bound texture memory.
        let occ_factor = occ_factor.max(1) as usize;
        let occ_width = (voxel_width + occ_factor - 1) / occ_factor;
        let occ_height = (voxel_height + occ_factor - 1) / occ_factor;
        let occ_length = (voxel_length + occ_factor - 1) / occ_factor;
        // Position math is done in f64 then stored as f32 to match the JS
        // reference exactly (JS does double-precision arithmetic then rounds on
        // the Float32Array store; doing it in f32 here would double-round).
        let res_f = resolution as f64;
        let width_half = width as f64 / 2.0;
        let length_half = length as f64 / 2.0;

        // --- Pass 1: dense color grid + occupancy + (lazy) fog volume ---------
        // color grid layout:   x + z*voxel_width + y*voxel_layer_size  (value = palette+1)
        // occupancy/fog layout: oz*occ_width*occ_height + oy*occ_width + ox
        //   where (ox,oy,oz) = (vx,vy,vz) / occ_factor.
        let mut grid: Vec<u16> = vec![0; voxel_layer_size * voxel_height];
        let occ_len = occ_width * occ_height * occ_length;
        let mut occupancy: Vec<u8> = vec![0; occ_len];
        let mut fog: Option<Vec<u8>> = None;
        let mut voxel_count: u32 = 0;
        // Unique, in-bounds occupied cells (packed x | y<<8 | z<<16, same as the
        // input positions). The sparse mesher iterates these instead of scanning
        // the whole grid volume 6x. Collected here so duplicates (last-write-wins
        // in the grid) and out-of-bounds entries are excluded exactly once.
        let mut occupied: Vec<u32> = Vec::with_capacity(positions.len());

        let entry_count = positions.len();
        for i in 0..entry_count {
            let pos = positions[i];
            let vx = (pos & 0xff) as usize;
            let vy = ((pos >> 8) & 0xff) as usize;
            let vz = ((pos >> 16) & 0xff) as usize;
            if vx >= voxel_width || vy >= voxel_height || vz >= voxel_length {
                continue;
            }
            let color_idx = colors[i] as usize;
            let grid_index = vx + vz * voxel_width + vy * voxel_layer_size;
            if grid[grid_index] == 0 {
                voxel_count += 1;
                occupied.push(pos);
            }
            grid[grid_index] = (color_idx as u16) + 1;

            // Scatter into the (possibly coarsened) occupancy/fog grid. Writing
            // the constant 255 makes "any solid voxel in the cell" fall out for
            // free -- exactly the OR semantics AO wants so thin occluders survive.
            let cell_index = (vz / occ_factor) * occ_width * occ_height
                + (vy / occ_factor) * occ_width
                + (vx / occ_factor);
            if self.is_volumetric[color_idx] == 1 {
                let fog_vol = fog.get_or_insert_with(|| vec![0; occ_len]);
                fog_vol[cell_index] = 255;
            } else {
                occupancy[cell_index] = 255;
            }
        }

        // --- Pass 2: greedy mesh, SPARSE over occupied voxels -----------------
        // The grid is typically <5% full, so scanning the whole volume 6x wastes
        // most visits on empty cells. Instead we group the occupied cells by
        // face-slice (per axis -- the two opposite faces of an axis share the
        // grouping) and visit only those. Within each slice the cells are sorted
        // by mask index `mi = u + v*u_dim`, i.e. ascending (v, u) -- the exact
        // order the dense scan used -- so the greedy merge produces identical
        // quads and stays byte-compatible with the TS reference.
        let mut buckets: Vec<Option<Bucket>> = (0..self.bucket_capacity).map(|_| None).collect();
        // Initial per-bucket capacity (mirrors the TS initialVertices clamp):
        // big enough to avoid early reallocations, capped so small buckets don't
        // over-allocate. The default bucket still grows past this on demand.
        let init_verts = (voxel_count as usize * 4).clamp(256, 65536);

        let voxel_dims = [voxel_width, voxel_height, voxel_length];
        let max_mask_size = (voxel_height * voxel_length)
            .max(voxel_width * voxel_length)
            .max(voxel_width * voxel_height);
        let mut mask_stamp: Vec<i32> = vec![0; max_mask_size];
        let mut mask_color: Vec<u8> = vec![0; max_mask_size];
        let mut mask_tile: Vec<u32> = vec![0; max_mask_size];
        let mut mask_deform: Vec<u8> = vec![0; max_mask_size];
        let mut stamp_counter: i32 = 0;

        // Grouping buffers, rebuilt per axis (reused allocations).
        let mut counts: Vec<u32> = Vec::new();
        let mut offsets: Vec<usize> = Vec::new();
        let mut cursor: Vec<usize> = Vec::new();
        // One entry per occupied cell: (mi << 32) | gi, grouped by slice then
        // sorted by mi within each slice.
        let mut entries: Vec<u64> = vec![0; occupied.len()];

        for axis in 0..3usize {
            let u_axis = if axis == 0 { 1 } else { 0 };
            let v_axis = if axis == 2 { 1 } else { 2 };
            let u_dim = voxel_dims[u_axis];
            let v_dim = voxel_dims[v_axis];
            let dim_normal = voxel_dims[axis];
            // The "above" voxel (+1 in Y) is always +voxel_layer_size in grid
            // index; the neighbour along the normal is +/- this stride.
            let normal_stride: usize = if axis == 0 {
                1
            } else if axis == 1 {
                voxel_layer_size
            } else {
                voxel_width
            };

            // --- Group occupied cells by slice (counting sort on slice index) -
            counts.clear();
            counts.resize(dim_normal, 0);
            for &p in &occupied {
                let coord = ((p >> (8 * axis as u32)) & 0xff) as usize;
                counts[coord] += 1;
            }
            offsets.clear();
            offsets.push(0);
            let mut acc = 0usize;
            for c in 0..dim_normal {
                acc += counts[c] as usize;
                offsets.push(acc);
            }
            cursor.clear();
            cursor.extend_from_slice(&offsets[..dim_normal]);
            for &p in &occupied {
                let x = (p & 0xff) as usize;
                let y = ((p >> 8) & 0xff) as usize;
                let z = ((p >> 16) & 0xff) as usize;
                let (c, u, v) = match axis {
                    0 => (x, y, z),
                    1 => (y, x, z),
                    _ => (z, x, y),
                };
                let mi = u + v * u_dim;
                let gi = x + z * voxel_width + y * voxel_layer_size;
                let slot = cursor[c];
                entries[slot] = ((mi as u64) << 32) | (gi as u64);
                cursor[c] += 1;
            }
            // Sort each slice's cells by mi (ascending => ascending (v, u)).
            for c in 0..dim_normal {
                let lo = offsets[c];
                let hi = offsets[c + 1];
                if hi - lo > 1 {
                    entries[lo..hi].sort_unstable();
                }
            }

            // --- Both opposite faces of this axis reuse the grouping ----------
            for dir in 0..2usize {
                let face = &FACES[axis * 2 + dir];
                let normal_sign = face.normal[axis]; // +1.0 (dir 0) or -1.0 (dir 1)
                let normal_y = face.normal[1];
                let neighbor_delta: isize = (normal_sign as isize) * (normal_stride as isize);
                let sign_i: isize = normal_sign as isize;

                for c in 0..dim_normal {
                    let lo = offsets[c];
                    let hi = offsets[c + 1];
                    if lo == hi {
                        continue;
                    }
                    stamp_counter += 1;
                    let stamp = stamp_counter;
                    let neighbor_c = c as isize + sign_i;
                    let neighbor_in_bounds = neighbor_c >= 0 && (neighbor_c as usize) < dim_normal;
                    let slice_coordinate = if normal_sign > 0.0 { c + 1 } else { c };

                    // --- Pass 2a: stamp exposed faces into the dense mask ------
                    // SAFETY (whole block): gi indexes occupied (non-empty) grid
                    // cells; neighbour/above offsets are guarded by
                    // neighbor_in_bounds / vy+1 < voxel_height; palette indices
                    // (color_idx, neighbor-1, above-1) are < 256 and every self.*
                    // table has length 256; mi < u_dim*v_dim <= max_mask_size.
                    // Validated byte-for-byte against the TS reference.
                    let mut any = false;
                    for &e in &entries[lo..hi] {
                        let mi = (e >> 32) as usize;
                        let gi = (e & 0xffff_ffff) as usize;
                        let color_idx = (unsafe { *grid.get_unchecked(gi) } - 1) as usize;
                        if unsafe { *self.is_volumetric.get_unchecked(color_idx) } == 1 {
                            continue;
                        }
                        let occ = unsafe { *self.occlusion_id.get_unchecked(color_idx) };
                        let neighbor: u16 = if neighbor_in_bounds {
                            unsafe { *grid.get_unchecked((gi as isize + neighbor_delta) as usize) }
                        } else {
                            0
                        };
                        if neighbor != 0
                            && occ == unsafe { *self.occlusion_id.get_unchecked((neighbor - 1) as usize) }
                        {
                            continue;
                        }
                        // vy is the Y coordinate: u for axis 0, c for axis 1, v for axis 2.
                        let vy = match axis {
                            0 => mi % u_dim,
                            1 => c,
                            _ => mi / u_dim,
                        };
                        let mut deform_top: u8 = 0;
                        if unsafe { *self.deforms_surface.get_unchecked(color_idx) } == 1
                            && normal_y == 0.0
                        {
                            let above: u16 = if vy + 1 < voxel_height {
                                unsafe { *grid.get_unchecked(gi + voxel_layer_size) }
                            } else {
                                0
                            };
                            if above == 0
                                || occ != unsafe { *self.occlusion_id.get_unchecked((above - 1) as usize) }
                            {
                                deform_top = 1;
                            }
                        }
                        unsafe {
                            *mask_stamp.get_unchecked_mut(mi) = stamp;
                            *mask_color.get_unchecked_mut(mi) = color_idx as u8;
                            *mask_tile.get_unchecked_mut(mi) = ((vy as u32) + 1) / resolution;
                            *mask_deform.get_unchecked_mut(mi) = deform_top;
                        }
                        any = true;
                    }
                    if !any {
                        continue;
                    }

                    // --- Pass 2b: greedy-merge in (v, u) order, emit quads -----
                    // Iterating entries (sorted by mi) visits the stamped cells in
                    // the same order the old dense scan did, skipping unexposed
                    // (wrong stamp) and consumed (stamp cleared to 0) cells.
                    // SAFETY: same invariants as 2a; all mask indices stay within
                    // the current slice's u_dim*v_dim <= max_mask_size.
                    for &e in &entries[lo..hi] {
                        let mi = (e >> 32) as usize;
                        if unsafe { *mask_stamp.get_unchecked(mi) } != stamp {
                            continue;
                        }
                        let color_idx = unsafe { *mask_color.get_unchecked(mi) } as usize;
                        let th = unsafe { *mask_tile.get_unchecked(mi) };
                        let dt = unsafe { *mask_deform.get_unchecked(mi) };
                        let preserve = unsafe { *self.preserves_faces.get_unchecked(color_idx) } == 1;
                        let u = mi % u_dim;
                        let v = mi / u_dim;

                        let mut quad_width = 1usize;
                        if !preserve {
                            while u + quad_width < u_dim {
                                let ni = mi + quad_width;
                                if unsafe { *mask_stamp.get_unchecked(ni) } != stamp
                                    || unsafe { *mask_color.get_unchecked(ni) } as usize != color_idx
                                    || unsafe { *mask_tile.get_unchecked(ni) } != th
                                    || unsafe { *mask_deform.get_unchecked(ni) } != dt
                                {
                                    break;
                                }
                                quad_width += 1;
                            }
                        }

                        let mut quad_height = 1usize;
                        if !preserve {
                            'height: while v + quad_height < v_dim {
                                let test_base = (v + quad_height) * u_dim + u;
                                for test_u in 0..quad_width {
                                    let ni = test_base + test_u;
                                    if unsafe { *mask_stamp.get_unchecked(ni) } != stamp
                                        || unsafe { *mask_color.get_unchecked(ni) } as usize != color_idx
                                        || unsafe { *mask_tile.get_unchecked(ni) } != th
                                        || unsafe { *mask_deform.get_unchecked(ni) } != dt
                                    {
                                        break 'height;
                                    }
                                }
                                quad_height += 1;
                            }
                        }

                        self.emit_quad(
                            &mut buckets,
                            face,
                            color_idx,
                            dt,
                            th,
                            u,
                            v,
                            axis,
                            u_axis,
                            v_axis,
                            slice_coordinate,
                            quad_width,
                            quad_height,
                            res_f,
                            width_half,
                            length_half,
                            init_verts,
                        );

                        // Consume the merged rectangle.
                        for cv in 0..quad_height {
                            let clear_base = (v + cv) * u_dim + u;
                            for cu in 0..quad_width {
                                unsafe {
                                    *mask_stamp.get_unchecked_mut(clear_base + cu) = 0;
                                }
                            }
                        }
                    }
                }
            }
        }

        // Collect non-empty buckets (order is irrelevant to JS -- it re-keys by
        // bucket_id).
        let buckets: Vec<Bucket> = buckets.into_iter().flatten().collect();

        MeshBuild {
            buckets,
            occupancy,
            fog,
            occ_width,
            occ_height,
            occ_length,
            voxel_count,
        }
    }

    /// Fused decode + mesh: decodes the base64-free SVO byte payload in WASM and
    /// runs the same greedy mesher as `build`. This keeps the SVO decode off the
    /// JS side entirely and avoids marshalling the positions/colors arrays across
    /// the JS<->WASM boundary on the gameplay terrain build path.
    pub fn build_from_svo(
        &self,
        svo_bytes: &[u8],
        width: u32,
        height: u32,
        length: u32,
        resolution: u32,
        occ_factor: u32,
    ) -> MeshBuild {
        let (positions, colors) = svo::decode_svo(svo_bytes);
        // `build` keeps its native Rust signature under wasm-bindgen, so it is
        // callable directly here with real slices (no JS round-trip).
        self.build(&positions, &colors, width, height, length, resolution, occ_factor)
    }
}

impl VoxelMesher {
    #[inline]
    fn corner_grid_value(
        corner: [f32; 3],
        axis: usize,
        normal_axis: usize,
        u_axis: usize,
        v_axis: usize,
        slice_coordinate: usize,
        start_u: usize,
        end_u: usize,
        start_v: usize,
        end_v: usize,
    ) -> usize {
        if axis == normal_axis {
            slice_coordinate
        } else if axis == u_axis {
            if corner[axis] < 0.0 {
                start_u
            } else {
                end_u
            }
        } else if axis == v_axis {
            if corner[axis] < 0.0 {
                start_v
            } else {
                end_v
            }
        } else {
            0
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn emit_quad(
        &self,
        buckets: &mut [Option<Bucket>],
        face: &Face,
        color_idx: usize,
        deforms_top_edge: u8,
        tile_height: u32,
        start_u: usize,
        start_v: usize,
        normal_axis: usize,
        u_axis: usize,
        v_axis: usize,
        slice_coordinate: usize,
        quad_width: usize,
        quad_height: usize,
        res_f: f64,
        width_half: f64,
        length_half: f64,
        init_verts: usize,
    ) {
        let uses_vertex_colors = self.uses_vertex_colors[color_idx] == 1;
        let deforms_surface = self.deforms_surface[color_idx] == 1;

        let bucket_id = self.bucket_id[color_idx];
        let slot = bucket_id as usize;
        if buckets[slot].is_none() {
            buckets[slot] = Some(Bucket::new(
                bucket_id as u32,
                uses_vertex_colors,
                deforms_surface,
                init_verts,
            ));
        }
        let b = buckets[slot].as_mut().unwrap();

        let nx = face.normal[0];
        let ny = face.normal[1];
        let nz = face.normal[2];
        let strength: f32 = if ny > 0.5 { 1.0 } else { 0.28 };
        let end_u = start_u + quad_width;
        let end_v = start_v + quad_height;

        let (r, g, bl) = if uses_vertex_colors {
            let o = color_idx * 3;
            (self.rgb[o], self.rgb[o + 1], self.rgb[o + 2])
        } else {
            (0.0, 0.0, 0.0)
        };

        // Resolve the 4 corners' integer grid coordinates.
        let mut corner_grid = [[0usize; 3]; 4];
        for ci in 0..4 {
            for axis in 0..3 {
                corner_grid[ci][axis] = Self::corner_grid_value(
                    face.corners[ci],
                    axis,
                    normal_axis,
                    u_axis,
                    v_axis,
                    slice_coordinate,
                    start_u,
                    end_u,
                    start_v,
                    end_v,
                );
            }
        }
        let top_grid_y = corner_grid[0][1]
            .max(corner_grid[1][1])
            .max(corner_grid[2][1])
            .max(corner_grid[3][1]);
        let is_top_face_deformed = deforms_surface && ny > 0.5;

        let face_start_vertex = b.vertex_count();

        for ci in 0..4 {
            let grid_x = corner_grid[ci][0];
            let grid_y = corner_grid[ci][1];
            let grid_z = corner_grid[ci][2];
            b.positions.push((grid_x as f64 / res_f - width_half) as f32);
            b.positions.push((grid_y as f64 / res_f - 0.5) as f32);
            b.positions.push((grid_z as f64 / res_f - length_half) as f32);
            b.normals.push(nx);
            b.normals.push(ny);
            b.normals.push(nz);
            if let Some(cols) = b.colors.as_mut() {
                cols.push(r);
                cols.push(g);
                cols.push(bl);
            }
            // grid_y == top_grid_y is an exact integer comparison here (the TS
            // uses abs(diff) < 1e-4 over floats; integers make it exact).
            let is_side_top_edge_deformed =
                deforms_top_edge == 1 && ny == 0.0 && grid_y == top_grid_y;
            if let Some(sd) = b.surface_deform.as_mut() {
                sd.push(if is_top_face_deformed || is_side_top_edge_deformed {
                    1.0
                } else {
                    0.0
                });
            }
            b.tile_heights.push(tile_height as f32);
            b.highlights.push(strength);
        }

        // Winding: v0 v1 v2 / v0 v2 v3.
        b.indices.push(face_start_vertex);
        b.indices.push(face_start_vertex + 1);
        b.indices.push(face_start_vertex + 2);
        b.indices.push(face_start_vertex);
        b.indices.push(face_start_vertex + 2);
        b.indices.push(face_start_vertex + 3);
    }
}

// ---------------------------------------------------------------------------
// Standalone SVO codec, exposed for the main-thread + editor call sites that
// don't go through the mesher. `decode_svo_wasm` returns an SvoDecode whose
// take_* getters move each buffer out as a fresh JS typed array; encode returns
// the SVO bytes directly.
// ---------------------------------------------------------------------------
#[wasm_bindgen]
pub struct SvoDecode {
    positions: Vec<u32>,
    colors: Vec<u8>,
}

#[wasm_bindgen]
impl SvoDecode {
    pub fn take_positions(&mut self) -> Vec<u32> {
        std::mem::take(&mut self.positions)
    }
    pub fn take_colors(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.colors)
    }
}

#[wasm_bindgen]
pub fn decode_svo_wasm(svo_bytes: &[u8]) -> SvoDecode {
    console_error_panic_hook::set_once();
    let (positions, colors) = svo::decode_svo(svo_bytes);
    SvoDecode { positions, colors }
}

#[wasm_bindgen]
pub fn encode_svo_wasm(positions: &[u32], colors: &[u8]) -> Vec<u8> {
    console_error_panic_hook::set_once();
    svo::encode_svo(positions, colors)
}
