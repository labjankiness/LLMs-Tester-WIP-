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

// Format multiplier. MLX on Apple Silicon is ~30% faster than GGUF on the same chip
// because it uses Metal natively and exploits unified memory better.
const MLX_APPLE_SILICON_BOOST = 1.3;

// Realistic-vs-theoretical multiplier. Memory bandwidth alone overestimates t/s
// because real inference also has compute and KV-cache overhead.
const REAL_WORLD_EFFICIENCY = 0.45;

export function findBenchmark(benchmarks, hw, modelId, quantLabel, format) {
  return benchmarks.find(b =>
    b.cpu_id === hw.cpu.id &&
    b.gpu_id === (hw.gpu ? hw.gpu.id : 'none') &&
    b.model_id === modelId &&
    b.quant_label === quantLabel &&
    b.format === format
  );
}

// Returns the effective memory bandwidth (GB/s) the model will actually use.
// On Apple Silicon, the SoC bandwidth applies (model lives in unified memory).
// On x86 with a GPU, if the model fits in VRAM we use GPU bandwidth; otherwise system RAM bandwidth.
function effectiveBandwidth(hw, sizeGb) {
  if (hw.cpu.platform === 'apple-silicon') {
    return hw.cpu.memory_bandwidth_gbps;
  }
  if (hw.gpu && hw.gpu.vram_gb >= sizeGb && hw.gpu.memory_bandwidth_gbps > 0) {
    return hw.gpu.memory_bandwidth_gbps;
  }
  // Fall back to system RAM bandwidth (dual-channel assumed).
  if (hw.ramType && hw.ramType.bandwidth_per_channel_gbps > 0) {
    return hw.ramType.bandwidth_per_channel_gbps * 2;
  }
  return hw.cpu.memory_bandwidth_gbps;
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
    const bandwidth = effectiveBandwidth(hw, quant.size_gb);
    let raw = (bandwidth / quant.size_gb) * REAL_WORLD_EFFICIENCY;
    if (quant.format === 'mlx' && hw.cpu.platform === 'apple-silicon') {
      raw *= MLX_APPLE_SILICON_BOOST;
    }
    // MoE models are faster than their total size suggests because only a subset of params activate.
    if (model.id === 'mixtral-8x7b') raw *= 2.5;
    tps = Math.round(raw);
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
