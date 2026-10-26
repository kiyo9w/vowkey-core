#![allow(missing_docs)]

use criterion::{criterion_group, criterion_main};
use default_allocator::criterion_benchmark;
use vowkey_crypto::ZeroizingAllocator;

#[global_allocator]
static ALLOC: ZeroizingAllocator<std::alloc::System> = ZeroizingAllocator(std::alloc::System);

mod default_allocator;

criterion_group!(benches, criterion_benchmark);
criterion_main!(benches);
