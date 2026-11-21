// Voxel light field: sky light + coloured glow, flood-filled over the
// (possibly downsampled) occupancy grid. Feeds the terrain shaders' indirect
// (ambient) lighting: sky scales the hemisphere light so covered spaces go dark,
// glow adds the light of lava / fire / light blocks onto nearby surfaces.
//
// Grid layout matches the occupancy volume: z * w * h + y * w + x.
//
// Both volumes are cropped to the only boxes where they can differ from their
// constant value, so the output is exact, just smaller:
//   - sky (R8, 0..255): the blockers' bounding box padded by one cell on the
//     sides and top, down to y = 0. Outside it every cell is open sky (255).
//   - glow (RGBA4, rgb used): the emitters' bounding box padded by the glow's
//     reach. Outside it glow is 0.

type Dims = (usize, usize, usize);

/// One light-emitting cell: grid index plus its 0..255 RGB seed levels.
pub struct Emitter {
    pub cell: usize,
    pub rgb: [u8; 3],
}

/// Sub-box of the grid in cells. All-zero dims = empty.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Region {
    pub origin: [usize; 3],
    pub dims: [usize; 3],
}

impl Region {
    fn len(&self) -> usize {
        self.dims[0] * self.dims[1] * self.dims[2]
    }
    /// [x0, y0, z0, w, h, l] for JS.
    pub fn to_vec(&self) -> Vec<u32> {
        self.origin.iter().chain(self.dims.iter()).map(|&v| v as u32).collect()
    }
}

#[derive(Default)]
pub struct LightField {
    /// Sky level per cell inside `sky_region`; 255 outside it.
    pub sky: Vec<u8>,
    pub sky_region: Region,
    /// RGBA4 glow per cell inside `glow_region` (r in the top nibble); 0 outside.
    pub glow: Vec<u16>,
    pub glow_region: Region,
}

fn for_neighbours(c: usize, dims: Dims, mut f: impl FnMut(usize)) {
    let (w, h, l) = dims;
    let layer = w * h;
    let x = c % w;
    let y = (c / w) % h;
    let z = c / layer;
    if x > 0 { f(c - 1); }
    if x + 1 < w { f(c + 1); }
    if y > 0 { f(c - w); }
    if y + 1 < h { f(c + w); }
    if z > 0 { f(c - layer); }
    if z + 1 < l { f(c + layer); }
}

/// Levels drop by `step` per cell. Bucketed BFS for seeds at mixed levels:
/// every level is processed once from high to low, so each cell settles at
/// its brightest reachable level in O(cells).
fn flood(level: &mut [u8], blocks: &[u8], dims: Dims, step: u8, seeds: &[usize]) {
    let mut buckets: Vec<Vec<u32>> = vec![Vec::new(); 256];
    for &s in seeds {
        buckets[level[s] as usize].push(s as u32);
    }
    for lvl in (1..=255usize).rev() {
        let next = lvl.saturating_sub(step as usize);
        if next == 0 {
            continue;
        }
        for c in std::mem::take(&mut buckets[lvl]) {
            let c = c as usize;
            if level[c] as usize != lvl {
                continue; // superseded by a brighter path
            }
            for_neighbours(c, dims, |n| {
                if blocks[n] == 0 && (level[n] as usize) < next {
                    level[n] = next as u8;
                    buckets[next].push(n as u32);
                }
            });
        }
    }
}

/// Inclusive bounds of the given cells, or None when there are none.
fn bounds(cells: impl Iterator<Item = usize>, dims: Dims) -> Option<([usize; 3], [usize; 3])> {
    let (w, h, _) = dims;
    let mut lo = [usize::MAX; 3];
    let mut hi = [0usize; 3];
    let mut any = false;
    for c in cells {
        let p = [c % w, (c / w) % h, c / (w * h)];
        for a in 0..3 {
            lo[a] = lo[a].min(p[a]);
            hi[a] = hi[a].max(p[a]);
        }
        any = true;
    }
    any.then_some((lo, hi))
}

fn region_from(lo: [usize; 3], hi: [usize; 3]) -> Region {
    Region { origin: lo, dims: [hi[0] - lo[0] + 1, hi[1] - lo[1] + 1, hi[2] - lo[2] + 1] }
}

fn crop(blocks: &[u8], dims: Dims, r: Region) -> Vec<u8> {
    let (w, h, _) = dims;
    let [x0, y0, z0] = r.origin;
    let [rw, rh, rl] = r.dims;
    let mut out = Vec::with_capacity(r.len());
    for z in 0..rl {
        for y in 0..rh {
            let start = (z + z0) * w * h + (y + y0) * w + x0;
            out.extend_from_slice(&blocks[start..start + rw]);
        }
    }
    out
}

fn to_local(c: usize, dims: Dims, r: Region) -> usize {
    let (w, h, _) = dims;
    let [rw, rh, _] = r.dims;
    let x = c % w - r.origin[0];
    let y = (c / w) % h - r.origin[1];
    let z = c / (w * h) - r.origin[2];
    z * rw * rh + y * rw + x
}

/// Sky inside `blocks` (already cropped): full light straight down each column
/// to the first blocker, then fading by `step` per cell sideways / under
/// overhangs. All seeds share level 255, so a plain level-by-level BFS from
/// the lit cells that border darker open cells is exact.
fn sky_flood(blocks: &[u8], dims: Dims, step: u8) -> Vec<u8> {
    let (w, h, l) = dims;
    let mut sky = vec![0u8; w * h * l];
    for z in 0..l {
        for x in 0..w {
            for y in (0..h).rev() {
                let c = z * w * h + y * w + x;
                if blocks[c] != 0 {
                    break;
                }
                sky[c] = 255;
            }
        }
    }
    let mut cur: Vec<u32> = Vec::new();
    for c in 0..sky.len() {
        if sky[c] != 255 {
            continue;
        }
        let mut frontier = false;
        for_neighbours(c, dims, |n| frontier |= blocks[n] == 0 && sky[n] != 255);
        if frontier {
            cur.push(c as u32);
        }
    }
    let mut next: Vec<u32> = Vec::new();
    let mut level = 255usize;
    while !cur.is_empty() && level > step as usize {
        level -= step as usize;
        for &c in &cur {
            for_neighbours(c as usize, dims, |n| {
                if blocks[n] == 0 && (sky[n] as usize) < level {
                    sky[n] = level as u8;
                    next.push(n as u32);
                }
            });
        }
        std::mem::swap(&mut cur, &mut next);
        next.clear();
    }
    sky
}

/// Round a 0..255 level to a 4-bit channel.
fn nibble(v: u8) -> u16 {
    (v as u16 * 15 + 127) / 255
}

/// Level drop per cell so light fades to zero over `radius_cells` cells.
pub fn step_for_radius(radius_cells: f32) -> u8 {
    (255.0 / radius_cells.max(1.0)).ceil().clamp(1.0, 255.0) as u8
}

/// Builds the cropped sky (R8) and glow (RGBA4) volumes. `blocks[c]` is 1
/// where light cannot enter.
pub fn compute_light_field(
    blocks: &[u8],
    emitters: &[Emitter],
    dims: Dims,
    sky_step: u8,
    glow_step: u8,
) -> LightField {
    let (w, h, l) = dims;
    let mut field = LightField::default();

    let blockers = (0..blocks.len()).filter(|&c| blocks[c] != 0);
    if let Some((lo, hi)) = bounds(blockers, dims) {
        let r = region_from(
            [lo[0].saturating_sub(1), 0, lo[2].saturating_sub(1)],
            [(hi[0] + 1).min(w - 1), (hi[1] + 1).min(h - 1), (hi[2] + 1).min(l - 1)],
        );
        let rd = (r.dims[0], r.dims[1], r.dims[2]);
        field.sky = sky_flood(&crop(blocks, dims, r), rd, sky_step);
        field.sky_region = r;
    }

    if let Some((lo, hi)) = bounds(emitters.iter().map(|e| e.cell), dims) {
        // One past the furthest cell a full-level seed can reach, so the box
        // edge is 0 and clamp-to-edge sampling outside it stays exact.
        let reach = 255 / glow_step as usize + 1;
        let r = region_from(
            [lo[0].saturating_sub(reach), lo[1].saturating_sub(reach), lo[2].saturating_sub(reach)],
            [(hi[0] + reach).min(w - 1), (hi[1] + reach).min(h - 1), (hi[2] + reach).min(l - 1)],
        );
        let rd = (r.dims[0], r.dims[1], r.dims[2]);
        let sub = crop(blocks, dims, r);
        let seeds: Vec<usize> = emitters.iter().map(|e| to_local(e.cell, dims, r)).collect();
        let mut level = vec![0u8; r.len()];
        let mut glow = vec![0u16; r.len()];
        for ch in 0..3 {
            level.fill(0);
            for (e, &s) in emitters.iter().zip(&seeds) {
                level[s] = level[s].max(e.rgb[ch]);
            }
            flood(&mut level, &sub, rd, glow_step, &seeds);
            let shift = 12 - 4 * ch as u16;
            for (g, &v) in glow.iter_mut().zip(&level) {
                *g |= nibble(v) << shift;
            }
        }
        field.glow = glow;
        field.glow_region = r;
    }
    field
}

#[cfg(test)]
mod tests {
    use super::*;

    fn idx(x: usize, y: usize, z: usize, w: usize, h: usize) -> usize {
        z * w * h + y * w + x
    }

    /// Sky / glow level at a full-grid cell, expanding the cropped volumes.
    fn sky_at(f: &LightField, c: usize, dims: Dims) -> u8 {
        match inside(f.sky_region, c, dims) {
            Some(i) => f.sky[i],
            None => 255,
        }
    }
    fn glow_at(f: &LightField, c: usize, dims: Dims) -> [u16; 3] {
        match inside(f.glow_region, c, dims) {
            Some(i) => [f.glow[i] >> 12, (f.glow[i] >> 8) & 15, (f.glow[i] >> 4) & 15],
            None => [0, 0, 0],
        }
    }
    fn inside(r: Region, c: usize, (w, h, _): Dims) -> Option<usize> {
        let p = [c % w, (c / w) % h, c / (w * h)];
        let ok = (0..3).all(|a| p[a] >= r.origin[a] && p[a] < r.origin[a] + r.dims[a]);
        ok.then(|| {
            let [rw, rh, _] = r.dims;
            (p[2] - r.origin[2]) * rw * rh + (p[1] - r.origin[1]) * rw + (p[0] - r.origin[0])
        })
    }

    /// The original full-grid algorithm (column seeds + bucketed flood), kept
    /// as the exactness reference for the cropped / frontier version.
    fn reference(blocks: &[u8], emitters: &[Emitter], dims: Dims, sky_step: u8, glow_step: u8) -> (Vec<u8>, Vec<[u8; 3]>) {
        let (w, h, l) = dims;
        let n = w * h * l;
        let mut sky = vec![0u8; n];
        let mut seeds = Vec::new();
        for z in 0..l {
            for x in 0..w {
                for y in (0..h).rev() {
                    let c = idx(x, y, z, w, h);
                    if blocks[c] != 0 {
                        break;
                    }
                    sky[c] = 255;
                    seeds.push(c);
                }
            }
        }
        flood(&mut sky, blocks, dims, sky_step, &seeds);
        let mut glow = vec![[0u8; 3]; n];
        let seeds: Vec<usize> = emitters.iter().map(|e| e.cell).collect();
        for ch in 0..3 {
            let mut lvl = vec![0u8; n];
            for e in emitters {
                lvl[e.cell] = lvl[e.cell].max(e.rgb[ch]);
            }
            flood(&mut lvl, blocks, dims, glow_step, &seeds);
            for c in 0..n {
                glow[c][ch] = lvl[c];
            }
        }
        (sky, glow)
    }

    #[test]
    fn sky_is_full_outside_and_fades_under_a_roof() {
        // 8 x 4 x 1 slice: a roof over x >= 4 at y = 3.
        let dims = (8, 4, 1);
        let mut blocks = vec![0u8; 32];
        for x in 4..8 {
            blocks[idx(x, 3, 0, 8, 4)] = 1;
        }
        let f = compute_light_field(&blocks, &[], dims, 64, 64);
        let sky = |x, y| sky_at(&f, idx(x, y, 0, 8, 4), dims);
        assert_eq!(sky(0, 0), 255, "open column, outside the sky box");
        assert_eq!(sky(4, 0), 255 - 64, "one cell under the roof edge");
        assert_eq!(sky(7, 0), 0, "deep under the roof fades out");
        assert_eq!(sky(5, 3), 0, "blocking cells stay dark");
        assert_eq!(f.sky_region, Region { origin: [3, 0, 0], dims: [5, 4, 1] });
    }

    #[test]
    fn floating_roof_shades_the_cells_below_it() {
        // Nothing below the roof: the sky box must still reach down to y = 0.
        let dims = (9, 6, 1);
        let mut blocks = vec![0u8; 54];
        for x in 2..7 {
            blocks[idx(x, 4, 0, 9, 6)] = 1;
        }
        let f = compute_light_field(&blocks, &[], dims, 100, 100);
        assert_eq!(sky_at(&f, idx(3, 0, 0, 9, 6), dims), 55, "two cells in from the open edge");
        assert_eq!(sky_at(&f, idx(4, 0, 0, 9, 6), dims), 0, "three cells in: dark");
    }

    #[test]
    fn glow_spreads_from_emitter_and_stops_at_walls() {
        // 5 x 1 x 1 row: emitter at x = 0, wall at x = 3.
        let dims = (5, 1, 1);
        let blocks = vec![1, 0, 0, 1, 0];
        let em = [Emitter { cell: 0, rgb: [255, 128, 0] }];
        let f = compute_light_field(&blocks, &em, dims, 255, 100);
        assert_eq!(glow_at(&f, 1, dims), [nibble(155), nibble(28), 0], "one step down per channel");
        assert_eq!(glow_at(&f, 2, dims), [nibble(55), 0, 0], "two steps");
        assert_eq!(glow_at(&f, 4, dims), [0, 0, 0], "behind the wall");
    }

    #[test]
    fn matches_the_full_grid_reference() {
        // Pseudo-random caves: ground, scattered blocks, a slab, a few emitters.
        let dims = (40, 20, 30);
        let (w, h, l) = dims;
        let mut seed = 12345u32;
        let mut rand = move || {
            seed = seed.wrapping_mul(1_103_515_245).wrapping_add(12345);
            (seed >> 16) % 100
        };
        let mut blocks = vec![0u8; w * h * l];
        for z in 0..l {
            for x in 0..w {
                for y in 0..h {
                    let solid = y < 2 || (y < 12 && rand() < 25) || (y == 14 && x > 8 && x < 30);
                    blocks[idx(x, y, z, w, h)] = solid as u8;
                }
            }
        }
        let emitters = vec![
            Emitter { cell: idx(5, 2, 5, w, h), rgb: [255, 90, 16] },
            Emitter { cell: idx(20, 13, 15, w, h), rgb: [255, 224, 176] },
            Emitter { cell: idx(22, 13, 16, w, h), rgb: [200, 120, 40] },
        ];
        let (sky_step, glow_step) = (step_for_radius(9.0), step_for_radius(15.0));
        let (ref_sky, ref_glow) = reference(&blocks, &emitters, dims, sky_step, glow_step);
        let f = compute_light_field(&blocks, &emitters, dims, sky_step, glow_step);
        for c in 0..blocks.len() {
            assert_eq!(sky_at(&f, c, dims), ref_sky[c], "sky at cell {c}");
            let want = ref_glow[c].map(nibble);
            assert_eq!(glow_at(&f, c, dims), want, "glow at cell {c}");
        }
        assert!(f.glow_region.len() < blocks.len(), "glow box is cropped");
    }
}
