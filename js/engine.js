// TokenFit estimation engine.
// Decides whether a given hardware setup can run a given model and at what speed.
//
// Three sources of truth, in priority order:
//   1. measured  - real benchmark from data/benchmarks.json
//   2. estimated - formula: effective_bandwidth (GB/s) / model_size (GB), with a format multiplier
//   3. won't fit - model needs more memory than the hardware has

export const STATUS = {
  FAST: 'fast',
  OK: 'ok',
  SLOW: 'slow',
  WONT_FIT: 'wont_fit',
};

// Speed thresholds in tokens/second. Tuned to match how the speed actually feels.
const FAST_THRESHOLD = 20;  // >= 20 t/s feels conversational
const OK_THRESHOLD = 8;     // 8-20 t/s feels usable but slow
                            // < 8 t/s feels painfully slow

// Format multiplier. MLX on Apple Silicon is ~25% faster than GGUF on the same chip
// because it uses Metal natively and exploits unified memory better.
const MLX_APPLE_SILICON_BOOST = 1.25;

// Realistic-vs-theoretical multipliers per platform. Memory bandwidth alone
// overestimates t/s because real inference has compute and KV-cache overhead.
// Calibrated against benchmarks.json so most estimates land within ~20% of measured.
const EFFICIENCY = {
  apple_silicon: 0.40,   // unified memory; quoted bandwidth is rarely fully delivered
  gpu_vram:      0.55,   // GPU bandwidth is well-utilized for inference
  system_ram:    0.30,   // CPU-only on x86 has more overhead and worse caching
};

// Small models that fit in cache see diminishing returns from bandwidth;
// the formula is bandwidth-bound and underestimates compute-bound regimes,
// but for our 2-50GB models this is mostly a non-issue. Cap to avoid runaway numbers
// for tiny models on huge bandwidth platforms.
const TPS_CAP = 200;

export function findBenchmark(benchmarks, hw, modelId, quantLabel, format) {
  return benchmarks.find(b =>
    b.cpu_id === hw.cpu.id &&
    b.gpu_id === (hw.gpu ? hw.gpu.id : 'none') &&
    b.model_id === modelId &&
    b.quant_label === quantLabel &&
    b.format === format
  );
}

// Returns { bandwidth_gbps, regime } where regime determines which efficiency multiplier applies.
function effectiveBandwidth(hw, sizeGb) {
  if (hw.cpu.platform === 'apple-silicon') {
    return { bandwidth: hw.cpu.memory_bandwidth_gbps, regime: 'apple_silicon' };
  }
  if (hw.gpu && hw.gpu.vram_gb >= sizeGb && hw.gpu.memory_bandwidth_gbps > 0) {
    return { bandwidth: hw.gpu.memory_bandwidth_gbps, regime: 'gpu_vram' };
  }
  if (hw.ramType && hw.ramType.bandwidth_per_channel_gbps > 0) {
    const channels = hw.ramType.channels || 2;
    return { bandwidth: hw.ramType.bandwidth_per_channel_gbps * channels, regime: 'system_ram' };
  }
  return { bandwidth: hw.cpu.memory_bandwidth_gbps, regime: 'system_ram' };
}

export function estimateModel(hw, model, quant, benchmarks) {
  // Hard compatibility: MLX requires Apple Silicon.
  if (quant.format === 'mlx' && hw.cpu.platform !== 'apple-silicon') {
    return {
      status: STATUS.WONT_FIT,
      reason: 'MLX models only run on Apple Silicon (M1/M2/M3/M4).',
      tokens_per_second: null,
      source: 'incompatible',
    };
  }

  // Memory check.
  const totalMemory = (hw.gpu ? hw.gpu.vram_gb : 0) + hw.ram_gb;
  if (quant.min_ram_gb > totalMemory) {
    return {
      status: STATUS.WONT_FIT,
      reason: `Needs ${quant.min_ram_gb} GB total memory, you have ${totalMemory} GB.`,
      tokens_per_second: null,
      source: 'memory',
    };
  }

  // Try a measured benchmark first.
  const bench = findBenchmark(benchmarks, hw, model.id, quant.label, quant.format);
  let tps;
  let source;
  if (bench) {
    tps = bench.tokens_per_second;
    source = 'measured';
  } else {
    // Theoretical: bandwidth / size, scaled by efficiency, with format boost.
    const { bandwidth, regime } = effectiveBandwidth(hw, quant.size_gb);
    let raw = (bandwidth / quant.size_gb) * EFFICIENCY[regime];
    if (quant.format === 'mlx' && hw.cpu.platform === 'apple-silicon') {
      raw *= MLX_APPLE_SILICON_BOOST;
    }
    // MoE models are faster than their total size suggests because only a subset of params activate.
    if (model.id === 'mixtral-8x7b') raw *= 2.5;
    tps = Math.min(TPS_CAP, Math.round(raw));
    source = 'estimated';
  }

  let status;
  if (tps >= FAST_THRESHOLD) status = STATUS.FAST;
  else if (tps >= OK_THRESHOLD) status = STATUS.OK;
  else status = STATUS.SLOW;

  return { status, tokens_per_second: tps, source, reason: null };
}

// Returns one row per (model, quant) combination, sorted: usable models first, then by speed.
export function evaluateAll(hw, models, benchmarks) {
  const rows = [];
  for (const model of models) {
    for (const quant of model.quants) {
      const result = estimateModel(hw, model, quant, benchmarks);
      rows.push({ model, quant, ...result });
    }
  }
  rows.sort((a, b) => {
    const order = { [STATUS.FAST]: 0, [STATUS.OK]: 1, [STATUS.SLOW]: 2, [STATUS.WONT_FIT]: 3 };
    if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
    return (b.tokens_per_second || 0) - (a.tokens_per_second || 0);
  });
  return rows;
}
