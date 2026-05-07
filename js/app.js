// TokenFit main app. Loads data, wires up the UI, and renders results.

import { evaluateAll, STATUS } from './engine.js';

const state = {
  components: null,
  laptops: null,
  models: null,
  benchmarks: null,
  mode: 'preset', // or 'custom'
};

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
    const gpuId = document.getElementById('custom-gpu').value;
    const gpu = gpuId !== 'none' ? getComponent('gpus', gpuId) : null;
    const ramType = getComponent('ram_types', document.getElementById('custom-ram-type').value);
    const ram_gb = parseInt(document.getElementById('custom-ram-gb').value, 10) || 16;
    return { cpu, gpu, ramType, ram_gb };
  }
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

  // Custom: CPUs
  document.getElementById('custom-cpu').innerHTML = state.components.cpus
    .map(c => `<option value="${c.id}">${c.name}</option>`).join('');

  // Custom: GPUs
  document.getElementById('custom-gpu').innerHTML = state.components.gpus
    .map(g => `<option value="${g.id}">${g.name}</option>`).join('');

  // Custom: RAM types
  document.getElementById('custom-ram-type').innerHTML = state.components.ram_types
    .filter(r => r.id !== 'unified')
    .map(r => `<option value="${r.id}">${r.name}</option>`).join('');

  // Custom: storage
  document.getElementById('custom-storage').innerHTML = state.components.storage_types
    .map(s => `<option value="${s.id}">${s.name}</option>`).join('');

  // Set sensible defaults for custom (RTX 4070 + DDR5-6000 desktop).
  document.getElementById('custom-cpu').value = 'amd-7700x';
  document.getElementById('custom-gpu').value = 'rtx-4070';
  document.getElementById('custom-ram-type').value = 'ddr5-6000';
  document.getElementById('custom-storage').value = 'nvme-gen4';

  // Wire change events on custom inputs.
  ['custom-cpu', 'custom-gpu', 'custom-ram-type', 'custom-ram-gb', 'custom-storage']
    .forEach(id => document.getElementById(id).addEventListener('change', render));
  document.getElementById('custom-ram-gb').addEventListener('input', render);
}

function populateVariants() {
  const presetId = document.getElementById('preset-machine').value;
  const preset = state.laptops.presets.find(p => p.id === presetId);
  const sel = document.getElementById('preset-variant');
  sel.innerHTML = preset.variants
    .map((v, i) => `<option value="${i}">${v.label}</option>`).join('');
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
  setupTabs();
  setupTooltips();
  render();
}

main();
