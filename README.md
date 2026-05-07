# TokenFit 🦙

> **Will that AI model run on your computer?** Find out in 10 seconds — no terminal required.

**TokenFit** is a friendly dashboard that helps people new to local AI figure out which models
([Ollama](https://ollama.com) GGUF and [MLX](https://github.com/ml-explore/mlx) on Apple Silicon)
their hardware can actually run, and roughly how fast they'll feel.

Pick your laptop or build, and see every popular model labeled as **Fast**, **Usable**, **Slow**, or **Won't fit** —
with plain-English explanations of *why*.

> 🚧 **Work in progress.** The repo is private during initial development. Numbers are based on a small benchmark
> set + a memory-bandwidth formula; expect ±30% accuracy until the dataset grows.

---

## ✨ What you get

- 🖥️ **Two ways to pick hardware** — choose a preset machine (MacBook M-series, gaming PC builds, etc.)
  or build your own from CPU / GPU / RAM dropdowns.
- 📊 **Ollama-style results table** — model name, size, quant level, speed (t/s), and a clear status badge.
- 🍎 **MLX-aware** — Apple Silicon users see MLX models too, with the ~30% speed boost factored in.
- 🏷️ **Measured vs. estimated badges** — every speed number is labeled so you know whether it's a real
  benchmark or a calculation.
- 💡 **Click any row** for an ELI5 explanation: where the model runs (VRAM / unified memory / system RAM),
  why it's that speed, and the exact command to run it.

---

## 🚀 Try it locally

You only need Python (or any tiny static server) — no `npm`, no build step.

```bash
git clone <this repo>
cd LLMs-Tester-WIP-
python3 -m http.server 8080
```

Then open **http://localhost:8080** in your browser.

> Why a server and not just opening the file? Browsers block `fetch()` from `file://` URLs for security.
> Any local server works: `python3 -m http.server`, `npx serve`, or VS Code's *Live Server* extension.

---

## 🧠 How the speed estimates work

TokenFit uses a **three-tier system**, with each row clearly labeled:

| Source | What it means |
|---|---|
| `measured` | Real-world benchmark from the community for this exact hardware + model + quant combo. |
| `estimated` | Calculated as `(memory bandwidth ÷ model size) × efficiency`, with a +30% multiplier for MLX on Apple Silicon. |
| `won't fit` | The model needs more memory than the hardware has, *or* it's an MLX model on a non-Apple machine. |

### What the speed numbers feel like

| t/s | Feel |
|---|---|
| **50+** | Instant — replies appear faster than you can read |
| **20–50** | Conversational — comfortable back-and-forth chat |
| **8–20** | Usable but slow — fine for thoughtful Q&A |
| **< 8** | Painful — you'll wait noticeably between words |

---

## 📁 Project structure

```
TokenFit/
├── index.html              # Single-page dashboard
├── styles.css              # Component styles (badges, tooltips, tabs)
├── js/
│   ├── app.js              # UI wiring, rendering
│   └── engine.js           # Compatibility + speed estimation logic
└── data/
    ├── components.json     # CPUs, GPUs, RAM types, storage types
    ├── laptops.json        # Preset machines and their RAM variants
    ├── models.json         # Popular LLMs, their quant levels, and memory needs
    └── benchmarks.json     # Real-world measured t/s data points
```

All data lives in JSON, so contributing new hardware or benchmarks doesn't require touching code.

---

## 🛠️ Tech choices (and why they're newcomer-friendly)

- **Plain HTML + Tailwind (CDN) + vanilla ES modules.** No build step, no node_modules, no framework lock-in.
  Anyone who knows a little JavaScript can read the source and contribute.
- **Static JSON data.** Editable in any text editor. No database, no API server.
- **Deployable to GitHub Pages** with zero configuration once made public.

This is intentional: a project that helps newcomers understand local AI shouldn't itself be intimidating to read.

---

## 🤝 Contributing (later)

Once the project is stable and made public, we'll welcome:

- **Real benchmark submissions** — your hardware running a model, with the t/s you actually got.
- **More preset machines** — your laptop model with its RAM variants.
- **Additional models** — newly released models with their quant levels and memory needs.
- **Translations** and accessibility improvements.

For now, the repo is private and not yet accepting external contributions.

---

## 📜 License

TBD. Repository is currently private during initial development.

---

## 🙏 Acknowledgements

- **Ollama** for making local LLMs ridiculously easy to run.
- **MLX** team at Apple for unlocking Apple Silicon performance.
- **The r/LocalLLaMA community** for the benchmark data this project depends on.
