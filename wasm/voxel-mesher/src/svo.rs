// Quest-Net Sparse Voxel Octree (SVO) codec (WASM).
//
// This is the SINGLE source of truth for the SVO format (the previous JS codec,
// VoxelSVOCodec.ts, was removed once this was validated). It is reached from JS
// via voxelCodecWasm.ts (standalone encode/decode) and build_from_svo (fused
// decode + mesh). The format is FROZEN: encoded blobs are persisted in IndexedDB
// and synced over Trystero, so any byte-level change here breaks stored terrain
// and desyncs peers -- bump a format/version flag instead of changing it in place.
//
// Format:
//   header: 20 bytes -- magic "QSVO", depth, geometry encoding, color encoding,
//           reserved, voxelCount(u32 LE), geometryLen(u32 LE), colorLen(u32 LE)
//   geometry stream: per-node child masks (RAW or varint-RLE)
//   color stream:    one palette byte per leaf in traversal order (RAW or RLE)

const MAGIC_Q: u8 = 0x51; // Q
const MAGIC_S: u8 = 0x53; // S
const MAGIC_V: u8 = 0x56; // V
const MAGIC_O: u8 = 0x4f; // O

const HEADER_BYTE_LENGTH: usize = 20;
const MAX_SVO_DEPTH: u32 = 8; // x/y/z are one byte each in Quest-Net voxel coords.

const STREAM_RAW: u8 = 0;
const STREAM_RLE: u8 = 1;

// ---------------------------------------------------------------------------
// Little-endian header helpers (mirror readUint32LE / writeUint32LE).
// ---------------------------------------------------------------------------
#[inline]
fn read_u32_le(bytes: &[u8], offset: usize) -> u32 {
    (bytes[offset] as u32)
        | ((bytes[offset + 1] as u32) << 8)
        | ((bytes[offset + 2] as u32) << 16)
        | ((bytes[offset + 3] as u32) << 24)
}

#[inline]
fn write_u32_le(bytes: &mut [u8], offset: usize, value: u32) {
    bytes[offset] = (value & 0xff) as u8;
    bytes[offset + 1] = ((value >> 8) & 0xff) as u8;
    bytes[offset + 2] = ((value >> 16) & 0xff) as u8;
    bytes[offset + 3] = ((value >> 24) & 0xff) as u8;
}

fn assert_magic(bytes: &[u8]) {
    if bytes.len() < HEADER_BYTE_LENGTH
        || bytes[0] != MAGIC_Q
        || bytes[1] != MAGIC_S
        || bytes[2] != MAGIC_V
        || bytes[3] != MAGIC_O
    {
        panic!("Invalid voxel SVO payload.");
    }
}

// ---------------------------------------------------------------------------
// Position packing (mirror getX/getY/getZ/packPosition).
// position = x + y*256 + z*65536.
// ---------------------------------------------------------------------------
#[inline]
fn get_x(position: u32) -> u32 {
    position & 0xff
}
#[inline]
fn get_y(position: u32) -> u32 {
    (position >> 8) & 0xff
}
#[inline]
fn get_z(position: u32) -> u32 {
    (position >> 16) & 0xff
}
#[inline]
fn pack_position(x: u32, y: u32, z: u32) -> u32 {
    x + (y << 8) + (z << 16)
}

fn depth_for_max_coord(max_coord: u32) -> u32 {
    let mut depth = 1u32;
    let mut extent = 2u32;
    while extent <= max_coord {
        depth += 1;
        extent <<= 1;
    }
    if depth > MAX_SVO_DEPTH {
        panic!("Voxel coordinate exceeds {MAX_SVO_DEPTH}-level SVO bounds.");
    }
    depth
}

/// Computes the full MAX_SVO_DEPTH Morton path for a voxel. Always emits 24
/// bits (3 bits per level) -- leading zeros mean the same numeric value sorts
/// and indexes identically for any smaller actual depth.
#[inline]
fn full_morton_path(x: u32, y: u32, z: u32) -> u32 {
    let mut path = 0u32;
    let mut level = MAX_SVO_DEPTH as i32 - 1;
    while level >= 0 {
        path = (path << 3)
            | (((x >> level) & 1) << 2)
            | (((y >> level) & 1) << 1)
            | ((z >> level) & 1);
        level -= 1;
    }
    path
}

// Entries pack the 24-bit Morton path and the 8-bit color: entry = path*256 + color.
// Max value is (2^24 - 1) * 256 + 255 = 2^32 - 1, so u64 holds it with room to
// spare and matches the JS Number arithmetic exactly.
#[inline]
fn entry_path(entry: u64) -> u64 {
    entry >> 8
}
#[inline]
fn entry_color(entry: u64) -> u8 {
    (entry & 0xff) as u8
}

// ---------------------------------------------------------------------------
// Encode: recursive node writer (mirror writeNode). Groups the sorted entry
// range by child octant at `level`, emits the child mask, and recurses (or, at
// level 1, emits one color byte per occupied leaf).
// ---------------------------------------------------------------------------
fn write_node(
    entries: &[u64],
    start: usize,
    end: usize,
    level: u32,
    geometry: &mut Vec<u8>,
    colors: &mut Vec<u8>,
) {
    let mask_index = geometry.len();
    geometry.push(0);

    let shift = (level - 1) * 3;
    // Child ranges captured as (start, end) so we can recurse after writing mask.
    let mut child_ranges: Vec<(usize, usize)> = Vec::new();
    let mut mask: u8 = 0;
    let mut cursor = start;

    while cursor < end {
        let child = ((entry_path(entries[cursor]) >> shift) & 0b111) as u8;
        let child_start = cursor;
        cursor += 1;
        while cursor < end && (((entry_path(entries[cursor]) >> shift) & 0b111) as u8) == child {
            cursor += 1;
        }
        mask |= 1 << child;
        child_ranges.push((child_start, cursor));
    }

    geometry[mask_index] = mask;

    if level == 1 {
        for &(range_start, _range_end) in &child_ranges {
            colors.push(entry_color(entries[range_start]));
        }
        return;
    }

    for &(range_start, range_end) in &child_ranges {
        write_node(entries, range_start, range_end, level - 1, geometry, colors);
    }
}

// ---------------------------------------------------------------------------
// Varint + RLE byte streams (mirror writeVarUint/readVarUint/encodeRle/decodeRle).
// ---------------------------------------------------------------------------
fn write_var_uint(value: u32, out: &mut Vec<u8>) {
    let mut remaining = value;
    while remaining >= 0x80 {
        out.push(((remaining % 0x80) | 0x80) as u8);
        remaining /= 0x80;
    }
    out.push(remaining as u8);
}

fn read_var_uint(bytes: &[u8], offset: &mut usize) -> u32 {
    let mut value: u64 = 0;
    let mut multiplier: u64 = 1;
    while *offset < bytes.len() {
        let byte = bytes[*offset];
        *offset += 1;
        value += ((byte & 0x7f) as u64) * multiplier;
        if (byte & 0x80) == 0 {
            return value as u32;
        }
        multiplier *= 0x80;
        if multiplier > 0x1_0000_0000 {
            panic!("Voxel SVO RLE count is too large.");
        }
    }
    panic!("Voxel SVO RLE stream ended mid-count.");
}

fn encode_rle(bytes: &[u8]) -> Vec<u8> {
    let mut out: Vec<u8> = Vec::new();
    let mut cursor = 0usize;
    while cursor < bytes.len() {
        let value = bytes[cursor];
        let mut end = cursor + 1;
        while end < bytes.len() && bytes[end] == value {
            end += 1;
        }
        write_var_uint((end - cursor) as u32, &mut out);
        out.push(value);
        cursor = end;
    }
    out
}

fn decode_rle(bytes: &[u8]) -> Vec<u8> {
    let mut out: Vec<u8> = Vec::new();
    let mut offset = 0usize;
    while offset < bytes.len() {
        let count = read_var_uint(bytes, &mut offset);
        if offset >= bytes.len() {
            panic!("Voxel SVO RLE stream ended before value byte.");
        }
        let value = bytes[offset];
        offset += 1;
        for _ in 0..count {
            out.push(value);
        }
    }
    out
}

struct EncodedByteStream {
    encoding: u8,
    bytes: Vec<u8>,
}

fn encode_byte_stream(bytes: Vec<u8>) -> EncodedByteStream {
    if bytes.is_empty() {
        return EncodedByteStream {
            encoding: STREAM_RAW,
            bytes,
        };
    }
    let rle = encode_rle(&bytes);
    if rle.len() < bytes.len() {
        EncodedByteStream {
            encoding: STREAM_RLE,
            bytes: rle,
        }
    } else {
        EncodedByteStream {
            encoding: STREAM_RAW,
            bytes,
        }
    }
}

fn decode_byte_stream(bytes: &[u8], encoding: u8) -> Vec<u8> {
    if encoding == STREAM_RAW {
        return bytes.to_vec();
    }
    if encoding == STREAM_RLE {
        return decode_rle(bytes);
    }
    panic!("Unsupported voxel SVO stream encoding: {encoding}.");
}

// ---------------------------------------------------------------------------
// Public: encode / decode / voxel_count. Pure functions over slices so both the
// wasm-bindgen wrappers and the fused mesher (build_from_svo) reuse them.
// ---------------------------------------------------------------------------

/// Encodes voxel positions and palette colors into an SVO byte stream.
/// Positions are packed as x + y*256 + z*65536. Byte-identical to the TS encode.
pub fn encode_svo(positions: &[u32], colors: &[u8]) -> Vec<u8> {
    if positions.len() != colors.len() {
        panic!("Voxel SVO positions/colors length mismatch.");
    }
    if positions.is_empty() {
        return Vec::new();
    }

    // Single pass: build Morton-keyed entries and track the largest coordinate.
    let mut entries: Vec<u64> = Vec::with_capacity(positions.len());
    let mut max_coord = 0u32;
    for i in 0..positions.len() {
        let position = positions[i];
        let x = get_x(position);
        let y = get_y(position);
        let z = get_z(position);
        if x > max_coord {
            max_coord = x;
        }
        if y > max_coord {
            max_coord = y;
        }
        if z > max_coord {
            max_coord = z;
        }
        entries.push((full_morton_path(x, y, z) as u64) * 256 + ((colors[i] & 0xff) as u64));
    }
    let depth = depth_for_max_coord(max_coord);
    entries.sort_unstable();

    let mut geometry_bytes: Vec<u8> = Vec::new();
    let mut color_bytes: Vec<u8> = Vec::new();
    write_node(
        &entries,
        0,
        entries.len(),
        depth,
        &mut geometry_bytes,
        &mut color_bytes,
    );

    let geometry = encode_byte_stream(geometry_bytes);
    let color_stream = encode_byte_stream(color_bytes);
    let mut out = vec![0u8; HEADER_BYTE_LENGTH + geometry.bytes.len() + color_stream.bytes.len()];

    out[0] = MAGIC_Q;
    out[1] = MAGIC_S;
    out[2] = MAGIC_V;
    out[3] = MAGIC_O;
    out[4] = depth as u8;
    out[5] = geometry.encoding;
    out[6] = color_stream.encoding;
    out[7] = 0;
    write_u32_le(&mut out, 8, positions.len() as u32);
    write_u32_le(&mut out, 12, geometry.bytes.len() as u32);
    write_u32_le(&mut out, 16, color_stream.bytes.len() as u32);
    out[HEADER_BYTE_LENGTH..HEADER_BYTE_LENGTH + geometry.bytes.len()]
        .copy_from_slice(&geometry.bytes);
    out[HEADER_BYTE_LENGTH + geometry.bytes.len()..].copy_from_slice(&color_stream.bytes);

    out
}

// Decoder state for the recursive descent (mirror the readNode closure).
struct Decoder<'a> {
    geometry: &'a [u8],
    color_stream: &'a [u8],
    geometry_offset: usize,
    color_offset: usize,
    voxel_offset: usize,
    voxel_count: usize,
    positions: Vec<u32>,
    colors: Vec<u8>,
}

impl<'a> Decoder<'a> {
    fn read_node(&mut self, level: u32, base_x: u32, base_y: u32, base_z: u32) {
        if self.geometry_offset >= self.geometry.len() {
            panic!("Voxel SVO geometry stream ended early.");
        }
        let mask = self.geometry[self.geometry_offset];
        self.geometry_offset += 1;
        let child_size = 1u32 << (level - 1);

        for child in 0..8u32 {
            if (mask & (1 << child)) == 0 {
                continue;
            }
            let x = base_x + (((child >> 2) & 1) * child_size);
            let y = base_y + (((child >> 1) & 1) * child_size);
            let z = base_z + ((child & 1) * child_size);

            if level == 1 {
                if self.voxel_offset >= self.voxel_count {
                    panic!("Voxel SVO geometry contains too many leaves.");
                }
                if self.color_offset >= self.color_stream.len() {
                    panic!("Voxel SVO color stream ended early.");
                }
                self.positions[self.voxel_offset] = pack_position(x, y, z);
                self.colors[self.voxel_offset] = self.color_stream[self.color_offset];
                self.color_offset += 1;
                self.voxel_offset += 1;
            } else {
                self.read_node(level - 1, x, y, z);
            }
        }
    }
}

/// Decodes an SVO byte stream into parallel (positions, colors) arrays.
/// positions[i] is packed as x + y*256 + z*65536; colors[i] is the palette index.
pub fn decode_svo(bytes: &[u8]) -> (Vec<u32>, Vec<u8>) {
    if bytes.is_empty() {
        return (Vec::new(), Vec::new());
    }

    assert_magic(bytes);

    let depth = bytes[4] as u32;
    let geometry_encoding = bytes[5];
    let color_encoding = bytes[6];
    let voxel_count = read_u32_le(bytes, 8) as usize;
    let geometry_length = read_u32_le(bytes, 12) as usize;
    let color_length = read_u32_le(bytes, 16) as usize;
    let expected_length = HEADER_BYTE_LENGTH + geometry_length + color_length;

    if depth > MAX_SVO_DEPTH {
        panic!("Voxel SVO depth {depth} exceeds supported bounds.");
    }
    if bytes.len() != expected_length {
        panic!("Voxel SVO payload length does not match its header.");
    }
    if voxel_count == 0 {
        return (Vec::new(), Vec::new());
    }
    if depth == 0 {
        panic!("Voxel SVO payload has voxels but no tree depth.");
    }

    let geometry_start = HEADER_BYTE_LENGTH;
    let color_start = geometry_start + geometry_length;
    let geometry = decode_byte_stream(&bytes[geometry_start..color_start], geometry_encoding);
    let color_stream = decode_byte_stream(&bytes[color_start..expected_length], color_encoding);

    let mut decoder = Decoder {
        geometry: &geometry,
        color_stream: &color_stream,
        geometry_offset: 0,
        color_offset: 0,
        voxel_offset: 0,
        voxel_count,
        positions: vec![0u32; voxel_count],
        colors: vec![0u8; voxel_count],
    };

    decoder.read_node(depth, 0, 0, 0);

    if decoder.voxel_offset != voxel_count {
        panic!("Voxel SVO geometry leaf count does not match its header.");
    }
    if decoder.geometry_offset != geometry.len() {
        panic!("Voxel SVO geometry stream has trailing bytes.");
    }
    if decoder.color_offset != color_stream.len() {
        panic!("Voxel SVO color stream has trailing bytes.");
    }

    (decoder.positions, decoder.colors)
}
