#!/usr/bin/env python3
"""Offline repository checks. Does not call providers or certify live operation."""
import ast
import json
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]

def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('duplicate JSON key: ' + key)
        result[key] = value
    return result

def main():
    errors = []
    config = json.loads((ROOT / '.quality-gate.json').read_text())
    names = subprocess.check_output(['git', 'ls-files', '-z'], cwd=ROOT).decode().split('\0')
    for required in config['required_files']:
        path = ROOT / required
        if not path.is_file() or not path.stat().st_size:
            errors.append(required + ': required file absent or empty')
    counts = {'json': 0, 'python': 0, 'javascript': 0, 'text': 0}
    for name in filter(None, names):
        path = ROOT / name
        if not path.is_file():
            errors.append(name + ': tracked file missing')
            continue
        if path.name in {'.env', '.env.local', '.env.production', '.env.development'}:
            errors.append(name + ': runtime environment file must not be tracked')
        try:
            source = path.read_text(encoding='utf-8')
        except UnicodeDecodeError:
            continue
        counts['text'] += 1
        if re.search(r'^<{7} |^>{7} ', source, re.M):
            errors.append(name + ': merge conflict marker')
        if re.search(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----', source):
            errors.append(name + ': private key material detected (value redacted)')
        if re.search(r'\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,}|AKIA[A-Z0-9]{16})\b', source):
            errors.append(name + ': credential pattern detected (value redacted)')
        try:
            if path.suffix == '.json' and path.name not in config.get('jsonc_files', []):
                json.loads(source, object_pairs_hook=unique_object,
                           parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))
                counts['json'] += 1
            if path.suffix == '.py':
                ast.parse(source, filename=name)
                counts['python'] += 1
            if path.suffix in {'.js', '.mjs', '.cjs'}:
                result = subprocess.run(['node', '--check', str(path)], capture_output=True, text=True)
                if result.returncode:
                    errors.append(name + ': JavaScript syntax check failed')
                counts['javascript'] += 1
        except (ValueError, SyntaxError) as exc:
            # JSON errors never echo the document, which might contain credentials.
            errors.append(name + ': invalid ' + ('Python syntax' if path.suffix == '.py' else 'JSON'))
    evidence = {'repository': config['repository'], 'scope': config['scope'],
                'tested_sha': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT).decode().strip(),
                'counts': counts, 'errors': errors,
                'live_runtime_certified': False}
    (ROOT / 'quality-gate-evidence.json').write_text(json.dumps(evidence, indent=2) + '\n')
    print(json.dumps(evidence, indent=2))
    return bool(errors)

if __name__ == '__main__':
    sys.exit(main())
