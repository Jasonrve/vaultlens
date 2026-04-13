# Contributing to VaultLens

Thank you for your interest in contributing to VaultLens! This guide will help you get started.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [How to Contribute](#how-to-contribute)
- [Development Setup](#development-setup)
- [Pull Request Process](#pull-request-process)
- [Coding Standards](#coding-standards)
- [Commit Messages](#commit-messages)
- [Reporting Issues](#reporting-issues)

## Code of Conduct

This project adheres to our [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code. Please report unacceptable behavior by opening an issue.

## How to Contribute

### Reporting Bugs

1. Check existing [issues](https://github.com/Jasonrve/vaultlens/issues) to avoid duplicates
2. Use the [Bug Report template](https://github.com/Jasonrve/vaultlens/issues/new?template=bug_report.md)
3. Include steps to reproduce, expected behavior, and environment details

### Suggesting Features

1. Check existing [issues](https://github.com/Jasonrve/vaultlens/issues) and [discussions](https://github.com/Jasonrve/vaultlens/discussions) first
2. Use the [Feature Request template](https://github.com/Jasonrve/vaultlens/issues/new?template=feature_request.md)
3. Explain the use case and why the feature would be valuable

### Contributing Code

1. Fork the repository
2. Create a feature branch from `main`
3. Make your changes
4. Submit a pull request

## Development Setup

See [docs/development.md](docs/development.md) for detailed setup instructions.

### Quick Start

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/VaultLens.git
cd VaultLens

# Start local Vault
docker compose up -d

# Start development server
cd app
npm install
npm run dev
```

## Pull Request Process

1. **Branch naming**: Use descriptive branch names:
   - `feat/description` — New features
   - `fix/description` — Bug fixes
   - `docs/description` — Documentation changes
   - `refactor/description` — Code refactoring

2. **Before submitting**:
   - Ensure the app builds without errors: `cd app && npm run build`
   - Ensure linting passes: `cd app && npm run lint`
   - Test your changes against the [testing checklist](docs/development.md#testing-checklist)
   - Update documentation if applicable

3. **PR description**: Clearly describe what your PR does, why it's needed, and how to test it

4. **Review**: At least one maintainer must approve before merging

5. **Merge**: Squash-and-merge is preferred for clean history

## Coding Standards

### TypeScript
- Use strict TypeScript — no `any` types unless absolutely necessary
- Prefer interfaces over type aliases for object shapes
- Export types from `types/index.ts`

### React
- Use functional components with hooks
- Keep components focused — one component per file
- Use `useEffect` cleanup to prevent memory leaks
- Prefer controlled forms

### Backend
- All routes use `async/await` with proper error handling
- Catch `VaultError` to handle Vault-specific errors before `next(error)`
- Never expose the system token or raw secret values in responses

### Styling
- Use TailwindCSS utility classes
- Follow existing color conventions (blue primary: `#1563ff`)
- Responsive design is encouraged but not mandatory for admin features

### Security
- Validate all user input at API boundaries
- Never log tokens or secret values
- Use parameterized queries (if database is ever added)
- Follow the existing auth middleware pattern for protected routes

## Commit Messages

Follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
type(scope): description

[optional body]
```

### Types
- `feat` — New feature
- `fix` — Bug fix
- `docs` — Documentation only
- `style` — Formatting, no code change
- `refactor` — Code restructuring
- `test` — Adding or updating tests
- `chore` — Tooling, dependencies, CI

### Examples
```
feat(secrets): add custom metadata editing UI
fix(sharing): prevent 401 redirect on shared secret page
docs(readme): rewrite user-facing documentation
chore(docker): add multi-arch build workflow
```

## Reporting Issues

### Security Vulnerabilities

**Do NOT open a public issue for security vulnerabilities.**

Please see our [Security Policy](SECURITY.md) for responsible disclosure instructions.

### General Issues

Use the GitHub issue tracker with the appropriate template. Include:
- Clear description of the problem
- Steps to reproduce
- Expected vs actual behavior
- Environment details (OS, browser, Vault version, VaultLens version)

## Recognition

Contributors are recognized in our release notes. Significant contributors may be added as project maintainers.

---

Thank you for helping make VaultLens better! 🎉
