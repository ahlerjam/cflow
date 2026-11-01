---
type: regex
target: { source: file, path: lint.sh }
pattern: '^(?=[\s\S]*--quiet)(?:(?![\s\S]*&& echo "lint failed")|[\s\S]*\nexit\s+("?\$|\d))'
---
