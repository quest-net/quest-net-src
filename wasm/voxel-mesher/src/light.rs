// Voxel light field: sky light + coloured block light, flood-filled over the
// (possibly downsampled) occupancy grid. Feeds the terrain shaders' indirect
// (ambient) lighting: sky scales the hemisphere light so covered spaces go dark,
// block light adds the glow of lava / fire / light blocks onto nearby surfaces.
//
// Grid layout matches the occupancy volume: z * w * h + y * w + x.
// Output is RGBA8 per cell: rgb = block light, a = sky light (0..255).

/// One light-emitting cell: grid index plus its 0..255 RGB seed levels.
pub struct Emitter {
    pub cell: usize,
    pub rgb: [u8; 3],
}

/// Levels drop by `step` per cell; 255 at the source. Bucketed BFS: every
/// level is processed once from high to low, so each cell settles at its
/// brightest reachable level in O(cells).
fn flood(level: &mut [u8], blocks: &[u8], dims: (usize, usize, usize), step: u8, seeds: &[usize]) {
    let (w, h, l) = dims;
    let mut buckets: Vec<Vec<u32>> = vec![Vec::new(); 256];
    for &s in seeds {
        buckets[level[s] as usize].push(s as u32);
    }
    let row = w;
    let layer = w * h;
    for lvl in (1..=255usize).rev() {
        let next = lvl.saturating_sub(step as usize);
        if next == 0 {
            continue;
        }
        let cells = std::mem::take(&mut buckets[lvl]);
        for c in cells {
            let c = c as usize;
            if level[c] as usize != lvl {
                continue; // superseded by a brighter path
            }
            let x = c % row;
            let y = (c / row) % h;
            let z = c / layer;
            let mut visit = |n: usize| {
                if blocks[n] == 0 && (level[n] as usize) < next {
                    level[n] = next as u8;
                    buckets[next].push(n as u32);
                }
            };
            if x > 0 { visit(c - 1); }
            if x + 1 < w { visit(c + 1); }
            if y > 0 { visit(c - row); }
            if y + 1 < h { visit(c + row); }
            if z > 0 { visit(c - layer); }
            if z + 1 < l { visit(c + layer); }
        }
    }
}

/// Level drop per cell so light fades to zero over `radius_cells` cells.
pub fn step_for_radius(radius_cells: f32) -> u8 {
    (255.0 / radius_cells.max(1.0)).ceil().clamp(1.0, 255.0) as u8
}

/// Builds the RGBA light volume. `blocks[c]` is 1 where light cannot enter.
pub fn compute_light_field(
    blocks: &[u8],
    emitters: &[Emitter],
    dims: (usize, usize, usize),
    sky_step: u8,
    glow_step: u8,
) -> Vec<u8> {
    let (w, h, l) = dims;
    let n = w * h * l;

    // Sky: full light straight down every column until the first blocker, then
    // spreads sideways / under overhangs, fading by sky_step per cell.
    let mut sky = vec![0u8; n];
    let mut seeds = Vec::new();
    for z in 0..l {
        for x in 0..w {
            for y in (0..h).rev() {
                let c = z * w * h + y * w + x;
                if blocks[c] != 0 {
                    break;
                }
                sky[c] = 255;
                seeds.push(c);
            }
        }
    }
    flood(&mut sky, blocks, dims, sky_step, &seeds);

    // Block light: one flood per channel, seeded at the (blocking) emitter
    // cells themselves so it spreads into the open neighbours.
    let mut out = vec![0u8; n * 4];
    if !emitters.is_empty() {
        let seeds: Vec<usize> = emitters.iter().map(|e| e.cell).collect();
        for ch in 0..3 {
            let mut lvl = vec![0u8; n];
            for e in emitters {
                lvl[e.cell] = lvl[e.cell].max(e.rgb[ch]);
            }
            flood(&mut lvl, blocks, dims, glow_step, &seeds);
            for c in 0..n {
                out[c * 4 + ch] = lvl[c];
            }
        }
    }
    for c in 0..n {
        out[c * 4 + 3] = sky[c];
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn idx(x: usize, y: usize, z: usize, w: usize, h: usize) -> usize {
        z * w * h + y * w + x
    }

    #[test]
    fn sky_is_full_outside_and_fades_under_a_roof() {
        // 8 x 4 x 1 slice: a roof over x >= 4 at y = 3.
        let (w, h, l) = (8, 4, 1);
        let mut blocks = vec![0u8; w * h * l];
        for x in 4..8 {
            blocks[idx(x, 3, 0, w, h)] = 1;
        }
        let out = compute_light_field(&blocks, &[], (w, h, l), 64, 64);
        let sky = |x, y| out[idx(x, y, 0, w, h) * 4 + 3];
        assert_eq!(sky(0, 0), 255, "open column");
        assert_eq!(sky(4, 0), 255 - 64, "one cell under the roof edge");
        assert_eq!(sky(7, 0), 0, "deep under the roof fades out");
        assert_eq!(sky(5, 3), 0, "blocking cells stay dark");
    }

    #[test]
    fn glow_spreads_from_emitter_and_stops_at_walls() {
        // 5 x 1 x 1 row: emitter at x = 0, wall at x = 3.
        let (w, h, l) = (5, 1, 1);
        let mut blocks = vec![0u8; w];
        blocks[0] = 1;
        blocks[3] = 1;
        let em = [Emitter { cell: 0, rgb: [255, 128, 0] }];
        let out = compute_light_field(&blocks, &em, (w, h, l), 255, 100);
        assert_eq!(&out[4..7], &[155, 28, 0], "neighbour: one step down per channel");
        assert_eq!(&out[8..11], &[55, 0, 0], "two steps");
        assert_eq!(&out[16..19], &[0, 0, 0], "behind the wall");
    }
}
