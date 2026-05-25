const BITSET_BITS_PER_BYTE = 8;

const BYTE_POPCOUNT = new Uint8Array(256);
for (let i = 0; i < BYTE_POPCOUNT.length; i++) {
	let value = i;
	let count = 0;
	while (value !== 0) {
		value &= value - 1;
		count++;
	}
	BYTE_POPCOUNT[i] = count;
}

export function createBitset(bitCount: number): Uint8Array {
	return new Uint8Array(Math.ceil(bitCount / BITSET_BITS_PER_BYTE));
}

export function isBitSet(bitset: Uint8Array, offset: number): boolean {
	return (bitset[offset >> 3] & (1 << (offset & 7))) !== 0;
}

export function setBit(bitset: Uint8Array, offset: number, enabled: boolean): void {
	const byteIndex = offset >> 3;
	const mask = 1 << (offset & 7);
	if (enabled) {
		bitset[byteIndex] |= mask;
	} else {
		bitset[byteIndex] &= ~mask;
	}
}

export function countSetBits(bitset: Uint8Array): number {
	let count = 0;
	for (let i = 0; i < bitset.length; i++) {
		count += BYTE_POPCOUNT[bitset[i]];
	}
	return count;
}
