//! A small deterministic generator for the generated-input tests (no dependency, same inputs on
//! every run, so a failure reproduces). Moved here from the `net` crate with the modules whose tests use it,
//! `shuffle` included; the `net` crate keeps a copy without it.

/// xorshift64*: good enough to spread test inputs, not for anything else.
pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Self {
        Self(seed.max(1))
    }

    pub fn next_u64(&mut self) -> u64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_f491_4f6c_dd1d)
    }

    /// A value in `0..n` (`0` when `n` is `0`).
    pub fn below(&mut self, n: usize) -> usize {
        if n == 0 { 0 } else { (self.next_u64() % n as u64) as usize }
    }

    pub fn bytes(&mut self, len: usize) -> Vec<u8> {
        (0..len).map(|_| self.next_u64() as u8).collect()
    }

    /// Valid UTF-8 of exactly `len` bytes, mixing one-, two-, three- and four-byte characters.
    pub fn text(&mut self, len: usize) -> String {
        let mut out = String::with_capacity(len);
        while out.len() < len {
            let ch = match self.below(4) {
                0 => char::from(b'a' + self.below(26) as u8),
                1 => 'é',
                2 => '€',
                _ => '🦀',
            };
            if out.len() + ch.len_utf8() > len {
                out.push(' ');
            } else {
                out.push(ch);
            }
        }
        out
    }

    /// Shuffle in place (Fisher-Yates).
    pub fn shuffle<T>(&mut self, items: &mut [T]) {
        for i in (1..items.len()).rev() {
            let j = self.below(i + 1);
            items.swap(i, j);
        }
    }
}
