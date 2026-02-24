# CLAUDE.md — Session Log

## Session: 2026-02-24

### Environment
- Repo: `git@github.com:Null0RM/null0rm.github.io.git`
- Theme: jekyll-theme-chirpy ~> 7.4
- SSH key: `~/.ssh/github_null0rm` (ed25519, added to GitHub account)
- Git identity: `Null0RM <junghy2301@gmail.com>`

---

### Bug Fixes (commit: `386e195`)

| File | Bug | Fix |
|------|-----|-----|
| `_posts/2025-12-11-AboutEtherHiding.md` | YAML date was `2025-12-09`, mismatched filename | Changed to `2025-12-11` |
| `_config.yml` | Duplicate `kramdown:` key — `math_engine: mathjax` was silently overridden, breaking MathJax | Merged into single `kramdown:` block |
| `_config.yml` | Default Chirpy placeholder in `description:` field | Replaced with `"A technical blog covering Web3 security, blockchain internals, and CTF write-ups."` |

---

### UI Enhancements (commit: `644a164`)

File modified: `assets/css/jekyll-theme-chirpy.scss`

- **Accent color tokens** — `--accent: #3b82f6` (light) / `--accent-dark: #60a5fa` (dark)
- **Dark mode** — GitHub-style deep backgrounds (`#0f1117` main, `#161b22` sidebar/cards)
- **Links** — accent color, 1px underline, smooth hover transition
- **h2 headings** — subtle left accent bar in post content
- **Code blocks** — rounded corners (8px) + border
- **Inline code** — improved padding and border-radius
- **Blockquotes** — uniform padding, non-italic, 3px left border
- **Post cards** — lift 2px on hover with soft shadow
- **Tags** — pill shape (border-radius: 20px), hover transition
- **TOC** — colored left border matching accent
- **Tables** — rounded corners, 0.92em font
- **Smooth scroll** — `scroll-behavior: smooth` on `html`

---

### Comments (commit: `66fb1ce`)

Giscus configured in `_config.yml`:
- `provider: giscus`
- `repo: Null0RM/null0rm.github.io`
- `repo_id: R_kgDOQRlfUQ`
- `category: Announcements`
- `category_id: DIC_kwDOQRlfUc4C3E40`
- `mapping: pathname`, `reactions_enabled: 1`

---

### Pending / Optional

- **Avatar** — `avatar:` field in `_config.yml` is still empty
- **Analytics** — all analytics providers unconfigured in `_config.yml`
- **Social preview image** — `social_preview_image:` still empty
