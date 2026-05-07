// TokenFit main app. Loads data, wires up the UI, and renders results.

import { evaluateAll, STATUS } from './engine.js';

const state = {
  components: null,
  laptops: null,
  models: null,
  benchmarks: null,
  mode: 'preset', // or 'custom'
  tomSelects: {}, // id -> Tom Select instance, for re-syncing after options change
};

// Wraps every <select> in the form with Tom Select for live search.
// We call .sync() whenever we change <select>.innerHTML so the wrapper
// picks up the new options.
function enhanceSelects() {
  const ids = [
    'preset-machine', 'preset-variant',
    'custom-cpu-vendor', 'custom-cpu',
    'custom-gpu-vendor', 'custom-gpu',
    'custom-ram-gen', 'custom-ram-speed', 'custom-ram-sticks',
    'custom-storage',
  ];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) continue;
    state.tomSelects[id] = new TomSelect(el, {
      maxOptions: 200,
      // Show search box only when the list has enough items to warrant it.
      controlInput: el.options.length > 5 || el.querySelector('optgroup') ? '<input>' : null,
      plugins: [],
      render: {
        no_results: (data) => `<div class="no-results">No matches for "${data.input}"</div>`,
      },
    });
  }
}

// Replaces the underlying <select>'s options and reflects them in the wrapper.
function setSelectOptions(id, html, value) {
  const el = document.getElementById(id);
  el.innerHTML = html;
  if (value !== undefined) el.value = value;
  const ts = state.tomSelects[id];
  if (ts) {
    ts.sync();
    if (value !== undefined) ts.setValue(value, true);
  }
}

async function loadData() {
  const [components, laptops, models, benchmarks] = await Promise.all([
    fetch('data/components.json').then(r => r.json()),
    fetch('data/laptops.json').then(r => r.json()),
    fetch('data/models.json').then(r => r.json()),
    fetch('data/benchmarks.json').then(r => r.json()),
  ]);
  state.components = components;
  state.laptops = laptops;
  state.models = models.models;
  state.benchmarks = benchmarks.benchmarks;
}

function getComponent(kind, id) {
  return state.components[kind].find(c => c.id === id);
}

function buildHardware() {
  if (state.mode === 'preset') {
    const presetId = document.getElementById('preset-machine').value;
    const variantIdx = parseInt(document.getElementById('preset-variant').value, 10);
    const preset = state.laptops.presets.find(p => p.id === presetId);
    if (!preset) return null;
    const variant = preset.variants[variantIdx];
    return {
      cpu: getComponent('cpus', preset.cpu_id),
      gpu: preset.gpu_id !== 'none' ? getComponent('gpus', preset.gpu_id) : null,
      ramType: getComponent('ram_types', preset.ram_type_id),
      ram_gb: variant.ram_gb,
    };
  } else {
    const cpu = getComponent('cpus', document.getElementById('custom-cpu').value);
    const gpuVendor = document.getElementById('custom-gpu-vendor').value;
    let gpu = null;
    if (gpuVendor !== 'none') {
      const gpuId = document.getElementById('custom-gpu').value;
      gpu = gpuId && gpuId !== 'none' ? getComponent('gpus', gpuId) : null;
    }
    // Apple Silicon SoCs use unified memory; ignore any picked GPU to avoid
    // double-counting VRAM in the memory budget.
    if (cpu && cpu.platform === 'apple-silicon') gpu = null;
    const gen = document.getElementById('custom-ram-gen').value;
    const speed = parseInt(document.getElementById('custom-ram-speed').value, 10);
    const sticks = parseInt(document.getElementById('custom-ram-sticks').value, 10);
    const channels = sticks === 1 ? 1 : 2;
    // Bandwidth per channel in GB/s = MT/s * 8 bytes / 1000.
    const bandwidth_per_channel_gbps = +(speed * 8 / 1000).toFixed(1);
    const ramType = {
      id: `${gen}-${speed}`,
      name: `${gen.toUpperCase()}-${speed} ${sticks === 1 ? 'single' : 'dual'} channel`,
      bandwidth_per_channel_gbps,
      channels,
    };
    const ram_gb = parseInt(document.getElementById('custom-ram-gb').value, 10) || 16;
    return { cpu, gpu, ramType, ram_gb };
  }
}

function populateCpus(vendor) {
  const list = state.components.cpus.filter(c => {
    if (vendor === 'apple') return c.platform === 'apple-silicon';
    return c.vendor === vendor;
  });
  const html = list.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  const defaults = { apple: 'apple-m3-pro', intel: 'intel-i9-14900k', amd: 'amd-7700x' };
  const def = list.find(c => c.id === defaults[vendor]) ? defaults[vendor] : (list[0] && list[0].id);
  setSelectOptions('custom-cpu', html, def);
}

function populateGpus(vendor) {
  const wrap = document.getElementById('custom-gpu-wrap');
  if (vendor === 'none') {
    wrap.classList.add('hidden');
    return;
  }
  wrap.classList.remove('hidden');
  const list = state.components.gpus.filter(g => g.vendor === vendor);
  const html = list.map(g => `<option value="${g.id}">${g.name}</option>`).join('');
  const defaults = { nvidia: 'rtx-4070', amd: 'rx-7900-xtx' };
  const def = list.find(g => g.id === defaults[vendor]) ? defaults[vendor] : (list[0] && list[0].id);
  setSelectOptions('custom-gpu', html, def);
}

// When the user picks Apple Silicon, GPU and RAM dropdowns are irrelevant
// (the SoC has unified memory and integrated graphics). Hide them and show a hint.
function applyApplePlatformConstraints() {
  const cpuVendor = document.getElementById('custom-cpu-vendor').value;
  const isApple = cpuVendor === 'apple';
  const gpuVendor = document.getElementById('custom-gpu-vendor');
  const gpuWrap = document.getElementById('custom-gpu-wrap');
  const noteId = 'apple-silicon-note';
  let note = document.getElementById(noteId);

  const gpuVendorTs = state.tomSelects['custom-gpu-vendor'];
  if (isApple) {
    if (gpuVendorTs) gpuVendorTs.setValue('none', true); else gpuVendor.value = 'none';
    if (gpuVendorTs) gpuVendorTs.disable(); else gpuVendor.disabled = true;
    gpuWrap.classList.add('hidden');
    if (!note) {
      note = document.createElement('div');
      note.id = noteId;
      note.className = 'sm:col-span-2 text-xs text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2';
      note.textContent = 'Apple Silicon uses unified memory and integrated graphics. The GPU dropdown and DDR4/DDR5 settings below are ignored — pick a preset MacBook for an exact unified-memory bandwidth match.';
      gpuVendor.closest('.grid').appendChild(note);
    }
  } else {
    if (gpuVendorTs) gpuVendorTs.enable(); else gpuVendor.disabled = false;
    if (note) note.remove();
  }
}

// Speed grades per generation. Stepped at common JEDEC / popular XMP values.
const RAM_SPEEDS = {
  ddr4: [2400, 2666, 2933, 3000, 3200, 3600, 3733, 4000],
  ddr5: [4800, 5200, 5600, 6000, 6400, 6800, 7200, 7600, 8000],
};
const RAM_DEFAULT_SPEED = { ddr4: 3200, ddr5: 6000 };

function populateRamSpeeds(gen) {
  const sel = document.getElementById('custom-ram-speed');
  // Apply user-requested ranges: DDR4 2400-4000, DDR5 5600-8000.
  const min = gen === 'ddr4' ? 2400 : 5600;
  const max = gen === 'ddr4' ? 4000 : 8000;
  const options = RAM_SPEEDS[gen].filter(s => s >= min && s <= max);
  const prev = parseInt(sel.value, 10);
  const def = options.includes(RAM_DEFAULT_SPEED[gen]) ? RAM_DEFAULT_SPEED[gen] : options[0];
  const selected = options.includes(prev) ? prev : def;
  const html = options.map(s => `<option value="${s}">${s} MT/s</option>`).join('');
  setSelectOptions('custom-ram-speed', html, String(selected));
}

function populateSelects() {
  // Presets — grouped by category for easier scanning.
  const presetSel = document.getElementById('preset-machine');
  const byCategory = state.laptops.presets.reduce((acc, p) => {
    (acc[p.category || 'Other'] ||= []).push(p);
    return acc;
  }, {});
  presetSel.innerHTML = Object.entries(byCategory)
    .map(([cat, items]) =>
      `<optgroup label="${cat}">${items.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}</optgroup>`
    ).join('');
  populateVariants();
  presetSel.addEventListener('change', () => { populateVariants(); render(); });
  document.getElementById('preset-variant').addEventListener('change', render);

  // Custom: CPU & GPU lists are populated based on the selected brand.
  populateCpus(document.getElementById('custom-cpu-vendor').value);
  populateGpus(document.getElementById('custom-gpu-vendor').value);
  applyApplePlatformConstraints();

  document.getElementById('custom-cpu-vendor').addEventListener('change', e => {
    populateCpus(e.target.value);
    applyApplePlatformConstraints();
    render();
  });
  document.getElementById('custom-gpu-vendor').addEventListener('change', e => {
    populateGpus(e.target.value);
    render();
  });

  // Custom: storage
  document.getElementById('custom-storage').innerHTML = state.components.storage_types
    .map(s => `<option value="${s.id}">${s.name}</option>`).join('');
  document.getElementById('custom-storage').value = 'nvme-gen4';

  // Populate the speed dropdown based on generation; repopulate when generation changes.
  populateRamSpeeds(document.getElementById('custom-ram-gen').value);
  document.getElementById('custom-ram-gen').addEventListener('change', e => {
    populateRamSpeeds(e.target.value);
    render();
  });

  // Wire change events on the model-level dropdowns.
  ['custom-cpu', 'custom-gpu', 'custom-ram-speed', 'custom-ram-sticks', 'custom-ram-gb', 'custom-storage']
    .forEach(id => document.getElementById(id).addEventListener('change', render));
  // Re-apply Apple constraints whenever the CPU model changes (e.g. user
  // switches to Apple via brand and we want the note to appear).
  document.getElementById('custom-cpu').addEventListener('change', applyApplePlatformConstraints);
  document.getElementById('custom-ram-gb').addEventListener('input', render);
}

function populateVariants() {
  const presetId = document.getElementById('preset-machine').value;
  const preset = state.laptops.presets.find(p => p.id === presetId);
  const html = preset.variants
    .map((v, i) => `<option value="${i}">${v.label}</option>`).join('');
  setSelectOptions('preset-variant', html, '0');
}

function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.remove('hidden');
      state.mode = btn.dataset.tab;
      render();
    });
  });
}

function statusBadge(status) {
  const map = {
    [STATUS.FAST]: ['badge-fast', 'Fast'],
    [STATUS.OK]:   ['badge-ok',   'Usable'],
    [STATUS.SLOW]: ['badge-slow', 'Slow'],
    [STATUS.WONT_FIT]: ['badge-no', "Won't fit"],
  };
  const [cls, label] = map[status];
  return `<span class="badge ${cls}">${label}</span>`;
}

function speedCell(row) {
  if (row.tokens_per_second == null) return '—';
  const srcBadge = row.source === 'measured'
    ? '<span class="badge badge-measured">measured</span>'
    : '<span class="badge badge-estimated">estimated</span>';
  return `<div class="flex items-center gap-2"><span class="font-mono">${row.tokens_per_second} t/s</span> ${srcBadge}</div>`;
}

function explainRow(hw, row) {
  const m = row.model;
  const q = row.quant;
  const totalMem = (hw.gpu ? hw.gpu.vram_gb : 0) + hw.ram_gb;

  if (row.status === STATUS.WONT_FIT) {
    return `<strong>Why it won't run:</strong> ${row.reason}`;
  }

  let where;
  if (hw.cpu.platform === 'apple-silicon') {
    where = `runs in unified memory (the SoC handles it directly)`;
  } else if (hw.gpu && hw.gpu.vram_gb >= q.size_gb) {
    where = `fits in your ${hw.gpu.name}'s ${hw.gpu.vram_gb} GB VRAM, which is the fast path`;
  } else {
    where = `is too big for your GPU's VRAM, so it'll spill to system RAM (much slower)`;
  }

  let speedTalk;
  if (row.status === STATUS.FAST) speedTalk = "feels conversational — replies stream as fast as you read";
  else if (row.status === STATUS.OK) speedTalk = "is usable, but a bit slow — fine for thoughtful answers, less so for chat";
  else speedTalk = "will feel slow — you'll wait noticeably between words";

  let formatNote = '';
  if (q.format === 'mlx') {
    formatNote = ` <em>(MLX format runs ~30% faster than GGUF on Apple Silicon because it uses Metal natively.)</em>`;
  }

  const cmd = q.format === 'gguf'
    ? `<code class="bg-slate-100 px-1.5 py-0.5 rounded text-xs">ollama run ${m.ollama_tag}</code>`
    : `<code class="bg-slate-100 px-1.5 py-0.5 rounded text-xs">${m.mlx_repo}</code>`;

  return `
    <p>${m.description}</p>
    <p class="mt-1.5">At <strong>${q.label}</strong>, this model ${where}. At ~${row.tokens_per_second} t/s it ${speedTalk}.${formatNote}</p>
    <p class="mt-1.5 text-slate-600">Total memory you have: ${totalMem} GB · Model needs: ${q.min_ram_gb} GB · Run with: ${cmd}</p>
  `;
}

function renderSummary(rows) {
  const counts = { fast: 0, ok: 0, slow: 0, wont_fit: 0 };
  for (const r of rows) counts[r.status]++;
  document.getElementById('summary').innerHTML = `
    <div class="summary-chip fast"><div><div class="count">${counts.fast}</div><div class="label">Fast</div></div></div>
    <div class="summary-chip ok"><div><div class="count">${counts.ok}</div><div class="label">Usable</div></div></div>
    <div class="summary-chip slow"><div><div class="count">${counts.slow}</div><div class="label">Slow</div></div></div>
    <div class="summary-chip no"><div><div class="count">${counts.wont_fit}</div><div class="label">Won't fit</div></div></div>
  `;
}

function renderPresetSummary(hw) {
  const el = document.getElementById('preset-summary');
  if (!el || !hw) return;
  const totalMem = (hw.gpu ? hw.gpu.vram_gb : 0) + hw.ram_gb;
  const parts = [
    hw.cpu.name,
    hw.gpu ? `${hw.gpu.name} (${hw.gpu.vram_gb} GB VRAM)` : 'no discrete GPU',
    `${hw.ram_gb} GB RAM`,
    `total memory budget: ${totalMem} GB`,
  ];
  el.textContent = parts.join(' · ');
}

function buildSubmitUrl(hw) {
  // Pre-fills a GitHub issue. Repo path is read from a meta tag if present, else placeholder.
  const repo = (document.querySelector('meta[name="github-repo"]')?.content) || 'OWNER/REPO';
  const title = `[benchmark] ${hw.cpu.name}${hw.gpu ? ' + ' + hw.gpu.name : ''} (${hw.ram_gb} GB)`;
  const body = [
    '<!-- Thanks for submitting a benchmark! Fill in the t/s you actually measured. -->',
    '',
    '**Hardware**',
    `- CPU: ${hw.cpu.name} (\`${hw.cpu.id}\`)`,
    `- GPU: ${hw.gpu ? `${hw.gpu.name} (\`${hw.gpu.id}\`)` : 'none'}`,
    `- RAM: ${hw.ram_gb} GB ${hw.ramType ? hw.ramType.name : ''}`,
    '',
    '**Model**',
    '- Model ID: `<e.g. llama3.1-8b>`',
    '- Quant: `<e.g. Q4_K_M or 4-bit>`',
    '- Format: `<gguf | mlx>`',
    '',
    '**Result**',
    '- Tokens / second: `<your number>`',
    '- How you measured: `<e.g. ollama run ... --verbose, mlx_lm.generate, ...>`',
    '- Source link (optional): `<reddit/youtube/etc>`',
  ].join('\n');
  return `https://github.com/${repo}/issues/new?labels=benchmark&title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
}

function render() {
  const hw = buildHardware();
  if (!hw) return;
  renderPresetSummary(hw);
  const rows = evaluateAll(hw, state.models, state.benchmarks);
  renderSummary(rows);

  const body = document.getElementById('results-body');
  body.innerHTML = rows.map((row, i) => {
    const formatCls = row.quant.format === 'mlx' ? 'mlx' : 'gguf';
    return `
      <tr class="row-main" data-row="${i}">
        <td class="font-medium">${row.model.name}</td>
        <td class="hidden sm:table-cell"><span class="format-pill ${formatCls}">${row.quant.format.toUpperCase()}</span></td>
        <td class="font-mono text-xs hidden md:table-cell">${row.quant.label}</td>
        <td class="font-mono text-xs hidden md:table-cell">${row.quant.size_gb} GB</td>
        <td>${speedCell(row)}</td>
        <td>${statusBadge(row.status)}</td>
        <td class="text-slate-400 text-xs"><span class="chevron">▾</span></td>
      </tr>
      <tr class="expand-row hidden" data-expand="${i}">
        <td colspan="7">${explainRow(hw, row)}</td>
      </tr>
    `;
  }).join('');

  body.querySelectorAll('tr.row-main').forEach(tr => {
    tr.addEventListener('click', () => {
      const idx = tr.dataset.row;
      const exp = body.querySelector(`tr[data-expand="${idx}"]`);
      exp.classList.toggle('hidden');
      tr.classList.toggle('expanded');
    });
  });

  // Wire submit button (rebound each render so URL reflects current hardware).
  const btn = document.getElementById('submit-bench-btn');
  btn.onclick = () => window.open(buildSubmitUrl(hw), '_blank', 'noopener');
}

function setupTooltips() {
  const tip = document.getElementById('tooltip');
  document.addEventListener('mouseover', e => {
    const t = e.target.closest('[data-tip]');
    if (!t) return;
    tip.textContent = t.dataset.tip;
    tip.classList.remove('hidden');
    const rect = t.getBoundingClientRect();
    tip.style.top = (window.scrollY + rect.bottom + 6) + 'px';
    tip.style.left = (window.scrollX + rect.left - 8) + 'px';
  });
  document.addEventListener('mouseout', e => {
    if (e.target.closest('[data-tip]')) tip.classList.add('hidden');
  });
}

async function main() {
  try {
    await loadData();
  } catch (err) {
    document.getElementById('results-body').innerHTML = `
      <tr><td colspan="7" class="py-8 text-center text-sm text-red-600">
        Couldn't load data files. If you opened this with file://, please run a local server instead — see README.
      </td></tr>`;
    return;
  }
  populateSelects();
  enhanceSelects();
  setupTabs();
  setupTooltips();
  render();
}

main();
